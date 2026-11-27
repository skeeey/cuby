import { describe, expect, it, vi } from "vitest";
import type { AgentAppView } from "../../state/agent-tool-traces.js";
import type { AppPageTarget } from "../../state/apps-slice.js";
import { openPanelChat, sendPanelUserMessage } from "../app-page-chat.js";

const view: AgentAppView = {
  viewId: "v1",
  appId: "demo",
  resourceUri: "ui://demo/home",
  toolName: "hello",
  title: "Demo",
  displayMode: "inline",
  protocol: "mcp-apps/2026-01-26",
  arguments: {},
  initialResult: { content: [] }
};

const entryTarget: AppPageTarget = {
  appId: "demo",
  bridgeChatId: "app-1",
  origin: "entry",
  target: { kind: "project", projectId: "p1" },
  view
};

const chatTarget: AppPageTarget = {
  appId: "demo",
  bridgeChatId: "chat-1",
  origin: "chat",
  chatId: "chat-1",
  view
};

describe("app page chat helpers", () => {
  it("creates, attaches, and subscribes a new panel chat", async () => {
    const connection = {
      getReadyGeneration: () => 7,
      newChat: vi.fn(async () => ({ chatId: "chat-new" })),
      attach: vi.fn()
    };
    const ensureChatSubscription = vi.fn();
    const onNewChat = vi.fn();

    const result = await openPanelChat({
      target: entryTarget,
      connection: connection as any,
      ensureChatSubscription,
      onNewChat
    });

    expect(result).toEqual({ chatId: "chat-new", isNewChat: true });
    expect(connection.newChat).toHaveBeenCalledWith(7);
    expect(connection.attach).toHaveBeenCalledWith("chat-new");
    expect(ensureChatSubscription).toHaveBeenCalledWith("chat-new");
    expect(onNewChat).toHaveBeenCalledWith("chat-new");
  });

  it("reuses and subscribes a chat-origin chat", async () => {
    const connection = {
      getReadyGeneration: () => 7,
      newChat: vi.fn(),
      attach: vi.fn()
    };
    const ensureChatSubscription = vi.fn();
    const onNewChat = vi.fn();

    const result = await openPanelChat({
      target: chatTarget,
      connection: connection as any,
      ensureChatSubscription,
      onNewChat
    });

    expect(result).toEqual({ chatId: "chat-1", isNewChat: false });
    expect(connection.newChat).not.toHaveBeenCalled();
    expect(connection.attach).toHaveBeenCalledWith("chat-1");
    expect(ensureChatSubscription).toHaveBeenCalledWith("chat-1");
    expect(onNewChat).not.toHaveBeenCalled();
  });

  it("submits user messages with a client request id and target only for a new chat", async () => {
    const submitMessage = vi.fn(async () => ({ status: "accepted" }));
    const connection = { getReadyGeneration: () => 7, submitMessage };

    const first = await sendPanelUserMessage({
      connection: connection as any,
      chatId: "chat-1",
      content: "hi",
      target: { kind: "project", projectId: "p1" },
      sendTarget: true
    });
    expect(first.clientRequestId).toEqual(expect.any(String));
    expect(submitMessage).toHaveBeenLastCalledWith({
      chatId: "chat-1",
      content: "hi",
      clientRequestId: first.clientRequestId,
      target: { kind: "project", projectId: "p1" }
    }, 7);

    await sendPanelUserMessage({
      connection: connection as any,
      chatId: "chat-1",
      content: "again",
      target: { kind: "project", projectId: "p1" },
      sendTarget: false
    });
    expect(submitMessage.mock.calls[1][0].target).toBeUndefined();
  });
});
