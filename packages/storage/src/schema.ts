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

-- Phase 3: long-term memory
CREATE TABLE IF NOT EXISTS memory_entries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('decision','preference','failure','fact')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  tags TEXT NOT NULL,
  source_run_id TEXT,
  embedding BLOB,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  usefulness INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_memory_workspace_kind ON memory_entries(workspace_id, kind);

-- Phase 3: semantic index chunks
CREATE TABLE IF NOT EXISTS semantic_chunks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  symbol_name TEXT,
  embedding BLOB NOT NULL,
  file_mtime INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_workspace_file ON semantic_chunks(workspace_id, file_path);

-- Phase 3: sub-task DAG
CREATE TABLE IF NOT EXISTS task_nodes (
  id TEXT PRIMARY KEY,
  parent_run_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  depends_on TEXT NOT NULL,
  verify_command TEXT,
  files_scope TEXT,
  sub_run_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_nodes_run ON task_nodes(parent_run_id);

-- Phase 3: inter-role messages
CREATE TABLE IF NOT EXISTS role_messages (
  id TEXT PRIMARY KEY,
  task_node_id TEXT NOT NULL,
  from_role TEXT NOT NULL,
  to_role TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_role_messages_node ON role_messages(task_node_id);

-- Phase 3: git actions
CREATE TABLE IF NOT EXISTS git_actions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  action TEXT NOT NULL,
  ref TEXT,
  payload TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_git_actions_run ON git_actions(run_id);
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
  // Phase 3: link sub-runs to parent run + task node.
  "ALTER TABLE agent_runs ADD COLUMN parent_run_id TEXT",
  "ALTER TABLE agent_runs ADD COLUMN task_node_id TEXT",
];
