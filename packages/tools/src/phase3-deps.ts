import type {
  ApproveChangeInput,
  ApproveChangeOutput,
  ProposeTaskBreakdownInput,
  ProposeTaskBreakdownOutput,
  ReadMemoryHit,
  RequestChangesInput,
  RequestChangesOutput,
  RequestReviewInput,
  RequestReviewOutput,
  SemanticSearchToolHit,
  UpdateTaskStatusInput,
  UpdateTaskStatusOutput,
  WebFetchToolInput,
  WebFetchToolOutput,
  WebSearchToolInput,
  WebSearchToolOutput,
  WriteMemoryInput,
} from "@coding-agent/shared";

/**
 * Port interfaces the Phase 3 tools depend on. Each tool is a factory that
 * closes over one of these ports; the main process wires concrete services
 * (semantic index, memory store, task/review orchestrator, web client) later.
 * Keeping the surface minimal mirrors the existing SnapshotStore pattern.
 */

export interface SemanticSearchPort {
  search(
    query: string,
    opts?: { topK?: number; kinds?: ("code" | "doc" | "comment")[] },
  ): Promise<SemanticSearchToolHit[]>;
}

export interface MemoryPort {
  read(
    query: string | undefined,
    kind: string | undefined,
    max: number,
  ): Promise<ReadMemoryHit[]>;
  write(input: WriteMemoryInput): Promise<{ id: string; kind: string }>;
}

export interface TaskPort {
  proposeBreakdown(input: ProposeTaskBreakdownInput): Promise<ProposeTaskBreakdownOutput>;
  updateStatus(input: UpdateTaskStatusInput): Promise<UpdateTaskStatusOutput>;
}

export interface ReviewPort {
  requestReview(input: RequestReviewInput): Promise<RequestReviewOutput>;
  approve(input: ApproveChangeInput): Promise<ApproveChangeOutput>;
  requestChanges(input: RequestChangesInput): Promise<RequestChangesOutput>;
}

export interface WebPort {
  search(input: WebSearchToolInput): Promise<WebSearchToolOutput>;
  fetch(input: WebFetchToolInput): Promise<WebFetchToolOutput>;
}
