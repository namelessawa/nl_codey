import { useCallback, useEffect, useMemo, useState } from "react";
import type { MemoryEntry } from "@coding-agent/shared";
import { api } from "../api.js";

interface FailureLibraryViewProps {
  workspaceId: string;
}

/**
 * Failure library: lists `failure`-kind memory entries with their usefulness,
 * filterable by tag chips collected from the entries themselves.
 */
export function FailureLibraryView({ workspaceId }: FailureLibraryViewProps): JSX.Element {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .listMemoryEntries(workspaceId, { kind: "failure" })
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const tags = useMemo(() => {
    const set = new Set<string>();
    for (const entry of entries) for (const tag of entry.tags) set.add(tag);
    return [...set].sort();
  }, [entries]);

  const visible = useMemo(
    () => (activeTag ? entries.filter((e) => e.tags.includes(activeTag)) : entries),
    [entries, activeTag],
  );

  const toggleTag = useCallback((tag: string) => {
    setActiveTag((prev) => (prev === tag ? null : tag));
  }, []);

  return (
    <div className="failure-lib">
      {error && <div className="error-banner">{error}</div>}

      {tags.length > 0 && (
        <div className="failure-tags">
          <button
            className={`tag-chip ${activeTag === null ? "tag-chip-active" : ""}`}
            onClick={() => setActiveTag(null)}
          >
            all
          </button>
          {tags.map((tag) => (
            <button
              key={tag}
              className={`tag-chip ${activeTag === tag ? "tag-chip-active" : ""}`}
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="empty">No failures recorded.</div>
      ) : (
        <ul className="mem-list">
          {visible.map((entry) => (
            <li key={entry.id} className="mem-item">
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
