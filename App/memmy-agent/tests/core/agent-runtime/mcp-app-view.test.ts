import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AppViewStore, type AppViewEvent } from "../../../src/apps/view.js";
import { AgentRunSpec, AgentRunner } from "../../../src/core/agent-runtime/runner.js";
import { Tool, type ToolExecutionContext } from "../../../src/core/agent-runtime/tools/base.js";
import { MCPToolWrapper } from "../../../src/core/agent-runtime/tools/mcp.js";
import { ToolRegistry } from "../../../src/core/agent-runtime/tools/registry.js";

function store(): AppViewStore {
  return new AppViewStore(mkdtempSync(path.join(tmpdir(), "cuby-app-view-")));
}

describe("MCP app views", () => {
  it("reports an app view for a tool with _meta.ui.resourceUri", async () => {
    const session = {
      callTool: vi.fn(async () => ({
        content: [{ type: "text", text: "hi" }],
        structuredContent: { ok: true },
      })),
    };
    const wrapper = new MCPToolWrapper(
      session,
      "demo",
      {
        name: "hello",
        description: "Hello",
        inputSchema: { type: "object", properties: {} },
        _meta: { ui: { resourceUri: "ui://demo/hello" } },
      },
      30,
      undefined,
      undefined,
      { appId: "demo", store: store() },
    );
    const views: AppViewEvent[] = [];

    await wrapper.execute({ name: "Cuby" }, {
      callId: "call-1",
      reportAppView: (view) => views.push(view),
    });

    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      appId: "demo",
      resourceUri: "ui://demo/hello",
      toolName: "hello",
      toolCallId: "call-1",
      arguments: { name: "Cuby" },
    });
  });

  it("does not report a view for an error result", async () => {
    const session = {
      callTool: vi.fn(async () => ({
        isError: true,
        content: [{ type: "text", text: "failed" }],
      })),
    };
    const wrapper = new MCPToolWrapper(
      session,
      "demo",
      {
        name: "hello",
        description: "Hello",
        inputSchema: { type: "object", properties: {} },
        _meta: { ui: { resourceUri: "ui://demo/hello" } },
      },
      30,
      undefined,
      undefined,
      { appId: "demo", store: store() },
    );
    const views: AppViewEvent[] = [];

    await wrapper.execute({}, { reportAppView: (view) => views.push(view) });

    expect(views).toEqual([]);
  });

  it("attaches a reported app view to the tool event", async () => {
    const view: AppViewEvent = {
      viewId: "v1",
      appId: "demo",
      resourceUri: "ui://demo/hello",
      toolName: "report_view",
      title: "Report",
      displayMode: "inline",
      protocol: "mcp-apps/2026-01-26",
      arguments: {},
      initialResult: { content: [] },
    };

    class ReportingTool extends Tool {
      get name(): string { return "report_view"; }
      get description(): string { return "Report a view"; }
      get parameters() { return { type: "object", properties: {} }; }
      async execute(_params: Record<string, any>, context?: ToolExecutionContext): Promise<string> {
        context?.reportAppView?.(view);
        return "ok";
      }
    }

    const registry = new ToolRegistry();
    registry.register(new ReportingTool());
    const runner = new AgentRunner();
    const results = await runner.executeTools(
      new AgentRunSpec({ tools: registry }),
      [{ id: "c1", name: "report_view", arguments: {} } as any],
    );

    expect(results[0]?.event.app).toEqual(view);
  });
});
