/**
 * Table definitions. All statements are idempotent so init can run repeatedly.
 *
 * Index creation lives in {@link INDEX_SQL}, not here, because some indexes
 * reference columns that only exist on upgraded databases after
 * {@link COLUMN_MIGRATIONS} runs (e.g. `file_snapshots.iteration`). Creating
 * those indexes before the migration would fail with "no such column" on a
 * pre-Phase-2 DB, so the constructor runs tables → migrations → indexes.
 */
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

-- Multi-turn: full LLM conversation per run (one row per LLMMessage, ordered
-- by seq). Loaded by continueTask so a follow-up sees prior tool calls and
-- assistant turns, not just the user-facing step log.
CREATE TABLE IF NOT EXISTS agent_run_messages (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  message_json TEXT NOT NULL,
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

-- Phase 3: git actions
CREATE TABLE IF NOT EXISTS git_actions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  action TEXT NOT NULL,
  ref TEXT,
  payload TEXT,
  created_at INTEGER NOT NULL
);

-- Phase 4: cross-project global patterns
CREATE TABLE IF NOT EXISTS global_patterns (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  example_snippet TEXT NOT NULL,
  source_projects TEXT NOT NULL,
  tags TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  embedding BLOB,
  created_at INTEGER NOT NULL,
  last_applied_at INTEGER NOT NULL
);

-- Phase 4: knowledge graph edges
CREATE TABLE IF NOT EXISTS kg_edges (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  from_kind TEXT NOT NULL,
  to_id TEXT NOT NULL,
  to_kind TEXT NOT NULL,
  edge_kind TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

-- Phase 4: per-workspace contribution mode
CREATE TABLE IF NOT EXISTS workspace_contribution (
  workspace_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'isolated',
  updated_at INTEGER NOT NULL
);

-- Phase 4: style profile (one row per scope/workspace)
CREATE TABLE IF NOT EXISTS style_specs (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  workspace_id TEXT,
  spec_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  UNIQUE(scope, workspace_id)
);

-- Phase 4: feedback signals
CREATE TABLE IF NOT EXISTS feedback_signals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  task_node_id TEXT,
  kind TEXT NOT NULL,
  before_text TEXT NOT NULL,
  after_text TEXT,
  reason TEXT,
  file_path TEXT,
  created_at INTEGER NOT NULL
);

-- Phase 4: preference pairs (curated dataset)
CREATE TABLE IF NOT EXISTS preference_pairs (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  chosen TEXT NOT NULL,
  rejected TEXT NOT NULL,
  category TEXT,
  quality_score REAL NOT NULL DEFAULT 0,
  signal_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS preference_datasets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  curation_notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

-- Phase 4: fine-tune jobs
CREATE TABLE IF NOT EXISTS finetune_jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_model TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL,
  eval_result_json TEXT,
  artifact_path TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Phase 4: model registry
CREATE TABLE IF NOT EXISTS model_registry (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  base_model TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  eval_delta REAL,
  artifact_path TEXT,
  created_at INTEGER NOT NULL
);

-- Phase 4: proactive proposals
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  rationale TEXT NOT NULL,
  estimated_effort TEXT NOT NULL,
  affected_files TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  snoozed_until INTEGER,
  converted_run_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Phase 4: distributed nodes
CREATE TABLE IF NOT EXISTS worker_nodes (
  id TEXT PRIMARY KEY,
  hostname TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  status TEXT NOT NULL,
  capabilities TEXT NOT NULL,
  active_assignments TEXT NOT NULL DEFAULT '[]',
  last_heartbeat INTEGER NOT NULL,
  registered_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS distributed_assignments (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  task_node_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);

-- Phase 4: plugin installations
CREATE TABLE IF NOT EXISTS plugin_installations (
  id TEXT PRIMARY KEY,
  manifest_json TEXT NOT NULL,
  install_path TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  approved_permissions TEXT NOT NULL DEFAULT '[]',
  installed_at INTEGER NOT NULL
);

-- Phase 4: long-horizon checkpoints
CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  task_node_id TEXT,
  kind TEXT NOT NULL,
  state_json TEXT NOT NULL,
  progress_report TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

-- Phase 4: evals (L4 + frozen regression suite)
CREATE TABLE IF NOT EXISTS eval_tasks (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  frozen INTEGER NOT NULL DEFAULT 0,
  verify_command TEXT NOT NULL DEFAULT '',
  expected_nodes INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS eval_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  pass INTEGER NOT NULL,
  corrections INTEGER NOT NULL DEFAULT 0,
  transfer_hits INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS frozen_suite_snapshots (
  id TEXT PRIMARY KEY,
  week_start_ts INTEGER NOT NULL,
  pass_rate REAL NOT NULL,
  corrections_per_task REAL NOT NULL,
  transfer_hits INTEGER NOT NULL,
  total_tasks INTEGER NOT NULL,
  model_id TEXT NOT NULL,
  UNIQUE(week_start_ts, model_id)
);
`;

/**
 * Index creation, run after {@link COLUMN_MIGRATIONS} so indexes that reference
 * migrated columns (e.g. `file_snapshots.iteration`) succeed on upgraded DBs.
 * All statements are idempotent.
 */
export const INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_agent_runs_workspace ON agent_runs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_steps_run ON agent_steps(run_id);
CREATE INDEX IF NOT EXISTS idx_run_messages_run_seq ON agent_run_messages(run_id, seq);
CREATE INDEX IF NOT EXISTS idx_file_snapshots_run ON file_snapshots(run_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_run_iter ON file_snapshots(run_id, iteration);
CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(workspace_id, name);
CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(workspace_id, file_path);
CREATE INDEX IF NOT EXISTS idx_memory_workspace_kind ON memory_entries(workspace_id, kind);
CREATE INDEX IF NOT EXISTS idx_chunks_workspace_file ON semantic_chunks(workspace_id, file_path);
CREATE INDEX IF NOT EXISTS idx_task_nodes_run ON task_nodes(parent_run_id);
CREATE INDEX IF NOT EXISTS idx_role_messages_node ON role_messages(task_node_id);
CREATE INDEX IF NOT EXISTS idx_git_actions_run ON git_actions(run_id);
CREATE INDEX IF NOT EXISTS idx_global_patterns_confidence ON global_patterns(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_kg_edges_from ON kg_edges(from_id, edge_kind);
CREATE INDEX IF NOT EXISTS idx_kg_edges_to ON kg_edges(to_id, edge_kind);
CREATE INDEX IF NOT EXISTS idx_style_specs_scope ON style_specs(scope, workspace_id);
CREATE INDEX IF NOT EXISTS idx_feedback_signals_workspace ON feedback_signals(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_signals_run ON feedback_signals(run_id);
CREATE INDEX IF NOT EXISTS idx_preference_pairs_dataset ON preference_pairs(dataset_id);
CREATE INDEX IF NOT EXISTS idx_finetune_status ON finetune_jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_registry_active ON model_registry(active);
CREATE INDEX IF NOT EXISTS idx_proposals_workspace ON proposals(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_worker_nodes_status ON worker_nodes(status);
CREATE INDEX IF NOT EXISTS idx_checkpoints_run ON checkpoints(run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eval_runs_task ON eval_runs(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_frozen_snapshots_week ON frozen_suite_snapshots(week_start_ts DESC);
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
