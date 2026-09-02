import type { AgentApi } from "@nlc/shared/browser";

declare global {
  interface Window {
    agentApi: AgentApi;
  }
}

export {};
