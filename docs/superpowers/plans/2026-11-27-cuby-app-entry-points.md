# Cuby App 入口与整页视图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让已集成 app 出现在左侧栏，点击后在主内容区以独立整页方式显示 app UI；app 页面不创建可见聊天，AI 对话通过宿主侧边面板完成。

**Architecture:** 后端新增 `GET /api/apps` 与 `apps_open` 运行时控制：`AppManager` 执行 manifest 的 home entryPoint（或 `defaultResourceUri`）生成 view；侧栏入口使用隐藏的 `bridgeChatId` 承载 app 反向调用，不建 Session、不写 transcript。前端新增 `/apps` 路由、`AppPage`、`AppViewHost` 的 page 布局，以及一个宿主 `AppChatPanel` 抽屉；app 通过 `ui/open-chat` / `ui/message` 请求打开面板。

**Tech Stack:** TypeScript、React 19、Electron、WebSocket（memmy-agent channel）、MCP Apps（sandboxed iframe + postMessage bridge）、vitest、zod、i18n。

**Spec:** `docs/superpowers/specs/2026-11-27-cuby-app-entry-points-design.md`

## Global Constraints

- app 页面独立：侧栏 `apps_open` **不创建 Session、不写聊天 transcript、不进聊天列表、不改变当前 chat**。
- 侧栏入口使用隐藏的 `bridgeChatId`（UUID）；`sessionKey = "websocket:" + bridgeChatId`；workspace 来自前端传入的当前项目 target，缺省用 agent 默认 workspace。
- 聊天来源的整页 view 复用原 chat：`bridgeChatId = 原 chatId`；不重新执行入口工具。
- `apps_open` 的 renderer 输入只有 `app_id`、可选 `chat_id`、可选 `target`；不能传工具名、参数或 resource URI。
- `GET /api/apps` 只返回白名单字段；不得包含 `server`、`credentials`、`env`、`build`、`licenses`。
- iframe 继续使用 `srcDoc`、`sandbox="allow-scripts"`、注入 CSP；不引入 `allow-same-origin`。
- `ui/open-chat` / `ui/message` 需要 `capabilities.appMessages === "allow"`；`false` / `"ask"` 拒绝。
- v1 **不提供** app 自建的 `chat/send` / `chat/subscribe` API；app 不能读取 assistant 回复。
- app 页面默认不显示常驻 host 顶栏；只保留右上角浮动刷新。
- 所有用户文案走 i18n，`zhCNMessages` 与 `enUSMessages` 同步加 key。
- ESM 源码 import 使用 `.js` 后缀（沿用现有文件风格）。
- 每个任务结束时提交；commit message 末尾带 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。

## Review Focus

- **无 chat 打开 app**：侧栏打开 app 后，聊天列表、当前 chat、transcript 都不变；隐藏 bridgeChatId 的反向调用仍能工作。测试放在 Task 6a / Task 10。
- **隐藏 bridge 会话被回收**：空闲回收后下一次 `tools/call` 会重启 app server，且 `${SESSION_WORKSPACE}` 仍是原 workspace。测试放在 Task 6b。
- **对话面板的权限边界**：`appMessages` 为 `false` / `"ask"` 时 `ui/open-chat` 和 `ui/message` 被拒绝；app 消息带 provenance 且限流；app 读不到回复。测试放在 Task 12 / Task 13。
- **聊天来源整页**：从内嵌卡片打开整页、刷新、打开 AI 面板都复用原 chat，不重新执行入口工具、不创建新 chat。测试放在 Task 11 / Task 13 / Task 14。
- **失败恢复**：failed / missing_credentials 的 app 显示可读错误和重试；session-scope 单会话失败不把 app 全局标 failed。测试放在 Task 3 / Task 6a。

---

### Task 1: Shared app host contracts

**Files:**
- Create: `App/backend/local-api-contracts/src/app-host.ts`
- Modify: `App/backend/local-api-contracts/src/index.ts`
- Create: `App/backend/local-api-contracts/tests/app-host.test.ts`
- Modify: `App/backend/local-api-contracts/package.json`（test 脚本加入新测试文件）

**Interfaces:**
- Produces: `AppHostStateSchema`, `AppHostSummarySchema`, `AppHostListResponseSchema`, `AppHostViewSchema`, `AppOpenResultSchema`；类型 `AppHostState`、`AppHostSummary`、`AppHostListResponse`、`AppHostView`、`AppOpenResult`。
- `AppHostView` 与前端 `AgentAppView` 同形：`viewId`、`appId`、`resourceUri`、`toolCallId?`、`toolName`、`title`、`displayMode: "inline" | "fullscreen"`、`protocol: "mcp-apps/2026-01-26"`、`arguments?`、`prefersBorder?`、`csp?`、`capabilities?: { openLinks?: boolean; downloads?: boolean; appMessages?: false | "ask" | "allow" }`、`toolTimeout?`、`initialResult?`、`artifacts?`、`resultRef?`。

- [ ] **Step 1: Write the failing test**

```ts
// App/backend/local-api-contracts/tests/app-host.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @memmy/local-api-contracts`
Expected: FAIL — `Cannot find module '../src/app-host.js'`.

- [ ] **Step 3: Implement the schemas**

Create `App/backend/local-api-contracts/src/app-host.ts` with zod schemas mirroring the spec's `AppHostSummary` (including `ui`, `capabilities`, `entryPoints`, `hasUi`) and `AppHostView` (same fields as `AgentAppView`, using `z.record(z.string(), z.unknown())` for `arguments` / `initialResult.structuredContent`). Export the inferred types. Add `export * from "./app-host.js";` to `src/index.ts`. Add `tests/app-host.test.ts` to the package `test` script.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @memmy/local-api-contracts`
Expected: PASS（包括 typecheck 和新增的 3 个用例）。

- [ ] **Step 5: Commit**

