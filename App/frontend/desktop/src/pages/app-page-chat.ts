import type { MemmyAgentWebSocketConnection, WebuiSessionTarget } from "../api/memmy-agent-client.js";
import type { AppPageTarget } from "../state/apps-slice.js";

export async function openPanelChat(input: {
  target: AppPageTarget;
  connection: Pick<MemmyAgentWebSocketConnection, "getReadyGeneration" | "newChat" | "attach">;
  ensureChatSubscription: (chatId: string) => void;
  onNewChat: (chatId: string) => void;
}): Promise<{ chatId: string; isNewChat: boolean; modelPreset?: string }> {
  if (input.target.origin === "chat" && input.target.chatId) {
    input.connection.attach(input.target.chatId);
    input.ensureChatSubscription(input.target.chatId);
    return { chatId: input.target.chatId, isNewChat: false };
  }
  const generation = input.connection.getReadyGeneration();
  if (generation === null) {
    throw new Error("Agent gateway is not ready");
  }
  const created = await input.connection.newChat(generation);
  input.connection.attach(created.chatId);
  input.ensureChatSubscription(created.chatId);
  input.onNewChat(created.chatId);
  return {
    chatId: created.chatId,
    isNewChat: true,
    ...(created.modelPreset ? { modelPreset: created.modelPreset } : {})
  };
}

export async function sendPanelUserMessage(input: {
  connection: Pick<MemmyAgentWebSocketConnection, "getReadyGeneration" | "submitMessage">;
  chatId: string;
  content: string;
  target?: WebuiSessionTarget;
  sendTarget: boolean;
  modelPreset?: string | null;
  source?: "mcp-app";
  appId?: string;
  viewId?: string;
  appControlled?: boolean;
}): Promise<{ clientRequestId: string }> {
  const generation = input.connection.getReadyGeneration();
  if (generation === null) {
    throw new Error("Agent gateway is not ready");
  }
  const clientRequestId = crypto.randomUUID();
  await input.connection.submitMessage({
    chatId: input.chatId,
    content: input.content,
    clientRequestId,
    ...(input.sendTarget && input.target ? { target: input.target } : {}),
    ...(input.modelPreset ? { modelPreset: input.modelPreset } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.appId ? { appId: input.appId } : {}),
    ...(input.viewId ? { viewId: input.viewId } : {}),
    ...(input.appControlled ? { appControlled: true } : {})
  }, generation);
  return { clientRequestId };
}
