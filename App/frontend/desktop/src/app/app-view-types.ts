import type { AgentAppView } from "../state/agent-tool-traces.js";

export type { AgentAppView } from "../state/agent-tool-traces.js";

export type AppBridgeTransport = {
  callTool(input: {
    appId: string;
    viewId: string;
    tool: string;
    arguments: Record<string, unknown>;
  }): Promise<any>;
  readResource(input: { appId: string; viewId: string; uri: string }): Promise<any>;
  sendMessage(input: {
    appId: string;
    viewId: string;
    content: Array<Record<string, unknown>>;
  }): Promise<any>;
  readViewResult(input: { appId: string; viewId: string }): Promise<any>;
};

export type AppViewLike = AgentAppView;
