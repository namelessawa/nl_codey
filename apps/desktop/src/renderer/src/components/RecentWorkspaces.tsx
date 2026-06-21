import type { Workspace } from "@nlc/shared";

type Props = {
  workspaces: Workspace[];
  activeId: string | null;
  onSelect: (id: string) => void;
};

/** Folder name (last path segment) for a compact label; falls back to full path. */
function folderName(rootPath: string): string {
  const segments = rootPath.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? rootPath;
}

/** Remembered workspaces, most recent first, for one-click reopening. */
export function RecentWorkspaces({ workspaces, activeId, onSelect }: Props): JSX.Element | null {
  if (workspaces.length === 0) return null;
  return (
    <div className="recents">
      <div className="recents-head">Recent</div>
      <ul className="recent-list">
        {workspaces.map((ws) => (
          <li
            key={ws.id}
            className={ws.id === activeId ? "active" : undefined}
            title={ws.rootPath}
            onClick={() => onSelect(ws.id)}
          >
            {folderName(ws.rootPath)}
          </li>
        ))}
      </ul>
    </div>
  );
}
