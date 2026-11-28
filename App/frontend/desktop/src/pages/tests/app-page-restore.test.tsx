// @vitest-environment happy-dom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeStoredAppPageTarget } from "../../app/app-page-storage.js";
import { AppProviders } from "../../app/providers.js";
import { appActions } from "../../state/app-actions.js";
import { useAppState } from "../../state/app-state.js";
import type { AppPageTarget } from "../../state/apps-slice.js";
import { AppPage } from "../app-page.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const stored: AppPageTarget = {
  appId: "demo",
  bridgeChatId: "chat-1",
  origin: "chat",
  chatId: "chat-1",
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

function Probe() {
  const { state } = useAppState();
  return <div data-testid="probe">{state.navigation.appPage ? "target" : "no-target"}</div>;
}

function Harness(props: { ready: boolean }) {
  const { dispatch } = useAppState();
  useEffect(() => {
    if (!props.ready) {
      dispatch(appActions.openAppPageFailed({ appId: "demo", error: "boom" }));
    }
  }, [props.ready, dispatch]);
  return props.ready ? <AppPage /> : null;
}

describe("AppPage restore guard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.sessionStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.sessionStorage.clear();
  });

  it("keeps the error page instead of restoring a stored target", async () => {
    writeStoredAppPageTarget(window.sessionStorage, stored);

    const render = async (ready: boolean) => {
      await act(async () => {
        root.render(
          <AppProviders>
            <Harness ready={ready} />
            <Probe />
          </AppProviders>
        );
      });
    };

    await render(false);
    await render(true);

    expect(container.textContent).toContain("boom");
    expect(container.querySelector('[data-testid="probe"]')?.textContent).toBe("no-target");
  });
});
