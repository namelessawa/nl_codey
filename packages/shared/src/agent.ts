/** Core agent + persistence domain types shared across main, packages, and renderer. */

export type Workspace = {
  id: string;
  rootPath: string;
  openedAt: number;
};

export type AgentRunState =
  | "idle"
  | "planning"
  | "searching"
  | "reading"
  | "editing"
  | "waiting_for_user_approval"
  | "applying_patch"
  | "running_command"
  | "done"
  | "failed"
  | "cancelled";

export type AgentRun = {
  id: string;
  workspaceId: string;
  userTask: string;
  status: AgentRunState;
  createdAt: number;
  updatedAt: number;
};

export type AgentStepType =
  | "message"
  | "tool_call"
  | "tool_result"
  | "diff"
  | "command"
  | "error";

export type AgentStep = {
  id: string;
  runId: string;
  type: AgentStepType;
  content: string;
  createdAt: number;
};

export type FileSnapshot = {
  id: string;
  runId: string;
  filePath: string;
  beforeContent: string;
  afterContent?: string;
  createdAt: number;
};

/** Structured plan the LLM returns during the planning phase. */
export type AgentPlan = {
  summary: string;
  searchQueries: string[];
  likelyFiles: string[];
  suggestedCommands: string[];
};

/** Detected project shape used to suggest validation commands. */
export type ProjectKind =
  | "node"
  | "python"
  | "go"
  | "rust"
  | "unknown";

export type ProjectInfo = {
  kind: ProjectKind;
  suggestedCommands: string[];
};
