# Cuby App Host MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuby 能在 dev 模式发现一个 app 包、启动它的 MCP server、注册工具、把带 `_meta.ui.resourceUri` 的工具结果渲染成 sandboxed MCP App，并支持反向工具调用和 `ui/message`。

**Architecture:** 新增 `AppRegistry` / `AppManager` / `AppViewStore` 三个 agent 侧模块；MCP 连接抽成单 server 的 `connectMcpServer`；工具 wrapper 保留 `_meta` 并通过 `ToolExecutionContext.reportAppView` 产出 app view；renderer 新增 `AppViewBridge` 手写 MCP Apps host 协议，iframe 只负责内容；app view 作为 tool event 的 `app` 字段进入现有 transcript。

**Tech Stack:** TypeScript, Node 22, Vitest, Electron, React, `@modelcontextprotocol/sdk`, `zod`.

**Spec:** `docs/superpowers/specs/2026-11-21-cuby-app-packages-design.md`

## Global Constraints

- app 包目录为 `apps/<id>/`，manifest 为 `app.json`，`schemaVersion: 1`。
- app UI 必须是标准 MCP Apps：`ui://` resource + tool `_meta.ui.resourceUri` + sandboxed iframe；不得 import Cuby React/contracts。
- manifest 只允许占位符 `${APP_ROOT}`、`${APP_DATA}`、`${SESSION_WORKSPACE}`、`${CUBY_USER_DATA}`；`${SESSION_WORKSPACE}` 只在 `server.scope === "session"` 且 `capabilities.workspace !== "none"` 时允许。
- app 工具命名 `mcp_<appId>_<rawTool>`；一个作用域内模型调用和 app 反向调用复用同一个 MCP session。
- iframe `sandbox="allow-scripts"`，不加 `allow-same-origin`；CSP 默认拒绝网络。
- app view 的 `initialResult` 内联上限 256 KiB；超出或含图片时写 `${APP_DATA}/views/<viewId>/`，transcript 只存引用。
- `ui/message` 必须带 provenance：`source: "mcp-app"`、`appId`、`viewId`、`appControlled: true`。
- 第一版只支持 build-time 内置/ dev 加载的 app；不做运行时安装、签名、OS 沙箱。
- 本计划只实现 Phase 1（host MVP + dev 加载 + build 选择脚本）；Phase 2/3（打包、skills、UI Kit、FinanceBuddy 迁移）另立计划。

## Review Focus

1. **坏 manifest / 旧 manifest**：缺字段、未知占位符、平台不匹配、明文密钥时应被拒绝并显示可读错误，不能让 agent 崩溃或静默跳过。
2. **MCP server 启动/发现失败**：一个 app 卡死或崩溃时，其他 app 仍能启动，失败 app 的工具不注册，状态可见。
3. **超大/二进制工具结果**：>256 KiB 或含图片时 transcript 不应被 base64 撑爆，刷新后 app view 仍能恢复。
4. **越权 iframe**：app 调用白名单外工具、跨 app 调用、伪造 `ui/message` 时必须被拒绝，且不泄露其他 app 数据。
5. **并发 session 状态**：两个 chat 同时使用 `server.scope: "session"` 的 app 时，C2/run 状态不串，workspace/数据目录正确。
6. **折叠后 app view 消失**：turn 结束后 activity cluster 折叠，app view 必须仍然可见，不能像 DSH spike 那样被折进 “Completed”。

---

## File Structure

**Agent / shared**
- `App/backend/local-api-contracts/src/app-manifest.ts` — manifest types, zod schema, `parseAppManifest`, `AppManifestError`.
- `App/backend/local-api-contracts/src/index.ts` — re-export.
- `App/memmy-agent/src/apps/roots.ts` — `resolveAppRoots`.
- `App/memmy-agent/src/apps/registry.ts` — `AppRegistry`, registry file loading, dev overrides.
- `App/memmy-agent/src/apps/view.ts` — `AppViewEvent`, `AppViewStore`, UI meta parsing, result sanitization.
- `App/memmy-agent/src/apps/manager.ts` — `AppManager`, app lifecycle, session pool, reverse calls.
- `App/memmy-agent/src/apps/bridge.ts` — runtime-control handler for `app_bridge`.
- `App/memmy-agent/src/apps/index.ts` — exports.
- `App/memmy-agent/src/core/agent-runtime/tools/mcp.ts` — `connectMcpServer`, `MCPToolWrapper` session resolver + `_meta` retention.
- `App/memmy-agent/src/core/agent-runtime/tools/base.ts` — `ToolExecutionContext.reportAppView`.
- `App/memmy-agent/src/core/agent-runtime/runner.ts` — collect `reportAppView` into `event.app`.
- `App/memmy-agent/src/core/agent-runtime/loop.ts` — initialize `AppManager`, handle `app_bridge` runtime control.
- `App/memmy-agent/src/utils/progress-events.ts` — preserve `app` in finish payload.
- `App/memmy-agent/src/core/runtime-messages/events.ts` — `RUNTIME_CONTROL_APP_BRIDGE`.
- `App/memmy-agent/src/integrations/channels/websocket.ts` — `app_bridge` envelope + response.

**Renderer**
- `App/frontend/desktop/src/app/app-view-types.ts` — renderer app view types.
- `App/frontend/desktop/src/app/app-theme.ts` — Cuby token → `McpUiHostContext.styles.variables`.
- `App/frontend/desktop/src/app/app-view-bridge.ts` — host-side MCP Apps protocol.
- `App/frontend/desktop/src/app/app-view-frame.tsx` — host chrome, loading/error, display modes.
- `App/frontend/desktop/src/app/app-view-host.tsx` — iframe lifecycle + bridge mount.
- `App/frontend/desktop/src/pages/agent-thread-messages.tsx` — render app views outside the folding activity cluster.
- `App/frontend/desktop/src/state/agent-tool-traces.ts` — `AgentAppView` type + normalization.
- `App/frontend/desktop/src/state/agent-chat-slice.ts` — preserve `app` through merge/hydration.
- `App/frontend/desktop/src/api/memmy-agent-client.ts` — `requestAppBridge` WebSocket method.

**Desktop**
- `App/shell/desktop/interface/src/index.ts` — `DesktopAppFileSaveRequest` / `Result`.
- `App/shell/desktop/src/preload/preload.cts` — `saveAppFile`.
- `App/shell/desktop/src/main/main.ts` — `memmy:saveAppFile` IPC handler.
- `App/frontend/desktop/src/global.d.ts` — `window.memmy.saveAppFile`.

**Build / fixture**
- `cuby.apps.json` — default app selection.
- `scripts/apps/build-apps.mjs` — selection, validation, staging, registry hash.
- `apps/fixture/app.json` — fixture manifest.
- `apps/fixture/server.mjs` — fixture stdio MCP server with `hello` + `ui://fixture/hello`.
- `apps/fixture/ui/index.html` — self-contained fixture app.
- `apps/fixture/package.json` — optional workspace package.
- `package.json` — add `apps/*` workspace, `apps:build`, `apps:check`.
- `tests/apps/build-apps.test.ts` — build script tests.

---

### Task 1: App manifest contract

**Files:**
- Create: `App/backend/local-api-contracts/src/app-manifest.ts`
- Modify: `App/backend/local-api-contracts/src/index.ts`
- Test: `App/memmy-agent/tests/apps/manifest.test.ts`

**Interfaces:**
- Produces:
  - `AppManifestSchema` (zod)
  - `type AppManifest`
  - `class AppManifestError extends Error`
  - `function parseAppManifest(value: unknown): AppManifest`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { AppManifestError, parseAppManifest } from "@memmy/local-api-contracts";

const valid = {
  schemaVersion: 1,
  id: "financebuddy",
  name: "FinanceBuddy",
  version: "0.5.1",
  engines: { cuby: ">=2.1.0" },
  server: {
    scope: "session",
    transport: "stdio",
    command: { "linux-x64": "runtime/linux-x64/bin/python3" },
    args: ["server/main.py", "--config", "${APP_DATA}/config.json"],
    cwd: "${APP_ROOT}",
    env: { FINANCEBUDDY_WORKSPACE: "${APP_DATA}/workspace" }
  },
  ui: {
    resources: [{ uri: "ui://financebuddy/reader", entry: "ui/dist/index.html" }],
    defaultResourceUri: "ui://financebuddy/reader",
    prefersBorder: true,
    csp: { connectDomains: [], resourceDomains: [] }
  },
  capabilities: {
    appToolCalls: ["read_consistency_review"],
    appMessages: "allow",
    workspace: "none"
  }
};

