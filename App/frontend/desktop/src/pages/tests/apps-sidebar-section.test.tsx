// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppHostSummary } from "@memmy/local-api-contracts";
import { I18nProvider } from "../../i18n/i18n-provider.js";
import { AppsSidebarSection } from "../apps-sidebar-section.js";

const base: AppHostSummary = {
  id: "demo",
  name: "Demo",
  version: "1.0.0",
  source: "dev",
  state: "ready",
  error: null,
  ui: {
    defaultResourceUri: "ui://demo/home",
    resources: [{ uri: "ui://demo/home" }],
    displayModes: ["inline", "fullscreen"],
    prefersBorder: true,
    csp: {}
  },
  capabilities: { openLinks: false, downloads: false, appMessages: "allow" },
  entryPoints: [{ surface: "home", title: "Demo" }],
  hasUi: true
};

function app(overrides: Partial<AppHostSummary>): AppHostSummary {
  return { ...base, ...overrides };
}

describe("AppsSidebarSection", () => {
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

  it("renders app entries and opens ready and failed apps but not disabled apps", () => {
    const onOpen = vi.fn();
    const apps = [
      app({ id: "demo", name: "Demo", state: "ready" }),
      app({ id: "bad", name: "Bad", state: "failed", error: "boom" }),
      app({ id: "off", name: "Off", state: "disabled" })
    ];

    act(() => root.render(
      <I18nProvider>
        <AppsSidebarSection
          apps={apps}
          activeAppId={null}
          onOpen={onOpen}
          onRetry={vi.fn()}
        />
      </I18nProvider>
    ));

    expect(container.textContent).toContain("Demo");
    expect(container.textContent).toContain("Bad");
    expect(container.querySelector('[data-app-id="bad"]')?.getAttribute("title")).toBe("boom");

    act(() => (container.querySelector('[data-app-id="demo"]') as HTMLButtonElement).click());
    expect(onOpen).toHaveBeenCalledWith("demo");

    act(() => (container.querySelector('[data-app-id="bad"]') as HTMLButtonElement).click());
    expect(onOpen).toHaveBeenCalledWith("bad");

    act(() => (container.querySelector('[data-app-id="off"]') as HTMLButtonElement).click());
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("renders a load error and retry action", () => {
    const onRetry = vi.fn();
    act(() => root.render(
      <I18nProvider>
        <AppsSidebarSection apps={[]} activeAppId={null} error="failed to load" onOpen={vi.fn()} onRetry={onRetry} />
      </I18nProvider>
    ));

    expect(container.textContent).toContain("failed to load");
    act(() => (container.querySelector('[data-apps-retry]') as HTMLButtonElement).click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
