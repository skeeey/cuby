import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/i18n-provider.js";
import { zhCNMessages } from "../../i18n/messages.js";
import type { AgentAppView } from "../../state/agent-tool-traces.js";
import { AppViewFrame } from "../app-view-frame.js";
import { buildChatAppPageTarget } from "../../pages/agent-thread-messages.js";

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

describe("AppViewFrame open page action", () => {
  it("shows an open-page action only when a handler is provided", () => {
    const label = zhCNMessages["app.view.openPage"];
    const withHandler = renderToString(
      <I18nProvider>
        <AppViewFrame view={view} state="ready" expanded={false} onOpenPage={() => undefined}>
          <div />
        </AppViewFrame>
      </I18nProvider>
    );
    expect(withHandler).toContain(`aria-label="${label}"`);

    const without = renderToString(
      <I18nProvider>
        <AppViewFrame view={view} state="ready" expanded={false}>
          <div />
        </AppViewFrame>
      </I18nProvider>
    );
    expect(without).not.toContain(`aria-label="${label}"`);
  });

  it("builds a chat-origin target with the original view and chat id", () => {
    expect(buildChatAppPageTarget(view, "chat-1")).toEqual({
      appId: "demo",
      bridgeChatId: "chat-1",
      origin: "chat",
      chatId: "chat-1",
      view
    });
  });
});
