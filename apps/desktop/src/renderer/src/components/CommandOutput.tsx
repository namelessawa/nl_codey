type Props = { entries: string[] };

/** Bottom panel: accumulated command / test / build output. */
export function CommandOutput({ entries }: Props): JSX.Element {
  if (entries.length === 0) {
    return <div className="empty">No command output yet.</div>;
  }
  return (
    <div className="panel-body">
      {entries.map((entry, i) => (
        <pre className="cmd-output" key={i}>
          {entry}
        </pre>
      ))}
    </div>
  );
}
