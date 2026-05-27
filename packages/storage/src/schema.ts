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
  updated_at INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  iteration_count INTEGER NOT NULL DEFAULT 0,
  model_name TEXT,
  exit_reason TEXT
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
  created_at INTEGER NOT NULL,
  iteration INTEGER NOT NULL DEFAULT 0,
  snapshot_type TEXT NOT NULL DEFAULT 'before_run'
);

CREATE TABLE IF NOT EXISTS project_cards (
  workspace_id TEXT PRIMARY KEY,
  card_json TEXT NOT NULL,
  generated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS symbols (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line INTEGER NOT NULL,
  signature TEXT NOT NULL,
  exported INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_workspace ON agent_runs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_steps_run ON agent_steps(run_id);
CREATE INDEX IF NOT EXISTS idx_file_snapshots_run ON file_snapshots(run_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_run_iter ON file_snapshots(run_id, iteration);
CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(workspace_id, name);
CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(workspace_id, file_path);
`;

/**
 * Additive column migrations for databases created before Phase 2. Each is
 * applied independently and a "duplicate column name" error is ignored, so the
 * set is safe to run on every startup. Fresh DBs already have these columns via
 * {@link SCHEMA_SQL}; these statements only matter for upgraded installs.
 */
export const COLUMN_MIGRATIONS: readonly string[] = [
  "ALTER TABLE agent_runs ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE agent_runs ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE agent_runs ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0",
  "ALTER TABLE agent_runs ADD COLUMN tool_call_count INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE agent_runs ADD COLUMN iteration_count INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE agent_runs ADD COLUMN model_name TEXT",
  "ALTER TABLE agent_runs ADD COLUMN exit_reason TEXT",
  "ALTER TABLE file_snapshots ADD COLUMN iteration INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE file_snapshots ADD COLUMN snapshot_type TEXT NOT NULL DEFAULT 'before_run'",
];
