import { useCallback, useEffect, useState } from "react";
import type { MemoryEntry, MemoryKind } from "@coding-agent/shared";
import { api } from "../api.js";

interface MemoryPanelProps {
  workspaceId: string;
}

const KINDS: MemoryKind[] = ["decision", "preference", "failure", "fact"];

const KIND_LABEL: Record<MemoryKind, string> = {
  decision: "Decisions",
  preference: "Preferences",
  failure: "Failures",
  fact: "Facts",
};

/**
 * Long-term project memory: four tabs by kind, each listing editable/deletable
 * entries plus an add form, with export/import (by file path) controls.
 */
export function MemoryPanel({ workspaceId }: MemoryPanelProps): JSX.Element {
  const [kind, setKind] = useState<MemoryKind>("decision");
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importPath, setImportPath] = useState<string>("");
  const [draft, setDraft] = useState<{ title: string; body: string; tags: string }>({
    title: "",
    body: "",
    tags: "",
  });

  const load = useCallback(async () => {
    setError(null);
    try {
      setEntries(await api.listMemoryEntries(workspaceId, { kind }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [workspaceId, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const addEntry = useCallback(async () => {
    if (!draft.title.trim()) return;
    setError(null);
    try {
      await api.createMemoryEntry(workspaceId, {
        kind,
        title: draft.title.trim(),
        body: draft.body.trim(),
        tags: parseTags(draft.tags),
      });
      setDraft({ title: "", body: "", tags: "" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [workspaceId, kind, draft, load]);

  const saveEntry = useCallback(
    async (id: string, title: string, body: string, tags: string[]) => {
      setError(null);
      try {
        await api.updateMemoryEntry(id, { title, body, tags });
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [load],
  );

  const removeEntry = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await api.deleteMemoryEntry(id);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [load],
  );

  const exportMemory = useCallback(async () => {
    setError(null);
    try {
      const { filePath } = await api.exportMemory(workspaceId);
      setImportPath(filePath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [workspaceId]);

  const importMemory = useCallback(async () => {
    setError(null);
    try {
      // The main process opens an OS dialog and reads the file with main's
      // privileges. We don't supply a path any more — see api.importMemory.
      const { imported, filePath } = await api.importMemory(workspaceId);
      if (filePath) {
        setImportPath(filePath);
        await load();
        setError(null);
      }
      // imported === 0 + filePath === null → user cancelled the dialog;
      // intentionally show nothing.
      void imported;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [workspaceId, load]);

  return (
    <div className="mem-panel">
      <div className="mem-tabs">
        {KINDS.map((k) => (
          <button
            key={k}
            className={`mem-tab ${kind === k ? "mem-tab-active" : ""}`}
            onClick={() => setKind(k)}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="mem-io">
        <button onClick={() => void exportMemory()}>Export</button>
        <button onClick={() => void importMemory()}>Import…</button>
        {importPath && (
          <span className="mem-import-path" title={importPath}>
            {importPath.split(/[\\/]/).pop()}
          </span>
        )}
      </div>

      <div className="mem-add">
        <input
          className="mem-input"
          placeholder="Title"
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
        />
        <textarea
          className="mem-input"
          placeholder="Body"
          value={draft.body}
          onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
        />
        <input
          className="mem-input"
          placeholder="Tags (comma separated)"
          value={draft.tags}
          onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))}
        />
        <button className="primary" onClick={() => void addEntry()} disabled={!draft.title.trim()}>
          + Add
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="empty">No {KIND_LABEL[kind].toLowerCase()} yet.</div>
      ) : (
        <ul className="mem-list">
          {entries.map((entry) => (
            <MemoryItem
              key={entry.id}
              entry={entry}
              onSave={(title, body, tags) => void saveEntry(entry.id, title, body, tags)}
              onDelete={() => void removeEntry(entry.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface MemoryItemProps {
  entry: MemoryEntry;
  onSave: (title: string, body: string, tags: string[]) => void;
  onDelete: () => void;
}

function MemoryItem({ entry, onSave, onDelete }: MemoryItemProps): JSX.Element {
  const [editing, setEditing] = useState<boolean>(false);
  const [title, setTitle] = useState<string>(entry.title);
  const [body, setBody] = useState<string>(entry.body);
  const [tags, setTags] = useState<string>(entry.tags.join(", "));

  const save = (): void => {
    onSave(title.trim(), body.trim(), parseTags(tags));
    setEditing(false);
  };

  if (editing) {
    return (
      <li className="mem-item">
        <input className="mem-input" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="mem-input" value={body} onChange={(e) => setBody(e.target.value)} />
        <input className="mem-input" value={tags} onChange={(e) => setTags(e.target.value)} />
        <div className="row">
          <button className="ok" onClick={save}>
            Save
          </button>
          <button onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </li>
    );
  }

  return (
    <li className="mem-item">
      <div className="mem-item-head">
        <strong>{entry.title}</strong>
        <span className="iter-meta">used {entry.usefulness} times</span>
      </div>
      {entry.body && <p className="mem-body">{entry.body}</p>}
      {entry.tags.length > 0 && (
        <div className="mem-tag-row">
          {entry.tags.map((t) => (
            <span key={t} className="ext-chip">
              {t}
            </span>
          ))}
        </div>
      )}
      <div className="row">
        <button onClick={() => setEditing(true)}>Edit</button>
        <button className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </li>
  );
}

function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}
