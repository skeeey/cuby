import { randomUUID } from "node:crypto";
import {
  INBOUND_META_RUNTIME_CONTROL,
  InboundMessage,
  RUNTIME_CONTROL_ACK,
  RUNTIME_CONTROL_APP_BRIDGE,
} from "../core/runtime-messages/events.js";
import type { AppManager } from "./manager.js";

export type AppBridgeMethod =
  | "tools/call"
  | "resources/read"
  | "ui/message"
  | "ui/update-model-context"
  | "view/result";

export type AppBridgeRequest = {
  requestId: string;
  chatId: string;
  sessionKey?: string;
  appId: string;
  viewId: string;
  method: AppBridgeMethod;
  params: Record<string, unknown>;
};

export type AppBridgeResult =
  | { ok: true; result?: unknown }
  | { ok: false; error: string };

const APP_BRIDGE_METHODS = new Set<AppBridgeMethod>([
  "tools/call",
  "resources/read",
  "ui/message",
  "ui/update-model-context",
  "view/result",
]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveAck(ack: any, result: AppBridgeResult): void {
  if (!ack) return;
  if (typeof ack === "function") ack(result);
  else if (typeof ack.resolve === "function") ack.resolve(result);
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (
      block && typeof block === "object" && (block as any).type === "text"
        && typeof (block as any).text === "string"
        ? (block as any).text
        : ""
    ))
    .filter(Boolean)
    .join("\n")
    .trim();
}

export async function handleAppRuntimeControl(input: {
  apps: AppManager | null;
  msg: InboundMessage;
  publishInbound: (message: InboundMessage) => Promise<void>;
}): Promise<boolean> {
  const metadata = input.msg?.metadata && typeof input.msg.metadata === "object"
    ? input.msg.metadata
    : {};
  if (metadata[INBOUND_META_RUNTIME_CONTROL] !== RUNTIME_CONTROL_APP_BRIDGE) {
    return false;
  }

  const ack = metadata[RUNTIME_CONTROL_ACK];
  const reply = (result: AppBridgeResult): void => resolveAck(ack, result);
  const apps = input.apps;
  if (!apps) {
    reply({ ok: false, error: "app host is unavailable" });
    return true;
  }

  const appId = typeof metadata.appId === "string" ? metadata.appId : "";
  const viewId = typeof metadata.viewId === "string" ? metadata.viewId : "";
  const chatId = typeof metadata.chatId === "string" && metadata.chatId
    ? metadata.chatId
    : input.msg.chatId;
  const method = metadata.method as AppBridgeMethod;
  const params = metadata.params && typeof metadata.params === "object" && !Array.isArray(metadata.params)
    ? metadata.params as Record<string, unknown>
    : {};
  const sessionContext = {
    sessionKey: typeof metadata.sessionKey === "string" ? metadata.sessionKey : input.msg.sessionKey ?? null,
    workspace: typeof metadata.workspace === "string" ? metadata.workspace : null,
  };

  if (!appId || !viewId || !chatId || !APP_BRIDGE_METHODS.has(method)) {
    reply({ ok: false, error: "invalid app bridge request" });
    return true;
  }

  try {
    switch (method) {
      case "tools/call": {
        const tool = typeof params.name === "string" ? params.name : "";
        if (!tool) throw new Error("tools/call requires a tool name");
        const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
          ? params.arguments as Record<string, any>
          : {};
        reply({ ok: true, result: await apps.callTool(appId, tool, args, sessionContext) });
        return true;
      }
      case "resources/read": {
        const uri = typeof params.uri === "string" ? params.uri : "";
        if (!uri) throw new Error("resources/read requires a uri");
        reply({ ok: true, result: await apps.readResource(appId, uri, sessionContext) });
        return true;
      }
      case "ui/message": {
        if (!apps.canAppMessage(appId)) {
          throw new Error("this app is not allowed to send messages");
        }
        const text = textFromContent(params.content);
        if (!text) throw new Error("ui/message requires text content");
        await input.publishInbound(new InboundMessage({
          channel: "websocket",
          chatId,
          senderId: "mcp-app",
          content: text,
          metadata: {
            webui: true,
            client_request_id: randomUUID(),
            source: "mcp-app",
            appId,
            viewId,
            appControlled: true,
            turn_source: { kind: "gui", channel: "websocket" },
          },
          turnSource: { kind: "gui", channel: "websocket" },
        }));
        reply({ ok: true });
        return true;
      }
      case "ui/update-model-context":
        reply({ ok: true });
        return true;
      case "view/result": {
        const result = await apps.readViewResult(appId, viewId);
        reply({ ok: true, result });
        return true;
      }
    }
    reply({ ok: false, error: `unsupported app bridge method: ${String(method)}` });
    return true;
  } catch (error) {
    reply({ ok: false, error: errorMessage(error) });
    return true;
  }
}
