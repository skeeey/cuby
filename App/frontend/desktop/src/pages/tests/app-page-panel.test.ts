import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AppPageError, AppPageTarget } from "../../state/apps-slice.js";
import { canRestoreAppPageTarget, panelOpenForTarget } from "../app-page.js";

const target: AppPageTarget = {
  appId: "demo",
  bridgeChatId: "chat-1",
  origin: "chat",
  chatId: "chat-1",
  openPanel: true,
  view: {
    viewId: "v1",
    appId: "demo",
    resourceUri: "ui://demo/home",
    toolName: "hello",
    title: "Demo",
    displayMode: "inline",
    protocol: "mcp-apps/2026-01-26",
    arguments: {},
    initialResult: { content: [] },
  },
};

describe("AppPage panel intent", () => {
  it("opens the panel only for an explicit one-shot intent", () => {
    expect(panelOpenForTarget(target)).toBe(true);
    expect(panelOpenForTarget({ ...target, openPanel: undefined })).toBe(false);
    expect(panelOpenForTarget(null)).toBe(false);
  });

  it("does not restore a stored target while an open error is showing", () => {
    const error: AppPageError = { appId: "demo", error: "boom" };
    expect(canRestoreAppPageTarget(null, null)).toBe(true);
    expect(canRestoreAppPageTarget(null, error)).toBe(false);
    expect(canRestoreAppPageTarget(target, error)).toBe(false);
  });

  it("wires the intent into AppPage", () => {
    const source = readFileSync(resolve(__dirname, "..", "app-page.tsx"), "utf8");
    expect(source).toContain("setPanelOpen(panelOpenForTarget(target))");
    expect(source).toContain("dispatch(appActions.consumeAppPageOpenPanel())");
    expect(source).toContain("if (!canRestoreAppPageTarget(target, pageError)) return;");
  });
});
