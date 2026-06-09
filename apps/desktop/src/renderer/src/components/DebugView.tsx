import { useMemo, useState } from "react";
import type { ReadFileOutput, RunCommandOutput } from "@coding-agent/shared";
import { api } from "../api.js";

interface DebugViewProps {
  workspaceId: string;
}

/**
 * Workspace-level debug surface — covers the three remaining direct-action
 * wrappers (`runCommand`, `listWorkspaceFiles`, `readFile`) that no other
 * panel exposes. These bypass the agent loop entirely (no LLM, no approval,
 * no snapshot), so they are clearly labelled as a debug channel.
 */
export function DebugView({ workspaceId }: DebugViewProps): JSX.Element {
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
      <header>
        <h3 style={{ margin: 0 }}>调试通道</h3>
        <p className="phase4-help" style={{ marginTop: 4 }}>
          直接调用 sandbox / 文件系统,不经过 agent 推理、不写快照、不进入 run 历史。
          仅用于本地排错和探查。
        </p>
      </header>

      <CommandRunner workspaceId={workspaceId} />
      <FileBrowser workspaceId={workspaceId} />
      <FileViewer workspaceId={workspaceId} />
    </div>
  );
}

// ─────────────────────  Command runner  ─────────────────────

function CommandRunner({ workspaceId }: { workspaceId: string }): JSX.Element {
  const [command, setCommand] = useState<string>("");
  const [running, setRunning] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunCommandOutput | null>(null);

  const run = async (): Promise<void> => {
    setError(null);
    if (!command.trim()) {
      setError("命令不能为空");
      return;
    }
    setRunning(true);
    try {
      const out = await api.runCommand(workspaceId, command.trim());
      setResult(out);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <section style={sectionStyle}>
      <h4 style={{ margin: 0 }}>命令执行</h4>
      <p className="phase4-help">
        遵循当前 sandbox 策略(white-list / WSL / Docker),60 秒超时,100KB 输出上限。
      </p>
      <div className="phase4-field">
        <label htmlFor="dv-cmd">command</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            id="dv-cmd"
            value={command}
            placeholder="pnpm test"
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                if (!running) void run();
              }
            }}
            style={{ flex: 1, fontFamily: "var(--mono)" }}
          />
          <button type="button" onClick={() => void run()} disabled={running}>
            {running ? "执行中…" : "执行"}
          </button>
        </div>
      </div>
      {error && <div className="phase4-error">{error}</div>}
      {result && (
        <div style={{ marginTop: 8 }}>
          <div style={metaRowStyle}>
            <span>exitCode: {result.exitCode === null ? "(null)" : result.exitCode}</span>
            <span>· timedOut: {result.timedOut ? "true" : "false"}</span>
            <span>· stdout {result.stdout.length} 字节</span>
            <span>· stderr {result.stderr.length} 字节</span>
          </div>
          {result.stdout.length > 0 && (
            <>
              <div style={labelStyle}>stdout</div>
              <pre style={outputBoxStyle}>{result.stdout}</pre>
            </>
          )}
          {result.stderr.length > 0 && (
            <>
              <div style={labelStyle}>stderr</div>
              <pre style={{ ...outputBoxStyle, color: "var(--danger, #c44)" }}>{result.stderr}</pre>
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ─────────────────────  File browser  ─────────────────────

function FileBrowser({ workspaceId }: { workspaceId: string }): JSX.Element {
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("");

  const load = async (): Promise<void> => {
    setError(null);
    setLoading(true);
    try {
      const list = await api.listWorkspaceFiles(workspaceId);
      setFiles(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.toLowerCase().includes(q));
  }, [files, filter]);

  return (
    <section style={sectionStyle}>
      <h4 style={{ margin: 0 }}>工作区文件</h4>
      <p className="phase4-help">
        递归扫描工作区(≤ 500 个文件,忽略 node_modules/.git/dist/build/target/.venv/__pycache__/.next/out)。
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? "加载中…" : files.length === 0 ? "扫描" : "重新扫描"}
        </button>
        <input
          placeholder="过滤路径…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ flex: 1, fontFamily: "var(--mono)" }}
        />
        <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--muted)" }}>
          {filtered.length}/{files.length}
        </span>
      </div>
      {error && <div className="phase4-error">{error}</div>}
      {filtered.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: "8px 0 0",
            maxHeight: 240,
            overflow: "auto",
            border: "1px solid var(--border)",
            borderRadius: 4,
            background: "var(--surface)",
          }}
        >
          {filtered.map((p) => (
            <li
              key={p}
              style={{
                padding: "4px 8px",
                fontFamily: "var(--mono)",
                fontSize: 11,
                borderBottom: "1px solid var(--border)",
              }}
            >
              {p}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─────────────────────  File viewer  ─────────────────────

function FileViewer({ workspaceId }: { workspaceId: string }): JSX.Element {
  const [path, setPath] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<ReadFileOutput | null>(null);

  const read = async (): Promise<void> => {
    setError(null);
    if (!path.trim()) {
      setError("path 必填(相对于工作区根)");
      return;
    }
    setLoading(true);
    try {
      const out = await api.readFile(workspaceId, path.trim());
      setContent(out);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section style={sectionStyle}>
      <h4 style={{ margin: 0 }}>读取文件</h4>
      <p className="phase4-help">
        路径相对于工作区根; 上限 200KB,拒绝二进制。
      </p>
      <div className="phase4-field">
        <label htmlFor="dv-path">path</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            id="dv-path"
            value={path}
            placeholder="src/index.ts"
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (!loading) void read();
              }
            }}
            style={{ flex: 1, fontFamily: "var(--mono)" }}
          />
          <button type="button" onClick={() => void read()} disabled={loading}>
            {loading ? "读取中…" : "读取"}
          </button>
        </div>
      </div>
      {error && <div className="phase4-error">{error}</div>}
      {content && (
        <div style={{ marginTop: 8 }}>
          <div style={metaRowStyle}>
            <span>{content.path}</span>
            <span>· {content.content.length} 字符</span>
          </div>
          <pre style={outputBoxStyle}>{content.content}</pre>
        </div>
      )}
    </section>
  );
}

// ─────────────────────  shared styles  ─────────────────────

const sectionStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  background: "var(--surface-2)",
};

const outputBoxStyle: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 11,
  whiteSpace: "pre-wrap",
  margin: 0,
  padding: 8,
  maxHeight: 320,
  overflow: "auto",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 4,
};

const metaRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  fontFamily: "var(--mono)",
  fontSize: 11,
  color: "var(--muted)",
};

const labelStyle: React.CSSProperties = {
  marginTop: 6,
  fontFamily: "var(--mono)",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--muted)",
};
