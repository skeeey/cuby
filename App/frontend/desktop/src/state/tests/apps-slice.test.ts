import { describe, expect, it } from "vitest";
import type { AppHostSummary } from "@memmy/local-api-contracts";
import { appActions, appsActions } from "../app-actions.js";
import { appReducer, createInitialAppState } from "../app-reducer.js";
import type { AgentAppView } from "../agent-tool-traces.js";

const summary: AppHostSummary = {
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

describe("apps state", () => {
  it("stores loaded apps and clears the error", () => {
    let state = createInitialAppState();
    state = appReducer(state, appActions.loadAppsStarted());
    expect(state.apps.status).toBe("loading");
    state = appReducer(state, appActions.loadAppsSucceeded([summary]));
    expect(state.apps).toMatchObject({ status: "ready", items: [summary], error: null });
  });

  it("records a load failure", () => {
    let state = createInitialAppState();
    state = appReducer(state, appActions.loadAppsFailed("boom"));
    expect(state.apps).toMatchObject({ status: "error", error: "boom" });
  });

  it("opens and clears an app page target without touching chat state", () => {
    let state = createInitialAppState();
    const chatIdBefore = state.agent.currentChatId;
    const target = { appId: "demo", bridgeChatId: "app-1", origin: "entry" as const, view };
    state = appReducer(state, appActions.openAppPage(target));
    expect(state.navigation.appPage).toEqual(target);
    expect(state.navigation.currentPath).toBe("/apps");
    expect(state.agent.currentChatId).toBe(chatIdBefore);
    state = appReducer(state, appActions.clearAppPage());
    expect(state.navigation.appPage).toBeNull();
  });

  it("records an app page open failure and clears it when retried", () => {
    let state = createInitialAppState();
    state = appReducer(state, appActions.openAppPageFailed({
      appId: "demo",
      target: { kind: "project", projectId: "p1" },
      error: "boom"
    }));
    expect(state.navigation.appPage).toBeNull();
    expect(state.navigation.appPageError).toMatchObject({ appId: "demo", error: "boom" });
    expect(state.navigation.currentPath).toBe("/apps");
    state = appReducer(state, appActions.openAppPage({ appId: "demo", bridgeChatId: "app-1", origin: "entry", view }));
    expect(state.navigation.appPageError).toBeNull();
  });

  it("loads apps through the helper", async () => {
    const actions: any[] = [];
    await appsActions.loadApps({ listApps: async () => [summary] }, (action) => actions.push(action));
    expect(actions.map((action) => action.type)).toEqual(["apps/loadStarted", "apps/loadSucceeded"]);
  });

  it("opens an app through the helper and preserves the workspace target", async () => {
    const actions: any[] = [];
    const target = { kind: "project" as const, projectId: "p1" };
    const opened = await appsActions.openApp(
      { openApp: async () => ({ bridge_chat_id: "app-1", view }) },
      (action) => actions.push(action),
      { appId: "demo", target }
    );
    expect(opened).toMatchObject({ appId: "demo", bridgeChatId: "app-1", origin: "entry", target });
    expect(actions.at(-1)).toMatchObject({ type: "navigation/appPageOpened" });
  });

  it("reports an app open failure through navigation", async () => {
    const actions: any[] = [];
    const opened = await appsActions.openApp(
      { openApp: async () => { throw new Error("boom"); } },
      (action) => actions.push(action),
      { appId: "demo" }
    );
    expect(opened).toBeNull();
    expect(actions.at(-1)).toMatchObject({ type: "navigation/appPageFailed", appId: "demo", error: "boom" });
  });
});
