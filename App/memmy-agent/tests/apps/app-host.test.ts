import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AppManager } from "../../src/apps/manager.js";
import { loadAppRegistry } from "../../src/apps/registry.js";
import { AgentLoop } from "../../src/core/agent-runtime/loop.js";
import { MessageBus } from "../../src/core/runtime-messages/index.js";

function provider() {
  return {
    getDefaultModel: () => "test-model",
    generation: { maxTokens: 4096 },
  };
}

describe("app host", () => {
  it("runs the fixture app through AppManager", async () => {
    const data = mkdtempSync(path.join(tmpdir(), "cuby-app-host-"));
    const roots = {
      bundled: null,
      user: path.join(data, "user"),
      data: path.join(data, "data"),
      dev: [] as string[],
    };
    const { entries, errors } = loadAppRegistry({
      ...roots,
      dev: [path.resolve("../../apps/fixture")],
    });
    expect(errors).toEqual([]);
    const registered: any[] = [];
    const manager = new AppManager({
      entries,
      roots,
      registerTool: (tool) => registered.push(tool),
      unregisterTool: () => undefined,
    });
    await manager.initialize();
    const view = await manager.callTool("fixture", "hello", { name: "Cuby" }, { sessionKey: "websocket:test" });
    expect(view.content[0].text).toContain("Hello");
    expect(registered.map((tool) => tool.name)).toContain("mcp_fixture_hello");
    await manager.stop();
  });

  it("reports an app view when the fixture hello tool runs", async () => {
    const data = mkdtempSync(path.join(tmpdir(), "cuby-app-view-host-"));
    const roots = {
      bundled: null,
      user: path.join(data, "user"),
      data: path.join(data, "data"),
      dev: [] as string[],
    };
    const { entries, errors } = loadAppRegistry({
      ...roots,
      dev: [path.resolve("../../apps/fixture")],
    });
    expect(errors).toEqual([]);
    const registered: any[] = [];
    const manager = new AppManager({
      entries,
      roots,
      registerTool: (tool) => registered.push(tool),
      unregisterTool: () => undefined,
    });
    await manager.initialize();
    await manager.ensureSessionTools({ sessionKey: "websocket:test" });
    const hello = registered.find((tool) => tool.name === "mcp_fixture_hello");
    const views: any[] = [];
    const result = await hello.execute({ name: "Cuby" }, {
      reportAppView: (view: any) => views.push(view),
    });
    expect(result).toContain("Hello, Cuby");
    expect(views).toHaveLength(1);
    expect(views[0].resourceUri).toBe("ui://fixture/hello");
    await manager.stop();
  });

  it("initializes app discovery in AgentLoop", async () => {    const previous = process.env.CUBY_DEV_APPS;
    process.env.CUBY_DEV_APPS = path.resolve("../../apps/fixture");
    const loop = new AgentLoop({
      bus: new MessageBus(),
      provider: provider(),
      workspace: mkdtempSync(path.join(tmpdir(), "cuby-loop-")),
      model: "test-model",
    });
    try {
      await loop.initializeRuntimeTools();
      expect(loop.apps?.getStatus("fixture")?.state).toBe("ready");
    } finally {
      await loop.closeRuntimeTools();
      if (previous === undefined) delete process.env.CUBY_DEV_APPS;
      else process.env.CUBY_DEV_APPS = previous;
    }
  });
});
