/**
 * Phase 4 storage facade. The Phase 4 packages depend on these port interfaces
 * (defined below) rather than the concrete Storage class — same pattern as
 * Phase 3's MemoryStore. The real implementation is {@link Phase4Storage},
 * which is composed into the main Storage instance by the desktop app.
 */
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  Checkpoint,
  CheckpointKind,
  DistributedAssignment,
  EvalRunResult,
  EvalTask,
  FeedbackSignal,
  FeedbackSignalInput,
  FinetuneJob,
  FinetuneJobInput,
  FinetuneStatus,
  FrozenSuiteSnapshot,
  GlobalPattern,
  GlobalPatternInput,
  KGEdge,
  ModelRegistryEntry,
  PluginInstallation,
  PluginManifest,
  PreferenceDataset,
  PreferencePair,
  Proposal,
  ProposalInput,
  ProposalStatus,
  StyleSpec,
  WorkerNode,
  WorkspaceContributionMode,
} from "@nlc/shared";
import {
  embeddingToBlob,
  embeddingFromBlob,
  toCheckpoint,
  toDistributedAssignment,
  toEvalRunResult,
  toEvalTask,
  toFeedbackSignal,
  toFinetuneJob,
  toFrozenSuiteSnapshot,
  toGlobalPattern,
  toKGEdge,
  toModelRegistryEntry,
  toPluginInstallation,
  toPreferenceDataset,
  toPreferencePair,
  toProposal,
  toStyleSpec,
  toWorkerNode,
  type CheckpointRow,
  type DistributedAssignmentRow,
  type EvalRunRow,
  type EvalTaskRow,
  type FeedbackSignalRow,
  type FinetuneJobRow,
  type FrozenSuiteSnapshotRow,
  type GlobalPatternRow,
  type KGEdgeRow,
  type ModelRegistryRow,
  type PluginInstallationRow,
  type PreferenceDatasetRow,
  type PreferencePairRow,
  type ProposalRow,
  type StyleSpecRow,
  type WorkerNodeRow,
  type WorkspaceContributionRow,
} from "./phase4-rows.js";

export class Phase4Storage {
  constructor(private readonly db: Database.Database) {}

  // ===== global patterns =====

  createGlobalPattern(input: GlobalPatternInput): GlobalPattern {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO global_patterns
         (id,title,description,example_snippet,source_projects,tags,confidence,embedding,created_at,last_applied_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.title,
        input.description,
        input.exampleSnippet,
        JSON.stringify(input.sourceProjects),
        JSON.stringify(input.tags),
        input.confidence,
        input.embedding.length ? embeddingToBlob(input.embedding) : null,
        now,
        now,
      );
    return this.getGlobalPattern(id)!;
  }

  getGlobalPattern(id: string): GlobalPattern | null {
    const row = this.db
      .prepare("SELECT * FROM global_patterns WHERE id = ?")
      .get(id) as GlobalPatternRow | undefined;
    return row ? toGlobalPattern(row) : null;
  }

