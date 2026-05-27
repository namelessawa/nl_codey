/** SQL schema. All statements are idempotent so init can run repeatedly. */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  root_path TEXT NOT NULL,
  opened_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_task TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS file_snapshots (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  before_content TEXT NOT NULL,
  after_content TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_workspace ON agent_runs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_steps_run ON agent_steps(run_id);
CREATE INDEX IF NOT EXISTS idx_file_snapshots_run ON file_snapshots(run_id);
`;
