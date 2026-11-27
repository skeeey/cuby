import { describe, expect, it } from "vitest";
import {
  AppHostListResponseSchema,
  AppHostSummarySchema,
  AppHostViewSchema,
  AppOpenResultSchema,
} from "../src/app-host.js";

const view = {
  viewId: "11111111-1111-4111-8111-111111111111",
  appId: "financebuddy",
  resourceUri: "ui://financebuddy/home",
  toolName: "hello",
  title: "FinanceBuddy",
  displayMode: "inline",
  protocol: "mcp-apps/2026-01-26",
  arguments: {},
  initialResult: { content: [{ type: "text", text: "Hello" }] },
};

const summary = {
  id: "financebuddy",
  name: "FinanceBuddy",
  description: "Finance reader",
  version: "1.0.0",
  source: "dev",
  state: "ready",
  error: null,
  ui: {
    defaultResourceUri: "ui://financebuddy/home",
    resources: [{ uri: "ui://financebuddy/home" }],
    displayModes: ["inline", "fullscreen"],
    prefersBorder: true,
    csp: {},
  },
  capabilities: { openLinks: true, downloads: true, appMessages: "allow" },
  entryPoints: [{ surface: "home", title: "Open FinanceBuddy" }],
  hasUi: true,
};

describe("app host contracts", () => {
  it("parses an app summary and list response", () => {
    expect(AppHostSummarySchema.parse(summary)).toEqual(summary);
    expect(AppHostListResponseSchema.parse({ apps: [summary] })).toEqual({ apps: [summary] });
  });

  it("parses an app view and open result", () => {
    expect(AppHostViewSchema.parse(view)).toEqual(view);
    expect(AppOpenResultSchema.parse({ view, bridge_chat_id: "app-1" })).toEqual({
      view,
      bridge_chat_id: "app-1",
    });
  });

  it("rejects a summary without hasUi or entryPoints defaults", () => {
    expect(() => AppHostSummarySchema.parse({ ...summary, hasUi: undefined })).toThrow();
  });
});
