import type { AgentApi } from "@coding-agent/shared";

declare global {
  interface Window {
    agentApi: AgentApi;
  }
}

export {};
