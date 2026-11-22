import type { AgentAppView } from "../state/agent-tool-traces.js";

export type { AgentAppView } from "../state/agent-tool-traces.js";

export type AppBridgeTransport = {
  callTool(input: {
    viewId: string;
    tool: string;
    arguments: Record<string, unknown>;
  }): Promise<any>;
  readResource(input: { viewId: string; uri: string }): Promise<any>;
  sendMessage(input: {
    viewId: string;
    content: Array<Record<string, unknown>>;
  }): Promise<any>;
  readViewResult(viewId: string): Promise<any>;
};

export type AppViewLike = AgentAppView;