  listGlobalPatterns(limit = 200): GlobalPattern[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM global_patterns ORDER BY confidence DESC, last_applied_at DESC LIMIT ?",
      )
      .all(limit) as GlobalPatternRow[];
    return rows.map(toGlobalPattern);
  }

  listGlobalPatternsWithEmbedding(): { pattern: GlobalPattern; embedding: number[] }[] {
    const rows = this.db.prepare("SELECT * FROM global_patterns").all() as GlobalPatternRow[];
    return rows.map((r) => ({
      pattern: toGlobalPattern(r),
      embedding: r.embedding ? embeddingFromBlob(r.embedding) : [],
    }));
  }

  updateGlobalPatternConfidence(id: string, confidence: number, appliedAt?: number): void {
    this.db
      .prepare(
        "UPDATE global_patterns SET confidence = ?, last_applied_at = COALESCE(?, last_applied_at) WHERE id = ?",
      )
      .run(confidence, appliedAt ?? null, id);
  }

  appendGlobalPatternSource(id: string, workspaceId: string): void {
    const existing = this.getGlobalPattern(id);
    if (!existing) return;
    if (existing.sourceProjects.includes(workspaceId)) return;
    const next = [...existing.sourceProjects, workspaceId];
    this.db
      .prepare("UPDATE global_patterns SET source_projects = ? WHERE id = ?")
      .run(JSON.stringify(next), id);
  }

  /** Remove a project's contribution from every pattern; delete patterns left with no sources. */
  retractWorkspaceContribution(workspaceId: string): { updated: number; deleted: number } {
    const rows = this.db
      .prepare("SELECT * FROM global_patterns")
      .all() as GlobalPatternRow[];
    let updated = 0;
    let deleted = 0;
    for (const row of rows) {
      const sources = JSON.parse(row.source_projects) as string[];
      if (!sources.includes(workspaceId)) continue;
      const remaining = sources.filter((s) => s !== workspaceId);
      if (remaining.length === 0) {
        this.db.prepare("DELETE FROM global_patterns WHERE id = ?").run(row.id);
        deleted++;
      } else {
        this.db
          .prepare("UPDATE global_patterns SET source_projects = ? WHERE id = ?")
          .run(JSON.stringify(remaining), row.id);
        updated++;
      }
    }
    return { updated, deleted };
  }

  deleteGlobalPattern(id: string): boolean {
    const r = this.db.prepare("DELETE FROM global_patterns WHERE id = ?").run(id);
    return r.changes > 0;
  }

  // ===== kg edges =====

  insertKGEdge(edge: Omit<KGEdge, "id" | "createdAt">): KGEdge {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO kg_edges (id,from_id,from_kind,to_id,to_kind,edge_kind,weight,created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        edge.fromId,
        edge.fromKind,
        edge.toId,
        edge.toKind,
        edge.edgeKind,
        edge.weight,
        now,
      );
    return { ...edge, id, createdAt: now };
  }

  listKGEdges(opts: { fromId?: string; toId?: string; edgeKind?: string } = {}): KGEdge[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (opts.fromId) {
      where.push("from_id = ?");
      params.push(opts.fromId);
    }
    if (opts.toId) {
      where.push("to_id = ?");
      params.push(opts.toId);
    }
    if (opts.edgeKind) {
      where.push("edge_kind = ?");
      params.push(opts.edgeKind);
    }
    const sql = `SELECT * FROM kg_edges${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC`;
    return (this.db.prepare(sql).all(...params) as KGEdgeRow[]).map(toKGEdge);
  }

  // ===== workspace contribution =====

  getWorkspaceContribution(workspaceId: string): WorkspaceContributionMode {
    const row = this.db
      .prepare("SELECT * FROM workspace_contribution WHERE workspace_id = ?")
      .get(workspaceId) as WorkspaceContributionRow | undefined;
    return (row?.mode as WorkspaceContributionMode | undefined) ?? "isolated";
  }

  setWorkspaceContribution(workspaceId: string, mode: WorkspaceContributionMode): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO workspace_contribution (workspace_id, mode, updated_at)
         VALUES (?,?,?)
         ON CONFLICT(workspace_id) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at`,
      )
      .run(workspaceId, mode, now);
  }

  // ===== style specs =====

  upsertStyleSpec(spec: StyleSpec): StyleSpec {
    const now = Date.now();
    const existing = this.db
      .prepare("SELECT * FROM style_specs WHERE scope = ? AND IFNULL(workspace_id,'') = IFNULL(?,'')")
      .get(spec.scope, spec.workspaceId ?? "") as StyleSpecRow | undefined;
    const nextVersion = existing ? existing.version + 1 : spec.version;
    const payload = JSON.stringify({
      scope: spec.scope,
      workspaceId: spec.workspaceId,
      rules: spec.rules,
      derivedFrom: spec.derivedFrom,
    });
    if (existing) {
      this.db
        .prepare(
          "UPDATE style_specs SET spec_json = ?, version = ?, updated_at = ? WHERE id = ?",
        )
        .run(payload, nextVersion, now, existing.id);
      return { ...spec, version: nextVersion, updatedAt: now };
    }
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO style_specs (id, scope, workspace_id, spec_json, version, updated_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(id, spec.scope, spec.workspaceId, payload, nextVersion, now);
    return { ...spec, version: nextVersion, updatedAt: now };
  }

  getStyleSpec(scope: StyleSpec["scope"], workspaceId: string | null): StyleSpec | null {
    const row = this.db
      .prepare("SELECT * FROM style_specs WHERE scope = ? AND IFNULL(workspace_id,'') = IFNULL(?,'')")
      .get(scope, workspaceId ?? "") as StyleSpecRow | undefined;
    return row ? toStyleSpec(row) : null;
  }

  // ===== feedback signals =====

  createFeedbackSignal(input: FeedbackSignalInput): FeedbackSignal {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO feedback_signals
         (id, workspace_id, run_id, task_node_id, kind, before_text, after_text, reason, file_path, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.runId,
        input.taskNodeId,
        input.kind,
        input.before,
        input.after,
        input.reason,
        input.filePath,
        now,
      );
    return { ...input, id, createdAt: now };
  }

  listFeedbackSignals(workspaceId: string, limit = 500): FeedbackSignal[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM feedback_signals WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(workspaceId, limit) as FeedbackSignalRow[];
    return rows.map(toFeedbackSignal);
  }

  // ===== preference datasets =====

  createPreferenceDataset(name: string, notes: string): PreferenceDataset {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare("INSERT INTO preference_datasets (id, name, curation_notes, created_at) VALUES (?,?,?,?)")
      .run(id, name, notes, now);
    return { id, name, pairs: [], curationNotes: notes, createdAt: now };
  }

  appendPreferencePair(
    datasetId: string,
    pair: Omit<PreferencePair, "id" | "createdAt">,
  ): PreferencePair {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO preference_pairs (id, dataset_id, prompt, chosen, rejected, category, quality_score, signal_id, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        datasetId,
        pair.prompt,
        pair.chosen,
        pair.rejected,
        pair.category,
        pair.qualityScore,
        pair.signalId,
        now,
      );
    return { ...pair, id, createdAt: now };
  }

  getPreferenceDataset(id: string): PreferenceDataset | null {
    const row = this.db
      .prepare("SELECT * FROM preference_datasets WHERE id = ?")
      .get(id) as PreferenceDatasetRow | undefined;
    if (!row) return null;
    const pairs = (
      this.db
        .prepare("SELECT * FROM preference_pairs WHERE dataset_id = ? ORDER BY created_at ASC")
        .all(id) as PreferencePairRow[]
    ).map(toPreferencePair);
    return toPreferenceDataset(row, pairs);
  }

  listPreferenceDatasets(): PreferenceDataset[] {
    // Single aggregate join — without the COUNT(*) the renderer's "N 对"
    // counter always showed 0 (the list endpoint used to pass `[]` for
    // every dataset's pairs). Loading the full pairs array per dataset
    // would balloon the response on large training sets, so we pass the
    // count out-of-band via PreferenceDataset.pairCount.
    const rows = this.db
      .prepare(
        `SELECT pd.*, COUNT(pp.id) AS pair_count
         FROM preference_datasets pd
         LEFT JOIN preference_pairs pp ON pp.dataset_id = pd.id
         GROUP BY pd.id
         ORDER BY pd.created_at DESC`,
      )
      .all() as (PreferenceDatasetRow & { pair_count: number })[];
    return rows.map((r) => {
      const dataset = toPreferenceDataset(r, []);
      return { ...dataset, pairCount: r.pair_count };
    });
  }

  /**
   * Replace every pair in a dataset with the provided list, atomically. Used by
   * curation: buildDatasetFromSignals inserts the raw pairs, curatePairs filters
   * out duplicates / low-quality / over-similar entries, then this method
   * rewrites the table so subsequent training reads only the kept set. Without
   * this step the count was reported as filtered but the dataset still held the
   * raw pairs, so training silently consumed pre-curation data.
   */
  replacePreferenceDatasetPairs(
    datasetId: string,
    pairs: PreferencePair[],
  ): void {
    const tx = this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM preference_pairs WHERE dataset_id = ?")
        .run(datasetId);
      const ins = this.db.prepare(
        `INSERT INTO preference_pairs
           (id, dataset_id, prompt, chosen, rejected, category, quality_score, signal_id, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      );
      const now = Date.now();
      for (const p of pairs) {
        ins.run(
          p.id,
          datasetId,
          p.prompt,
          p.chosen,
          p.rejected,
          p.category,
          p.qualityScore,
          p.signalId,
          p.createdAt || now,
        );
      }
    });
    tx();
  }

  // ===== finetune jobs =====

  createFinetuneJob(input: FinetuneJobInput): FinetuneJob {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO finetune_jobs (id, name, base_model, dataset_id, method, status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(id, input.name, input.baseModel, input.datasetId, input.method, "queued", now, now);
    return this.getFinetuneJob(id)!;
  }

  getFinetuneJob(id: string): FinetuneJob | null {
    const row = this.db
      .prepare("SELECT * FROM finetune_jobs WHERE id = ?")
      .get(id) as FinetuneJobRow | undefined;
    return row ? toFinetuneJob(row) : null;
  }

  listFinetuneJobs(): FinetuneJob[] {
    const rows = this.db
      .prepare("SELECT * FROM finetune_jobs ORDER BY created_at DESC")
      .all() as FinetuneJobRow[];
    return rows.map(toFinetuneJob);
  }

  updateFinetuneJob(
    id: string,
    patch: {
      status?: FinetuneStatus;
      evalResult?: FinetuneJob["evalResult"];
      artifactPath?: string | null;
    },
  ): FinetuneJob | null {
    const existing = this.getFinetuneJob(id);
    if (!existing) return null;
    const next: FinetuneJob = {
      ...existing,
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.evalResult !== undefined ? { evalResult: patch.evalResult } : {}),
      ...(patch.artifactPath !== undefined ? { artifactPath: patch.artifactPath } : {}),
      updatedAt: Date.now(),
    };
    this.db
      .prepare(
        "UPDATE finetune_jobs SET status = ?, eval_result_json = ?, artifact_path = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        next.status,
        next.evalResult ? JSON.stringify(next.evalResult) : null,
        next.artifactPath,
        next.updatedAt,
        id,
      );
    return next;
  }

  // ===== model registry =====

  registerModel(
    entry: Omit<ModelRegistryEntry, "id" | "createdAt">,
  ): ModelRegistryEntry {
    const id = randomUUID();
    const now = Date.now();
    if (entry.active) {
      this.db.prepare("UPDATE model_registry SET active = 0").run();
    }
    this.db
      .prepare(
        `INSERT INTO model_registry (id, name, kind, base_model, active, eval_delta, artifact_path, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        entry.name,
        entry.kind,
        entry.baseModel,
        entry.active ? 1 : 0,
        entry.evalDelta,
        entry.artifactPath,
        now,
      );
    return { ...entry, id, createdAt: now };
  }

  setActiveModel(id: string): ModelRegistryEntry | null {
    const target = this.db
      .prepare("SELECT * FROM model_registry WHERE id = ?")
      .get(id) as ModelRegistryRow | undefined;
    if (!target) return null;
    this.db.prepare("UPDATE model_registry SET active = 0").run();
    this.db.prepare("UPDATE model_registry SET active = 1 WHERE id = ?").run(id);
    return toModelRegistryEntry({ ...target, active: 1 });
  }

  getActiveModel(): ModelRegistryEntry | null {
    const row = this.db
      .prepare("SELECT * FROM model_registry WHERE active = 1 LIMIT 1")
      .get() as ModelRegistryRow | undefined;
    return row ? toModelRegistryEntry(row) : null;
  }

  listModels(): ModelRegistryEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM model_registry ORDER BY created_at DESC")
      .all() as ModelRegistryRow[];
    return rows.map(toModelRegistryEntry);
  }

  rollbackToBase(): ModelRegistryEntry | null {
    const base = this.db
      .prepare("SELECT * FROM model_registry WHERE kind = 'base' ORDER BY created_at ASC LIMIT 1")
      .get() as ModelRegistryRow | undefined;
    if (!base) return null;
    return this.setActiveModel(base.id);
  }

  // ===== proposals =====

  createProposal(input: ProposalInput): Proposal {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO proposals
         (id, workspace_id, kind, title, rationale, estimated_effort, affected_files, status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.kind,
        input.title,
        input.rationale,
        input.estimatedEffort,
        JSON.stringify(input.affectedFiles),
        "new",
        now,
        now,
      );
    return this.getProposal(id)!;
  }

  getProposal(id: string): Proposal | null {
    const row = this.db.prepare("SELECT * FROM proposals WHERE id = ?").get(id) as
      | ProposalRow
      | undefined;
    return row ? toProposal(row) : null;
  }

  listProposals(workspaceId: string, status?: ProposalStatus): Proposal[] {
    const sql = status
      ? "SELECT * FROM proposals WHERE workspace_id = ? AND status = ? ORDER BY created_at DESC"
      : "SELECT * FROM proposals WHERE workspace_id = ? ORDER BY created_at DESC";
    const params = status ? [workspaceId, status] : [workspaceId];
    const rows = this.db.prepare(sql).all(...params) as ProposalRow[];
    return rows.map(toProposal);
  }

  updateProposalStatus(
    id: string,
    status: ProposalStatus,
    extras: { snoozedUntil?: number | null; convertedRunId?: string | null } = {},
  ): Proposal | null {
    const existing = this.getProposal(id);
    if (!existing) return null;
    const now = Date.now();
    this.db
      .prepare(
        "UPDATE proposals SET status = ?, snoozed_until = ?, converted_run_id = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        status,
        extras.snoozedUntil ?? existing.snoozedUntil,
        extras.convertedRunId ?? existing.convertedRunId,
        now,
        id,
      );
    return this.getProposal(id);
  }

  // ===== worker nodes =====

  upsertWorkerNode(node: Omit<WorkerNode, "registeredAt">): WorkerNode {
    const existing = this.db
      .prepare("SELECT * FROM worker_nodes WHERE id = ?")
      .get(node.id) as WorkerNodeRow | undefined;
    if (existing) {
      this.db
        .prepare(
          "UPDATE worker_nodes SET hostname = ?, endpoint = ?, status = ?, capabilities = ?, active_assignments = ?, last_heartbeat = ? WHERE id = ?",
        )
        .run(
          node.hostname,
          node.endpoint,
          node.status,
          JSON.stringify(node.capabilities),
          JSON.stringify(node.activeAssignments),
          node.lastHeartbeat,
          node.id,
        );
      return { ...node, registeredAt: existing.registered_at };
    }
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO worker_nodes
         (id, hostname, endpoint, status, capabilities, active_assignments, last_heartbeat, registered_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        node.id,
        node.hostname,
        node.endpoint,
        node.status,
        JSON.stringify(node.capabilities),
        JSON.stringify(node.activeAssignments),
        node.lastHeartbeat,
        now,
      );
    return { ...node, registeredAt: now };
  }

  listWorkerNodes(): WorkerNode[] {
    const rows = this.db
      .prepare("SELECT * FROM worker_nodes ORDER BY registered_at ASC")
      .all() as WorkerNodeRow[];
    return rows.map(toWorkerNode);
  }

  recordAssignment(assignment: Omit<DistributedAssignment, "id">): DistributedAssignment {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO distributed_assignments (id, node_id, task_node_id, status, started_at, finished_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(
        id,
        assignment.nodeId,
        assignment.taskNodeId,
        assignment.status,
        assignment.startedAt,
        assignment.finishedAt,
      );
    return { ...assignment, id };
  }

  listAssignments(nodeId?: string): DistributedAssignment[] {
    const rows = (
      nodeId
        ? this.db
            .prepare("SELECT * FROM distributed_assignments WHERE node_id = ? ORDER BY started_at DESC")
            .all(nodeId)
        : this.db.prepare("SELECT * FROM distributed_assignments ORDER BY started_at DESC").all()
    ) as DistributedAssignmentRow[];
    return rows.map(toDistributedAssignment);
  }

  // ===== plugin installations =====

  installPlugin(
    manifest: PluginManifest,
    installPath: string,
    approvedPermissions: PluginInstallation["approvedPermissions"],
  ): PluginInstallation {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO plugin_installations
         (id, manifest_json, install_path, enabled, approved_permissions, installed_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(
        id,
        JSON.stringify(manifest),
        installPath,
        1,
        JSON.stringify(approvedPermissions),
        now,
      );
    return {
      id,
      manifest,
      installPath,
      enabled: true,
      approvedPermissions,
      installedAt: now,
    };
  }

  listPlugins(): PluginInstallation[] {
    const rows = this.db
      .prepare("SELECT * FROM plugin_installations ORDER BY installed_at DESC")
      .all() as PluginInstallationRow[];
    return rows.map(toPluginInstallation);
  }

  setPluginEnabled(id: string, enabled: boolean): PluginInstallation | null {
    this.db
      .prepare("UPDATE plugin_installations SET enabled = ? WHERE id = ?")
      .run(enabled ? 1 : 0, id);
    const row = this.db
      .prepare("SELECT * FROM plugin_installations WHERE id = ?")
      .get(id) as PluginInstallationRow | undefined;
    return row ? toPluginInstallation(row) : null;
  }

  uninstallPlugin(id: string): boolean {
    return (
      this.db.prepare("DELETE FROM plugin_installations WHERE id = ?").run(id).changes > 0
    );
  }

  // ===== checkpoints =====

  createCheckpoint(
    runId: string,
    taskNodeId: string | null,
    kind: CheckpointKind,
    state: string,
    progressReport: string,
  ): Checkpoint {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO checkpoints (id, run_id, task_node_id, kind, state_json, progress_report, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(id, runId, taskNodeId, kind, state, progressReport, now);
    return {
      id,
      runId,
      taskNodeId,
      kind,
      state,
      progressReport,
      createdAt: now,
    };
  }

  latestCheckpoint(runId: string): Checkpoint | null {
    const row = this.db
      .prepare("SELECT * FROM checkpoints WHERE run_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(runId) as CheckpointRow | undefined;
    return row ? toCheckpoint(row) : null;
  }

  listCheckpoints(runId: string): Checkpoint[] {
    const rows = this.db
      .prepare("SELECT * FROM checkpoints WHERE run_id = ? ORDER BY created_at ASC")
      .all(runId) as CheckpointRow[];
    return rows.map(toCheckpoint);
  }

  // ===== eval suite =====

  upsertEvalTask(input: Omit<EvalTask, "createdAt">): EvalTask {
    const now = Date.now();
    const existing = this.db
      .prepare("SELECT * FROM eval_tasks WHERE id = ?")
      .get(input.id) as EvalTaskRow | undefined;
    if (existing) {
      // Frozen tasks: only allow non-frozen->frozen promotion, no description changes.
      if (existing.frozen === 1 && (existing.description !== input.description ||
          existing.verify_command !== input.verifyCommand)) {
        throw new Error(`Cannot modify frozen eval task ${input.id}`);
      }
      this.db
        .prepare(
          "UPDATE eval_tasks SET level = ?, title = ?, description = ?, frozen = ?, verify_command = ?, expected_nodes = ? WHERE id = ?",
        )
        .run(
          input.level,
          input.title,
          input.description,
          input.frozen ? 1 : 0,
          input.verifyCommand,
          input.expectedNodes,
          input.id,
        );
      return { ...input, createdAt: existing.created_at };
    }
    this.db
      .prepare(
        `INSERT INTO eval_tasks (id, level, title, description, frozen, verify_command, expected_nodes, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.id,
        input.level,
        input.title,
        input.description,
        input.frozen ? 1 : 0,
        input.verifyCommand,
        input.expectedNodes,
        now,
      );
    return { ...input, createdAt: now };
  }

  listEvalTasks(opts: { frozenOnly?: boolean } = {}): EvalTask[] {
    const sql = opts.frozenOnly
      ? "SELECT * FROM eval_tasks WHERE frozen = 1 ORDER BY level, id"
      : "SELECT * FROM eval_tasks ORDER BY level, id";
    return (this.db.prepare(sql).all() as EvalTaskRow[]).map(toEvalTask);
  }

  recordEvalRun(input: Omit<EvalRunResult, "id" | "createdAt">): EvalRunResult {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO eval_runs (id, task_id, model_id, pass, corrections, transfer_hits, cost_usd, duration_ms, error_message, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.taskId,
        input.modelId,
        input.pass ? 1 : 0,
        input.corrections,
        input.transferHits,
        input.costUsd,
        input.durationMs,
        input.errorMessage,
        now,
      );
    return { ...input, id, createdAt: now };
  }

  listEvalRuns(taskId?: string, modelId?: string): EvalRunResult[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (taskId) {
      where.push("task_id = ?");
      params.push(taskId);
    }
    if (modelId) {
      where.push("model_id = ?");
      params.push(modelId);
    }
    const sql = `SELECT * FROM eval_runs${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC`;
    return (this.db.prepare(sql).all(...params) as EvalRunRow[]).map(toEvalRunResult);
  }

  recordFrozenSuiteSnapshot(snapshot: FrozenSuiteSnapshot): FrozenSuiteSnapshot {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO frozen_suite_snapshots
         (id, week_start_ts, pass_rate, corrections_per_task, transfer_hits, total_tasks, model_id)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(week_start_ts, model_id) DO UPDATE SET
           pass_rate = excluded.pass_rate,
           corrections_per_task = excluded.corrections_per_task,
           transfer_hits = excluded.transfer_hits,
           total_tasks = excluded.total_tasks`,
      )
      .run(
        id,
        snapshot.weekStartTs,
        snapshot.passRate,
        snapshot.correctionsPerTask,
        snapshot.transferHits,
        snapshot.totalTasks,
        snapshot.modelId,
      );
    return snapshot;
  }

  listFrozenSuiteSnapshots(modelId?: string): FrozenSuiteSnapshot[] {
    const sql = modelId
      ? "SELECT * FROM frozen_suite_snapshots WHERE model_id = ? ORDER BY week_start_ts ASC"
      : "SELECT * FROM frozen_suite_snapshots ORDER BY week_start_ts ASC";
    const params = modelId ? [modelId] : [];
    return (this.db.prepare(sql).all(...params) as FrozenSuiteSnapshotRow[]).map(
      toFrozenSuiteSnapshot,
    );
  }
}
