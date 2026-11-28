import { describe, expect, it, vi } from "vitest";
import { MemmyAgentRequestError } from "../../api/memmy-agent-client.js";
import type { AgentTaskView } from "../../state/agent-chat-slice.js";
import {
  loadTaskChatForPanel,
  openTaskInApp,
  resolveTaskAppDisplayName,
  taskOpenInAppRequest,
} from "../open-task-in-app.js";

function task(overrides: Partial<AgentTaskView> = {}): AgentTaskView {
  return {
    sessionKey: "websocket:chat-1",
    chatId: "chat-1",
    title: "Notes",
    preview: "",
    updatedAt: null,
    runStartedAt: null,
    completedUnseen: false,
    pinned: false,
    archived: false,
    tags: [],
    projectId: null,
    groupProjectId: null,
    cwd: "/tmp",
    missingProject: false,
    ...overrides,
  };
}

describe("taskOpenInAppRequest", () => {
  it("returns null without an app", () => {
    expect(taskOpenInAppRequest(task())).toBeNull();
  });

  it("prefers the project workspace", () => {
    expect(taskOpenInAppRequest(task({ appId: "example-notes", projectId: "p1" }))).toEqual({
      appId: "example-notes",
      chatId: "chat-1",
      target: { kind: "project", projectId: "p1" },
      openPanel: true,
    });
  });

  it("falls back to standalone", () => {
    expect(taskOpenInAppRequest(task({ appId: "example-notes" }))).toMatchObject({
      target: { kind: "standalone" },
    });
  });
});

describe("resolveTaskAppDisplayName", () => {
  it("prefers the app list name over the persisted panel label", () => {
    expect(resolveTaskAppDisplayName(
      [{ id: "example-notes", name: "Example Notes" }],
      task({ appId: "example-notes", appName: "Notes panel title" })
    )).toBe("Example Notes");
  });

  it("falls back to the persisted label, then the app id", () => {
    expect(resolveTaskAppDisplayName([], task({ appId: "example-notes", appName: "Notes" }))).toBe("Notes");
    expect(resolveTaskAppDisplayName([], task({ appId: "example-notes" }))).toBe("example-notes");
    expect(resolveTaskAppDisplayName([], task())).toBeNull();
  });
});

describe("loadTaskChatForPanel", () => {
  it("selects and loads the chat for the panel", async () => {
    const dispatch = vi.fn();
    loadTaskChatForPanel(
      { readWebuiThread: async () => ({ sessionKey: "websocket:chat-1", messages: [] } as any) },
      dispatch,
      task()
    );

    expect(dispatch.mock.calls[0][0]).toMatchObject({ type: "agent/historyLoading", chatId: "chat-1" });
    const requestId = dispatch.mock.calls[0][0].requestId;
    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
        type: "agent/historyLoaded",
        requestId,
      }));
    });
  });

  it("records a missing chat without throwing", async () => {
    const dispatch = vi.fn();
    loadTaskChatForPanel(
      { readWebuiThread: async () => { throw new MemmyAgentRequestError("missing", 404); } },
      dispatch,
      task()
    );
    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "agent/historyOpenMissing" }));
    });
  });
});

const view = {
  viewId: "v1",
  appId: "example-notes",
  resourceUri: "ui://example-notes/home",
  toolName: "hello",
  title: "Example Notes",
  displayMode: "inline" as const,
  protocol: "mcp-apps/2026-01-26" as const,
  arguments: {},
  initialResult: { content: [] },
};

describe("openTaskInApp", () => {
  it("still opens the app when history loading fails", async () => {
    const dispatch = vi.fn();
    const openApp = vi.fn(async () => ({ bridge_chat_id: "chat-1", view }));
    openTaskInApp(task({ appId: "example-notes" }), {
      client: { readWebuiThread: async () => { throw new Error("network"); } },
      connection: { openApp } as any,
      dispatch,
    });

    await vi.waitFor(() => expect(openApp).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "agent/historyOpenFailed" }));
    });
  });

  it("does nothing for a non-app task", () => {
    const openApp = vi.fn();
    openTaskInApp(task(), {
      client: null,
      connection: { openApp } as any,
      dispatch: vi.fn(),
    });
    expect(openApp).not.toHaveBeenCalled();
  });
});
