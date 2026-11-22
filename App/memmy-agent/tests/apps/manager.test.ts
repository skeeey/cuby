import { mkdtempSync } from "node:fs";
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
});
