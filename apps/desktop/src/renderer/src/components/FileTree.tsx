import { useMemo, useState } from "react";

type Props = {
  files: string[];
  selected: string | null;
  onSelect: (path: string) => void;
};

type TreeNode = {
  name: string;
  /** Workspace-relative path (posix-style) used as key, selection id, and title. */
  path: string;
  isDir: boolean;
  children: TreeNode[];
};

/** Fold a flat list of relative paths into a nested folder/file tree. */
function buildTree(files: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", isDir: true, children: [] };
  for (const file of files) {
    const parts = file.split(/[\\/]/).filter(Boolean);
    let node = root;
    let acc = "";
    parts.forEach((part, idx) => {
      acc = acc ? `${acc}/${part}` : part;
      const isDir = idx < parts.length - 1;
      let child = node.children.find((c) => c.name === part && c.isDir === isDir);
      if (!child) {
        child = { name: part, path: acc, isDir, children: [] };
        node.children.push(child);
      }
      node = child;
    });
  }
  sortNode(root);
  return root.children;
}

/** Directories first, then files; alphabetical within each group. */
function sortNode(node: TreeNode): void {
  node.children.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  node.children.forEach(sortNode);
}

type RowProps = {
  node: TreeNode;
  depth: number;
  selected: string | null;
  collapsed: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
};

function TreeRow({ node, depth, selected, collapsed, onToggle, onSelect }: RowProps): JSX.Element {
  const indent = { paddingLeft: 8 + depth * 12 };
  if (node.isDir) {
    const isCollapsed = collapsed.has(node.path);
    return (
      <li>
        <div className="tree-row" style={indent} title={node.path} onClick={() => onToggle(node.path)}>
          <span className="tree-caret">{isCollapsed ? "▸" : "▾"}</span>
          <span className="tree-icon">📁</span>
          <span className="tree-name">{node.name}</span>
        </div>
        {!isCollapsed && (
          <ul>
            {node.children.map((c) => (
              <TreeRow
                key={c.path}
                node={c}
                depth={depth + 1}
                selected={selected}
                collapsed={collapsed}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }
  return (
    <li>
      <div
        className={`tree-row${node.path === selected ? " active" : ""}`}
        style={indent}
        title={node.path}
        onClick={() => onSelect(node.path)}
      >
        <span className="tree-caret" />
        <span className="tree-icon">📄</span>
        <span className="tree-name tree-file">{node.name}</span>
      </div>
    </li>
  );
}

/** Collapsible, workspace-relative file tree. */
export function FileTree({ files, selected, onSelect }: Props): JSX.Element {
  const tree = useMemo(() => buildTree(files), [files]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  if (files.length === 0) {
    return <div className="empty">No files. Open a workspace.</div>;
  }

  const toggle = (path: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <ul className="file-tree">
      {tree.map((node) => (
        <TreeRow
          key={node.path}
          node={node}
          depth={0}
          selected={selected}
          collapsed={collapsed}
          onToggle={toggle}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}
