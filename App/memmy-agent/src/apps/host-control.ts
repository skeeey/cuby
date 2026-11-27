import {
  INBOUND_META_RUNTIME_CONTROL,
  RUNTIME_CONTROL_ACK,
  RUNTIME_CONTROL_APPS,
  type InboundMessage,
} from "../core/runtime-messages/events.js";
import type { AppManager } from "./manager.js";

type Ack = ((result: Record<string, any>) => void) | { resolve?: (result: Record<string, any>) => void } | undefined;

function resolveAck(ack: Ack, result: Record<string, any>): void {
  if (!ack) return;
  if (typeof ack === "function") ack(result);
  else if (typeof ack.resolve === "function") ack.resolve(result);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function handleAppHostRuntimeControl(input: {
  apps: AppManager | null;
  msg: InboundMessage;
}): Promise<boolean> {
  const metadata = input.msg?.metadata && typeof input.msg.metadata === "object"
    ? input.msg.metadata
    : {};
  if (metadata[INBOUND_META_RUNTIME_CONTROL] !== RUNTIME_CONTROL_APPS) {
    return false;
  }

  const ack = metadata[RUNTIME_CONTROL_ACK] as Ack;
  const reply = (result: Record<string, any>): void => resolveAck(ack, result);
  const apps = input.apps;
  if (!apps) {
    reply({ ok: false, error: "app host is unavailable" });
    return true;
  }

  const action = typeof metadata.action === "string" ? metadata.action : "";
  try {
    if (action === "list") {
      reply({ ok: true, result: { apps: apps.summaries() } });
      return true;
    }
    if (action === "open") {
      const appId = typeof metadata.appId === "string" ? metadata.appId.trim() : "";
      if (!appId) throw new Error("apps/open requires an app id");
      const sessionKey = typeof metadata.sessionKey === "string" ? metadata.sessionKey : null;
      const workspace = typeof metadata.workspace === "string" ? metadata.workspace : null;
      const view = await apps.openEntryPoint(appId, { sessionKey, workspace });
      reply({ ok: true, result: { view } });
      return true;
    }
    throw new Error(`unsupported apps action: ${action || "(empty)"}`);
  } catch (error) {
    reply({ ok: false, error: errorMessage(error) });
    return true;
  }
}