describe("parseAppManifest", () => {
  it("accepts a valid manifest", () => {
    const parsed = parseAppManifest(valid);
    expect(parsed.id).toBe("financebuddy");
    expect(parsed.server.scope).toBe("session");
  });

  it("rejects an unknown placeholder", () => {
    expect(() => parseAppManifest({
      ...valid,
      server: { ...valid.server, args: ["${SECRET_DIR}/x"] }
    })).toThrow(AppManifestError);
  });

  it("rejects SESSION_WORKSPACE without session scope", () => {
    expect(() => parseAppManifest({
      ...valid,
      server: { ...valid.server, scope: "global", args: ["${SESSION_WORKSPACE}"] }
    })).toThrow(AppManifestError);
  });

  it("rejects duplicate UI resource URIs", () => {
    expect(() => parseAppManifest({
      ...valid,
      ui: { resources: [
        { uri: "ui://a/x", entry: "a.html" },
        { uri: "ui://a/x", entry: "b.html" }
      ] }
    })).toThrow(AppManifestError);
  });

  it("rejects plaintext secrets in server.env", () => {
    expect(() => parseAppManifest({
      ...valid,
      server: { ...valid.server, env: { API_KEY: "sk-live-1234567890" } }
    })).toThrow(AppManifestError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Before running, build the shared package: `npm run build -w @memmy/local-api-contracts` (the `pretest` hook does this for `npm test`, not for direct `npx vitest`).

Run: `cd App/memmy-agent && npx vitest run tests/apps/manifest.test.ts`
Expected: FAIL — `parseAppManifest` is not exported.

- [ ] **Step 3: Implement the schema**

In `app-manifest.ts`, define zod schemas for the fields in the spec §6.2–6.5. Use `.strict()` on every object. Add `validatePlaceholders(manifest)`:

```ts
const ALLOWED_PLACEHOLDERS = new Set(["APP_ROOT", "APP_DATA", "SESSION_WORKSPACE", "CUBY_USER_DATA"]);

function assertPlaceholders(value: unknown, path: string, manifest: AppManifest): void {
  for (const match of JSON.stringify(value).matchAll(/\$\{([A-Z_]+)\}/g)) {
    const name = match[1]!;
    if (!ALLOWED_PLACEHOLDERS.has(name)) throw new AppManifestError(`Unknown placeholder \${${name}} at ${path}`);
    if (name === "SESSION_WORKSPACE"
      && (manifest.server.scope !== "session" || manifest.capabilities.workspace === "none")) {
      throw new AppManifestError(`${"${SESSION_WORKSPACE}"} requires server.scope="session" and workspace capability`);
    }
  }
}
```

`parseAppManifest` calls `AppManifestSchema.safeParse`, maps zod issues to `AppManifestError` with `path.join(".")`, then runs placeholders and `assertNoPlaintextSecrets`.

`assertNoPlaintextSecrets` rejects values in `server.env` matching `/^(sk-|xoxb-|Bearer\s)/i` or a 40+ char base64-looking token. Keep it conservative; test every rejection.

Export from `index.ts`:
```ts
export * from "./app-manifest.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd App/memmy-agent && npx vitest run tests/apps/manifest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add App/backend/local-api-contracts/src/app-manifest.ts App/backend/local-api-contracts/src/index.ts App/memmy-agent/tests/apps/manifest.test.ts
git commit -m "feat(contracts): add app manifest schema"
```

---

### Task 2: App roots and registry

**Files:**
- Create: `App/memmy-agent/src/apps/roots.ts`
- Create: `App/memmy-agent/src/apps/registry.ts`
- Test: `App/memmy-agent/tests/apps/registry.test.ts`

**Interfaces:**
- Produces:
  - `type AppRoots = { bundled: string | null; user: string; data: string; dev: string[] }`
  - `function resolveAppRoots(env?: NodeJS.ProcessEnv): AppRoots`
  - `type AppSource = "bundled" | "user" | "dev"`
  - `type AppRegistryEntry = { id: string; version: string; path: string; source: AppSource; manifest: AppManifest; hash?: string }`
  - `type AppRegistryError = { path: string; message: string }`
  - `function loadAppRegistry(roots: AppRoots): { entries: AppRegistryEntry[]; errors: AppRegistryError[] }`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadAppRegistry } from "../../src/apps/registry.js";
import { resolveAppRoots } from "../../src/apps/roots.js";

function writeApp(root: string, id: string, version = "1.0.0") {
  const dir = path.join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "app.json"), JSON.stringify({
    schemaVersion: 1, id, name: id, version,
    engines: { cuby: ">=0.0.1" },
    server: { transport: "stdio", command: "node", args: ["server.mjs"] },
    capabilities: { appToolCalls: [], appMessages: false }
  }));
  return dir;
}

describe("app registry", () => {
  it("loads dev apps and lets them override bundled apps", () => {
    const root = mkdtempSync(path.join(tmpdir(), "cuby-apps-"));
    const bundled = writeApp(path.join(root, "bundled"), "demo", "1.0.0");
    const dev = writeApp(path.join(root, "dev"), "demo", "2.0.0");
    mkdirSync(path.join(root, "user"), { recursive: true });
    mkdirSync(path.join(root, "data"), { recursive: true });
    writeFileSync(path.join(root, "bundled", "registry.json"), JSON.stringify({
      schemaVersion: 1, apps: [{ id: "demo", version: "1.0.0", path: bundled }]
    }));

    const roots = resolveAppRoots({
      CUBY_BUNDLED_APPS_DIR: path.join(root, "bundled"),
      CUBY_USER_APPS_DIR: path.join(root, "user"),
      CUBY_APP_DATA_DIR: path.join(root, "data"),
      CUBY_DEV_APPS: dev
    });
    const { entries, errors } = loadAppRegistry(roots);
    expect(errors).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: "demo", version: "2.0.0", source: "dev" });
  });

  it("reports an invalid dev manifest without throwing", () => {
    const root = mkdtempSync(path.join(tmpdir(), "cuby-apps-"));
    const bad = path.join(root, "bad");
    mkdirSync(bad);
    writeFileSync(path.join(bad, "app.json"), "{ nope");
    const roots = resolveAppRoots({ CUBY_DEV_APPS: bad });
    const { entries, errors } = loadAppRegistry(roots);
    expect(entries).toEqual([]);
    expect(errors[0]?.path).toBe(bad);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd App/memmy-agent && npx vitest run tests/apps/registry.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement roots and registry**

`roots.ts`:
```ts
export function resolveAppRoots(env: NodeJS.ProcessEnv = process.env): AppRoots {
  const home = env.HOME || env.USERPROFILE || process.cwd();
  const userData = env.CUBY_USER_DATA?.trim() || path.join(home, ".cuby");
  return {
    bundled: env.CUBY_BUNDLED_APPS_DIR?.trim() || null,
    user: env.CUBY_USER_APPS_DIR?.trim() || path.join(userData, "apps"),
    data: env.CUBY_APP_DATA_DIR?.trim() || path.join(userData, "app-data"),
    dev: (env.CUBY_DEV_APPS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}
```

`registry.ts`:
- Read `registry.json` from bundled/user if present; each entry `{ id, version, path }`; resolve relative paths against the registry directory and read `app.json`.
- Dev paths are app directories (or parent directories containing `*/app.json`? Spec says `CUBY_DEV_APPS` points to local app dirs; support both a single app dir and a parent dir: if `app.json` exists use it, else scan immediate child dirs).
- Deduplicate by id with precedence `dev > user > bundled`.
- Parse each manifest with `parseAppManifest`; collect errors; do not throw.
- `hash` comes from registry entry and is optional.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd App/memmy-agent && npx vitest run tests/apps/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add App/memmy-agent/src/apps/roots.ts App/memmy-agent/src/apps/registry.ts App/memmy-agent/tests/apps/registry.test.ts
git commit -m "feat(apps): discover app packages from bundled and dev roots"
```

---

### Task 3: Single-server MCP connection

**Files:**
- Modify: `App/memmy-agent/src/core/agent-runtime/tools/mcp.ts`
- Create: `App/memmy-agent/tests/fixtures/mcp-echo-server.mjs`
- Test: `App/memmy-agent/tests/core/agent-runtime/mcp-connection.test.ts`

**Interfaces:**
- Produces:
  - `type McpServerConnection = { name: string; session: any; tools: any[]; resources: any[]; prompts: any[]; close(): Promise<void> }`
  - `function connectMcpServer(name: string, cfg: any): Promise<McpServerConnection>`
- Consumes: existing `connectMcpServers` behavior and `setMcpRuntimeForTest`.

- [ ] **Step 1: Write the failing test**

Create `tests/fixtures/mcp-echo-server.mjs` — a minimal stdio MCP server using `@modelcontextprotocol/sdk` with one `echo` tool and one `ui://fixture/echo` resource. Then add:

```ts
import path from "node:path";
import { connectMcpServer } from "../../../src/core/agent-runtime/tools/mcp.js";

it("returns a live session, tools and resources for one server", async () => {
  const connection = await connectMcpServer("fixture", {
    transport: "stdio",
    command: process.execPath,
    args: [path.resolve("tests/fixtures/mcp-echo-server.mjs")]
  });
  expect(connection.name).toBe("fixture");
  expect(connection.tools.map((tool) => tool.name)).toContain("echo");
  expect(connection.resources.map((resource) => resource.uri)).toContain("ui://fixture/echo");
  expect(typeof connection.session.callTool).toBe("function");
  await connection.close();
});
```

The fixture server must write only JSON-RPC to stdout and logs to stderr.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd App/memmy-agent && npx vitest run tests/core/agent-runtime/mcp-connection.test.ts`
Expected: FAIL — `connectMcpServer` is not exported.

- [ ] **Step 3: Extract the per-server body**

Move the body of the `for (const [name, cfg] of Object.entries(servers))` loop into:
```ts
export async function connectMcpServer(name: string, cfg: any): Promise<McpServerConnection> {
  // existing transport setup, initialize, listTools/listResources/listPrompts
  return { name, session: liveSession, tools: tools?.tools ?? [], resources, prompts, close };
}
```
Keep `connectMcpServers` behavior identical:
- call `connectMcpServer(name, cfg)`
- register `MCPToolWrapper` for each tool (respect `enabledTools`)
- register `MCPResourceWrapper` / `MCPPromptWrapper`
- store `{ close: connection.close, aclose: connection.close }` in stacks
- preserve the existing error logging and protocol-pollution hint.

Do not move the Managed OCU permission logic out of `connectMcpServer`; it stays inside.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd App/memmy-agent && npx vitest run tests/core/agent-runtime/mcp-connection.test.ts tests/core/agent-runtime/tools/mcp-tool.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add App/memmy-agent/src/core/agent-runtime/tools/mcp.ts App/memmy-agent/tests/core/agent-runtime/mcp-connection.test.ts App/memmy-agent/tests/fixtures/mcp-echo-server.mjs
git commit -m "refactor(mcp): expose single-server connection"
```

---

### Task 4: AppManager lifecycle

**Files:**
- Create: `App/memmy-agent/src/apps/manager.ts`
- Test: `App/memmy-agent/tests/apps/manager.test.ts`

**Interfaces:**
- Consumes: `AppRegistryEntry`, `McpServerConnection`, `connectMcpServer`, `ToolRegistry`.
- Produces:
```ts
export type AppState = "discovered" | "validated" | "enabled" | "starting" | "ready" | "failed" | "disabled" | "missing_credentials";
export type AppStatus = { id: string; version: string; source: AppSource; state: AppState; error: string | null; toolNames: string[]; viewUris: string[] };
export type AppManagerOptions = {
  entries: AppRegistryEntry[];
  roots: AppRoots;
  registerTool: (tool: any) => void;
  unregisterTool: (name: string) => void;
  connect?: (name: string, cfg: any) => Promise<McpServerConnection>;
  logger?: Pick<Console, "info" | "warn" | "error">;
  now?: () => number;
};
export class AppManager {
  constructor(options: AppManagerOptions);
  initialize(): Promise<void>;
  list(): AppStatus[];
  getStatus(id: string): AppStatus | undefined;
  sessionFor(appId: string, context: { sessionKey?: string | null; workspace?: string | null }): Promise<McpServerConnection>;
  callTool(appId: string, toolName: string, args: Record<string, any>, context: { sessionKey?: string | null; workspace?: string | null }): Promise<any>;
  readResource(appId: string, uri: string, context: { sessionKey?: string | null }): Promise<any>;
  readViewResult(appId: string, viewId: string): Promise<any | null>;
  canAppMessage(appId: string): boolean;
  stop(): Promise<void>;
}
```

- [ ] **Step 1: Write the failing test**

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd App/memmy-agent && npx vitest run tests/apps/manager.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement AppManager**

Implementation rules:
- `initialize()`:
  - For each entry: `semver.satisfies(VERSION, manifest.engines.cuby)`; add `semver` to `App/memmy-agent/package.json` if not declared. Unsatisfied → state `failed`, error `requires Cuby <range>`.
  - Check required credentials: `manifest.credentials?.filter(c => c.required).every(c => process.env[c.key])`. If missing → `missing_credentials`, no connect.
  - For `scope: "global"` → `startGlobal(entry)`.
  - For `scope: "session"` → state `ready` but no process until `sessionFor`.
- `startGlobal(entry)`:
  - `mkdir(${roots.data}/${id})`
  - build `serverConfig` by resolving placeholders and injecting env:
    - `APP_ROOT` = entry.path
    - `APP_DATA` = `${roots.data}/${id}`
    - `CUBY_USER_DATA` = `path.dirname(roots.data)` (or `CUBY_USER_DATA` env; pass in options if needed)
    - `SESSION_WORKSPACE` only for session scope
    - declared credentials from `process.env`
  - `connect(entry.id, serverConfig)`
  - create `MCPToolWrapper` for each tool with `serverName = entry.id`, `toolTimeout`, and a `resolveSession` callback; register. App view wiring is added in Task 5 and passed by Task 14.
  - state `ready`, `toolNames`, `viewUris`.
- `sessionFor(appId, context)`:
  - global → return global connection.
  - session → key `context.sessionKey ?? "default"`; reuse existing; else start a new connection with `${SESSION_WORKSPACE}` = `context.workspace ?? ""`; store; schedule idle eviction after 10 min (`setTimeout(...).unref?.()`).
- `callTool`/`readResource` delegate to the right connection.
- `readViewResult(appId, viewId)` reads `${roots.data}/${appId}/views/${viewId}/result.json` if present, else returns `null`.
- `canAppMessage` returns `manifest.capabilities.appMessages !== false`.
- `stop()` closes all connections and clears timers.
- Use `AppStatus` updates; do not throw out of `initialize()` for one app.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd App/memmy-agent && npx vitest run tests/apps/manager.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add App/memmy-agent/src/apps/manager.ts App/memmy-agent/tests/apps/manager.test.ts
git commit -m "feat(apps): add app manager lifecycle"
```

---

### Task 5: App view store and tool reporting

**Files:**
- Create: `App/memmy-agent/src/apps/view.ts`
- Modify: `App/memmy-agent/src/core/agent-runtime/tools/base.ts`
- Modify: `App/memmy-agent/src/core/agent-runtime/tools/mcp.ts`
- Modify: `App/memmy-agent/src/core/agent-runtime/runner.ts`
- Test: `App/memmy-agent/tests/apps/view.test.ts`
- Test: `App/memmy-agent/tests/core/agent-runtime/mcp-app-view.test.ts`

**Interfaces:**
- Produces:
```ts
export type AppViewEvent = {
  viewId: string;
  appId: string;
  resourceUri: string;
  toolCallId?: string;
  toolName: string;
  title: string;
  displayMode: "inline";
  protocol: "mcp-apps/2026-01-26";
  arguments: Record<string, unknown>;
  prefersBorder?: boolean;
  initialResult: { content: unknown[]; structuredContent?: unknown };
  artifacts?: Array<{ path: string; mimeType: string }>;
  resultRef?: string;
};
export class AppViewStore {
  constructor(appDataDir: string);
  create(input: { appId: string; resourceUri: string; toolName: string; title: string; toolCallId?: string; arguments: Record<string, unknown>; result: any }): Promise<AppViewEvent>;
}
export function readUiResourceUri(meta: unknown): string | null;
```
- Modify `ToolExecutionContext`:
```ts
reportAppView?: (view: AppViewEvent) => void;
```
- Modify `MCPToolWrapper` constructor to accept an optional `appView?: { appId: string; store: AppViewStore }`.
- Add `resolveSession?: (context: RequestContext | null) => Promise<any>` to `MCPToolWrapper` for session-scoped apps.

- [ ] **Step 1: Write the failing view store test**

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AppViewStore, readUiResourceUri } from "../../src/apps/view.js";

describe("AppViewStore", () => {
  it("reads nested and flat UI resource metadata", () => {
    expect(readUiResourceUri({ ui: { resourceUri: "ui://a/x" } })).toBe("ui://a/x");
    expect(readUiResourceUri({ "ui/resourceUri": "ui://a/y" })).toBe("ui://a/y");
    expect(readUiResourceUri(null)).toBeNull();
  });

  it("keeps small structured results inline", async () => {
    const store = new AppViewStore(mkdtempSync(path.join(tmpdir(), "cuby-view-")));
    const view = await store.create({
      appId: "demo", resourceUri: "ui://demo/x", toolName: "hello", title: "Hello",
      arguments: {}, result: { content: [{ type: "text", text: "hi" }], structuredContent: { ok: true } }
    });
    expect(view.initialResult.structuredContent).toEqual({ ok: true });
    expect(view.resultRef).toBeUndefined();
  });

  it("externalizes an oversized result", async () => {
    const store = new AppViewStore(mkdtempSync(path.join(tmpdir(), "cuby-view-")));
    const view = await store.create({
      appId: "demo", resourceUri: "ui://demo/x", toolName: "hello", title: "Hello",
      arguments: {}, result: { content: [{ type: "text", text: "x".repeat(300 * 1024) }] }
    });
    expect(view.resultRef).toMatch(/result\.json$/);
  });

  it("turns image content into an artifact", async () => {
    const store = new AppViewStore(mkdtempSync(path.join(tmpdir(), "cuby-view-")));
    const view = await store.create({
      appId: "demo", resourceUri: "ui://demo/x", toolName: "hello", title: "Hello",
      arguments: {}, result: { content: [{ type: "image", data: Buffer.from("png").toString("base64"), mimeType: "image/png" }] }
    });
    expect(view.artifacts?.[0]?.path).toMatch(/artifacts\//);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd App/memmy-agent && npx vitest run tests/apps/view.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement AppViewStore**

- `create`:
  - `viewId = crypto.randomUUID()`
  - clone result, strip `_meta` from content blocks.
  - For `image` blocks: write bytes to `${appDataDir}/views/${viewId}/artifacts/<n>.<ext>`, replace block with `{ type: "text", text: "[image: <path>]" }`, push artifact.
  - `initialResult = { content, structuredContent }`.
  - If `JSON.stringify(initialResult).length > 256 * 1024`: write full JSON to `${appDataDir}/views/${viewId}/result.json`; set `resultRef`; truncate `structuredContent` to `{ truncated: true }` and content to one text block.
  - Return event with `arguments: input.arguments`, `prefersBorder: true`, and the sanitized result.
- `readUiResourceUri` supports `_meta.ui.resourceUri` and `_meta["ui/resourceUri"]`; reject non-`ui://`.

- [ ] **Step 4: Wire MCPToolWrapper and runner**

In `MCPToolWrapper`:
```ts
private readonly uiResourceUri: string | null;
constructor(..., private readonly appView?: { appId: string; store: AppViewStore }, private readonly resolveSession?: (context: RequestContext | null) => Promise<any>) {
  ...
  this.uiResourceUri = readUiResourceUri(toolDef._meta);
}
```
In `execute`, replace `this.session.callTool` with:
```ts
const session = this.resolveSession ? await this.resolveSession(this.requestContext.get()) : this.session;
const result = await timeoutPromise(session.callTool(...), ...);
if (result?.isError !== true && this.uiResourceUri && this.appView && context?.reportAppView) {
  context.reportAppView(await this.appView.store.create({
    appId: this.appView.appId,
    resourceUri: this.uiResourceUri,
    toolName: this.originalName,
    title: this.toolDescription,
    toolCallId: context.callId ?? undefined,
    arguments: params,
    result,
  }));
}
```
Do this in both managed and regular branches; for managed, use the result before conversion.

In `AppManager`, create one `AppViewStore` per app: `new AppViewStore(path.join(roots.data, entry.id))`, and pass `{ appId: entry.id, store }` plus the session resolver to each `MCPToolWrapper` (see Task 14 for the final wiring).

In `runner.ts` `executeTool`:
```ts
let appView: AppViewEvent | null = null;
const toolContext: ToolExecutionContext = { ..., reportAppView: (view) => { appView = view; } };
...
if (appView) event.app = appView;
```
Attach before `afterToolCall` so hooks see it.

- [ ] **Step 5: Run tests**

Run: `cd App/memmy-agent && npx vitest run tests/apps/view.test.ts tests/core/agent-runtime/mcp-app-view.test.ts tests/core/agent-runtime/tools/mcp-tool.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add App/memmy-agent/src/apps/view.ts App/memmy-agent/src/core/agent-runtime/tools/base.ts App/memmy-agent/src/core/agent-runtime/tools/mcp.ts App/memmy-agent/src/core/agent-runtime/runner.ts App/memmy-agent/tests/apps/view.test.ts App/memmy-agent/tests/core/agent-runtime/mcp-app-view.test.ts
git commit -m "feat(apps): report app views from MCP tool results"
```

---

### Task 6: Persist app views through tool events

**Files:**
- Modify: `App/memmy-agent/src/utils/progress-events.ts`
- Test: `App/memmy-agent/tests/utils/progress-events.test.ts`
- Test: `App/memmy-agent/tests/core/agent-runtime/loop-progress.test.ts`

**Interfaces:**
- Consumes: `event.app` from Task 5.
- Produces: finish payload includes `app?: AppViewEvent`.

- [ ] **Step 1: Write the failing test**

```ts
it("preserves an app view in the finish payload", () => {
  const app = { viewId: "v1", appId: "demo", resourceUri: "ui://demo/x", toolName: "hello", title: "Hello", displayMode: "inline", protocol: "mcp-apps/2026-01-26", initialResult: { content: [] } };
  const [payload] = buildToolEventFinishPayloads({
    toolCalls: [{ id: "c1", name: "mcp_demo_hello", arguments: {} }],
    toolResults: ["ok"],
    toolEvents: [{ status: "ok", app }]
  });
  expect(payload.app).toEqual(app);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd App/memmy-agent && npx vitest run tests/utils/progress-events.test.ts`
Expected: FAIL — `payload.app` is undefined.

- [ ] **Step 3: Implement**

In `buildToolEventFinishPayloads`, read `event.app` and add it to `payload`:
```ts
if (event.app) payload.app = event.app;
```
Do not include it in the start payload. `buildToolEventStartPayload` can keep `app: null` for shape consistency, but the renderer should ignore `phase: "start"`.

- [ ] **Step 4: Run tests**

Run: `cd App/memmy-agent && npx vitest run tests/utils/progress-events.test.ts tests/core/agent-runtime/loop-progress.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add App/memmy-agent/src/utils/progress-events.ts App/memmy-agent/tests/utils/progress-events.test.ts App/memmy-agent/tests/core/agent-runtime/loop-progress.test.ts
git commit -m "feat(apps): carry app views in tool events"
```

---

### Task 7: Renderer app view types and state

**Files:**
- Modify: `App/frontend/desktop/src/state/agent-tool-traces.ts`
- Modify: `App/frontend/desktop/src/state/agent-chat-slice.ts` (types only if needed)
- Test: `App/frontend/desktop/src/state/tests/agent-tool-traces.test.ts`

**Interfaces:**
- Produces:
```ts
export type AgentAppView = {
  viewId: string;
  appId: string;
  resourceUri: string;
  toolCallId?: string;
  toolName: string;
  title: string;
  displayMode: "inline" | "fullscreen";
  protocol: "mcp-apps/2026-01-26";
  arguments?: Record<string, unknown>;
  prefersBorder?: boolean;
  initialResult?: { content: unknown[]; structuredContent?: unknown } | null;
  artifacts?: Array<{ path: string; mimeType: string }>;
  resultRef?: string;
};
export interface AgentToolProgressEvent {
  ...
  app?: AgentAppView | null;
}
```

- [ ] **Step 1: Write the failing test**

```ts
it("preserves app metadata when normalizing and merging tool events", () => {
  const app = { viewId: "v1", appId: "demo", resourceUri: "ui://demo/x", toolName: "hello", title: "Hello", displayMode: "inline", protocol: "mcp-apps/2026-01-26" };
  const events = normalizeToolProgressEvents([
    { phase: "start", call_id: "1", name: "mcp_demo_hello" },
    { phase: "end", call_id: "1", name: "mcp_demo_hello", app }
  ]);
  const merged = mergeToolProgressEvents(events, []);
  expect(merged[0]?.app).toEqual(app);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd App/frontend/desktop && npx vitest run src/state/tests/agent-tool-traces.test.ts`
Expected: FAIL — type/logic doesn't preserve `app` (or TypeScript error if test uses `app`).

- [ ] **Step 3: Implement**

- Add `AgentAppView` and `app?: AgentAppView | null` to `AgentToolProgressEvent`.
- `normalizeToolProgressEvents` already returns `{ ...event }`; ensure it doesn't strip unknown keys (it doesn't).
- `mergeToolProgressEvents` uses spread; ensure the later `end` event's `app` wins. Add a test.
- `agent-chat-slice.ts` uses `normalizeToolProgressEvents`; no code change unless the trace message builder picks fields explicitly. If it does, add `app: event.app` or keep the spread.
- `AgentChatMessage` already has `toolEvents?: AgentToolProgressEvent[]`; no new field.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd App/frontend/desktop && npx vitest run src/state/tests/agent-tool-traces.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add App/frontend/desktop/src/state/agent-tool-traces.ts App/frontend/desktop/src/state/agent-chat-slice.ts App/frontend/desktop/src/state/tests/agent-tool-traces.test.ts
git commit -m "feat(webui): preserve app view metadata in tool events"
```

---

### Task 8: AppViewBridge and AppViewHost

**Files:**
- Create: `App/frontend/desktop/src/app/app-view-types.ts`
- Create: `App/frontend/desktop/src/app/app-view-bridge.ts`
- Create: `App/frontend/desktop/src/app/app-view-host.tsx`
- Test: `App/frontend/desktop/src/app/tests/app-view-bridge.test.ts`

**Interfaces:**
- Produces:
```ts
export type AppBridgeTransport = {
  callTool(input: { viewId: string; tool: string; arguments: Record<string, unknown> }): Promise<any>;
  readResource(input: { viewId: string; uri: string }): Promise<any>;
  sendMessage(input: { viewId: string; content: Array<Record<string, unknown>> }): Promise<any>;
  readViewResult(viewId: string): Promise<any>;
};
export class AppViewBridge {
  constructor(input: {
    iframe: { contentWindow: { postMessage(message: unknown, targetOrigin: string): void } | null };
    view: AgentAppView;
    hostContext: () => Record<string, unknown>;
    transport: AppBridgeTransport;
    openLink?: (url: string) => Promise<void>;
    downloadFile?: (contents: unknown[]) => Promise<any>;
    onDisplayModeChange?: (mode: "inline" | "fullscreen") => void;
    onSizeChange?: (size: { width?: number; height?: number }) => void;
    onError?: (message: string) => void;
  });
  start(): void;
  handleMessage(event: { source?: unknown; data?: unknown }): Promise<void>;
  sendToolInput(args: Record<string, unknown>): void;
  sendToolResult(result: unknown): void;
  sendHostContextChanged(context: Record<string, unknown>): void;
  teardown(): Promise<void>;
}
export function AppViewHost(props: { view: AgentAppView; chatId: string; client: AppBridgeTransport; onSendMessage?; ... }): JSX.Element;
```

- [ ] **Step 1: Write the failing bridge test**

```ts
import { describe, expect, it, vi } from "vitest";
import { AppViewBridge } from "../app-view-bridge.js";

function makeBridge() {
  const postMessage = vi.fn();
  const callTool = vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));
  const bridge = new AppViewBridge({
    iframe: { contentWindow: { postMessage } },
    view: { viewId: "v1", appId: "demo", resourceUri: "ui://demo/x", toolName: "hello", title: "Hello", displayMode: "inline", protocol: "mcp-apps/2026-01-26" },
    hostContext: () => ({ theme: "light", displayMode: "inline" }),
    transport: { callTool, readResource: vi.fn(), sendMessage: vi.fn(), readViewResult: vi.fn() },
    openLink: vi.fn(),
    downloadFile: vi.fn()
  });
  bridge.start();
  return { bridge, postMessage, callTool };
}

describe("AppViewBridge", () => {
  it("answers ui/initialize with host capabilities and context", async () => {
    const { bridge, postMessage } = makeBridge();
    await bridge.handleMessage({
      source: (bridge as any).iframeWindow,
      data: { jsonrpc: "2.0", id: 1, method: "ui/initialize", params: { protocolVersion: "2026-01-26", appCapabilities: {}, appInfo: { name: "demo", version: "1" } } }
    });
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      jsonrpc: "2.0", id: 1,
      result: expect.objectContaining({
        protocolVersion: "2026-01-26",
        hostCapabilities: expect.objectContaining({ openLinks: {}, downloadFile: {} }),
        hostContext: expect.objectContaining({ theme: "light" })
      })
    }), "*");
  });

  it("forwards tools/call and rejects an out-of-allowlist tool error", async () => {
    const { bridge, postMessage, callTool } = makeBridge();
    await bridge.handleMessage({
      source: (bridge as any).iframeWindow,
      data: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "read_consistency_page", arguments: { page: 1 } } }
    });
    expect(callTool).toHaveBeenCalledWith({ viewId: "v1", tool: "read_consistency_page", arguments: { page: 1 } });
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 2, result: expect.anything() }), "*");
  });
});
```

If `iframeWindow` is not exposed publicly, use a fake window object and expose `handleMessage(event)` with a stable `source` check: compare `event.source` to `contentWindow`; the test can use the same object.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd App/frontend/desktop && npx vitest run src/app/tests/app-view-bridge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement AppViewBridge**

- `start()`: attach `window.addEventListener("message", this.handleMessage)`, set a 5000ms timer; if no `ui/notifications/initialized`, call `onError`.
- `handleMessage`:
  - ignore if `event.source !== this.iframe.contentWindow`.
  - parse `event.data`; require `jsonrpc === "2.0"`.
  - If `id` is present and method:
    - `ui/initialize` → respond `{ protocolVersion: params.protocolVersion === "2026-01-26" ? "2026-01-26" : "2026-01-26", hostCapabilities, hostInfo: { name: "Cuby", version: APP_VERSION }, hostContext: hostContext() }`.
    - `tools/call` → `transport.callTool({ viewId, tool: params.name, arguments: params.arguments ?? {} })`; respond `{ result }` or `{ error: { code: -32603, message } }`.
    - `resources/read` → `transport.readResource({ viewId, uri: params.uri })`.
    - `ui/message` → `transport.sendMessage({ viewId, content: params.content ?? [] })`.
    - `ui/open-link` → validate `http`/`https`; call `openLink`; respond `{}`.
    - `ui/download-file` → call `downloadFile(params.contents ?? [])`; respond `{}`.
    - `ui/request-display-mode` → call `onDisplayModeChange(params.mode)`; respond `{ mode: params.mode }`.
    - `ui/update-model-context` → call `transport.sendMessage`? Better add `updateModelContext` to transport; v1 can respond `{}` and ignore. Add `updateModelContext?: (input) => Promise<void>` to transport; if absent respond `{}`.
  - If notification:
    - `ui/notifications/initialized` → clear timer; mark initialized; send `sendToolInput(view.arguments ?? {})` then `sendToolResult(view.initialResult)`.
    - `ui/notifications/size-changed` → `onSizeChange`.
    - `ui/notifications/request-teardown` → `teardown`.
- `sendToolInput`/`sendToolResult` use `postMessage({jsonrpc:"2.0", method, params}, "*")`.
- `teardown()`: `postMessage({jsonrpc:"2.0", method:"ui/resource-teardown", params:{}})` and remove listener.

`app-view-host.tsx`:
- `useEffect` on mount: call `client.readResource({viewId, uri})` to get HTML; if `view.resultRef` is set, call `client.readViewResult(view.viewId)` and use that as `initialResult`, otherwise use `view.initialResult`; set `iframe.srcdoc`; create bridge after iframe load.
- `iframe` attributes: `sandbox="allow-scripts"`, `title={view.title}`, `className`, `style={{ width: "100%", height: size.height ?? 320, border: 0 }}`.
- Render `AppViewFrame` (Task 9) around it.
- On unmount: `bridge.teardown()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd App/frontend/desktop && npx vitest run src/app/tests/app-view-bridge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add App/frontend/desktop/src/app/app-view-types.ts App/frontend/desktop/src/app/app-view-bridge.ts App/frontend/desktop/src/app/app-view-host.tsx App/frontend/desktop/src/app/tests/app-view-bridge.test.ts
git commit -m "feat(webui): add MCP Apps host bridge"
```

---

### Task 9: Host chrome, tokens, and thread rendering

**Files:**
- Create: `App/frontend/desktop/src/app/app-theme.ts`
- Create: `App/frontend/desktop/src/app/app-view-frame.tsx`
- Modify: `App/frontend/desktop/src/pages/agent-thread-messages.tsx`
- Modify: `App/frontend/desktop/src/pages/app-frame.tsx`
- Test: `App/frontend/desktop/src/app/tests/app-theme.test.ts`
- Test: `App/frontend/desktop/src/pages/tests/agent-thread-messages.test.tsx`

**Interfaces:**
- Produces:
```ts
export function cubyHostContext(input: {
  displayMode: "inline" | "fullscreen";
  container: { width: number; height?: number; maxHeight?: number };
  locale: string;
  theme: "light" | "dark";
  readToken?: (name: string) => string;
}): Record<string, unknown>;
```
- `AppViewFrame` props: `{ view; children; state: "loading" | "ready" | "error"; error?: string; onRetry?; onToggleExpanded?; expanded: boolean }`.

- [ ] **Step 1: Write the failing theme test**

```ts
import { describe, expect, it } from "vitest";
import { cubyHostContext } from "../app-theme.js";

