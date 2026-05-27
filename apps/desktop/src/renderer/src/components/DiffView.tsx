type Props = { patch: string };

/**
 * Text-based unified-diff renderer with line coloring. Kept behind this
 * component boundary so a Monaco DiffEditor can replace it without touching
 * callers.
 */
export function DiffView({ patch }: Props): JSX.Element {
  const lines = patch.split("\n");
  return (
    <pre className="diff">
      {lines.map((line, i) => (
        <span key={i} className={classFor(line)}>
          {line || " "}
        </span>
      ))}
    </pre>
  );
}

function classFor(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "";
}
