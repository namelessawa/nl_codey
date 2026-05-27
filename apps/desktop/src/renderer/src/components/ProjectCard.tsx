import { useMemo } from "react";
import { deriveProjectCard } from "@coding-agent/shared";

type Props = { files: string[] };

const KIND_LABEL: Record<string, string> = {
  node: "Node / TypeScript",
  python: "Python",
  go: "Go",
  rust: "Rust",
  unknown: "未知类型",
};

/**
 * Project card: a compact summary of the open workspace (detected kind,
 * marker files, the validation commands the agent will prefer, file count, and
 * top file extensions). Derived client-side from the file list.
 */
export function ProjectCard({ files }: Props): JSX.Element | null {
  const card = useMemo(() => deriveProjectCard(files), [files]);
  if (files.length === 0) return null;

  return (
    <div className="project-card">
      <div className="project-card-head">
        <span className={`kind-badge kind-${card.kind}`}>{KIND_LABEL[card.kind] ?? card.kind}</span>
        <span className="iter-meta">{card.fileCount} files</span>
      </div>
      {card.suggestedCommands.length > 0 && (
        <div className="project-card-row">
          <span className="project-card-label">验证命令</span>
          <code className="project-card-cmds">{card.suggestedCommands.join("  ·  ")}</code>
        </div>
      )}
      {card.topExtensions.length > 0 && (
        <div className="project-card-exts">
          {card.topExtensions.map((e) => (
            <span key={e.ext} className="ext-chip">
              {e.ext} <b>{e.count}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
