/**
 * @nlc/session — file-backed conversation tree under
 * `~/.nlc/agent.session/<encoded-cwd>/`.
 *
 * The package is intentionally framework-free: the store is built on
 * `node:fs` only, has no dependency on the GUI or the agent loop, and
 * is consumable by the CLI/TUI, the desktop main process, or any other
 * caller that wants an append-only conversation log with branching.
 */
export * from "./types.js";
export { encodeProjectFolder } from "./path-encoder.js";
export { newSessionId, newMessageId, newEventId } from "./ids.js";
export {
  SessionStore,
  SessionWriter,
  type AppendMessageInput,
  type AppendStateEventInput,
  type SessionStoreOptions,
} from "./store.js";
export {
  buildProjectTree,
  renderProjectTree,
  type AnnotatedMessage,
  type RenderTreeOptions,
  type TreeRow,
} from "./tree.js";