```bash
git add App/backend/local-api-contracts/src/app-host.ts App/backend/local-api-contracts/src/index.ts App/backend/local-api-contracts/tests/app-host.test.ts App/backend/local-api-contracts/package.json
git commit -m "feat(contracts): add app host summary and view schemas

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: AppManager summaries

**Files:**
- Modify: `App/memmy-agent/src/apps/manager.ts`
- Test: `App/memmy-agent/tests/apps/manager.test.ts`

**Interfaces:**
- Consumes: `AppHostSummary` from `@memmy/local-api-contracts`（Task 1）。
- Produces: `AppManager.summaries(): AppHostSummary[]`。

- [ ] **Step 1: Write the failing test**

Add to `manager.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix App/memmy-agent exec vitest run tests/apps/manager.test.ts`
Expected: FAIL — `manager.summaries is not a function`.

- [ ] **Step 3: Implement `summaries()`**

从 `this.apps` 的每个 `AppRuntime` 组装 `AppHostSummary`：使用 `runtime.status` 和 `runtime.entry.manifest`；`ui.resources` 只保留 `uri`；`displayModes` 缺省 `["inline", "fullscreen"]`；`prefersBorder` 缺省 `true`；`csp` 缺省 `{}`；`capabilities.openLinks/downloads` 用 `=== true`；`entryPoints` 只保留 `surface/title/description/icon`；`hasUi = (ui?.resources.length ?? 0) > 0`。不要包含 `server`/`credentials`/`env`/`build`/`licenses`。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix App/memmy-agent exec vitest run tests/apps/manager.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add App/memmy-agent/src/apps/manager.ts App/memmy-agent/tests/apps/manager.test.ts
git commit -m "feat(apps): summarize app UI metadata for the sidebar

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: AppManager openEntryPoint, retryApp, fixture entry point

**Files:**
- Modify: `App/memmy-agent/src/apps/manager.ts`
- Modify: `App/memmy-agent/src/apps/view.ts`（`AppViewCapabilities` 增加 `appMessages`）
- Modify: `App/frontend/desktop/src/state/agent-tool-traces.ts`（`AgentAppView.capabilities` 增加 `appMessages`）
- Modify: `apps/fixture/app.json`
- Test: `App/memmy-agent/tests/apps/manager.test.ts`

**Interfaces:**
- Produces:
  - `AppManager.openEntryPoint(appId: string, context: AppSessionContext, options?: { entryPointIndex?: number }): Promise<AppViewEvent>`
  - `AppManager.retryApp(appId: string): Promise<void>`
  - `AppViewEvent.capabilities` 增加 `appMessages?: false | "ask" | "allow"`（后端 `src/apps/view.ts` 的 `AppViewCapabilities`）；前端 `AgentAppView.capabilities` 同步（Task 8 使用）。
- Consumes: `AppViewStore.create`（已有）、`readUiResourceUri`（已有）、`connection.tools`。

- [ ] **Step 1: Write the failing tests**

```ts
it("opens the home entry point tool and returns an app view", async () => {
  const manager = new AppManager({
    entries: [entry("demo", {
      ui: { resources: [{ uri: "ui://demo/home", entry: "ui/index.html" }], defaultResourceUri: "ui://demo/home" },
      entryPoints: [{ surface: "home", title: "Demo", action: { kind: "tool", tool: "hello", arguments: { name: "Cuby" } } }],
    })],
    roots: { bundled: null, user: "/tmp/user", data: mkdtempSync(path.join(tmpdir(), "cuby-data-")), dev: [] },
    registerTool: vi.fn(),
    unregisterTool: vi.fn(),
    connect: vi.fn(async (name: string) => ({
      name,
      session: { callTool: vi.fn(async () => ({ content: [{ type: "text", text: "Hello, Cuby" }] })) },
      tools: [{ name: "hello", description: "Say hello", inputSchema: { type: "object" }, _meta: { ui: { resourceUri: "ui://demo/home" } } }],
      resources: [], prompts: [], close: vi.fn(),
    })),
  });
  await manager.initialize();

  const view = await manager.openEntryPoint("demo", { sessionKey: "websocket:app-1", workspace: null });
  expect(view.appId).toBe("demo");
  expect(view.resourceUri).toBe("ui://demo/home");
  expect(view.toolName).toBe("hello");
  expect(view.capabilities?.appMessages).toBe("allow");
  expect(view.initialResult.content[0]).toMatchObject({ type: "text", text: "Hello, Cuby" });
});

it("falls back to defaultResourceUri when the app has no entry point", async () => {
  const manager = new AppManager({
    entries: [entry("demo", {
      ui: { resources: [{ uri: "ui://demo/home", entry: "ui/index.html" }], defaultResourceUri: "ui://demo/home" },
    })],
    roots: { bundled: null, user: "/tmp/user", data: mkdtempSync(path.join(tmpdir(), "cuby-data-")), dev: [] },
    registerTool: vi.fn(),
    unregisterTool: vi.fn(),
    connect: vi.fn(async (name: string) => ({
      name, session: { callTool: vi.fn() }, tools: [], resources: [], prompts: [], close: vi.fn()
    })),
  });
  await manager.initialize();

  const view = await manager.openEntryPoint("demo", { sessionKey: "websocket:app-1" });
  expect(view.resourceUri).toBe("ui://demo/home");
  expect(view.toolName).toBe("app_home");
  expect(view.initialResult.content).toEqual([]);
});

it("fails with a readable error when the app has no UI", async () => {
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
  await expect(manager.openEntryPoint("plain", { sessionKey: "websocket:app-1" }))
    .rejects.toThrow("has no ui");
});

it("retries a failed global app", async () => {
  let attempts = 0;
  const connect = vi.fn(async (name: string) => {
    attempts += 1;
    if (attempts === 1) throw new Error("boom");
    return { name, session: { callTool: vi.fn() }, tools: [], resources: [], prompts: [], close: vi.fn() };
  });
  const manager = new AppManager({
    entries: [entry("demo")],
    roots: { bundled: null, user: "/tmp/user", data: mkdtempSync(path.join(tmpdir(), "cuby-data-")), dev: [] },
    registerTool: vi.fn(),
    unregisterTool: vi.fn(),
    connect,
  });
  await manager.initialize();
  expect(manager.getStatus("demo")?.state).toBe("failed");
  await manager.retryApp("demo");
  expect(manager.getStatus("demo")?.state).toBe("ready");
});
```

Add a home entry point to `apps/fixture/app.json` for manual verification:

```json
"entryPoints": [
  { "surface": "home", "title": "Fixture", "action": { "kind": "tool", "tool": "hello", "arguments": { "name": "Cuby" } } }
]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix App/memmy-agent exec vitest run tests/apps/manager.test.ts`
Expected: FAIL — `openEntryPoint` / `retryApp` not defined.

- [ ] **Step 3: Implement `openEntryPoint` and `retryApp`**

按 spec §6.5 实现。要点：`openEntryPoint` 先处理 `disabled` / `missing_credentials` / global `failed`；`sessionFor` 获取连接；第一个 `surface:"home"` entry point；工具名只在 `connection.tools` 中找，参数只来自 manifest；`readUiResourceUri` 优先，缺省 `defaultResourceUri`；`result.isError` 抛错；`view = runtime.store.create(...)`，不写 `hostSurface`。
`registerConnectionTools` 传给 `AppViewStore` 的 `capabilities` 增加 `appMessages: manifest.capabilities.appMessages`；`openEntryPoint` 的 view 也带上它（Task 12 的 `ui/open-chat` gate 依赖这个字段）。同步 `view.ts` 的 `AppViewCapabilities` 和前端 `agent-tool-traces.ts` 的 `AgentAppView.capabilities` 类型。
`retryApp`：仅对 `scope:"global"` 且状态 `failed` 的 app 重连；受 `failures` / `nextRetryAt` 约束；成功后重新注册工具、状态 `ready`；失败则记录错误并抛出。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix App/memmy-agent exec vitest run tests/apps/manager.test.ts`
Expected: PASS（新增 4 个用例 + 原有 manager 用例）。

- [ ] **Step 5: Commit**