describe("cubyHostContext", () => {
  it("maps Cuby tokens to MCP Apps style variables", () => {
    const context = cubyHostContext({
      displayMode: "inline", container: { width: 800, maxHeight: 480 }, locale: "zh-CN", theme: "light",
      readToken: (name) => `value-of-${name}`
    });
    expect(context).toMatchObject({
      theme: "light",
      displayMode: "inline",
      locale: "zh-CN",
      containerDimensions: { width: 800, maxHeight: 480 },
      styles: { variables: expect.objectContaining({
        "--color-background-primary": expect.any(String),
        "--color-text-primary": expect.any(String),
        "--font-sans": expect.any(String)
      }) }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd App/frontend/desktop && npx vitest run src/app/tests/app-theme.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement theme mapping and frame**

`app-theme.ts`:
- Read computed style values from `document.documentElement`:
```ts
const read = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const variables: Record<string, string> = {
  "--color-background-primary": read("--color-background-paper"),
  "--color-background-secondary": read("--color-canvas-oat"),
  "--color-text-primary": read("--color-text-ink"),
  "--color-text-secondary": read("--color-ink-muted"),
  "--color-border-primary": read("--color-border-stone"),
  "--color-ring-primary": read("--color-action-sky"),
  "--font-sans": read("--font-sans"),
  "--font-mono": read("--font-mono"),
  "--border-radius-md": read("--radius-card"),
  "--border-radius-sm": read("--radius-btn"),
  "--shadow-md": read("--shadow-card")
};
```
- Include `safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 }`, `platform: "desktop"`, `deviceCapabilities: { touch: false, hover: true }`.
- Accept `theme` from `document.documentElement.dataset.theme` / class `dark`.

`app-view-frame.tsx`:
- Card with `border`/`background` based on `view.prefersBorder` (add `prefersBorder?: boolean` to `AgentAppView`).
- Header: app name (`view.appId` or manifest name in title), title, toolbar buttons with accessible labels.
- Loading skeleton: 3 pulsing rows.
- Error: message + Retry button.
- Children: iframe.
- Expanded: fullscreen overlay; Escape closes.

`agent-thread-messages.tsx`:
- Add `AppViewList` component:
```tsx
function AppViewList(props: { message: AgentChatMessage; client: AppBridgeTransport; chatId: string }) {
  const views = (props.message.toolEvents ?? []).flatMap((event) => event.phase === "end" && event.app ? [event.app] : []);
  return <>{views.map((view) => <AppViewHost key={view.viewId} view={view} chatId={props.chatId} client={props.client} />)}</>;
}
```
- Render it **outside** `AgentActivityCluster`, after the cluster in both render paths (`buildAgentDisplayUnits` unit path and single trace path), so folding the activity does not hide it.
- `AgentThreadMessages` 新增 `appBridgeClient?: AppBridgeTransport` prop；`app-frame.tsx` 用当前 `MemmyAgentWebSocketConnection` 和 `window.memmy` 构造并传入。没有 client 时 `AppViewList` 显示“app 宿主不可用”占位，不崩溃。
- Add a test asserting an app view renders after a trace message even when the activity is collapsed.

- [ ] **Step 4: Run tests**

Run: `cd App/frontend/desktop && npx vitest run src/app/tests/app-theme.test.ts src/pages/tests/agent-thread-messages.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add App/frontend/desktop/src/app/app-theme.ts App/frontend/desktop/src/app/app-view-frame.tsx App/frontend/desktop/src/pages/agent-thread-messages.tsx App/frontend/desktop/src/pages/app-frame.tsx App/frontend/desktop/src/app/tests/app-theme.test.ts App/frontend/desktop/src/pages/tests/agent-thread-messages.test.tsx
git commit -m "feat(webui): render app views with Cuby chrome and tokens"
```

---

### Task 10: `app_bridge` runtime control and `ui/message`

**Files:**
- Modify: `App/memmy-agent/src/core/runtime-messages/events.ts`
- Create: `App/memmy-agent/src/apps/bridge.ts`
- Modify: `App/memmy-agent/src/core/agent-runtime/loop.ts`
- Modify: `App/memmy-agent/src/integrations/channels/websocket.ts`
- Modify: `App/frontend/desktop/src/api/memmy-agent-client.ts`
- Test: `App/memmy-agent/tests/apps/bridge.test.ts`
- Test: `App/memmy-agent/tests/integrations/channels/websocket-channel.test.ts`

**Interfaces:**
- Produces:
```ts
export const RUNTIME_CONTROL_APP_BRIDGE = "appBridge";
export type AppBridgeMethod = "tools/call" | "resources/read" | "ui/message" | "ui/update-model-context" | "view/result";
export type AppBridgeRequest = { requestId: string; chatId: string; sessionKey?: string; appId: string; viewId: string; method: AppBridgeMethod; params: Record<string, unknown> };
export type AppBridgeResult = { ok: true; result?: unknown } | { ok: false; error: string };
export async function handleAppRuntimeControl(input: {
  apps: AppManager | null;
  msg: InboundMessage;
  publishInbound: (message: InboundMessage) => Promise<void>;
}): Promise<boolean>;
```
- Frontend:
```ts
requestAppBridge(request: { requestId: string; chatId: string; sessionKey?: string; appId: string; viewId: string; method: AppBridgeMethod; params: Record<string, unknown> }): Promise<AppBridgeResult>;
```
- WebSocket envelope: `{ type: "app_bridge", request_id, chat_id, session_key, app_id, view_id, method, params }`; response event `app_bridge_result` with `request_id`.

- [ ] **Step 1: Write the failing bridge test**

```ts
import { describe, expect, it, vi } from "vitest";
import { handleAppRuntimeControl } from "../../src/apps/bridge.js";
import { InboundMessage } from "../../src/core/runtime-messages/events.js";

it("routes tools/call to the app manager", async () => {
  const callTool = vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));
  const ack = vi.fn();
  const msg = new InboundMessage({
    channel: "system", chatId: "runtime", content: "appBridge",
    metadata: {
      runtimeControl: "appBridge", ack,
      appId: "demo", viewId: "v1", chatId: "chat-1", sessionKey: "websocket:chat-1", method: "tools/call",
      params: { name: "hello", arguments: { x: 1 } }
    }
  });
  const handled = await handleAppRuntimeControl({
    apps: { callTool, canAppMessage: vi.fn() } as any,
    msg,
    publishInbound: vi.fn()
  });
  expect(handled).toBe(true);
  expect(callTool).toHaveBeenCalledWith("demo", "hello", { x: 1 }, expect.objectContaining({ sessionKey: "websocket:chat-1" }));
  expect(ack).toHaveBeenCalledWith({ ok: true, result: expect.anything() });
});

it("rejects ui/message when the app has no message capability", async () => {
  const ack = vi.fn();
  const msg = new InboundMessage({
    channel: "system", chatId: "runtime", content: "appBridge",
    metadata: { runtimeControl: "appBridge", ack, appId: "demo", viewId: "v1", chatId: "chat-1", method: "ui/message", params: { content: [] } }
  });
  await handleAppRuntimeControl({ apps: { callTool: vi.fn(), canAppMessage: () => false } as any, msg, publishInbound: vi.fn() });
  expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd App/memmy-agent && npx vitest run tests/apps/bridge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`events.ts`: add `export const RUNTIME_CONTROL_APP_BRIDGE = "appBridge";`.

`bridge.ts`:
- Read metadata; if `runtimeControl !== RUNTIME_CONTROL_APP_BRIDGE` return false.
- Validate `appId`, `viewId`, `chatId`, `method`.
- `tools/call`: `apps.callTool(appId, params.name, params.arguments ?? {}, { sessionKey: metadata.sessionKey ?? msg.sessionKey ?? null })`.
- `resources/read`: `apps.readResource(appId, params.uri, { sessionKey: metadata.sessionKey ?? msg.sessionKey ?? null })`.
- `ui/message`: if `!apps.canAppMessage(appId)` → error; else `publishInbound(new InboundMessage({ channel: "websocket", chatId, senderId: "mcp-app", content: textFromContent(params.content), metadata: { webui: true, client_request_id: crypto.randomUUID(), source: "mcp-app", appId, viewId, appControlled: true, turn_source: { kind: "gui", channel: "websocket" } }, turnSource: { kind: "gui", channel: "websocket" } }))`.
- `ui/update-model-context`: v1 return `{ ok: true }` without storing.
- `view/result`: `apps.readViewResult(appId, viewId)`; return `{ ok: true, result }` or `{ ok: false, error }`.
- `resolveAck` with result; return true.

`loop.ts`: import `handleAppRuntimeControl`; in the runtime-control section at line ~5243, call it before/after MCP control:
```ts
if (await handleAppRuntimeControl({ apps: this.apps, msg, publishInbound: (m) => this.bus.publishInbound(m) })) continue;
```
Add `apps: AppManager | null` field and initialize in `initializeRuntimeTools`:
```ts
const { entries } = loadAppRegistry(resolveAppRoots());
this.apps = new AppManager({ entries, roots: resolveAppRoots(), registerTool: (tool) => this.tools.register(tool), unregisterTool: (name) => this.tools.unregister(name) });
await this.apps.initialize();
```
Use a single `roots` variable.

`websocket.ts`:
- In `dispatchEnvelope`, before other types:
```ts
if (type === "app_bridge") { ... }
```
- Validate `request_id` UUID, `chat_id`, `app_id`, `view_id`, method.
- Create ack (reuse `createAck` from mcp.ts or local), publish `InboundMessage({channel:"system", chatId:"runtime", senderId:"mcp-app-bridge", content:"appBridge", metadata:{ runtimeControl:"appBridge", ack, ... }})` via `this.bus.publishInbound`.
- Await ack with 30s timeout; send `{event:"app_bridge_result", request_id, ok, result/error}` to the connection.

`memmy-agent-client.ts`:
- Add `AppBridgeMethod`/`AppBridgeResult` types.
- Add `requestAppBridge` to `MemmyAgentWebSocketConnection` and implementation:
  - send `{type:"app_bridge", request_id, ...}`
  - register a pending promise keyed by request_id; `onmessage` handles `event: "app_bridge_result"` and resolves/rejects.
  - 30s timeout.

- [ ] **Step 4: Run tests**

Run: `cd App/memmy-agent && npx vitest run tests/apps/bridge.test.ts tests/integrations/channels/websocket-channel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add App/memmy-agent/src/core/runtime-messages/events.ts App/memmy-agent/src/apps/bridge.ts App/memmy-agent/src/core/agent-runtime/loop.ts App/memmy-agent/src/integrations/channels/websocket.ts App/frontend/desktop/src/api/memmy-agent-client.ts App/memmy-agent/tests/apps/bridge.test.ts App/memmy-agent/tests/integrations/channels/websocket-channel.test.ts
git commit -m "feat(apps): add app bridge runtime control"
```

---

### Task 11: `ui/open-link` and `ui/download-file`

**Files:**
- Modify: `App/shell/desktop/interface/src/index.ts`
- Modify: `App/shell/desktop/src/preload/preload.cts`
- Modify: `App/shell/desktop/src/main/main.ts`
- Modify: `App/frontend/desktop/src/global.d.ts`
- Test: `App/shell/desktop/tests/app-download.test.ts`

**Interfaces:**
- Produces:
```ts
export type DesktopAppFileSaveRequest = {
  name: string;
  mime: string;
  data: Uint8Array;
};
export type DesktopAppFileSaveResult = { canceled: boolean; path?: string };
```
- Preload API: `saveAppFile(request: DesktopAppFileSaveRequest): Promise<DesktopAppFileSaveResult>`.
- Main IPC: `memmy:saveAppFile`.

- [ ] **Step 1: Write the failing test**

Test a pure helper `decodeAppDownloadContents(contents)` in `App/shell/desktop/src/main/app-download.ts`:
```ts
import { decodeAppDownloadContents } from "../src/main/app-download.js";

it("accepts embedded resources and rejects non-data content", () => {
  const bytes = Buffer.from("pdf").toString("base64");
  expect(decodeAppDownloadContents([{ type: "resource", resource: { uri: "file://x.pdf", mimeType: "application/pdf", blob: bytes } }]))
    .toEqual([{ name: "x.pdf", mime: "application/pdf", data: expect.any(Uint8Array) }]);
  expect(() => decodeAppDownloadContents([{ type: "text", text: "no" }])).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd App/shell/desktop && npx vitest run tests/app-download.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

- `app-download.ts`: normalize `EmbeddedResource` (`resource.blob` base64, `resource.mimeType`, name from URI) and `ResourceLink` (host must fetch via MCP before calling; for v1, reject `ResourceLink` in this helper and let the agent resolve it to an embedded resource).
- `main.ts`: add `ipcMain.handle("memmy:saveAppFile", ...)`:
  - validate `name`/`mime`/`data` sizes (max 128 MiB);
  - `dialog.showSaveDialog({ defaultPath: sanitizeFileName(name) })`;
  - `writeFile(filePath, data)`.
- `preload.cts`: expose `saveAppFile` via `ipcRenderer.invoke("memmy:saveAppFile", request)`.
- `global.d.ts`: add the type.
- `AppViewBridge` `ui/download-file`: if `contents` contains `ResourceLink`, call `transport.readResource` first to resolve to an embedded resource; then `window.memmy.saveAppFile`. If `window.memmy.saveAppFile` is unavailable, fall back to `saveImage` for images or return `{ isError: true }`.

- [ ] **Step 4: Run tests**

Run: `cd App/shell/desktop && npx vitest run tests/app-download.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add App/shell/desktop/interface/src/index.ts App/shell/desktop/src/main/app-download.ts App/shell/desktop/src/main/main.ts App/shell/desktop/src/preload/preload.cts App/frontend/desktop/src/global.d.ts App/shell/desktop/tests/app-download.test.ts
git commit -m "feat(desktop): support app file downloads"
```

---

### Task 12: Build selection and registry staging

**Files:**
- Create: `cuby.apps.json`
- Create: `scripts/apps/build-apps.mjs`
- Modify: `package.json`
- Test: `tests/apps/build-apps.test.ts`

**Interfaces:**
- Produces:
  - `buildApps({ rootDir, outDir, selection, env }): Promise<{ apps: Array<{ id; version; hash }>; skipped: Array<{ id; reason }> }>`
  - CLI: `node scripts/apps/build-apps.mjs --out dist/apps`
  - npm scripts: `apps:build`, `apps:list`.

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildApps } from "../scripts/apps/build-apps.mjs";

it("stages the selected app and writes a registry", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "cuby-build-"));
  const app = path.join(root, "apps", "demo");
  mkdirSync(path.join(app, "ui", "dist"), { recursive: true });
  writeFileSync(path.join(app, "ui", "dist", "index.html"), "<html>ok</html>");
  writeFileSync(path.join(app, "app.json"), JSON.stringify({
    schemaVersion: 1, id: "demo", name: "Demo", version: "1.0.0",
    engines: { cuby: ">=0.0.1" },
    server: { transport: "stdio", command: "node", args: ["server.mjs"] },
    ui: { resources: [{ uri: "ui://demo/x", entry: "ui/dist/index.html" }] },
    capabilities: { appToolCalls: [], appMessages: false }
  }));
  const result = await buildApps({ rootDir: root, outDir: path.join(root, "dist", "apps"), selection: ["demo"] });
  expect(result.apps).toEqual([expect.objectContaining({ id: "demo", version: "1.0.0" })]);
  expect(readFileSync(path.join(root, "dist", "apps", "registry.json"), "utf8")).toContain('"demo"');
});
```

- [ ] **Step 2: Run test to verify it fails**

Before running, build the shared validator: `npm run build -w @memmy/local-api-contracts`.

Run: `npx vitest run tests/apps/build-apps.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

- `cuby.apps.json`: `{ "schemaVersion": 1, "apps": [] }`.
- `build-apps.mjs`:
  - Resolve selection: CLI `--apps` > `process.env.CUBY_APPS` > `cuby.apps.json`; `*` = all; empty = none.
  - Read `apps/*/app.json`; import `parseAppManifest` from `../App/backend/local-api-contracts/dist/index.js` (build that package first).
  - Validate platform: `server.command` map must have `process.platform-process.arch` or string; `runtime.platforms` likewise. If missing → `skipped` (or throw when `CUBY_APPS_STRICT=1`).
  - Run `manifest.build.ui.command` with `cwd = app dir` via `execFileSync`; check `manifest.build.ui.output` exists.
  - Copy `manifest.build.include` (default `["app.json","server/**","ui/**","runtime/**","assets/**"]`) to `outDir/<id>/`; exclude the four patterns.
  - Compute `sha256` over sorted file contents; write `registry.json` with `{schemaVersion:1,hostApiVersion:1,generatedAt,apps:[{id,version,path,hash,manifest}]}`.
  - Do not copy `dev` section; fail if `app.json` contains `dev` and `CUBY_ALLOW_DEV_APP=1` is not set.
- `package.json`: add `"apps/*"` to workspaces; add `"apps:build": "node scripts/apps/build-apps.mjs --out dist/apps"` and `"apps:list": "node scripts/apps/build-apps.mjs --list"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/apps/build-apps.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cuby.apps.json scripts/apps/build-apps.mjs package.json tests/apps/build-apps.test.ts
git commit -m "feat(apps): add build selection and registry staging"
```

---

### Task 13: Dev mode and fixture app

**Files:**
- Create: `apps/fixture/app.json`
- Create: `apps/fixture/server.mjs`
- Create: `apps/fixture/ui/index.html`
- Create: `apps/fixture/package.json`
- Test: `App/memmy-agent/tests/apps/fixture-app.test.ts`

**Interfaces:**
- Produces: a stdio MCP server with:
  - tool `hello` (`{ name: string }`) returning `{ content: [{type:"text",text:"Hello, <name>"}], structuredContent: { greeting } }` and `_meta.ui.resourceUri = "ui://fixture/hello"`.
  - resource `ui://fixture/hello` (`text/html;profile=mcp-app`) with a self-contained HTML app.
  - tool `echo` without UI.
  - resource `ui://fixture/extra` for multi-resource tests.

- [ ] **Step 1: Write the fixture**

`app.json`:
```json
{
  "schemaVersion": 1,
  "id": "fixture",
  "name": "Fixture",
  "version": "0.0.1",
  "engines": { "cuby": ">=0.0.1" },
  "server": { "scope": "session", "transport": "stdio", "command": "node", "args": ["server.mjs"], "cwd": "${APP_ROOT}" },
  "ui": { "resources": [{ "uri": "ui://fixture/hello", "entry": "ui/index.html" }, { "uri": "ui://fixture/extra", "entry": "ui/index.html" }], "defaultResourceUri": "ui://fixture/hello", "prefersBorder": true, "csp": {} },
  "capabilities": { "appToolCalls": ["echo"], "appMessages": "allow", "workspace": "none" }
}
```

`server.mjs`: use `@modelcontextprotocol/sdk` `Server` + `StdioServerTransport`; declare `hello` with `_meta: { ui: { resourceUri: "ui://fixture/hello" } }`; implement `resources/list`/`resources/read`; read `ui/index.html` as text; support `--probe` to exit after initialize? Not needed.

`ui/index.html`: a minimal app that:
- listens for `message`; on `{jsonrpc:"2.0", id, method:"ui/initialize"}`, responds with `{protocolVersion, appCapabilities:{}, appInfo:{name:"fixture",version:"0.0.1"}}` and then sends `ui/notifications/initialized`.
- on `ui/notifications/tool-result`, renders the greeting.
- has a button that sends `tools/call` for `echo` and renders the result.
This is enough to validate the host bridge without bundling the SDK.

- [ ] **Step 2: Write the failing test**

```ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import { connectMcpServer } from "../../src/core/agent-runtime/tools/mcp.js";

it("starts the fixture app and exposes its tool and resource", async () => {
  const connection = await connectMcpServer("fixture", {
    transport: "stdio", command: process.execPath,
    args: [path.resolve("apps/fixture/server.mjs")], cwd: path.resolve("apps/fixture")
  });
  expect(connection.tools.map((tool) => tool.name)).toContain("hello");
  expect(connection.resources.map((resource) => resource.uri)).toContain("ui://fixture/hello");
  await connection.close();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd App/memmy-agent && npx vitest run tests/apps/fixture-app.test.ts`
Expected: FAIL — fixture files not found.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd App/memmy-agent && npx vitest run tests/apps/fixture-app.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/fixture App/memmy-agent/tests/apps/fixture-app.test.ts
git commit -m "test(apps): add dev fixture app"
```

---

### Task 14: End-to-end host wiring and developer docs

**Files:**
- Modify: `App/memmy-agent/src/core/agent-runtime/loop.ts` (AppManager init)
- Modify: `App/memmy-agent/src/core/agent-runtime/loop.ts` (pass `requestContext` to app tools)
- Create: `docs/app-packages.md`
- Test: `App/memmy-agent/tests/apps/app-host.test.ts`

**Interfaces:**
- Consumes all previous tasks.
- Produces: `AppManager` initialized in `AgentLoop.initializeRuntimeTools`, app tools copied into per-turn registries via existing `copyConnectedMcpTools`.

- [ ] **Step 1: Write the failing integration test**

```ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AppManager } from "../../src/apps/manager.js";
import { loadAppRegistry } from "../../src/apps/registry.js";

it("runs the fixture app through AppManager", async () => {
  const { entries, errors } = loadAppRegistry({
    bundled: null, user: "/tmp/unused", data: "/tmp/cuby-app-data",
    dev: [path.resolve("../../apps/fixture")]
  });
  expect(errors).toEqual([]);
  const registered: any[] = [];
  const manager = new AppManager({
    entries, roots: { bundled: null, user: "/tmp/unused", data: "/tmp/cuby-app-data", dev: [] },
    registerTool: (tool) => registered.push(tool),
    unregisterTool: () => undefined
  });
  await manager.initialize();
  const view = await manager.callTool("fixture", "hello", { name: "Cuby" }, { sessionKey: "websocket:test" });
  expect(view.content[0].text).toContain("Hello");
  expect(registered.map((tool) => tool.name)).toContain("mcp_fixture_hello");
  await manager.stop();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd App/memmy-agent && npx vitest run tests/apps/app-host.test.ts`
Expected: FAIL — `AppManager` not initialized or fixture path wrong.

- [ ] **Step 3: Wire AgentLoop**

In `AgentLoop`, add a field `apps: AppManager | null = null;` and initialize it in `initializeRuntimeTools`. Guard against repeated calls (the method runs more than once):
```ts
if (!this.apps) {
  const roots = resolveAppRoots();
  const { entries, errors } = loadAppRegistry(roots);
  for (const error of errors) console.warn(`[apps] ${error.path}: ${error.message}`);
  this.apps = new AppManager({
    entries, roots,
    registerTool: (tool) => this.tools.register(tool),
    unregisterTool: (name) => this.tools.unregister(name),
    logger: console,
  });
  await this.apps.initialize();
}
```
Place after `await this.connectMcp()` so the default registry exists. Ensure `this.apps` is closed in the agent shutdown path (search for `close()`/`stop()` in `loop.ts` and add `await this.apps?.stop()`).

Pass `requestContext` into app tools: `MCPToolWrapper` already stores it via `setContext` from `setToolContext`. For session-scoped apps, AppManager creates the wrapper with a context-aware resolver:
```ts
new MCPToolWrapper(
  globalConnection?.session ?? null,
  entry.id,
  toolDef,
  timeout,
  undefined,
  undefined,
  { appId: entry.id, store },
  (ctx) => this.sessionFor(entry.id, { sessionKey: ctx?.sessionKey, workspace: ctx?.workspace }).then((runtime) => runtime.session)
);
```
For global apps pass the fixed `globalConnection.session` and omit the resolver. `MCPToolWrapper.execute` calls `resolveSession(this.requestContext.get())`.

- [ ] **Step 4: Add developer docs**

Create `docs/app-packages.md` with:
- directory layout
- minimal `app.json`
- required MCP methods
- `_meta.ui.resourceUri`
- `CUBY_DEV_APPS=apps/fixture npm run dev:desktop`
- build selection `CUBY_APPS=fixture npm run apps:build`
- security rules (iframe sandbox, allowlists, provenance)
- what is not in v1 (runtime install, skills, OS sandbox)

- [ ] **Step 5: Run all targeted tests**

Run:
```bash
cd App/memmy-agent && npx vitest run tests/apps tests/core/agent-runtime/mcp-app-view.test.ts tests/core/agent-runtime/mcp-connection.test.ts
cd ../frontend/desktop && npx vitest run src/app/tests src/state/tests/agent-tool-traces.test.ts src/pages/tests/agent-thread-messages.test.tsx
cd ../../shell/desktop && npx vitest run tests/app-download.test.ts
cd ../../.. && npx vitest run tests/apps/build-apps.test.ts
```
Expected: PASS.

- [ ] **Step 6: Manual smoke test**

Run:
```sh
CUBY_DEV_APPS=apps/fixture npm run dev:desktop
```
In a chat, ask the model to call `mcp_fixture_hello` with `{"name":"Cuby"}`. Expected:
- a Cuby-framed app view appears and stays visible after the activity collapses;
- the iframe shows "Hello, Cuby";
- the fixture app's button calls `echo` through the bridge;
- `ui/message` from the fixture appears as a user message with “来自 fixture” provenance;
- toggling light/dark changes the app colors via host context.

- [ ] **Step 7: Commit**

```bash
git add App/memmy-agent/src/core/agent-runtime/loop.ts App/memmy-agent/src/apps App/memmy-agent/tests/apps/app-host.test.ts docs/app-packages.md
git commit -m "feat(apps): wire app host into the agent runtime"
```

---

## Plan Self-Review Notes

- **Spec coverage:** Manifest, roots/registry, lifecycle, tool mapping, `_meta`, app view persistence, bridge, `ui/message`, `ui/open-link`/`ui/download-file`, host chrome/tokens, dev loading, build selection. Skills, entry points, full UI Kit, packaging/electron-builder, FinanceBuddy migration are explicitly deferred to Plan 2/3.
- **Type consistency:** `AppViewEvent` is defined in Task 5 and used in Tasks 6–9; `AppBridgeTransport` in Task 8 is implemented by Task 10; `AppManager.sessionFor` in Task 4 is consumed by Task 14.
- **Review Focus coverage:** malformed manifests (Task 1/2), failed startup isolation (Task 4), oversized results (Task 5/6), iframe allowlist (Task 8/10), concurrent session state (Task 4), folded app view (Task 9).
