import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/i18n-provider.js";
import { zhCNMessages } from "../../i18n/messages.js";
import type { AppPageTarget } from "../../state/apps-slice.js";
import { AppPageView } from "../app-page.js";

const target: AppPageTarget = {
  appId: "demo",
  bridgeChatId: "app-1",
  origin: "entry" as const,
  view: {
    viewId: "v1",
    appId: "demo",
    resourceUri: "ui://demo/home",
    toolName: "hello",
    title: "Demo",
    displayMode: "inline",
    protocol: "mcp-apps/2026-01-26",
    arguments: {},
    initialResult: { content: [] }
  }
};

describe("AppPage", () => {
  it("renders the app page for an entry target without a chat page", () => {
    const html = renderToString(
      <I18nProvider>
        <AppPageView target={target} onReload={vi.fn()} />
      </I18nProvider>
    );
    expect(html).toContain("cuby-app-page");
    expect(html).not.toContain("app-frame-task-list");
  });

  it("renders an empty state without a target", () => {
    const html = renderToString(
      <I18nProvider>
        <AppPageView target={null} onReload={vi.fn()} />
      </I18nProvider>
    );
    expect(html).toContain(zhCNMessages["app.page.empty"]);
  });
});