```bash
git add App/memmy-agent/src/apps/manager.ts App/memmy-agent/tests/apps/manager.test.ts apps/fixture/app.json
git commit -m "feat(apps): open manifest entry points without a model turn

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: App host runtime control

**Files:**
- Create: `App/memmy-agent/src/apps/host-control.ts`
- Modify: `App/memmy-agent/src/core/runtime-messages/events.ts`
- Modify: `App/memmy-agent/src/core/agent-runtime/loop.ts`
- Test: `App/memmy-agent/tests/apps/host-control.test.ts`

**Interfaces:**
- Produces:
  - `RUNTIME_CONTROL_APPS = "apps"`
  - `handleAppHostRuntimeControl(input: { apps: AppManager | null; msg: InboundMessage }): Promise<boolean>`
  - ack 结果：list → `{ ok: true, result: { apps: AppHostSummary[] } }`；open → `{ ok: true, result: { view: AppViewEvent } }`；失败 `{ ok: false, error: string }`。
- Consumes: Task 2/3 的 `summaries()` / `openEntryPoint()`。

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import { handleAppHostRuntimeControl } from "../../src/apps/host-control.js";
import { InboundMessage } from "../../src/core/runtime-messages/events.js";

it("lists app summaries through an ack", async () => {
  const ack = vi.fn();
  const apps = { summaries: vi.fn(() => [{ id: "demo" }]), openEntryPoint: vi.fn() } as any;
  const msg = new InboundMessage({
    channel: "system", chatId: "runtime", content: "apps",
    metadata: { runtimeControl: "apps", action: "list", ack },
  });
  expect(await handleAppHostRuntimeControl({ apps, msg })).toBe(true);
  expect(ack).toHaveBeenCalledWith({ ok: true, result: { apps: [{ id: "demo" }] } });
});

it("opens an entry point through an ack", async () => {
  const ack = vi.fn();
  const view = { viewId: "v1" };
  const openEntryPoint = vi.fn(async () => view);
  const msg = new InboundMessage({
    channel: "system", chatId: "runtime", content: "apps",
    metadata: {
      runtimeControl: "apps", action: "open", ack,
      appId: "demo", sessionKey: "websocket:app-1", workspace: "/tmp/ws",
    },
  });
  await handleAppHostRuntimeControl({ apps: { summaries: vi.fn(), openEntryPoint } as any, msg });
  expect(openEntryPoint).toHaveBeenCalledWith("demo", { sessionKey: "websocket:app-1", workspace: "/tmp/ws" });
  expect(ack).toHaveBeenCalledWith({ ok: true, result: { view } });
});

it("fails closed for unknown actions and missing apps", async () => {
  const ack = vi.fn();
  const msg = new InboundMessage({
    channel: "system", chatId: "runtime", content: "apps",
    metadata: { runtimeControl: "apps", action: "nope", ack },
  });
  await handleAppHostRuntimeControl({ apps: null, msg });
  expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix App/memmy-agent exec vitest run tests/apps/host-control.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the control and wire it into the loop**

`handleAppHostRuntimeControl` 检查 `metadata[INBOUND_META_RUNTIME_CONTROL] === RUNTIME_CONTROL_APPS`，读取 `action`、`ack`、`appId`、`sessionKey`、`workspace`；`list` 返回 `summaries()`；`open` 返回 `openEntryPoint(appId, { sessionKey, workspace })`；错误通过 ack 返回。未知 action / 无 apps 返回 `{ ok:false, error }`。
在 `AgentLoop.run()` 中，`handleAppRuntimeControl(...)` 之后加入 `if (await handleAppHostRuntimeControl({ apps: this.apps, msg })) continue;`。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix App/memmy-agent exec vitest run tests/apps/host-control.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add App/memmy-agent/src/apps/host-control.ts App/memmy-agent/src/core/runtime-messages/events.ts App/memmy-agent/src/core/agent-runtime/loop.ts App/memmy-agent/tests/apps/host-control.test.ts
git commit -m "feat(apps): handle apps list and open runtime controls

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: GET /api/apps

**Files:**
- Modify: `App/memmy-agent/src/integrations/channels/websocket.ts`
- Test: `App/memmy-agent/tests/integrations/channels/websocket-channel.test.ts`

**Interfaces:**
- Produces: `GET /api/apps` → `{ apps: AppHostSummary[] }`；`handleAppsList(request): Promise<HttpLikeResponse>`。
- Consumes: Task 4 的 runtime control。

- [ ] **Step 1: Write the failing test**

```ts
it("lists apps over GET /api/apps", async () => {
  const bus = new MessageBus();
  const channel = new WebSocketChannel({}, bus);
  channel.apiTokens.set("api-token", Number.POSITIVE_INFINITY);
  const captured: any[] = [];
  vi.spyOn(bus, "publishInbound").mockImplementation(async (msg: any) => { captured.push(msg); });

  const pending = channel.dispatchHttp({}, {
    path: "/api/apps",
    headers: { authorization: "Bearer api-token" },
  });
  await vi.waitFor(() => expect(captured).toHaveLength(1));
  captured[0].metadata.ack.resolve({ ok: true, result: { apps: [{ id: "demo" }] } });
  const response = await pending;
  expect(response?.status).toBe(200);
  expect(JSON.parse(String(response?.body))).toEqual({ apps: [{ id: "demo" }] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix App/memmy-agent exec vitest run tests/integrations/channels/websocket-channel.test.ts -t "lists apps"`
Expected: FAIL — 404 / handler missing.

- [ ] **Step 3: Implement the handler and route**

在 `dispatchHttp` 加 `if (got === "/api/apps") return this.handleAppsList(request);`。`handleAppsList` 校验 token，创建 ack（复用 `createAppBridgeAck`，如需要改名为 `createRuntimeAck`），publish 一条 `runtimeControl: "apps", action: "list"` 的 inbound，等待 ack（超时 5s），返回 JSON；失败 503。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix App/memmy-agent exec vitest run tests/integrations/channels/websocket-channel.test.ts -t "lists apps"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add App/memmy-agent/src/integrations/channels/websocket.ts App/memmy-agent/tests/integrations/channels/websocket-channel.test.ts
git commit -m "feat(gateway): expose GET /api/apps

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6a: apps_open envelope and hidden bridge session

**Files:**
- Modify: `App/memmy-agent/src/integrations/channels/websocket.ts`
- Test: `App/memmy-agent/tests/integrations/channels/websocket-channel.test.ts`

**Interfaces:**
- Produces: WS envelope `apps_open`；event `apps_open_result` 带 `{ request_id, ok, bridge_chat_id?, view?, error?, reason? }`；连接级 `appBridgeChats` 记录。
- Consumes: Task 4 的 runtime control。

- [ ] **Step 1: Write the failing tests**

```ts
it("opens an app with a hidden bridge chat and writes no transcript", async () => {
  const bus = new MessageBus();
  const channel = new WebSocketChannel({}, bus);
  const ws = connection();
  const captured: any[] = [];
  vi.spyOn(bus, "publishInbound").mockImplementation(async (msg: any) => { captured.push(msg); });

  const pending = channel.dispatchEnvelope(ws, "client-1", {
    type: "apps_open",
    request_id: "22222222-2222-4222-8222-222222222222",
    app_id: "demo",
  });
  await vi.waitFor(() => expect(captured).toHaveLength(1));
  const bridgeChatId = captured[0].metadata.sessionKey.replace("websocket:", "");
  captured[0].metadata.ack.resolve({ ok: true, result: { view: { viewId: "v1" } } });
  await pending;

  const result = sent(ws);
  expect(result).toMatchObject({ event: "apps_open_result", ok: true, bridge_chat_id: bridgeChatId, view: { viewId: "v1" } });
  expect(((channel as any).connectionChats.get(ws) as Set<string>).has(bridgeChatId)).toBe(true);
  expect(fs.existsSync(webuiTranscriptPath(`websocket:${bridgeChatId}`))).toBe(false);
});

it("reuses a native chat id and never reuses an external chat id for the bridge", async () => {
  const bus = new MessageBus();
  const channel = new WebSocketChannel({}, bus);
  const ws = connection();
  const captured: any[] = [];
  vi.spyOn(bus, "publishInbound").mockImplementation(async (msg: any) => { captured.push(msg); });

  const nativeChatId = "11111111-1111-4111-8111-111111111111";
  const pending = channel.dispatchEnvelope(ws, "client-1", {
    type: "apps_open",
    request_id: "33333333-3333-4333-8333-333333333333",
    app_id: "demo",
    chat_id: nativeChatId,
  });
  await vi.waitFor(() => expect(captured).toHaveLength(1));
  captured[0].metadata.ack.resolve({ ok: true, result: { view: { viewId: "v1" } } });
  await pending;
  expect(sent(ws)).toMatchObject({ ok: true, bridge_chat_id: nativeChatId });

  const externalChatId = "ext_external_chat";
  const pendingExternal = channel.dispatchEnvelope(ws, "client-1", {
    type: "apps_open",
    request_id: "44444444-4444-4444-8444-444444444444",
    app_id: "demo",
    chat_id: externalChatId,
  });
  await vi.waitFor(() => expect(captured).toHaveLength(2));
  captured[1].metadata.ack.resolve({ ok: true, result: { view: { viewId: "v2" } } });
  await pendingExternal;
  const externalResult = JSON.parse(ws.send.mock.calls.at(-1)![0]);
  expect(externalResult).toMatchObject({ ok: true });
  expect(externalResult.bridge_chat_id).not.toBe(externalChatId);
});
```

测试用 `(channel as any).connectionChats.get(ws)` 断言 attach；不要把内部 map 变成 public API。

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix App/memmy-agent exec vitest run tests/integrations/channels/websocket-channel.test.ts -t "apps_open"`
Expected: FAIL — envelope 未处理。

- [ ] **Step 3: Implement `apps_open`**

在 `dispatchEnvelope` 中 `app_bridge` 分支之后加入 `apps_open`：校验 `request_id`（UUID）、`app_id`；读取可选 `chat_id` / `target`（`target` 复用 `WebuiSessionTarget`：`{kind:"standalone"}` 或 `{kind:"project", projectId}`）；native `chat_id` → `attachConnection` 并复用；外部或无 `chat_id` → `crypto.randomUUID()` 并 attach；`sessionKey = "websocket:" + bridgeChatId`；workspace：`target.kind === "project"` → 通过 project store 解析 `projectId` 的 cwd；否则用 `assertWebuiWorkspaceAvailable(this.workspacePath)`；publish `runtimeControl:"apps", action:"open"`（带 appId/sessionKey/workspace/ack），等待 ack；成功发 `apps_open_result`，**不调用 `tryAppendWebuiTranscript`、不创建 Session**。失败返回 reason `app_not_found` / `app_not_ready` / `no_ui` / `entry_failed` / `timeout` / `invalid_request`。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix App/memmy-agent exec vitest run tests/integrations/channels/websocket-channel.test.ts -t "apps_open"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add App/memmy-agent/src/integrations/channels/websocket.ts App/memmy-agent/tests/integrations/channels/websocket-channel.test.ts
git commit -m "feat(gateway): open app pages on a hidden bridge chat

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6b: bridge workspace memory

**Files:**
- Modify: `App/memmy-agent/src/integrations/channels/websocket.ts`
- Test: `App/memmy-agent/tests/integrations/channels/websocket-channel.test.ts`

**Interfaces:**
- Produces: connection-scoped `bridgeChatId -> workspace` map；`app_bridge` 解析 workspace 时优先使用它；连接关闭时清理。
- Consumes: Task 6a 的 `bridgeChatId`。

- [ ] **Step 1: Write the failing test**

```ts
it("keeps the app page workspace for reverse calls", async () => {
  const workspace = tempDataDir();
  const bus = new MessageBus();
  const channel = new WebSocketChannel({}, bus, {
    sessionManager: new SessionManager(path.join(workspace, "sessions")),
    workspacePath: workspace,
  });
  const ws = connection();
  const captured: any[] = [];
  vi.spyOn(bus, "publishInbound").mockImplementation(async (msg: any) => { captured.push(msg); });

  const openPending = channel.dispatchEnvelope(ws, "client-1", {
    type: "apps_open",
    request_id: "55555555-5555-4555-8555-555555555555",
    app_id: "demo",
    target: { kind: "standalone" },
  });
  await vi.waitFor(() => expect(captured).toHaveLength(1));
  const bridgeChatId = captured[0].metadata.sessionKey.replace("websocket:", "");
  captured[0].metadata.ack.resolve({ ok: true, result: { view: { viewId: "v1" } } });
  await openPending;

  const callPending = channel.dispatchEnvelope(ws, "client-1", {
    type: "app_bridge",
    request_id: "66666666-6666-4666-8666-666666666666",
    chat_id: bridgeChatId,
    app_id: "demo",
    view_id: "v1",
    method: "tools/call",
    params: { name: "hello", arguments: {} },
  });
  await vi.waitFor(() => expect(captured).toHaveLength(2));
  expect(captured[1].metadata.workspace).toBe(workspace);
  captured[1].metadata.ack.resolve({ ok: true, result: {} });
  await callPending;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix App/memmy-agent exec vitest run tests/integrations/channels/websocket-channel.test.ts -t "keeps the app page workspace"`
Expected: FAIL — `app_bridge` 从 session binding 读 workspace，隐藏会话没有 binding。

- [ ] **Step 3: Implement the map**

在 channel 加 `private readonly appBridgeWorkspaces = new WeakMap<any, Map<string, string | null>>();`。`apps_open` 成功后记录 `bridgeChatId -> workspace`；`app_bridge` 分支在计算 workspace 时先查该 map；连接关闭/销毁时清理。不要改变真实 chat 的 workspace 解析优先级：真实 session binding 优先，隐藏 bridge 用 map。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix App/memmy-agent exec vitest run tests/integrations/channels/websocket-channel.test.ts -t "keeps the app page workspace"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add App/memmy-agent/src/integrations/channels/websocket.ts App/memmy-agent/tests/integrations/channels/websocket-channel.test.ts
git commit -m "fix(gateway): retain app page workspace for app bridge calls

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: Frontend agent client

**Files:**
- Modify: `App/frontend/desktop/src/api/memmy-agent-client.ts`
- Test: `App/frontend/desktop/src/api/tests/memmy-agent-client.test.ts`

**Interfaces:**
- Produces:
  - `listApps(): Promise<AppHostSummary[]>`
  - `openApp(input: { appId: string; chatId?: string; target?: WebuiSessionTarget }): Promise<AppOpenResult>`
  - 复用已存在的 `WebuiSessionTarget`（`{kind:"standalone"} | {kind:"project", projectId}`），不新增 target 类型。
- Consumes: Task 1 的 schemas；Task 6 的 `apps_open_result`。

- [ ] **Step 1: Write the failing tests**

```ts
it("lists apps over HTTP", async () => {
  // 用现有 fetch mock 返回 { apps: [summary] }
  await expect(connection.listApps()).resolves.toEqual([summary]);
});

it("openApp sends apps_open and resolves the returned view", async () => {
  const pending = connection.openApp({ appId: "demo" });
  const frame = JSON.parse(sockets[0]!.sent.at(-1)!);
  expect(frame).toMatchObject({ type: "apps_open", app_id: "demo" });
  sockets[0]!.onmessage({ data: JSON.stringify({
    event: "apps_open_result",
    request_id: frame.request_id,
    ok: true,
    bridge_chat_id: "app-1",
    view: { viewId: "v1" },
  }) });
  await expect(pending).resolves.toEqual({ bridge_chat_id: "app-1", view: { viewId: "v1" } });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w @memmy/frontend-desktop -- src/api/tests/memmy-agent-client.test.ts`
Expected: FAIL — `listApps` / `openApp` 不存在。

- [ ] **Step 3: Implement the client methods**

`listApps` 用现有 `request("/api/apps", AppHostListResponseSchema)` 并返回 `.apps`。`openApp` 仿照 `newChat`：维护 `pendingAppOpens: Map<requestId, {resolve,reject,timer}>`；发送 `{ type:"apps_open", request_id, app_id, chat_id?, target? }`；在 WS 事件处理中识别 `apps_open_result`，`ok` 时 resolve `{ view, bridge_chat_id }`，否则 reject 可读错误；超时清理 pending。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w @memmy/frontend-desktop -- src/api/tests/memmy-agent-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add App/frontend/desktop/src/api/memmy-agent-client.ts App/frontend/desktop/src/api/tests/memmy-agent-client.test.ts
git commit -m "feat(desktop): add app list and open client methods

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: Apps state and navigation app page

**Files:**
- Create: `App/frontend/desktop/src/state/apps-slice.ts`
- Modify: `App/frontend/desktop/src/state/app-reducer.ts`
- Modify: `App/frontend/desktop/src/state/app-actions.ts`
- Test: `App/frontend/desktop/src/state/tests/apps-slice.test.ts`（新建）或 `app-reducer.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type AppsStatus = "idle" | "loading" | "ready" | "error";
  export interface AppsState { status: AppsStatus; items: AppHostSummary[]; error: string | null; }
  export const initialAppsState: AppsState;
  export type AppPageTarget = { appId: string; bridgeChatId: string; origin: "entry" | "chat"; chatId?: string; view: AgentAppView; };
  ```
  `AppState.apps: AppsState`；`NavigationState.appPage: AppPageTarget | null`；actions `apps/loadStarted`、`apps/loadSucceeded`、`apps/loadFailed`、`navigation/appPageOpened`、`navigation/appPageCleared`。
  `appsActions.loadApps(client: Pick<MemmyAgentClient, "listApps">, dispatch): Promise<void>`；`appsActions.openApp(client: Pick<MemmyAgentClient, "openApp">, dispatch, input: { appId: string; target?: WebuiSessionTarget }): Promise<AppPageTarget | null>`（成功时 dispatch `navigation/appPageOpened`）。
- Consumes: Task 1 的 `AppHostSummary`；Task 7 的 `listApps` / `openApp`。

- [ ] **Step 1: Write the failing tests**

```ts
it("stores loaded apps and clears the error", () => {
  let state = createInitialAppState();
  state = appReducer(state, appActions.loadAppsStarted());
  expect(state.apps.status).toBe("loading");
  state = appReducer(state, appActions.loadAppsSucceeded([summary]));
  expect(state.apps).toMatchObject({ status: "ready", items: [summary], error: null });
});

it("opens and clears an app page target", () => {
  let state = createInitialAppState();
  const chatIdBefore = state.agent.currentChatId;
  const target = { appId: "demo", bridgeChatId: "app-1", origin: "entry" as const, view: { viewId: "v1" } as any };
  state = appReducer(state, appActions.openAppPage(target));
  expect(state.navigation.appPage).toEqual(target);
  expect(state.navigation.currentPath).toBe("/apps");
  expect(state.agent.currentChatId).toBe(chatIdBefore); // app page 不切换/创建 chat
  state = appReducer(state, appActions.clearAppPage());
  expect(state.navigation.appPage).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w @memmy/frontend-desktop -- src/state/tests/apps-slice.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the slice, actions, reducer wiring**

`appsReducer` 只处理 3 个 apps action；`appReducer` 在 default 前加 `case "apps/...": return { ...state, apps: appsReducer(state.apps, action) }`。`navigation/appPageOpened` 设置 `navigation.appPage`、`currentPath: "/apps"`、`history` 追加 `/apps`；`navigation/appPageCleared` 置空。`appActions` 加对应 creator。异步加载/打开 helper 放在 `app-actions.ts` 的 `appsActions`（仿照 `toolsActions`）：`loadApps(client, dispatch)`、`openApp(client, dispatch, input, target?)`；`openApp` 把服务的 `bridge_chat_id` 映射成 `AppPageTarget.bridgeChatId`，`view` 原样保留。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w @memmy/frontend-desktop -- src/state/tests/apps-slice.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add App/frontend/desktop/src/state/apps-slice.ts App/frontend/desktop/src/state/app-reducer.ts App/frontend/desktop/src/state/app-actions.ts App/frontend/desktop/src/state/tests/apps-slice.test.ts
git commit -m "feat(desktop): add apps state and app page navigation

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: Sidebar Apps section

**Files:**
- Create: `App/frontend/desktop/src/pages/apps-sidebar-section.tsx`
- Modify: `App/frontend/desktop/src/pages/app-frame.tsx`
- Modify: `App/frontend/desktop/src/i18n/messages.ts`
- Test: `App/frontend/desktop/src/pages/tests/apps-sidebar-section.test.tsx`

**Interfaces:**
- Produces:
  ```tsx
  export interface AppsSidebarSectionProps {
    apps: AppHostSummary[];
    activeAppId: string | null;
    loading?: boolean;
    error?: string | null;
    onOpen: (appId: string) => void;
    onRetry: () => void;
  }
  export function AppsSidebarSection(props: AppsSidebarSectionProps)
  ```
- Consumes: Task 8 的 state/actions。

- [ ] **Step 1: Write the failing test**

```tsx
// 在测试文件里定义与 Task 1 相同的 summary fixture
it("renders app entries, disabled states, and calls onOpen", () => {
  const html = renderToString(
    <I18nProvider>
      <AppsSidebarSection
        apps={[
          { ...summary, id: "demo", name: "Demo", state: "ready" },
          { ...summary, id: "bad", name: "Bad", state: "failed", error: "boom" },
        ]}
        activeAppId="demo"
        onOpen={() => undefined}
        onRetry={() => undefined}
      />
    </I18nProvider>
  );
  expect(html).toContain("Demo");
  expect(html).toContain("Bad");
  expect(html).toContain("boom"); // title / aria-description
});
```

（再补一个 DOM 交互测试：点击 Demo 调用 `onOpen("demo")`。）

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @memmy/frontend-desktop -- src/pages/tests/apps-sidebar-section.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the section and wire it into AppFrame**

组件渲染 `Apps` 分区标题 + 列表；`hasUi` 由调用方过滤（或组件内过滤）；`ready/starting` 可点，`failed/missing_credentials` 置灰但仍可点，`disabled` 不可点；状态点/错误 tooltip；`activeAppId` 高亮。AppFrame 在启动后 `useEffect` 调 `appsActions.loadApps(clients.memmyAgent, dispatch)`，把 `state.apps` 传入；`onOpen` 调 `appsActions.openApp(...)`，`target` 从当前项目选择状态构造（`{kind:"project", projectId}`，无项目则 `{kind:"standalone"}`），成功后 `appActions.openAppPage(target)`（该 action 会导航到 `/apps`）。加 i18n key `appFrame.apps.title`、`appFrame.apps.loadFailed`、`appFrame.apps.retry`。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @memmy/frontend-desktop -- src/pages/tests/apps-sidebar-section.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add App/frontend/desktop/src/pages/apps-sidebar-section.tsx App/frontend/desktop/src/pages/app-frame.tsx App/frontend/desktop/src/i18n/messages.ts App/frontend/desktop/src/pages/tests/apps-sidebar-section.test.tsx
git commit -m "feat(desktop): list installed apps in the sidebar

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 10: /apps route, AppPage, AppViewHost page layout

**Files:**
- Modify: `App/frontend/desktop/src/app/routes.ts`
- Modify: `App/frontend/desktop/src/app/router.tsx`
- Modify: `App/frontend/desktop/src/app/app-view-host.tsx`
- Modify: `App/frontend/desktop/src/app/app-view-frame.tsx`
- Create: `App/frontend/desktop/src/pages/app-page.tsx`
- Modify: `App/frontend/desktop/src/i18n/messages.ts`（`app.page.reload`、`app.page.empty`）
- Test: `App/frontend/desktop/src/pages/tests/app-page.test.tsx`、`App/frontend/desktop/src/app/tests/app-view-host-page.test.tsx`

**Interfaces:**
- Produces:
  - `AppRoutePath` 增加 `"/apps"`；`routeTable["/apps"]`。
  - `AppPage()` 组件；同文件导出纯展示组件 `AppPageView({ target, onReload }: { target: AppPageTarget | null; onReload: () => void })`，用于测试。
  - `AppViewHost` props 增加 `layout?: "inline" | "page"`。
  - `AppViewFrame` props 增加 `variant?: "inline" | "page"`。
- Consumes: Task 8 的 `navigation.appPage`；Task 7 的 bridge client。

- [ ] **Step 1: Write the failing tests**

```tsx
const fakeClient = {
  callTool: vi.fn(), readResource: vi.fn(), sendMessage: vi.fn(), readViewResult: vi.fn(),
};
// view / target 用与 Task 1 相同的 fixture（view 补 capabilities 可选）

it("renders the app page for an entry target without a chat page", () => {
  const html = renderToString(
    <I18nProvider>
      <AppPageView target={{ ...target, origin: "entry" }} onReload={() => undefined} />
    </I18nProvider>
  );
  expect(html).toContain("cuby-app-page");
  expect(html).not.toContain("app-frame-task-list");
});

it("page layout fills the container and keeps the sandbox", () => {
  const html = renderToString(
    <I18nProvider>
      <AppViewHost view={view} chatId="chat-1" client={fakeClient} layout="page" />
    </I18nProvider>
  );
  expect(html).toContain("cuby-app-view-host--page");
  expect(html).not.toContain("cuby-app-view-frame__header");
});
```

（`AppPageView` 是 `AppPage` 的纯展示部分，导出以便测试；`AppViewHost` 的 iframe 在 loading 时还不存在，至少断言 wrapper class。）

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w @memmy/frontend-desktop -- src/pages/tests/app-page.test.tsx src/app/tests/app-view-host-page.test.tsx`
Expected: FAIL — route/组件缺失。

- [ ] **Step 3: Implement**

- routes.ts/router.tsx：加 `/apps`、`renderRoute` case、`isRestorableRoute`。
- AppViewHost：加 `layout`，page 模式 wrapper class `cuby-app-view-host--page`，不渲染 AppViewFrame header，iframe `height:100%`；host context 用 `displayMode:"fullscreen"`。
- AppViewFrame：加 `variant`，page 模式去掉卡片边框/背景/header；inline 保持现有行为。
- AppPage：从 `state.navigation.appPage` 取 target，创建 `createAppBridgeTransport(clients.memmyAgent, target.bridgeChatId)`，渲染 `AppViewHost layout="page"`；无 target 时渲染空态；默认不渲染常驻 host 顶栏，右上角浮动刷新按钮；加载/错误态占满整页。`origin==="chat"` 的刷新 remount 当前 view，`entry` 的刷新重新调 `openApp`（Task 14 完成恢复；此处先提供按钮）。展示逻辑拆到 `AppPageView`，让单元测试不依赖 effects。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w @memmy/frontend-desktop -- src/pages/tests/app-page.test.tsx src/app/tests/app-view-host-page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add App/frontend/desktop/src/app/routes.ts App/frontend/desktop/src/app/router.tsx App/frontend/desktop/src/app/app-view-host.tsx App/frontend/desktop/src/app/app-view-frame.tsx App/frontend/desktop/src/pages/app-page.tsx App/frontend/desktop/src/pages/tests/app-page.test.tsx App/frontend/desktop/src/app/tests/app-view-host-page.test.tsx
git commit -m "feat(desktop): render apps as standalone full pages

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 11: Inline card → full page

**Files:**
- Modify: `App/frontend/desktop/src/app/app-view-frame.tsx`
- Modify: `App/frontend/desktop/src/app/app-view-host.tsx`
- Modify: `App/frontend/desktop/src/pages/agent-thread-messages.tsx`
- Modify: `App/frontend/desktop/src/i18n/messages.ts`（`app.view.openPage`）
- Test: `App/frontend/desktop/src/app/tests/app-view-frame.test.tsx`（新建）或现有测试

**Interfaces:**
- Produces: `AppViewFrameProps.onOpenPage?: () => void`；`AppViewHostProps.onOpenPage?: () => void`；导出纯函数 `buildChatAppPageTarget(view: AgentAppView, chatId: string): AppPageTarget`（`origin:"chat"`，`bridgeChatId=chatId`）；`AppViewList` 用它并 dispatch `appActions.openAppPage(target)`。
- Consumes: Task 8 的 action、Task 10 的 page。

- [ ] **Step 1: Write the failing tests**

```tsx
it("shows an open-page action only when a handler is provided", () => {
  const label = zhCNMessages["app.view.openPage"];
  const withHandler = renderToString(
    <I18nProvider>
      <AppViewFrame view={view} state="ready" expanded={false} onOpenPage={() => undefined}><div /></AppViewFrame>
    </I18nProvider>
  );
  expect(withHandler).toContain(`aria-label="${label}"`);
  const without = renderToString(
    <I18nProvider>
      <AppViewFrame view={view} state="ready" expanded={false}><div /></AppViewFrame>
    </I18nProvider>
  );
  expect(without).not.toContain(`aria-label="${label}"`);
});

it("builds a chat-origin target with the original view and chat id", () => {
  expect(buildChatAppPageTarget(view, "chat-1")).toEqual({
    appId: view.appId,
    bridgeChatId: "chat-1",
    origin: "chat",
    chatId: "chat-1",
    view,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @memmy/frontend-desktop -- src/app/tests/app-view-frame.test.tsx`
Expected: FAIL — prop/按钮不存在。

- [ ] **Step 3: Implement**

AppViewFrame header 增加按钮（`ExternalLink` 图标，i18n `app.view.openPage`）；AppViewHost 透传 `onOpenPage`；AppViewList 的 `AppViewHost` 传 `onOpenPage={() => dispatch(appActions.openAppPage({ appId: view.appId, bridgeChatId: chatId, origin: "chat", chatId, view }))}`。AppViewList 需要 `useAppState` 的 dispatch（或从父组件传入回调）。不重新执行入口工具。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @memmy/frontend-desktop -- src/app/tests/app-view-frame.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add App/frontend/desktop/src/app/app-view-frame.tsx App/frontend/desktop/src/app/app-view-host.tsx App/frontend/desktop/src/pages/agent-thread-messages.tsx App/frontend/desktop/src/app/tests/app-view-frame.test.tsx
git commit -m "feat(desktop): open chat app views on the full app page

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 12: Host chat bridge (`ui/open-chat`, page-mode `ui/message`)

**Files:**
- Modify: `App/frontend/desktop/src/app/app-view-bridge.ts`
- Modify: `App/frontend/desktop/src/app/app-view-types.ts`
- Modify: `App/frontend/desktop/src/app/app-view-host.tsx`
- Modify: `apps/fixture/ui/index.html`（加一个“AI 对话”按钮，调用 `ui/open-chat`）
- Test: `App/frontend/desktop/src/app/tests/app-view-bridge.test.ts`

**Interfaces:**
- Produces: `AppViewBridge` 构造参数增加 `layout?: "inline" | "page"` 和 `onOpenChat?: (input: { message?: string }) => Promise<void>`；`AppViewHost` props 增加 `layout` / `onOpenChat` 并透传。
- `ui/open-chat` case；page 模式下 `ui/message` 调用 `onOpenChat({ message: <content 中的文本> })` 而不是 `transport.sendMessage`；inline 模式保持现状。
- Consumes: Task 10 的 page layout；Task 3 的 `AgentAppView.capabilities.appMessages`。

- [ ] **Step 1: Write the failing tests**

```ts
function makeChatBridge(capability: "allow" | "ask", onOpenChat = vi.fn(async () => undefined)) {
  const postMessage = vi.fn();
  const bridge = new AppViewBridge({
    iframe: { contentWindow: { postMessage } },
    view: {
      viewId: "v1", appId: "demo", resourceUri: "ui://demo/x", toolName: "hello", title: "Hello",
      displayMode: "inline", protocol: "mcp-apps/2026-01-26",
      capabilities: { appMessages: capability },
    },
    hostContext: () => ({}),
    transport: { callTool: vi.fn(), readResource: vi.fn(), sendMessage: vi.fn(), readViewResult: vi.fn() },
    layout: "page",
    onOpenChat,
  });
  return { bridge, postMessage, onOpenChat };
}

it("rejects ui/open-chat unless appMessages is allow", async () => {
  const { bridge, postMessage, onOpenChat } = makeChatBridge("ask");
  await bridge.handleMessage({
    source: (bridge as any).iframeWindow,
    data: { jsonrpc: "2.0", id: 1, method: "ui/open-chat", params: { message: "hi" } },
  });
  expect(onOpenChat).not.toHaveBeenCalled();
  expect(postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ id: 1, error: expect.anything() }),
    "*",
  );
});

it("routes ui/open-chat when appMessages is allow", async () => {
  const { bridge, onOpenChat } = makeChatBridge("allow");
  await bridge.handleMessage({
    source: (bridge as any).iframeWindow,
    data: { jsonrpc: "2.0", id: 1, method: "ui/open-chat", params: { message: "hi" } },
  });
  expect(onOpenChat).toHaveBeenCalledWith({ message: "hi" });
});
```

（检查 `AppViewBridge` 的现有测试构造方式；`view` 需要包含 `capabilities.appMessages`，如现有类型没有该字段，在 `app-view-types.ts` 增加可选字段。）

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w @memmy/frontend-desktop -- src/app/tests/app-view-bridge.test.ts`
Expected: FAIL — method 未识别。

- [ ] **Step 3: Implement**

`AppViewBridge` 增加 `layout` 和 `onOpenChat` option；`ui/open-chat` 检查 `this.view.capabilities?.appMessages === "allow"`，有 `onOpenChat` 则调用并回 ok，否则回 error。page 模式下 `ui/message` 走 `onOpenChat({ message })`；inline 模式保持 `transport.sendMessage`。`AppViewHost` 增加 `layout` / `onOpenChat` props 并传给 bridge；更新文档 `docs/app-packages.md` 说明 `ui/open-chat` 是 Cuby 扩展、需要 `appMessages: "allow"`。fixture UI 加按钮验证端到端。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w @memmy/frontend-desktop -- src/app/tests/app-view-bridge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add App/frontend/desktop/src/app/app-view-bridge.ts App/frontend/desktop/src/app/app-view-types.ts App/frontend/desktop/src/app/app-view-host.tsx docs/app-packages.md
git commit -m "feat(apps): add host chat panel bridge method

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 13: AppChatPanel and lazy visible chat

**Files:**
- Create: `App/frontend/desktop/src/pages/app-chat-panel.tsx`
- Modify: `App/frontend/desktop/src/pages/app-page.tsx`
- Modify: `App/frontend/desktop/src/i18n/messages.ts`
- Test: `App/frontend/desktop/src/pages/tests/app-chat-panel.test.tsx`

**Interfaces:**
- Produces:
  ```tsx
  export interface AppChatPanelProps {
    open: boolean;
    appName: string;
    chatId: string | null;
    pendingAppMessage?: string | null;
    onClose: () => void;
    onEnsureChat: () => Promise<string>;
    onAppMessage: (chatId: string, content: string) => Promise<void>;
  }
  export function AppChatPanel(props: AppChatPanelProps)
  export async function ensurePanelChat(input: {
    target: Pick<AppPageTarget, "origin" | "chatId">;
    newChat: () => Promise<string>;
  }): Promise<string>
  ```
  `ensurePanelChat`：`origin==="chat"` 且有 `chatId` → 直接返回；否则调用 `newChat()`。
- Consumes: Task 12 的 `onOpenChat`、Task 7 的 client。

- [ ] **Step 1: Write the failing test**

```tsx
it("creates a visible chat only when the panel opens", async () => {
  const ensureChat = vi.fn(async () => "chat-1");
  const { rerender } = render(
    <AppChatPanel open={false} appName="Demo" chatId={null} onClose={vi.fn()} onEnsureChat={ensureChat} onAppMessage={vi.fn()} />,
  );
  expect(ensureChat).not.toHaveBeenCalled();
  rerender(
    <AppChatPanel open appName="Demo" chatId={null} onClose={vi.fn()} onEnsureChat={ensureChat} onAppMessage={vi.fn()} />,
  );
  await vi.waitFor(() => expect(ensureChat).toHaveBeenCalledTimes(1));
});

it("sends the pending app message after opening", async () => {
  const onEnsureChat = vi.fn(async () => "chat-1");
  const onAppMessage = vi.fn(async () => undefined);
  render(
    <AppChatPanel open appName="Demo" chatId={null} pendingAppMessage="hi" onClose={vi.fn()} onEnsureChat={onEnsureChat} onAppMessage={onAppMessage} />,
  );
  await vi.waitFor(() => expect(onAppMessage).toHaveBeenCalledWith("chat-1", "hi"));
});

it("reuses a chat-origin chat without creating a new one", async () => {
  const newChat = vi.fn(async () => "chat-new");
  await expect(ensurePanelChat({ target: { origin: "chat", chatId: "chat-1" }, newChat })).resolves.toBe("chat-1");
  expect(newChat).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @memmy/frontend-desktop -- src/pages/tests/app-chat-panel.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`AppChatPanel` 是右侧抽屉（约 360–420px）：打开时调用 `onEnsureChat`（只一次），渲染聊天消息列表（复用现有 `AgentThreadMessages` 或最小消息列表；消息从 `state.agent.messagesByChatId[panelChatId]` 选取）+ 输入框；`pendingAppMessage` 在 chat 就绪后通过 `onAppMessage` 发送。AppPage 的 `onOpenChat` 设置 `panelOpen=true` 和 `pendingAppMessage=message`；`onEnsureChat` 调用导出的 `ensurePanelChat`（chat-origin 复用 `target.chatId`；否则 `connection.newChat(connection.getReadyGeneration()!)` 并保存到本地 `panelChatId`）。app 消息通过 `createAppBridgeTransport(connection, panelChatId).sendMessage` 发送（带 `source:"mcp-app"` provenance 由后端 `ui/message` 路径负责，现有 10 条/分钟/view 限流继续生效）。面板普通输入用正常 `connection.sendMessage({ chatId: panelChatId, content, target })`。加 i18n `app.chat.panelTitle`、`app.chat.openFailed`、`app.chat.retry`。
**重要**：app 页面打开时 `panelOpen=false`、不创建 chat；只有 `ui/open-chat` / `ui/message` 打开面板时才创建。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @memmy/frontend-desktop -- src/pages/tests/app-chat-panel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add App/frontend/desktop/src/pages/app-chat-panel.tsx App/frontend/desktop/src/pages/app-page.tsx App/frontend/desktop/src/i18n/messages.ts App/frontend/desktop/src/pages/tests/app-chat-panel.test.tsx
git commit -m "feat(apps): host AI chat panel for app pages

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 14: App page restore

**Files:**
- Create: `App/frontend/desktop/src/app/app-page-storage.ts`
- Modify: `App/frontend/desktop/src/pages/app-page.tsx`
- Test: `App/frontend/desktop/src/app/tests/app-page-storage.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const APP_PAGE_TARGET_STORAGE_KEY = "memmy.appPageTarget";
  export function readStoredAppPageTarget(storage: Storage | undefined): AppPageTarget | null;
  export function writeStoredAppPageTarget(storage: Storage | undefined, target: AppPageTarget): boolean;
  export function clearStoredAppPageTarget(storage: Storage | undefined): void;
  ```
- Consumes: Task 8 的 `AppPageTarget`。

- [ ] **Step 1: Write the failing tests**

```ts
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    clear: () => { map.clear(); },
    key: (index) => [...map.keys()][index] ?? null,
    get length() { return map.size; },
  } as Storage;
}

it("round-trips an app page target", () => {
  const storage = memoryStorage();
  const target = { appId: "demo", bridgeChatId: "app-1", origin: "entry" as const, view: { viewId: "v1" } as any };
  expect(writeStoredAppPageTarget(storage, target)).toBe(true);
  expect(readStoredAppPageTarget(storage)).toEqual(target);
});

it("returns null for invalid JSON and clears", () => {
  const storage = memoryStorage();
  storage.setItem(APP_PAGE_TARGET_STORAGE_KEY, "{bad");
  expect(readStoredAppPageTarget(storage)).toBeNull();
  clearStoredAppPageTarget(storage);
  expect(storage.getItem(APP_PAGE_TARGET_STORAGE_KEY)).toBeNull();
});

it("returns null for an invalid target shape", () => {
  const storage = memoryStorage();
  storage.setItem(APP_PAGE_TARGET_STORAGE_KEY, JSON.stringify({ appId: "demo" }));
  expect(readStoredAppPageTarget(storage)).toBeNull();
});

it("reports quota failures without throwing", () => {
  const storage = { setItem: () => { throw new Error("quota"); }, getItem: () => null, removeItem: () => undefined } as any;
  expect(writeStoredAppPageTarget(storage, { appId: "demo", bridgeChatId: "app-1", origin: "entry", view: { viewId: "v1" } as any })).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w @memmy/frontend-desktop -- src/app/tests/app-page-storage.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement and wire into AppPage**

实现 storage helpers（try/catch，sessionStorage）。`readStoredAppPageTarget` 除 JSON 解析外还要校验 `appId` / `bridgeChatId` / `origin` / `view.viewId`，shape 不对返回 null。AppPage 挂载时：内存 target → sessionStorage target → 空态；打开 app 时写入 target；`origin==="entry"` 的刷新重新 `appsActions.openApp`；`origin==="chat"` 的刷新只 remount。无 target 时显示空态（不自动跳转）。app 被删除/禁用时清空 storage 并显示空态。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w @memmy/frontend-desktop -- src/app/tests/app-page-storage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add App/frontend/desktop/src/app/app-page-storage.ts App/frontend/desktop/src/pages/app-page.tsx App/frontend/desktop/src/app/tests/app-page-storage.test.ts
git commit -m "feat(apps): restore the app page across reloads

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 15: Docs and full verification

**Files:**
- Modify: `docs/app-packages.md`
- Modify: `docs/superpowers/specs/2026-11-27-cuby-app-entry-points-design.md`（如实现偏离，更新状态/说明）

- [ ] **Step 1: Update app developer docs**

在 `docs/app-packages.md` 增加：
- home entry point 示例和“侧栏入口不触发模型 turn”。
- `ui/open-chat` 是 Cuby host 扩展；需要 `capabilities.appMessages: "allow"`；`ui/message` 在整页模式下打开宿主对话面板；app 不读取回复。
- app 页面独立、无聊天；隐藏 bridge 会话对 app 不可见。
- 明确 v1 没有 `chat/send` API。

- [ ] **Step 2: Run the full relevant test suites**

```bash
npm run build -w @memmy/local-api-contracts
npm --prefix App/memmy-agent exec vitest run tests/apps tests/integrations/channels/websocket-channel.test.ts
npm run test -w @memmy/frontend-desktop -- src/state/tests src/pages/tests src/app/tests src/api/tests
```

Expected: all PASS.

- [ ] **Step 3: Typecheck**

```bash
npm --prefix App/memmy-agent run typecheck
npm run typecheck -w @memmy/frontend-desktop
```

Expected: exit 0.

- [ ] **Step 4: Manual verification with fixture**

```sh
CUBY_DEV_APPS=apps/fixture npm run dev:desktop
```

检查：
- 侧栏 Apps 出现 Fixture；点击后整页显示 hello UI；聊天列表/当前 chat 不变。
- 聊天里调用 `mcp_fixture_hello` 出现内嵌卡片；点“整页打开”进入同一 view。
- app 页面触发 `ui/open-chat`（fixture 临时加按钮）→ 右侧 Cuby 对话面板出现，聊天列表出现该 chat；关闭再开复用。
- 刷新窗口回到 app 页（sessionStorage 恢复）。

- [ ] **Step 5: Commit**

```bash
git add docs/app-packages.md docs/superpowers/specs/2026-11-27-cuby-app-entry-points-design.md
git commit -m "docs(apps): document standalone app pages and host chat panel

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```
