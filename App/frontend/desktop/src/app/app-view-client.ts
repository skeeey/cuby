import type { AppBridgeTransport } from "./app-view-types.js";

export type AppBridgeRequester = {
  requestAppBridge(request: {
    requestId: string;
    chatId: string;
    appId: string;
    viewId: string;
    method: "tools/call" | "resources/read" | "ui/message" | "view/result";
    params: Record<string, unknown>;
  }): Promise<any>;
};

function unwrap(result: any): any {
  if (result && typeof result === "object" && result.ok === false) {
    throw new Error(typeof result.error === "string" ? result.error : "app bridge request failed");
  }
  return result && typeof result === "object" && "result" in result ? result.result : result;
}

export function createAppBridgeTransport(
  connection: AppBridgeRequester,
  chatId: string,
): AppBridgeTransport {
  return {
    async callTool({ appId, viewId, tool, arguments: args }) {
      return unwrap(await connection.requestAppBridge({
        requestId: crypto.randomUUID(),
        chatId,
        appId,
        viewId,
        method: "tools/call",
        params: { name: tool, arguments: args },
      }));
    },
    async readResource({ appId, viewId, uri }) {
      return unwrap(await connection.requestAppBridge({
        requestId: crypto.randomUUID(),
        chatId,
        appId,
        viewId,
        method: "resources/read",
        params: { uri },
      }));
    },
    async sendMessage({ appId, viewId, content }) {
      return unwrap(await connection.requestAppBridge({
        requestId: crypto.randomUUID(),
        chatId,
        appId,
        viewId,
        method: "ui/message",
        params: { content },
      }));
    },
    async readViewResult({ appId, viewId }) {
      return unwrap(await connection.requestAppBridge({
        requestId: crypto.randomUUID(),
        chatId,
        appId,
        viewId,
        method: "view/result",
        params: {},
      }));
    },
  };
}
