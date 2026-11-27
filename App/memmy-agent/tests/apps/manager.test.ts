import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AppManager } from "../../src/apps/manager.js";
import type { AppRegistryEntry } from "../../src/apps/registry.js";

function entry(id: string, overrides: Partial<AppRegistryEntry["manifest"]> = {}): AppRegistryEntry {
  return {
    id,
    version: "1.0.0",
    path: `/tmp/${id}`,
    source: "dev",
    manifest: {
      schemaVersion: 1,
      id,
      name: id,
      version: "1.0.0",
      engines: { cuby: ">=0.0.1" },
      server: { scope: "global", transport: "stdio", command: "node", args: ["server.mjs"] },
      capabilities: { appToolCalls: [], appMessages: false },
      ...overrides
    } as any
  };
}

describe("AppManager", () => {
  it("starts global apps and exposes their status", async () => {
    const tools: any[] = [];
    const connect = vi.fn(async (name: string) => ({
      name, session: { callTool: vi.fn() }, tools: [{ name: "hello", inputSchema: { type: "object" } }],
      resources: [], prompts: [], close: vi.fn()
    }));
    const manager = new AppManager({
      entries: [entry("demo")],
      roots: { bundled: null, user: "/tmp/user", data: mkdtempSync(path.join(tmpdir(), "cuby-data-")), dev: [] },
      registerTool: (tool) => tools.push(tool),
      unregisterTool: vi.fn(),
      connect
    });
    await manager.initialize();
    expect(manager.getStatus("demo")?.state).toBe("ready");
    expect(tools.map((tool) => tool.name)).toEqual(["mcp_demo_hello"]);
  });

  it("does not block other apps when one fails", async () => {
    const connect = vi.fn(async (name: string) => {
      if (name === "bad") throw new Error("boom");
      return { name, session: {}, tools: [], resources: [], prompts: [], close: vi.fn() };
    });
    const manager = new AppManager({
      entries: [entry("bad"), entry("good")],
      roots: { bundled: null, user: "/tmp/user", data: mkdtempSync(path.join(tmpdir(), "cuby-data-")), dev: [] },
      registerTool: vi.fn(),
      unregisterTool: vi.fn(),
      connect
    });
    await manager.initialize();
    expect(manager.getStatus("bad")?.state).toBe("failed");
    expect(manager.getStatus("good")?.state).toBe("ready");
  });

  it("uses a separate process per session for session-scoped apps", async () => {
    const connect = vi.fn(async (name: string) => ({
      name, session: { callTool: vi.fn() }, tools: [], resources: [], prompts: [], close: vi.fn()
    }));
    const manager = new AppManager({
      entries: [entry("stateful", { server: { scope: "session", transport: "stdio", command: "node", args: ["server.mjs"] } })],
      roots: { bundled: null, user: "/tmp/user", data: mkdtempSync(path.join(tmpdir(), "cuby-data-")), dev: [] },
      registerTool: vi.fn(),
      unregisterTool: vi.fn(),
      connect
    });
    await manager.initialize();
    await manager.sessionFor("stateful", { sessionKey: "websocket:a" });
    await manager.sessionFor("stateful", { sessionKey: "websocket:b" });
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("starts session-scoped app tools for a turn", async () => {
    const tools: any[] = [];
    const connect = vi.fn(async (name: string) => ({
      name,
      session: { callTool: vi.fn() },
      tools: [{ name: "hello", inputSchema: { type: "object" } }],
      resources: [],
      prompts: [],
      close: vi.fn(),
    }));
    const manager = new AppManager({
      entries: [entry("stateful", { server: { scope: "session", transport: "stdio", command: "node", args: ["server.mjs"] } })],
      roots: { bundled: null, user: "/tmp/user", data: mkdtempSync(path.join(tmpdir(), "cuby-data-")), dev: [] },
      registerTool: (tool) => tools.push(tool),
      unregisterTool: vi.fn(),
      connect,
    });
    await manager.initialize();
    await manager.ensureSessionTools({ sessionKey: "websocket:a" });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(tools.map((tool) => tool.name)).toContain("mcp_stateful_hello");
  });

  it("gates app-initiated tools by the manifest allowlist", async () => {
    const manager = new AppManager({
      entries: [entry("demo", { capabilities: { appToolCalls: ["echo"], appMessages: false, workspace: "none" } })],
      roots: { bundled: null, user: "/tmp/user", data: mkdtempSync(path.join(tmpdir(), "cuby-data-")), dev: [] },
      registerTool: vi.fn(),
      unregisterTool: vi.fn(),
      connect: vi.fn(async (name: string) => ({
        name, session: { callTool: vi.fn() }, tools: [], resources: [], prompts: [], close: vi.fn()
      }))
    });
    await manager.initialize();
    expect(manager.canAppCallTool("demo", "echo")).toBe(true);
    expect(manager.canAppCallTool("demo", "hello")).toBe(false);
    expect(manager.canAppCallTool("unknown", "echo")).toBe(false);
  });

  it("denies ask app messages in v1", async () => {
    const manager = new AppManager({
      entries: [entry("ask", { capabilities: { appToolCalls: [], appMessages: "ask", workspace: "none" } })],
      roots: { bundled: null, user: "/tmp/user", data: mkdtempSync(path.join(tmpdir(), "cuby-data-")), dev: [] },
      registerTool: vi.fn(),
      unregisterTool: vi.fn(),
      connect: vi.fn(async (name: string) => ({
        name, session: { callTool: vi.fn() }, tools: [], resources: [], prompts: [], close: vi.fn()
      }))
    });
    await manager.initialize();
    expect(manager.canAppMessage("ask")).toBe(false);
  });

  it("shares one in-flight session start for concurrent callers", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const connect = vi.fn(async (name: string) => {
      await gate;
      return { name, session: { callTool: vi.fn() }, tools: [], resources: [], prompts: [], close: vi.fn() };
    });
    const manager = new AppManager({
      entries: [entry("stateful", { server: { scope: "session", transport: "stdio", command: "node", args: ["server.mjs"] }, capabilities: { appToolCalls: [], appMessages: false, workspace: "none" } })],
      roots: { bundled: null, user: "/tmp/user", data: mkdtempSync(path.join(tmpdir(), "cuby-data-")), dev: [] },
      registerTool: vi.fn(),
      unregisterTool: vi.fn(),
      connect,
    });
    await manager.initialize();
    const first = manager.sessionFor("stateful", { sessionKey: "s1", workspace: "/ws" });
    const second = manager.sessionFor("stateful", { sessionKey: "s1", workspace: "/ws" });
    release();
    const [left, right] = await Promise.all([first, second]);
    expect(left).toBe(right);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("injects SESSION_WORKSPACE only when the app declares workspace access", async () => {
    const configs: any[] = [];
    const connect = vi.fn(async (name: string, cfg: any) => {
      configs.push(cfg);
      return { name, session: { callTool: vi.fn() }, tools: [], resources: [], prompts: [], close: vi.fn() };
    });
    const manager = new AppManager({
      entries: [
        entry("reader", { server: { scope: "session", transport: "stdio", command: "node", args: ["server.mjs", "--workspace", "${SESSION_WORKSPACE}"] }, capabilities: { appToolCalls: [], appMessages: false, workspace: "read" } }),
        entry("isolated", { server: { scope: "session", transport: "stdio", command: "node", args: ["server.mjs"] }, capabilities: { appToolCalls: [], appMessages: false, workspace: "none" } }),
      ],
      roots: { bundled: null, user: "/tmp/user", data: mkdtempSync(path.join(tmpdir(), "cuby-data-")), dev: [] },
      registerTool: vi.fn(),
      unregisterTool: vi.fn(),
      connect,
    });
    await manager.initialize();
    await manager.sessionFor("reader", { sessionKey: "a", workspace: "/workspace" });
    await manager.sessionFor("isolated", { sessionKey: "b", workspace: "/workspace" });
    expect(configs[0]?.args).toEqual(["server.mjs", "--workspace", "/workspace"]);
    expect(configs[1]?.args).toEqual(["server.mjs"]);
    expect(configs[0]?.env?.SESSION_WORKSPACE).toBeUndefined();
  });

  it("respawning a session when the workspace changes", async () => {
    const closes: Array<ReturnType<typeof vi.fn>> = [];
    const connect = vi.fn(async (name: string) => {
      const close = vi.fn();
      closes.push(close);
      return { name, session: { callTool: vi.fn() }, tools: [], resources: [], prompts: [], close };
    });
    const manager = new AppManager({
      entries: [entry("stateful", { server: { scope: "session", transport: "stdio", command: "node", args: ["server.mjs"] }, capabilities: { appToolCalls: [], appMessages: false, workspace: "read" } })],
      roots: { bundled: null, user: "/tmp/user", data: mkdtempSync(path.join(tmpdir(), "cuby-data-")), dev: [] },
      registerTool: vi.fn(),
      unregisterTool: vi.fn(),
      connect,
    });
    await manager.initialize();
    await manager.sessionFor("stateful", { sessionKey: "s", workspace: "/a" });
    await manager.sessionFor("stateful", { sessionKey: "s", workspace: "/b" });
    expect(connect).toHaveBeenCalledTimes(2);
    expect(closes[0]).toHaveBeenCalledTimes(1);
  });

  it("marks a session app failed and unregisters its tools after a startup failure", async () => {
    let fail = false;
    const connect = vi.fn(async (name: string) => {
      if (fail) throw new Error("boom");
      return { name, session: { callTool: vi.fn() }, tools: [{ name: "hello", inputSchema: { type: "object" } }], resources: [], prompts: [], close: vi.fn() };
    });
    const unregister = vi.fn();
    const manager = new AppManager({
      entries: [entry("stateful", { server: { scope: "session", transport: "stdio", command: "node", args: ["server.mjs"] }, capabilities: { appToolCalls: [], appMessages: false, workspace: "read" } })],
      roots: { bundled: null, user: "/tmp/user", data: mkdtempSync(path.join(tmpdir(), "cuby-data-")), dev: [] },
      registerTool: vi.fn(),
      unregisterTool: unregister,
      connect,
      now: () => 0,
    });
    await manager.initialize();
    await manager.ensureSessionTools({ sessionKey: "s", workspace: "/a" });
    expect(manager.getStatus("stateful")?.toolNames).toContain("mcp_stateful_hello");
    fail = true;
    await manager.ensureSessionTools({ sessionKey: "s", workspace: "/b" });
    expect(manager.getStatus("stateful")?.state).toBe("failed");
    expect(unregister).toHaveBeenCalledWith("mcp_stateful_hello");
  });

  it("rejects view results for unknown apps and invalid view ids", async () => {
    const manager = new AppManager({
      entries: [entry("demo")],
      roots: { bundled: null, user: "/tmp/user", data: mkdtempSync(path.join(tmpdir(), "cuby-data-")), dev: [] },
      registerTool: vi.fn(),
      unregisterTool: vi.fn(),
      connect: vi.fn(async (name: string) => ({
        name, session: { callTool: vi.fn() }, tools: [], resources: [], prompts: [], close: vi.fn()
      }))
    });
    await manager.initialize();
    await expect(manager.readViewResult("unknown", "v")).rejects.toThrow();
    await expect(manager.readViewResult("demo", "../../x")).resolves.toBeNull();
  });

  it("reads a stored view result for a known app", async () => {
    const data = mkdtempSync(path.join(tmpdir(), "cuby-data-"));
    const manager = new AppManager({
      entries: [entry("demo")],
      roots: { bundled: null, user: "/tmp/user", data, dev: [] },
      registerTool: vi.fn(),
      unregisterTool: vi.fn(),
      connect: vi.fn(async (name: string) => ({
        name, session: { callTool: vi.fn() }, tools: [], resources: [], prompts: [], close: vi.fn()
      }))
    });
    await manager.initialize();
    const viewId = "11111111-1111-4111-8111-111111111111";
    mkdirSync(path.join(data, "demo", "views", viewId), { recursive: true });
    writeFileSync(path.join(data, "demo", "views", viewId, "result.json"), JSON.stringify({ content: [] }));
    await expect(manager.readViewResult("demo", viewId)).resolves.toEqual({ content: [] });
  });

  it("summarizes app UI metadata without exposing server config", async () => {
    const manager = new AppManager({
      entries: [entry("demo", {
        name: "Demo",
        description: "Demo app",
        ui: {
          resources: [{ uri: "ui://demo/home", entry: "ui/index.html" }],
          defaultResourceUri: "ui://demo/home",
          prefersBorder: false,
        },
        capabilities: { appToolCalls: ["hello"], appMessages: "allow", openLinks: true },
        entryPoints: [{ surface: "home", title: "Open Demo" }],
      })],
      roots: { bundled: null, user: "/tmp/user", data: mkdtempSync(path.join(tmpdir(), "cuby-data-")), dev: [] },
      registerTool: vi.fn(),
      unregisterTool: vi.fn(),
      connect: vi.fn(async (name: string) => ({
        name, session: { callTool: vi.fn() }, tools: [], resources: [], prompts: [], close: vi.fn()
      })),
    });
    await manager.initialize();

    const [summary] = manager.summaries();
    expect(summary).toMatchObject({
      id: "demo",
      name: "Demo",
      description: "Demo app",
      state: "ready",
      hasUi: true,
      ui: { defaultResourceUri: "ui://demo/home", prefersBorder: false },
      capabilities: { openLinks: true, appMessages: "allow" },
      entryPoints: [{ surface: "home", title: "Open Demo" }],
    });
    expect(JSON.stringify(summary)).not.toContain("server.mjs");
    expect(JSON.stringify(summary)).not.toContain("command");
  });

  it("marks no-UI apps with hasUi false", async () => {
    const manager = new AppManager({
      entries: [entry("plain")],
      roots: { bundled: null, user: "/tmp/user", data: mkdtempSync(path.join(tmpdir(), "cuby-data-")), dev: [] },
      registerTool: vi.fn(),
      unregisterTool: vi.fn(),
      connect: vi.fn(async (name: string) => ({
        name, session: { callTool: vi.fn() }, tools: [], resources: [], prompts: [], close: vi.fn()
      })),
    });
    await manager.initialize();
    expect(manager.summaries()[0]).toMatchObject({ id: "plain", hasUi: false });
  });
});
