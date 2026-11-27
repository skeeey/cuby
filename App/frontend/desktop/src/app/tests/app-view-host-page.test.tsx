import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/i18n-provider.js";
import type { AgentAppView } from "../../state/agent-tool-traces.js";
import { AppViewHost } from "../app-view-host.js";

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

const client = {
  callTool: vi.fn(),
  readResource: vi.fn(),
  sendMessage: vi.fn(),
  readViewResult: vi.fn()
};

describe("AppViewHost page layout", () => {
  it("fills the container and omits the inline card header", () => {
    const html = renderToString(
      <I18nProvider>
        <AppViewHost view={view} chatId="chat-1" client={client} layout="page" />
      </I18nProvider>
    );
    expect(html).toContain("cuby-app-view-host--page");
    expect(html).not.toContain("cuby-app-view-frame__header");
  });
});
