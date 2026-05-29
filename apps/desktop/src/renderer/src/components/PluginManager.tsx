import { useEffect, useState } from "react";
import type { PluginInstallation } from "@coding-agent/shared";
import { api } from "../api";

export function PluginManager(): JSX.Element {
  const [plugins, setPlugins] = useState<PluginInstallation[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="plugin-manager">
      <h2>插件管理</h2>
      <p className="phase4-help">
        所有插件在 Phase 3 沙箱中运行,按 manifest 声明权限,安装时需逐项授权。未声明权限的调用会被拒绝。
      </p>
      {error && <div className="phase4-error">{error}</div>}
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
