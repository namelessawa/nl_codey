import { useEffect, useState } from "react";
import type {
  PluginInstallation,
  PluginManifest,
  PluginPermission,
  PluginToolManifest,
  PluginToolParameter,
} from "@coding-agent/shared";
import { api } from "../api";

const FIXED_PERMISSIONS: PluginPermission[] = [
  "run_command",
  "read_workspace",
  "write_workspace",
  "read_memory",
];

type SandboxKind = PluginManifest["sandbox"];
const SANDBOX_KINDS: SandboxKind[] = ["whitelist", "wsl", "docker"];

type ToolDraft = {
  name: string;
  description: string;
  /** Free-form JSON edited in a textarea; parsed on submit. */
  parametersJson: string;
  permissions: PluginPermission[];
};

function emptyTool(): ToolDraft {
  return { name: "", description: "", parametersJson: "{}", permissions: [] };
}

type ManifestDraft = {
  name: string;
  version: string;
  description: string;
  author: string;
  sandbox: SandboxKind;
  tools: ToolDraft[];
};

function emptyManifest(): ManifestDraft {
  return {
    name: "",
    version: "0.1.0",
    description: "",
    author: "",
    sandbox: "whitelist",
    tools: [emptyTool()],
  };
}

export function PluginManager(): JSX.Element {
  const [plugins, setPlugins] = useState<PluginInstallation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showInstaller, setShowInstaller] = useState<boolean>(false);
  const [draft, setDraft] = useState<ManifestDraft>(emptyManifest);
  const [installPath, setInstallPath] = useState<string>("");
  const [approvedPermissions, setApprovedPermissions] = useState<PluginPermission[]>([]);
  const [networkHost, setNetworkHost] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);

  const refresh = (): void => {
    api.listPlugins().then(setPlugins).catch((e) => setError(String(e)));
  };
  useEffect(refresh, []);

  const toggle = async (id: string, enabled: boolean): Promise<void> => {
    try {
      await api.setPluginEnabled(id, enabled);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const uninstall = async (id: string): Promise<void> => {
    if (!confirm("卸载该插件?")) return;
    try {
      await api.uninstallPlugin(id);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  const updateTool = (idx: number, patch: Partial<ToolDraft>): void => {
    setDraft((d) => ({
      ...d,
      tools: d.tools.map((t, i) => (i === idx ? { ...t, ...patch } : t)),
    }));
  };

  const addTool = (): void => {
    setDraft((d) => ({ ...d, tools: [...d.tools, emptyTool()] }));
  };

  const removeTool = (idx: number): void => {
    setDraft((d) => ({
      ...d,
      tools: d.tools.length > 1 ? d.tools.filter((_, i) => i !== idx) : d.tools,
    }));
  };

  const toggleToolPermission = (idx: number, perm: PluginPermission): void => {
    setDraft((d) => ({
      ...d,
      tools: d.tools.map((t, i) =>
        i === idx
          ? {
              ...t,
              permissions: t.permissions.includes(perm)
                ? t.permissions.filter((p) => p !== perm)
                : [...t.permissions, perm],
            }
          : t,
      ),
    }));
  };

  const toggleApproved = (perm: PluginPermission): void => {
    setApprovedPermissions((cur) =>
      cur.includes(perm) ? cur.filter((p) => p !== perm) : [...cur, perm],
    );
  };

  const addNetworkPermission = (): void => {
    const host = networkHost.trim();
    if (!host) return;
    const perm: PluginPermission = `network:${host}`;
    if (!approvedPermissions.includes(perm)) {
      setApprovedPermissions([...approvedPermissions, perm]);
    }
    setNetworkHost("");
  };

  const resetForm = (): void => {
    setDraft(emptyManifest());
    setInstallPath("");
    setApprovedPermissions([]);
    setNetworkHost("");
  };

  const submit = async (): Promise<void> => {
    setError(null);
    if (!draft.name.trim()) {
      setError("插件 name 必填");
      return;
    }
    if (!installPath.trim()) {
      setError("安装路径必填(指向已解压的插件目录)");
      return;
    }
    const toolsParsed: PluginToolManifest[] = [];
    for (let i = 0; i < draft.tools.length; i++) {
      const t = draft.tools[i];
      if (!t || !t.name.trim()) {
        setError(`第 ${i + 1} 个工具缺少 name`);
        return;
      }
      let params: Record<string, PluginToolParameter>;
      try {
        const raw = JSON.parse(t.parametersJson) as unknown;
        if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
          throw new Error("must be an object");
        }
        params = raw as Record<string, PluginToolParameter>;
      } catch (e) {
        setError(`第 ${i + 1} 个工具 parameters JSON 无效: ${String(e)}`);
        return;
      }
      toolsParsed.push({
        name: t.name.trim(),
        description: t.description.trim(),
        parameters: params,
        permissions: t.permissions,
      });
    }
    const manifest: PluginManifest = {
      name: draft.name.trim(),
      version: draft.version.trim() || "0.0.0",
      ...(draft.description.trim() ? { description: draft.description.trim() } : {}),
      ...(draft.author.trim() ? { author: draft.author.trim() } : {}),
      tools: toolsParsed,
      sandbox: draft.sandbox,
    };
    setSubmitting(true);
    try {
      await api.installPlugin(manifest, installPath.trim(), approvedPermissions);
      resetForm();
      setShowInstaller(false);
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="plugin-manager">
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h2 style={{ margin: 0 }}>插件管理</h2>
        <button
          type="button"
          onClick={() => setShowInstaller((s) => !s)}
        >
          {showInstaller ? "取消安装" : "+ 安装插件"}
        </button>
      </div>
      <p className="phase4-help">
        所有插件在 Phase 3 沙箱中运行,按 manifest 声明权限,安装时需逐项授权。未声明权限的调用会被拒绝。
      </p>
      {error && <div className="phase4-error">{error}</div>}

      {showInstaller && (
        <section
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 16,
            marginBottom: 16,
            background: "var(--surface-2)",
          }}
        >
          <h3 style={{ marginTop: 0 }}>安装新插件</h3>

          <div className="phase4-field">
            <label htmlFor="pm-name">name *</label>
            <input
              id="pm-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div className="phase4-field">
            <label htmlFor="pm-version">version</label>
            <input
              id="pm-version"
              value={draft.version}
              onChange={(e) => setDraft({ ...draft, version: e.target.value })}
            />
          </div>
          <div className="phase4-field">
            <label htmlFor="pm-desc">description</label>
            <input
              id="pm-desc"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </div>
          <div className="phase4-field">
            <label htmlFor="pm-author">author</label>
            <input
              id="pm-author"
              value={draft.author}
              onChange={(e) => setDraft({ ...draft, author: e.target.value })}
            />
          </div>
          <div className="phase4-field">
            <label htmlFor="pm-sandbox">sandbox</label>
            <select
              id="pm-sandbox"
              value={draft.sandbox}
              onChange={(e) => setDraft({ ...draft, sandbox: e.target.value as SandboxKind })}
            >
              {SANDBOX_KINDS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </div>
          <div className="phase4-field">
            <label htmlFor="pm-install-path">installPath *</label>
            <input
              id="pm-install-path"
              value={installPath}
              placeholder="C:\\…\\plugin-dir"
              onChange={(e) => setInstallPath(e.target.value)}
            />
          </div>

          <h4 style={{ marginTop: 16 }}>工具(tools)</h4>
          {draft.tools.map((t, idx) => (
            <fieldset
              key={idx}
              style={{ marginBottom: 12, border: "1px solid var(--border)", padding: 10 }}
            >
              <legend>tool #{idx + 1}</legend>
              <div className="phase4-field">
                <label>name *</label>
                <input value={t.name} onChange={(e) => updateTool(idx, { name: e.target.value })} />
              </div>
              <div className="phase4-field">
                <label>description</label>
                <input
                  value={t.description}
                  onChange={(e) => updateTool(idx, { description: e.target.value })}
                />
              </div>
              <div className="phase4-field">
                <label>parameters (JSON, Record&lt;string, PluginToolParameter&gt;)</label>
                <textarea
                  rows={3}
                  value={t.parametersJson}
                  onChange={(e) => updateTool(idx, { parametersJson: e.target.value })}
                />
              </div>
              <div className="phase4-field">
                <label>tool permissions</label>
                <div>
                  {FIXED_PERMISSIONS.map((p) => (
                    <label key={p} style={{ marginRight: 12 }}>
                      <input
                        type="checkbox"
                        checked={t.permissions.includes(p)}
                        onChange={() => toggleToolPermission(idx, p)}
                      />{" "}
                      {p}
                    </label>
                  ))}
                </div>
              </div>
              {draft.tools.length > 1 && (
                <button type="button" onClick={() => removeTool(idx)}>
                  删除此工具
                </button>
              )}
            </fieldset>
          ))}
          <button type="button" onClick={addTool}>+ 添加工具</button>

          <h4 style={{ marginTop: 16 }}>已批准权限(approvedPermissions)</h4>
          <p className="phase4-help">运行时仅放行此处勾选的权限。manifest 声明 ≠ 用户批准。</p>
          <div className="phase4-field">
            {FIXED_PERMISSIONS.map((p) => (
              <label key={p} style={{ marginRight: 12 }}>
                <input
                  type="checkbox"
                  checked={approvedPermissions.includes(p)}
                  onChange={() => toggleApproved(p)}
                />{" "}
                {p}
              </label>
            ))}
          </div>
          <div className="phase4-field">
            <label htmlFor="pm-net">+ network:host</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                id="pm-net"
                placeholder="api.example.com"
                value={networkHost}
                onChange={(e) => setNetworkHost(e.target.value)}
              />
              <button type="button" onClick={addNetworkPermission}>加入</button>
            </div>
          </div>
          {approvedPermissions.filter((p) => p.startsWith("network:")).length > 0 && (
            <ul style={{ marginTop: 4 }}>
              {approvedPermissions
                .filter((p) => p.startsWith("network:"))
                .map((p) => (
                  <li key={p}>
                    {p}{" "}
                    <button type="button" onClick={() => toggleApproved(p)}>
                      移除
                    </button>
                  </li>
                ))}
            </ul>
          )}

          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <button type="button" onClick={() => void submit()} disabled={submitting}>
              {submitting ? "安装中…" : "安装"}
            </button>
            <button type="button" onClick={resetForm}>重置表单</button>
          </div>
        </section>
      )}

      {plugins.length === 0 && <p className="phase4-empty">无已安装插件</p>}
      <ul className="plugin-list">
        {plugins.map((p) => (
          <li key={p.id} className={`plugin ${p.enabled ? "enabled" : "disabled"}`}>
            <div className="plugin-head">
              <strong>{p.manifest.name}</strong>{" "}
              <span className="version">v{p.manifest.version}</span>
              <span className="sandbox">[sandbox: {p.manifest.sandbox}]</span>
            </div>
            {p.manifest.description && <p>{p.manifest.description}</p>}
            <div className="plugin-perms">
              <strong>已批准权限:</strong> {p.approvedPermissions.join(", ") || "(无)"}
            </div>
            <div className="plugin-tools">
              <strong>工具:</strong> {p.manifest.tools.map((t) => t.name).join(", ")}
            </div>
            <div className="plugin-actions">
              <button type="button" onClick={() => void toggle(p.id, !p.enabled)}>
                {p.enabled ? "禁用" : "启用"}
              </button>
              <button type="button" onClick={() => void uninstall(p.id)}>卸载</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
