/**
 * Fine-tune job runner. Wires {@link FinetuneJobInput} → background training
 * process → job-status updates in `storage.phase4`.
 *
 * The trainer itself is opt-in (gated by `phase4Settings.finetuneEnabled`) and
 * requires the user to provide a Python training script at
 * `<userData>/finetune/train.py`. When the script is missing — the default for
 * most installs — the runner stamps the job as `failed` with a clear,
 * actionable reason instead of silently leaving it in "queued" forever.
 *
 * The training process is REQUIRED to:
 *   - read --base-model, --dataset-id, --method, --output-dir from argv
 *   - write progress lines to stdout (free-form; captured for diagnostics)
 *   - on success print exactly `ARTIFACT: <absolute path>` as the final line
 *
 * Promotion to the active model is NOT done here — that always flows through
 * the eval gate + ModelRegistry per the Phase 4 design. The runner stops at
 * `evaluating` (or `failed`); the eval pipeline takes it from there.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { FinetuneJob, FinetuneJobInput } from "@nlc/shared";
import type { Services } from "./services.js";

const ARTIFACT_LINE_PREFIX = "ARTIFACT:";
const STDOUT_CAP = 100 * 1024;
const TRAINING_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes; user can extend by editing the constant

export class FinetuneRunner {
  constructor(
    private readonly services: Services,
    private readonly userDataDir: string,
  ) {}

  /**
   * Resolve the path to the user-supplied training script. Returns null when
   * the file is absent so the caller can stamp a clean "missing script" error
   * instead of spawning into the void.
   */
  scriptPath(): string | null {
    const p = path.join(this.userDataDir, "finetune", "train.py");
    return fs.existsSync(p) ? p : null;
  }

  /**
   * Kick off a job that's already been registered in storage (status="queued").
   * Returns a promise that resolves AFTER the final status update is written;
   * callers typically fire-and-forget so the IPC handler stays snappy.
   */
  async run(job: FinetuneJob): Promise<void> {
    const script = this.scriptPath();
    if (!script) {
      this.fail(
        job.id,
        `No fine-tune training script found at <userData>/finetune/train.py. ` +
          `Provide a script that accepts --base-model, --dataset-id, --method, --output-dir and emits ` +
          `"ARTIFACT: <path>" on success, then re-queue the job.`,
      );
      return;
    }

    this.services.storage.finetune.updateFinetuneJob(job.id, { status: "training" });

    const outputDir = path.join(this.userDataDir, "finetune", "artifacts", job.id);
    try {
      fs.mkdirSync(outputDir, { recursive: true });
    } catch (err) {
      this.fail(job.id, `Failed to create output dir: ${asMessage(err)}`);
      return;
    }

    try {
      const artifactPath = await runScript(script, {
        baseModel: job.baseModel,
        datasetId: job.datasetId,
        method: job.method,
        outputDir,
      });
      this.services.storage.finetune.updateFinetuneJob(job.id, {
        status: "evaluating",
        artifactPath,
      });
    } catch (err) {
      this.fail(job.id, asMessage(err));
    }
  }

  /**
   * Replay any queued jobs that may have been interrupted by an app restart.
   * Called once at startup so a job the user left queued continues instead of
   * sitting forever. Safe to call when finetune is disabled — it short-circuits.
   */
  resumeQueued(): void {
    if (!this.services.phase4Settings.get().finetuneEnabled) return;
    const jobs = this.services.storage.finetune.listFinetuneJobs();
    for (const job of jobs) {
      if (job.status === "queued") {
        void this.run(job);
      }
    }
  }

  private fail(jobId: string, reason: string): void {
    this.services.storage.finetune.updateFinetuneJob(jobId, {
      status: "failed",
      evalResult: {
        baselineScore: 0,
        candidateScore: 0,
        delta: 0,
        perTaskRegressions: [],
        holdoutScore: 0,
        holdoutBaselineScore: 0,
        gatePassed: false,
        gateReasons: [reason],
      },
    });
  }
}

/** Validate that the IPC handler can synchronously create a job + dispatch it. */
export function dispatchFinetuneJob(
  runner: FinetuneRunner,
  services: Services,
  input: FinetuneJobInput,
): FinetuneJob {
  const job = services.storage.finetune.createFinetuneJob(input);
  // Fire-and-forget. Errors inside `run` are translated to status="failed",
  // so we don't need to surface them to the caller — the UI subscribes to the
  // job list and will see the status transition.
  void runner.run(job).catch(() => {
    /* runner already stamps failures into storage */
  });
  return job;
}

type ScriptArgs = {
  baseModel: string;
  datasetId: string;
  method: string;
  outputDir: string;
};

async function runScript(scriptPath: string, args: ScriptArgs): Promise<string> {
  return new Promise((resolve, reject) => {
    const argv = [
      scriptPath,
      "--base-model",
      args.baseModel,
      "--dataset-id",
      args.datasetId,
      "--method",
      args.method,
      "--output-dir",
      args.outputDir,
    ];
    const child = spawn("python", argv, {
      cwd: path.dirname(scriptPath),
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      reject(new Error(`Training timed out after ${TRAINING_TIMEOUT_MS / 1000}s.`));
    }, TRAINING_TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < STDOUT_CAP) stdout += chunk.toString("utf-8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < STDOUT_CAP) stderr += chunk.toString("utf-8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Failed to spawn training process — is python on PATH? (${err.message})`,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `Training exited with code ${code}. stderr: ${stderr.slice(-1024) || "(empty)"}`,
          ),
        );
        return;
      }
      const artifact = extractArtifactPath(stdout);
      if (!artifact) {
        reject(
          new Error(
            `Training succeeded (exit 0) but produced no ARTIFACT: line. ` +
              `The script must print "ARTIFACT: <absolute path>" as the final line on success.`,
          ),
        );
        return;
      }
      resolve(artifact);
    });
  });
}

/**
 * Extract the artifact path from the training stdout. Convention: the script
 * emits `ARTIFACT: <absolute path>` as the final line on success. We scan
 * from the end so chatty progress logging before it doesn't shadow the marker.
 */
export function extractArtifactPath(stdout: string): string | null {
  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line && line.startsWith(ARTIFACT_LINE_PREFIX)) {
      return line.slice(ARTIFACT_LINE_PREFIX.length).trim();
    }
  }
  return null;
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
