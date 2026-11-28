// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/i18n-provider.js";
import { zhCNMessages } from "../../i18n/messages.js";
import type { AppPageTarget } from "../../state/apps-slice.js";
import { AppPageView } from "../app-page.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

describe("AppPageView layout", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("docks the app chat panel outside the app page's floating reload control", async () => {
    await act(async () => {
      root.render(
        <I18nProvider language="zh-CN">
          <AppPageView
            target={target}
            onReload={vi.fn()}
            aside={<aside className="cuby-app-chat-panel" aria-label="chat panel" />}
          >
            <div data-testid="app-content" />
          </AppPageView>
        </I18nProvider>
      );
    });

    const page = container.querySelector(".cuby-app-page");
    const appArea = container.querySelector(".cuby-app-page__main");
    const panel = container.querySelector(".cuby-app-chat-panel");

    expect(page).not.toBeNull();
    expect(appArea).not.toBeNull();
    expect(panel).not.toBeNull();

    // The app content and the floating reload control share the app area.
    expect(appArea?.querySelector('[data-testid="app-content"]')).not.toBeNull();
    expect(appArea?.querySelector(`[aria-label="${zhCNMessages["app.page.reload"]}"]`)).not.toBeNull();

    // The docked panel is a sibling of the app area, so its close button can
    // never overlap the floating reload control.
    expect(appArea?.contains(panel!)).toBe(false);
    expect(page?.contains(panel!)).toBe(true);
  });
});
