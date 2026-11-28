import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../../../src/core/session/manager.js";

const roots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memmy-app-summary-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function webuiSession(key: string): { sessions: SessionManager; session: ReturnType<SessionManager["getOrCreate"]> } {
  const root = tempRoot();
  const sessions = new SessionManager(path.join(root, "sessions"));
  const session = sessions.getOrCreate(key);
  session.metadata.webui = true;
  session.metadata.webuiProjectId = null;
  session.metadata.webuiWorkspaceCwd = fs.realpathSync(root);
  return { sessions, session };
}

describe("session summary app origin", () => {
  it("exposes the app context of the first user message", () => {
    const { sessions, session } = webuiSession("websocket:chat-1");
    session.addMessage("user", "hi", {
      webui_app_context: { appId: "example-notes", name: "Example Notes" },
    });
    session.addMessage("assistant", "hello");

    expect(sessions.webuiSessionSummary(session)).toMatchObject({
      appId: "example-notes",
      appName: "Example Notes",
    });
  });

  it("recognizes an app-controlled first message without a context name", () => {
    const { sessions, session } = webuiSession("websocket:chat-2");
    session.addMessage("user", "hi", { app_source: "mcp-app", appId: "example-notes" });

    const summary = sessions.webuiSessionSummary(session);
    expect(summary.appId).toBe("example-notes");
    expect(summary.appName).toBeUndefined();
  });

  it("ignores app messages that do not start the chat", () => {
    const { sessions, session } = webuiSession("websocket:chat-3");
    session.addMessage("user", "normal question");
    session.addMessage("user", "from app", { app_source: "mcp-app", appId: "example-notes" });

    expect(sessions.webuiSessionSummary(session).appId).toBeUndefined();
  });
});
