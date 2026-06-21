import type { AgentApi } from "@nlc/shared";

declare global {
  interface Window {
    agentApi: AgentApi;
  }
}

export {};
