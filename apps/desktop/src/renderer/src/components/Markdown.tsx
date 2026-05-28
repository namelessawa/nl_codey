import type { ReactNode } from "react";

/** Inline spans we support: `code`, **bold**, *italic* / _italic_. */
const INLINE_RE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_)/g;

/** Render inline markdown within a line into React nodes. */
function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("`")) {
      out.push(
        <code key={key++} className="md-code-inline">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      out.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      out.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const BLOCK_BREAK_RE = /^(```|#{1,6}\s|[-*]\s|\d+\.\s)/;

/**
 * Minimal, dependency-free markdown renderer for LLM message output:
 * headings, fenced code, bullet/numbered lists, paragraphs, and inline spans.
 * Anything it doesn't recognize falls through as plain paragraph text.
 */
export function Markdown({ text }: { text: string }): JSX.Element {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let key = 0;
  let i = 0;

  while (i < lines.length) {
    const trimmed = (lines[i] ?? "").trim();

    if (trimmed === "") {
      i++;
      continue;
    }

    // Fenced code block.
    if (trimmed.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
        buf.push(lines[i] ?? "");
        i++;
      }
      i++; // skip the closing fence
      blocks.push(
        <pre key={key++} className="md-code-block">
          <code>{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Heading (# .. ######).
    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      const level = (heading[1] ?? "#").length;
      blocks.push(
        <div key={key++} className={`md-h md-h${level}`}>
          {renderInline(heading[2] ?? "")}
        </div>,
      );
      i++;
      continue;
    }

    // Unordered list.
    if (/^[-*]\s+/.test(trimmed)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^[-*]\s+/.test((lines[i] ?? "").trim())) {
        const item = (lines[i] ?? "").trim().replace(/^[-*]\s+/, "");
        items.push(<li key={items.length}>{renderInline(item)}</li>);
        i++;
      }
      blocks.push(
        <ul key={key++} className="md-ul">
          {items}
        </ul>,
      );
      continue;
    }

    // Ordered list.
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\d+\.\s+/.test((lines[i] ?? "").trim())) {
        const item = (lines[i] ?? "").trim().replace(/^\d+\.\s+/, "");
        items.push(<li key={items.length}>{renderInline(item)}</li>);
        i++;
      }
      blocks.push(
        <ol key={key++} className="md-ol">
          {items}
        </ol>,
      );
      continue;
    }

    // Paragraph: gather consecutive plain lines.
    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() !== "" &&
      !BLOCK_BREAK_RE.test((lines[i] ?? "").trim())
    ) {
      para.push((lines[i] ?? "").trim());
      i++;
    }
    blocks.push(
      <p key={key++} className="md-p">
        {renderInline(para.join(" "))}
      </p>,
    );
  }

  return <div className="md">{blocks}</div>;
}
