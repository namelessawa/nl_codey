/** Public API for the @coding-agent/orchestrator package (Phase 3 multi-agent). */

export {
  ROLE_TOOLS,
  PLANNER_PROMPT,
  CODER_PROMPT,
  REVIEWER_PROMPT,
  canRoleUseTool,
  type ToolRole,
} from "./roles.js";

export {
  MessageBus,
  validateRoleMessage,
  serializeRow,
  parseRow,
  type MessageBusOptions,
  type ValidationResult,
} from "./message-bus.js";

export { BudgetController, Mutex } from "./budget-controller.js";

export { LockManager } from "./lock-manager.js";

export { runPool, MAX_WORKERS } from "./worker-pool.js";

export {
  runReviewLoop,
  type ReviewLoopPorts,
  type ReviewLoopOutcome,
} from "./review-loop.js";

export {
  Coordinator,
  type CoordinatorPorts,
  type CoordinatorResult,
} from "./coordinator.js";
