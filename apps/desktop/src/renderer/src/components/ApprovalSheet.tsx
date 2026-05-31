import { useEffect, useMemo, useState } from "react";
import { Icon } from "./Icons.js";
import { summarizePatch, type PatchSummary } from "./ChatRunView.js";
import { useLang, useT } from "../lang-context.js";
import { tf } from "../i18n.js";

interface ApprovalSheetProps {
  patch: string;
  runIdLabel: string;
  taskTitle: string;
  workspaceName: string;
  onClose: () => void;
  onApply: () => void;
  onReject: () => void;
}

export function ApprovalSheet({
  patch,
  runIdLabel,
  taskTitle,
  workspaceName,
  onClose,
  onApply,
  onReject,
}: ApprovalSheetProps): JSX.Element {
  const tr = useT();
  const lang = useLang();
  const [signature, setSignature] = useState("");
  const summary = useMemo<PatchSummary>(() => summarizePatch(patch), [patch]);
  const fileExcerpts = useMemo(() => splitPatchByFile(patch), [patch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && signature.trim()) {
        e.preventDefault();
        onApply();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onApply, signature]);

  const canApply = signature.trim().length > 0;
  const newCount = summary.files.filter((f) => f.kind === "new").length;

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div className="num">
            {tr("approval.crumb.runbook")} · {workspaceName || tr("approval.crumb.project")} ·{" "}
            {runIdLabel} · {tr("approval.crumb.patch")}
          </div>
          <button className="close" type="button" onClick={onClose} aria-label={tr("approval.close")}>
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="sheet-body">
          <div>
            <h2>
              {tr("approval.headingA")} <em>{tr("approval.headingB")}</em>
            </h2>
            <p className="lede" style={{ marginTop: 8 }}>
              {taskTitle || tr("approval.subtitleFallback")} {tr("approval.subtitleAfter")}
            </p>
          </div>

          <div className="sheet-section">
            <div className="label">{tr("approval.label.summary")}</div>
            <div className="sheet-summary">
              <span className="pill add">{tf("approval.linesAdded", lang, { n: summary.added })}</span>
              <span className="pill del">{tf("approval.linesRemoved", lang, { n: summary.removed })}</span>
              <span className="pill">
                {summary.files.length}{" "}
                {summary.files.length === 1
                  ? tr("approval.fileSingular")
                  : tr("approval.filePlural")}
                {newCount > 0 ? tf("approval.newSuffix", lang, { n: newCount }) : ""}
              </span>
              <span className="snapshot">{tr("approval.snapshot")}</span>
            </div>
          </div>

          {summary.files.length > 0 && (
            <div className="sheet-section">
              <div className="label">{tr("approval.label.files")}</div>
              <div className="sheet-files">
                {summary.files.map((f) => (
                  <div className="sheet-file" key={f.path}>
                    <span className={`st ${f.kind}`}>{f.kind}</span>
                    <span className="pth" title={f.path}>{f.path}</span>
                    <span className="ad">+{f.added}</span>
                    <span className="dl">−{f.removed}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="sheet-section">
            <div className="label">{tr("approval.label.patch")}</div>
            {fileExcerpts.length === 0 ? (
              <pre className="diff-block">{patch}</pre>
            ) : (
              fileExcerpts.slice(0, 4).map((excerpt, i) => (
                <details key={i} open={i === 0}>
                  <summary
                    style={{
                      cursor: "pointer",
                      fontFamily: "var(--mono)",
                      fontSize: 12,
                      color: "var(--ink-2)",
                      padding: "6px 0",
                      listStyle: "none",
                    }}
                  >
                    ▸ {excerpt.path}
                  </summary>
                  <pre
                    className="diff-block"
                    dangerouslySetInnerHTML={{ __html: highlightDiff(excerpt.body) }}
                  />
                </details>
              ))
            )}
            {fileExcerpts.length > 4 && (
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  color: "var(--muted)",
                  padding: "4px 0",
                }}
              >
                {tf("approval.moreFiles", lang, { n: fileExcerpts.length - 4 })}
              </div>
            )}
          </div>

          <div className="sheet-section">
            <div className="label">{tr("approval.label.signOff")}</div>
            <p
              style={{
                fontFamily: "var(--serif)",
                fontSize: 14,
                fontStyle: "italic",
                color: "var(--ink-2)",
                margin: 0,
              }}
            >
              {tr("approval.initial")}
            </p>
            <div className="signature">
              <span className="x">×</span>
              <input
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder={tr("approval.initialPlaceholder")}
                autoFocus
                aria-label={tr("approval.signAria")}
              />
            </div>
          </div>
        </div>

        <div className="sheet-foot">
          <div className="left">
            <strong>{tr("approval.reversibleStrong")}</strong> · {tr("approval.reversibleHint")}
          </div>
          <button className="btn ghost" type="button" onClick={onReject}>
            {tr("approval.reject")}
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              onClose();
              setTimeout(() => {
                const ta = document.querySelector(
                  ".composer textarea",
                ) as HTMLTextAreaElement | null;
                if (ta) ta.focus();
              }, 60);
            }}
          >
            {tr("approval.askChanges")}
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={!canApply}
            style={{
              opacity: canApply ? 1 : 0.55,
              cursor: canApply ? "pointer" : "not-allowed",
            }}
            onClick={onApply}
          >
            {tr("approval.apply")}
          </button>
        </div>
      </div>
    </div>
  );
}

interface FileExcerpt {
  path: string;
  body: string;
}

function splitPatchByFile(patch: string): FileExcerpt[] {
  const lines = patch.split(/\r?\n/);
  const excerpts: FileExcerpt[] = [];
  let current: FileExcerpt | null = null;
  let buffer: string[] = [];
  let v4aMode = false;

  const flush = (): void => {
    if (current) {
      current.body = buffer.join("\n");
      excerpts.push(current);
    }
    current = null;
    buffer = [];
  };

  for (const line of lines) {
    if (line === "*** Begin Patch") {
      v4aMode = true;
      continue;
    }
    if (line === "*** End Patch") {
      flush();
      v4aMode = false;
      continue;
    }
    if (v4aMode) {
      const v4aMatch = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
      if (v4aMatch) {
        flush();
        current = { path: v4aMatch[2] ?? "", body: "" };
        buffer.push(line);
        continue;
      }
      buffer.push(line);
      continue;
    }
    const diffHeader = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (diffHeader) {
      flush();
      current = { path: diffHeader[2] ?? "", body: "" };
      buffer.push(line);
      continue;
    }
    if (current) {
      buffer.push(line);
    }
  }
  flush();
  return excerpts;
}

function highlightDiff(body: string): string {
  return body
    .split(/\r?\n/)
    .map((line) => {
      const escaped = escapeHtml(line);
      if (line.startsWith("+++") || line.startsWith("---")) {
        return `<span class="meta">${escaped}</span>`;
      }
      if (line.startsWith("@@")) {
        return `<span class="hunk">${escaped}</span>`;
      }
      if (line.startsWith("+")) {
        return `<span class="add">${escaped}</span>`;
      }
      if (line.startsWith("-")) {
        return `<span class="del">${escaped}</span>`;
      }
      if (line.startsWith("***")) {
        return `<span class="meta">${escaped}</span>`;
      }
      return escaped;
    })
    .join("\n");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
