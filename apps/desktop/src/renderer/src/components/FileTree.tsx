type Props = {
  files: string[];
  selected: string | null;
  onSelect: (path: string) => void;
};

/** Flat, workspace-relative file list. Tree grouping is a later enhancement. */
export function FileTree({ files, selected, onSelect }: Props): JSX.Element {
  if (files.length === 0) {
    return <div className="empty">No files. Open a workspace.</div>;
  }
  return (
    <ul className="file-list">
      {files.map((file) => (
        <li
          key={file}
          className={file === selected ? "active" : ""}
          title={file}
          onClick={() => onSelect(file)}
        >
          {file}
        </li>
      ))}
    </ul>
  );
}
