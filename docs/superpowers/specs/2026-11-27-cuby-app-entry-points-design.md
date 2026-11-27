# Cuby App 入口与整页视图设计

- 日期：2026-11-27
- 状态：Approved / 已批准（2026-11-27）
- 关联文档：
  - `docs/superpowers/specs/2026-11-21-cuby-app-packages-design.md`
  - `docs/app-packages.md`
  - `docs/superpowers/plans/2026-11-22-cuby-app-host-mvp.md`
- 范围：已集成 app 的侧边栏入口、独立整页 app view、宿主 AI 对话面板、聊天内嵌卡片与整页互跳；不包含去掉 iframe、独立窗口、运行时安装/签名、app 自建的 chat API

## 1. 意图与为什么

现在 app 的 UI 只有一个出现位置：模型调用带 `_meta.ui.resourceUri` 的工具后，聊天里渲染一张内嵌卡片。对 FinanceBuddy、财经日历这类应用，内嵌卡片的可用面积和交互都不够。用户希望在左侧栏选中 app，右侧直接显示 **app 自己的整页页面**，而不是一个聊天页面。

本设计采用 app host MVP 设计文档 §8.9 已经定义的 **entry point** 机制：宿主不启动模型 turn，直接执行 app 的入口工具或打开默认 resource，生成一个 app view，然后由渲染进程以整页方式展示。app 页面本身是独立的，不创建、不切换、不显示聊天；反向调用使用一个隐藏的 bridge 会话。只有当用户在 app 里点击“AI 对话”时，宿主才打开一个聊天面板，并惰性创建一个可见的 chat。

用户已确认：
- 目标是 **视觉上的整页**，保留现有 sandboxed iframe 和 MCP Apps bridge；不是把 app HTML 直接注入宿主页面。
- app 提供页面时，**不要 chat 页面**；app 页面独立。
- demo（`demo.png`）右上角的“AI 对话”采用 **宿主聊天面板**：app 请求宿主打开 Cuby 的 AI 对话面板，宿主负责对话 UI 和模型；app 不自己渲染聊天，也不通过 chat API 读取回复。

## 2. 目标 / 非目标 / 反目标

### 目标

1. 左侧栏有一个 Apps 分区，列出所有带 UI 的已集成 app，并显示可用状态。
2. 点击侧栏 app 后，主内容区以整页方式显示该 app 的 UI；左侧栏保持可见，可随时切换。
3. app 页面是独立页面：打开 app 不创建可见 chat、不改当前 chat、不进聊天列表；只有用户主动打开 AI 对话面板时才创建/使用可见 chat。
4. 侧栏入口不触发模型 turn；它按 manifest 的 `entryPoints` 执行入口工具，或退回到 `ui.defaultResourceUri`。
5. 聊天里的内嵌卡片可以跳到同一个 view 的整页视图，不丢失参数和结果。
6. app 可以通过宿主方法请求打开 AI 对话面板，并把当前页面上下文作为 app 消息发进去；对话由宿主渲染。
7. 现有安全模型不变：sandbox iframe、注入 CSP、capability 校验、反向调用白名单。
8. 入口失败、app 不可用、对话面板失败都有可读错误和重试，不静默。

### 非目标

- 去掉 iframe、使用 `WebContentsView`、独立 `BrowserWindow` 或自定义协议。
- 运行时安装/卸载/升级 app、签名、app 商店。
- app 注入任意 React 页面或宿主组件。
- 多个 home entry point 的选择菜单；v1 只取第一个 `surface: "home"` 的入口。
- app 自定义侧栏图标的上传/资源协议；v1 用通用图标。
- 入口工具的参数编辑 UI；参数来自 manifest 的静态 `arguments`。
- **app 自建的 chat API**（`chat/send`、`chat/subscribe`、让 app 读取 assistant 回复等）；v1 只提供宿主聊天面板。
- 实时 app 状态推送；v1 在打开侧栏/打开 app 时刷新。

### 反目标

- app UI 运行在宿主 DOM/JS 上下文，能访问宿主 `localStorage`、`window.memmy` 或 React 状态。
- 为了渲染 app 页面而创建可见 chat、切换当前 chat 或往聊天列表塞空会话。
- 入口调用触发模型 turn，或在聊天里生成用户/assistant 消息。
- app 通过聊天面板之外的接口直接消耗模型额度或读取对话内容。
- 入口失败时静默回退到空页面；必须有可读错误和重试。
- 把 app 的 server 配置、凭据、环境变量暴露给渲染进程或 `GET /api/apps`。

## 3. 约束

- `AppManager` 运行在 agent 进程；websocket 通道不直接持有它。现有 `app_bridge` 已经用「inbound runtime control + ack」的方式把渲染进程请求转给 agent loop，本设计复用同一模式。
- 现有 `app_bridge` 要求连接已订阅 `chat_id`；整页 view 的反向调用必须绑定到一个已订阅的 chat id。这个 chat id 可以是一个 **隐藏的 bridge 会话 id**，不要求对应真实 Session 或聊天列表项。
- 会话 key 由 chat id 推导：`websocket:<chatId>`；`scope: "session"` app 按 sessionKey 隔离。workspace 由 `apps_open` 请求携带的 `target` / 当前项目决定；没有时使用 agent 默认 workspace。
- app 页面在侧栏入口场景下不写 transcript；view 和 bridge 会话信息存在前端 sessionStorage，用于 reload 恢复。聊天内嵌卡片触发的整页 view 仍然属于原 chat，继续走 transcript。
- `entryPoints` 已在 manifest schema 中定义（`surface` / `title` / `description` / `icon` / `action: { kind: "tool", tool, arguments? }`），但 v1 从未实现。本设计不修改 manifest schema。
- 前端路由是字面量联合类型 `AppRoutePath`，没有动态段；侧栏 nav 目前是静态 `navItems` 数组。
- 宿主聊天面板是一个 Cuby 前端 UI，不是 MCP Apps 协议的一部分；新增的 `ui/open-chat` 是 Cuby 的 host 扩展方法，需要 capability gate。
- 侧栏 app 的列表来自 `AppManager`，必须经过字段白名单，不能把 manifest 全量下发。

## 4. 方案选择

考虑过三条路线：

### A. 前端合成 view

前端用 `defaultResourceUri` 直接合成 `AgentAppView`，绑定一个 bridge 会话，整页渲染；后端只加 app 列表接口。

- 优点：改动最小，最快落地。
- 缺点：入口工具无法执行；view 恢复和宿主对话面板都要以后重做。

### B. 规范的 App Entry Point + 独立整页 + 宿主对话面板（选中）

后端实现 `apps/open` 运行时控制：执行 manifest 的 home entry point（或无入口时打开 `defaultResourceUri`），生成 view；app 页面使用隐藏的 bridge 会话，不依赖真实 chat；宿主提供 `ui/open-chat` 对话面板。

- 优点：对齐已有设计文档的 entry point；app 页面独立于聊天；入口工具能用真实数据；聊天内嵌卡片与整页共用同一个 view；AI 对话由宿主负责，安全性和一致性最好。
- 缺点：后端需要新增运行时控制；前端需要新增 app 页面、page 模式和对话面板。

### C. 独立窗口 / WebContentsView

用独立 `BrowserWindow` 或主窗口内嵌 `WebContentsView` + 自定义协议加载 app UI。

- 优点：真正脱离 SPA/iframe，进程隔离强。
- 缺点：主进程、bridge（preload/IPC）、主题与会话同步都要重做，和现有侧栏/聊天架构冲突大。

**选择 B。** 用户明确要独立整页和宿主对话面板；A 缺少入口工具/对话面板，C 的成本与风险不匹配当前需求。

## 5. 总体流程

### 5.1 打开 app 页面（侧栏）

```text
侧栏点击 app
  │
  ▼
renderer: memmyAgent.openApp({ appId, target? })
  │  ws: apps_open
  ▼
websocket channel
  ├─ 校验 appId / request_id
  ├─ 生成隐藏 bridgeChatId（或复用 chat 来源的 chatId）
  ├─ attachConnection(connection, bridgeChatId)
  ├─ 解析 sessionKey / workspace
  ├─ publish inbound control (apps/open) + ack
  ▼
agent loop / AppManager
  ├─ sessionFor(appId, { sessionKey, workspace })   // 启动/复用 app server
  ├─ 找第一个 surface:"home" 的 entryPoint
  ├─ 有 action.kind="tool" → 调该工具 → 取 toolDef._meta.ui.resourceUri
  ├─ 无 action → 用 ui.defaultResourceUri，结果为空
  ├─ AppViewStore.create({ ... })
  └─ 返回 view
  ▼
websocket channel
  └─ ws: apps_open_result { view, bridge_chat_id }
  ▼
renderer: 导航到 /apps，整页渲染 AppViewHost
  ├─ resources/read 取 HTML（走 app_bridge，绑定 bridge_chat_id）
  ├─ 注入 CSP，sandbox iframe
  └─ postMessage bridge 反向调用（走 app_bridge）
```

### 5.2 打开 AI 对话面板（app 内）

```text
app UI: ui/open-chat { message? } 或 ui/message { content }
  │  postMessage bridge
  ▼
renderer AppViewBridge
  ├─ 校验 capabilities.appMessages === "allow"
  ├─ 打开 AppPage 右侧对话面板（已开则聚焦）
  ├─ 选择/创建可见 chat：
  │    ├─ chat 来源的整页 view → 复用原 chat
  │    └─ 侧栏入口 → 惰性 newChat + 当前项目/默认 workspace
  └─ 把 message 作为 app 消息发送到该 chat（provenance 标记、限流）
  ▼
宿主聊天面板显示正常 Cuby 对话（流式回复、停止、历史）
```

## 6. 数据与 API

### 6.1 AppHostSummary

新增共享 DTO（放在 `@memmy/local-api-contracts`，例如 `src/app-host.ts`），只包含渲染进程需要的字段：

```ts
type AppHostState =
  | "discovered" | "validated" | "enabled" | "starting"
  | "ready" | "failed" | "disabled" | "missing_credentials";

type AppHostSummary = {
  id: string;
  name: string;
  description?: string;
  version: string;
  source: "bundled" | "user" | "dev";
  state: AppHostState;
  error: string | null;
  ui: {
    defaultResourceUri: string | null;
    resources: Array<{ uri: string }>;
    displayModes: Array<"inline" | "fullscreen" | "pip">;
    prefersBorder: boolean;
    csp: {
      connectDomains?: string[];
      resourceDomains?: string[];
      frameDomains?: string[];
      baseUriDomains?: string[];
    };
  };
  capabilities: {
    openLinks: boolean;
    downloads: boolean;
    appMessages: false | "ask" | "allow";
  };
  entryPoints: Array<{
    surface: "home" | "settings";
    title: string;
    description?: string;
    icon?: string;
  }>;
  hasUi: boolean;
};
```

规则：

- `hasUi = ui.resources.length > 0`。
- 不包含 `server`、`credentials`、`env`、`build`、`licenses`。
- `state` 是 app 级别的可用性；`scope: "session"` 的 app 单个会话启动失败不回写为全局 `failed`（见 §8）。
- `state` 为 `failed` / `missing_credentials` 时，侧栏置灰但仍可点击：整页显示错误原因和重试；`disabled` 是显式禁用，不可进入。
- `entryPoints[].action` 不下发；执行逻辑只在 agent 侧。

`AppManager` 新增 `summaries(): AppHostSummary[]`，从 `AppRuntime.status` 和 `runtime.entry.manifest` 组装；不改现有 `list()` 的返回结构。

### 6.2 列表接口

新增 `GET /api/apps`（由 websocket 通道的 HTTP 分发处理）：

- 校验 API token（沿用 `checkApiToken`）。
- 通过 inbound runtime control `apps` / `action: "list"` 向 agent loop 请求，等待 ack。
- 返回 `{ apps: AppHostSummary[] }`。
- 失败返回 503，前端显示侧栏错误提示但不阻塞页面。

前端 `memmy-agent-client.ts` 新增 `listApps()`，用 zod schema 校验返回。

### 6.3 apps/open 控制

新增 websocket envelope：

```json
{
  "type": "apps_open",
  "request_id": "<uuid>",
  "app_id": "financebuddy",
  "chat_id": "<uuid, optional>",
  "target": { "kind": "project", "projectId": "...", "cwd": "..." }
}
```

- `chat_id` 仅用于“从聊天内嵌卡片打开整页”的场景；侧栏入口不传。
- `target` 是可选的项目/workspace 目标，用于隐藏 bridge 会话的 `${SESSION_WORKSPACE}` 和 app 页面里的新建对话；不传时使用默认 workspace。
- `target` 的结构复用现有 `WebuiSessionTarget`（或 builder 定义的等价类型）。

响应事件：

```json
{
  "event": "apps_open_result",
  "request_id": "<uuid>",
  "ok": true,
  "bridge_chat_id": "<uuid>",
  "view": { /* AppViewEvent */ }
}
```

失败：

```json
{
  "event": "apps_open_result",
  "request_id": "<uuid>",
  "ok": false,
  "error": "readable message",
  "reason": "app_not_found" | "app_not_ready" | "no_ui" | "entry_failed" | "timeout" | "invalid_request"
}
```

约束：

- renderer 只能传 `app_id`、可选 `chat_id` 和 `target`；**不能**传工具名、参数或 resource URI。工具名和参数只来自 manifest。
- 每次请求必须带 `request_id`（UUID）。
- `app_id` 必须是已注册 app；`chat_id` 必须通过 `isValidGuiChatId`。

### 6.4 bridge 会话规则

在 websocket 通道里处理：

1. 如果请求带 `chat_id` 且它对应一个 **native** GUI chat：
   - 校验格式；如果连接尚未订阅，先 `attachConnection`；
   - `bridgeChatId = chat_id`；这个 chat 的 view 已经在 transcript 里，整页只是复用。
2. 如果请求带 `chat_id` 但它是外部 GUI chat（`isExternalGuiChatId`，例如 TUI/IM 投影）：
   - 不复用该 chat 作为 bridge；
   - 生成隐藏的 `bridgeChatId = crypto.randomUUID()` 并 attach；
   - 不写外部会话的 transcript，也不让 app 消息进入外部通道。
3. 如果请求没有 `chat_id`（侧栏入口）：
   - 生成隐藏的 `bridgeChatId = crypto.randomUUID()`，`attachConnection(connection, bridgeChatId)`；
   - **不创建 Session 记录、不写 transcript、不进聊天列表**。
4. `sessionKey = "websocket:" + bridgeChatId`。
5. `workspace`：
   - 请求的 `target` 有 project/cwd → 使用它；
   - 否则使用 agent 默认 workspace（与 `handleWebuiSeedChat` 相同的 `assertWebuiWorkspaceAvailable(this.workspacePath)`）。
6. 隐藏 bridge 会话不要求真实 chat；`app_bridge` 的 `chat_not_subscribed` 检查由 `attachConnection` 满足。app server 的 `scope: "session"` 实例按 `bridgeChatId` 隔离，空闲 10 分钟后由现有回收逻辑关闭。
7. `ui/message` 的目标不是 `bridgeChatId`：在整页模式下，app 的 `ui/message` / `ui/open-chat` 走宿主对话面板，面板使用真实 chat（见 §7.7）。`bridgeChatId` 只承载 `tools/call` / `resources/read`。
8. 通道在 `apps_open` 时把 `bridgeChatId -> workspace` 记在连接级 map 里；后续 `app_bridge` 请求用同一 workspace 解析 session，避免隐藏 bridge 会话被回收后重启 app server 时丢失 `${SESSION_WORKSPACE}`。连接关闭时清理该 map。

### 6.5 AppManager.openEntryPoint

新增方法：

```ts
async openEntryPoint(
  appId: string,
  context: AppSessionContext, // { sessionKey, workspace }
  options?: { entryPointIndex?: number },
): Promise<AppViewEvent>;
```

流程：

1. `requireRuntime(appId)`。
   - `disabled`：直接抛出不可用错误。
   - `missing_credentials`：抛出包含缺失 credential key 的可读错误。
   - `scope: "global"` 且状态是 `failed`：先尝试一次重启（新增 `AppManager.retryApp(appId)` 或等价的公开方法），仍然失败才抛出；重试受现有 `failures` / `nextRetryAt` 退避约束。
   - `scope: "session"` 且状态是 `failed`：交给 `sessionFor` 按 session 重试；单会话失败不阻止其他会话。
2. `connection = await sessionFor(appId, context)`（`scope: "session"` 时启动/复用该 session 的 server）。
3. 选择入口：
   - `manifest.entryPoints?.filter(e => e.surface === "home")`；
   - 取 `options.entryPointIndex ?? 0`；
   - 没有 home entry point → 走默认 resource 分支。
4. 如果入口有 `action.kind === "tool"`：
   - 在 `connection.tools` 中按 raw name 找到 toolDef；找不到 → 抛出 `entry tool not found`。
   - `result = await connection.session.callTool(action.tool, action.arguments ?? {}, timeout)`。
   - `result.isError === true` → 抛出工具返回的可读错误，不创建 view。
   - `resourceUri = readUiResourceUri(toolDef._meta) ?? manifest.ui?.defaultResourceUri`。
   - 没有 `resourceUri` → 抛出 `app entry has no ui resource`。
5. 否则（有入口但无 action，或没有 home entry point）：
   - `resourceUri = manifest.ui?.defaultResourceUri ?? manifest.ui?.resources[0]?.uri`。
   - 没有 → 抛出 `app has no ui`。
   - `result = { content: [] }`（app 在 handshake 后通过反向调用自行加载）。
   - `toolName = "app_home"`，`title = manifest.name`。
6. `view = await runtime.store.create({ appId, resourceUri, toolName, title, arguments, result, prefersBorder, csp, capabilities, toolTimeout })`。
7. 返回 view。

`title` 优先使用 entry point 的 `title`，否则用工具描述，最后用 `manifest.name`。

### 6.6 AppViewEvent

不新增 `hostSurface` 字段。view 就是标准 `AppViewEvent`；整页和聊天内嵌只是 host 的渲染方式。聊天内嵌卡片跳整页时，把同一个 view 对象传给 `AppPageTarget`，不修改 view。

### 6.7 持久化

- 侧栏入口的 `apps/open` **不写聊天 transcript**；`AppPageTarget`（含 view、`bridgeChatId`、`origin`）写入 `sessionStorage["memmy.appPageTarget"]`，用于 reload 恢复。
- 聊天内嵌卡片触发的 view 仍然在聊天 transcript 里；整页 target 引用同一个 view，刷新后可以从聊天记录重新打开。
- 大结果仍由 `AppViewStore` 外置到 `${APP_DATA}/views/<viewId>/result.json`，view 带 `resultRef`；整页挂载时通过 `view/result` 恢复，不依赖 transcript。

## 7. 前端设计

### 7.1 状态

新增一个 `apps` slice（可以扩展现有 `app-reducer` / `app-state`，也可以新建 `state/apps-slice.ts`）：

```ts
type AppsState = {
  status: "idle" | "loading" | "ready" | "error";
  items: AppHostSummary[];
  error: string | null;
};

type AppPageTarget = {
  appId: string;
  bridgeChatId: string;
  origin: "entry" | "chat";
  chatId?: string;        // chat origin 时的原 chat
  view: AgentAppView;
};
```

- `navigation.appPage: AppPageTarget | null` 保存当前整页 target。
- 启动或进入 `/apps` 时调用 `listApps()`；打开失败或 app 状态错误时刷新。
- 不轮询；v1 只在挂载、打开 app、手动重试时刷新。

### 7.2 侧栏

在 `app-frame.tsx` 的主导航后面增加 Apps 分区（`settingsNav` 模式下不显示）：

```text
┌ Sidebar ──────────────┬ Main ─────────────────────────────┐
│ Chat                  │                                   │
│ Search                │   FinanceBuddy                    │
│ Tools                 │  ┌─────────────────────────────┐  │
│ Memory                │  │                             │  │
│ Knowledge             │  │   app UI（整页，沙箱 iframe） │  │
│ ── Apps ──            │  │                             │  │
│ ● FinanceBuddy  (sel) │  │                             │  │
│ ○ Fixture             │  └─────────────────────────────┘  │
└───────────────────────┴───────────────────────────────────┘
```

- 只显示 `hasUi === true` 的 app。
- 每一项是 nav 按钮样式，图标 v1 用通用 `Puzzle`/`Boxes` 图标（或 app 名首字母），名称来自 `summary.name`。
- 状态：
  - `ready` / `starting`：正常可点；
  - `failed` / `missing_credentials`：置灰但仍可点，进入整页错误页；
  - `disabled`：不可点；
  - `loading`：侧栏骨架。
- 当前路径是 `/apps` 且 `navigation.appPage.appId` 匹配时高亮。
- 点击：
  1. 调用 `memmyAgent.openApp({ appId, target: 当前项目/workspace })`；侧栏入口不传 `chatId`；
  2. 成功：把返回的 `view` / `bridge_chat_id` 写入 `navigation.appPage`，`origin: "entry"`，`dispatch(appActions.navigate("/apps"))`；
  3. **不改变 `state.agent.currentChatId`，不创建可见 chat，不写聊天 transcript**；
  4. 失败：显示 toast/banner，保留在当前页，刷新 app 列表。
- 侧栏隐藏/恢复、settings 导航等现有行为不变。

### 7.3 路由与 AppPage

- `AppRoutePath` 增加 `"/apps"`；`routeTable` 增加 `{ path: "/apps", navKey: "nav.apps", requiresBootstrap: true }`。
- `AppRouter.renderRoute` 增加 `case "/apps": return <AppPage />;`。
- `isRestorableRoute` 增加 `"/apps"`；`AppPage` 自己负责恢复 target（见 7.6）。
- 新增 `pages/app-page.tsx`：
  - 从 `state.navigation.appPage` 取 target；
  - 没有 target：尝试从 `sessionStorage["memmy.appPageTarget"]` 恢复；
  - 有 target：取 `clients.memmyAgent` 和 `createAppBridgeTransport(connection, target.bridgeChatId)`，渲染 `AppViewHost layout="page"`；
  - 没有 target 且无法恢复：显示“请从左侧选择一个 app”的空态（或导航回 `/main`，builder 选其一）。
- AppPage 默认不包含聊天输入框、消息列表或工具痕迹；它是 app 的专用页面。
- 顶部不加常驻 host header；加载/错误时显示整页状态；页面右上角提供一个轻量的刷新按钮。
- `AppPageTarget.origin` 区分来源：
  - `entry`：刷新重新执行入口，生成新 view；
  - `chat`：刷新只 remount 当前 view（重新读取 resource/result），不重新执行入口工具，避免替换掉用户正在看的聊天结果。

### 7.4 AppViewHost page 布局

`AppViewHost` 增加 `layout?: "inline" | "page"`（默认 `"inline"`）：

- `inline`：保持现有 `AppViewFrame` 卡片、高度自适应、展开按钮。
- `page`：
  - 填满父容器（`height: 100%` / `flex: 1`），`margin: 0`，无卡片边框/背景/标题栏；
  - iframe `width: "100%"`、`height: "100%"`，不跟随 `ui/notifications/size-changed` 调整高度；
  - host context 的 `displayMode` 使用 `"fullscreen"`，`containerDimensions` 使用实际容器尺寸（ResizeObserver 或父子布局测量）；
  - 加载态/错误态用整页面板，保留重试；
  - `ui/request-display-mode` 在 page 模式下始终返回 `"fullscreen"`。
- iframe 继续使用 `srcDoc`、`sandbox="allow-scripts"`、注入 CSP；不改 bridge。

### 7.5 聊天内嵌卡片与整页互跳

- 普通工具触发的 view 仍然在聊天里渲染内嵌卡片。
- `AppViewFrame` 的 header 增加一个“在整页打开”按钮（`ExternalLink`/`Maximize2` 图标），点击时：
  - 用当前 view、当前 chatId 构造 `AppPageTarget`（`origin: "chat"`，`bridgeChatId = chatId`）；
  - `dispatch(appActions.navigate("/apps"))`；
  - 不重新执行入口工具。
- 整页打开聊天来源的 view 时，AppPage 的对话面板复用原 chat；`ui/message` 进入原 chat。
- 如果产品后续希望 FinanceBuddy 的所有工具视图都只走整页，可以在 app manifest 增加 `ui.preferredSurface: "page"`；本设计不实现。

### 7.6 恢复

- 打开 app 时把完整的 `AppPageTarget`（含 view、`bridgeChatId`、`origin`、`chatId`）写入 `sessionStorage["memmy.appPageTarget"]`；如果写入失败（配额），退化为只存 `{ appId, bridgeChatId, origin, chatId, viewId }`。
- 页面重载或窗口 reload 后：
  - 如果内存里已有 target → 直接渲染；
  - 否则读取 sessionStorage；有完整 view → 直接渲染（bridge 会话如果已被回收，第一次反向调用会重新启动 app server）；
  - 只有 `{ appId, bridgeChatId, origin, chatId, viewId }` 时：
    - `chat` origin 显示空态并提示“请回到聊天里重新打开”，因为原结果只存在于聊天记录中；
    - `entry` origin 重新调用 `apps/open`，生成新 view。
- app 被删除/禁用 → 清空 target，显示空态并提示。
- 应用进程完全重启后 `sessionStorage` 不保证保留；此时回到 `/main` 或空态即可，v1 不追求跨进程恢复。

### 7.7 宿主 AI 对话面板

这是 demo `demo.png` 右上角“AI 对话”的实现方式。

**App 侧调用**：

- 新增 host 方法 `ui/open-chat`（Cuby 扩展，不属于 MCP Apps 标准）：
  ```json
  { "jsonrpc": "2.0", "id": 7, "method": "ui/open-chat", "params": { "message": "请解释当前页面的数据" } }
  ```
  - `message` 可选；有值时打开面板并作为 app 消息发送。
  - 返回 `{ ok: true }`；失败返回 JSON-RPC error。
- 现有的 `ui/message` 在整页模式下等价于“打开面板（如未开）并发送内容”。
- Capability gate：`capabilities.appMessages === "allow"`。`"ask"` 和 `false` 拒绝；错误以 JSON-RPC error 返回，UI 显示可读信息。
- 限流：沿用 `ui/message` 的 10 条/分钟/ view；`ui/open-chat` 本身幂等，多次调用只聚焦同一个面板。
- app 不会收到 assistant 的回复；面板是宿主 UI。需要回复的场景不在 v1。

**Host 侧**：

- `AppViewBridge` 增加 `ui/open-chat` case，并把 `ui/message` 在 page 模式交给 `onOpenChat` / `onAppMessage` 回调。
- `AppPage` 渲染一个右侧抽屉 `AppChatPanel`（宽度约 360–420px，可关闭/重新打开）：
  - 面板复用现有 Cuby 聊天 UI（消息列表、流式回复、停止、滚动）；builder 决定复用 `AgentThreadMessages` / composer 的最小边界。
  - 打开时选择 chat：
    - `origin === "chat"` 且 `chatId` 存在 → 复用原 chat；
    - 否则 → 惰性创建可见 chat（`newChat` + 首条消息），标题可用 app 名称（builder 决定是否加 “AI 对话” 后缀），workspace 使用当前项目/目标。
  - 发送 app 消息时带 provenance：`source: "mcp-app"`、`appId`、`viewId`、`appControlled: true`；UI 标记“来自 <app>”，不伪装成用户输入。
  - 面板关闭不结束 chat；再次打开复用同一个 chat。
  - 面板里的普通用户输入是正常 chat 消息，可以继续对话。
- 面板创建的 chat 会出现在聊天列表里（这是用户主动打开 AI 对话的结果）；app 页面本身不会创建 chat。
- 面板的错误（chat 创建失败、发送失败）显示在抽屉内，并提供重试；不影响 app 页面本身。

## 8. 错误与状态

| 场景 | 行为 |
|---|---|
| 列表加载失败 | 侧栏 Apps 区显示“无法加载应用”+ 重试；不阻塞聊天 |
| app 状态 failed / missing_credentials | 侧栏置灰，点击进入整页错误页；显示 `error` 和重试按钮；`disabled` 不可进入 |
| app 没有 UI | 不出现在侧栏；如果通过旧链接进入，整页显示 “This app has no UI” |
| 入场工具失败 / 超时 | `apps_open_result.ok=false`；前端整页错误 + 重试；不写 transcript |
| 全局 app 启动失败 | 侧栏 failed；`apps/open` 先尝试一次重启（受现有 failures/backoff 约束）；仍失败则错误页 |
| session-scope app 单会话启动失败 | 不回写为全局 failed；`apps/open` 返回 `app_not_ready`，错误页重试；其他会话不受影响 |
| 反向调用失败 | 沿用 `AppViewHost` 现有错误展示；整页模式用整页错误面板 |
| 入口生成了大结果 | `AppViewStore` 外置，view 带 `resultRef`；整页挂载时通过 `view/result` 恢复 |
| `ui/open-chat` / `ui/message` 被拒绝 | JSON-RPC error；app UI 自己显示可读信息；宿主记录审计 |
| 对话面板创建 chat 失败 | 抽屉内错误 + 重试；app 页面保持可用 |
| bridge 隐藏会话被回收 | 下一次 `tools/call` / `resources/read` 自动重启 app server（现有 `sessionFor` 逻辑） |

## 9. 安全

- 不改变 iframe 沙箱：继续 `sandbox="allow-scripts"`、无 `allow-same-origin`、默认拒绝 CSP。
- `apps/open` 的 renderer 输入只有 appId/chatId/target；工具名和参数只来自 agent 侧 manifest。
- `apps/list` 只返回白名单字段，不下发 server 配置、env、credentials、build 信息。
- 整页 view 的反向调用仍走现有 `app_bridge`：`canAppCallTool` 白名单、`resources/read`、`ui/message` 能力与限流不变。
- 隐藏 bridge 会话不是真实 chat；不会出现在聊天列表，也不写 transcript。
- `ui/open-chat` 需要 `appMessages: "allow"`；app 消息带 provenance 和限流。app 不能读取 assistant 回复，也不能直接消耗模型额度（只能通过用户可见的面板）。
- app 页面创建的可见 chat 只发生在用户主动打开 AI 对话时；chat 的标题、workspace 和普通聊天一致。
- entry point 工具调用只在 app 自己的 `connection.session` 上执行，不经过模型工具名解析，避免跨 app 调用。

## 10. 文件改动清单

后端 / 共享：

- `App/backend/local-api-contracts/src/app-host.ts`（新增）：`AppHostSummary`、`AppHostState`、`OpenApp` 请求/响应类型和 zod schema。
- `App/backend/local-api-contracts/src/index.ts`：导出新模块。
- `App/memmy-agent/src/apps/manager.ts`：`summaries()`、`openEntryPoint()`；`AppRuntime` 里保留 toolDef 查询能力（或直接使用 `connection.tools`）。
- `App/memmy-agent/src/apps/bridge.ts`（或新 `host-control.ts`）：处理 `apps/list` 与 `apps/open` 的 runtime control。
- `App/memmy-agent/src/core/runtime-messages/events.ts`：新增 `RUNTIME_CONTROL_APPS`。
- `App/memmy-agent/src/integrations/channels/websocket.ts`：
  - `GET /api/apps`；
  - `apps_open` envelope 处理；
  - 隐藏 bridgeChatId / chat 来源复用 / attach / sessionKey/workspace 解析；
  - 不写 transcript。
- `apps/fixture/app.json`：增加一个 `surface: "home"` 的 entry point，供测试和手动验收（工具 `hello`）。

前端：

- `App/frontend/desktop/src/api/memmy-agent-client.ts`：`listApps()`、`openApp()` + zod schema。
- `App/frontend/desktop/src/state/`：apps slice + actions；`navigation.appPage`。
- `App/frontend/desktop/src/pages/app-frame.tsx`：侧栏 Apps 分区、点击打开。
- `App/frontend/desktop/src/app/routes.ts`：`/apps` 路由。
- `App/frontend/desktop/src/app/router.tsx`：渲染 `AppPage`。
- `App/frontend/desktop/src/pages/app-page.tsx`（新增）：整页 AppViewHost + 对话面板。
- `App/frontend/desktop/src/pages/app-chat-panel.tsx`（新增）：宿主 AI 对话抽屉。
- `App/frontend/desktop/src/app/app-view-host.tsx`：`layout` prop、page 模式 host context/尺寸、`onOpenChat`/`onAppMessage` 回调。
- `App/frontend/desktop/src/app/app-view-bridge.ts`：`ui/open-chat` case；page 模式的 `ui/message` 路由。
- `App/frontend/desktop/src/app/app-view-frame.tsx`：inline 卡片的“整页打开”按钮。
- `App/frontend/desktop/src/pages/agent-thread-messages.tsx`：把“整页打开”回调传到 AppViewHost。
- i18n：`nav.apps`、`apps.*`、`appFrame.apps.*`、`app.chat.*` 文案。

## 11. 测试

后端：

- `App/memmy-agent/tests/apps/manager.test.ts`：
  - `summaries()` 包含 UI 元数据，且不包含 server/env/credentials；
  - `openEntryPoint()` 执行 entry tool，返回正确 `resourceUri` 和 `initialResult`；
  - 无 entry point 时回退 `defaultResourceUri`，`initialResult` 为空；
  - 无 UI / 工具不存在 / 工具 isError / app 状态不可用时返回可读错误；
  - session-scope app 在不同 sessionKey 下启动独立 server。
- `App/memmy-agent/tests/apps/bridge.test.ts`（或新 host-control 测试）：list/open runtime control 的 ack 和错误路径。
- `App/memmy-agent/tests/integrations/channels/websocket-channel.test.ts`：
  - `GET /api/apps`；
  - `apps_open` 无 chat_id 时返回隐藏 bridgeChatId、attach、不创建 Session、不写 transcript；
  - `apps_open` 带 native chat_id 时复用该 chat；
  - `apps_open` 带 external chat_id 时改用隐藏 bridgeChatId；
  - workspace target 传递正确；
  - 失败不写 transcript。
- `tests/apps/build-apps.test.ts` / `manifest.test.ts`：fixture 新增 entryPoints 后仍通过构建/校验。

前端：

- `state/tests`：apps slice reducer、`navigation.appPage`。
- `pages/tests/app-frame.test.tsx`：Apps 分区渲染、禁用状态、点击调用 openApp。
- 新增 `pages/tests/app-page.test.tsx`：有 target 渲染整页、无 target 空态/恢复、错误重试、打开对话面板不改变 app 页面。
- 新增 `pages/tests/app-chat-panel.test.tsx`：`ui/open-chat` 打开面板、惰性创建 chat、`ui/message` 发送 provenance、限流错误。
- 新增 `app/tests/app-view-host-page.test.tsx`：page 布局 host context、iframe 属性、size-changed 不改变高度。
- `app/tests/app-view-bridge.test.ts`：`ui/open-chat` 的 capability gate、page 模式 `ui/message` 路由。

手动验收：

- `CUBY_DEV_APPS=apps/fixture npm run dev:desktop`；
- 侧栏出现 Fixture，点击后整页显示 hello UI；聊天列表和当前 chat 不变；
- 聊天里调用 `mcp_fixture_hello` 仍出现内嵌卡片，点“整页打开”跳到同一 view，对话面板复用原 chat；
- 在 app 页面触发 `ui/open-chat`，右侧出现 Cuby 对话面板，发送上下文，assistant 正常回复；关闭再打开复用同一个 chat；
- 刷新窗口后回到 app 页或空态（按 7.6 的行为）；
- FinanceBuddy 用真实 app 验证整页 reader、反向调用、AI 对话面板、下载/外链能力。

## 12. 分阶段

1. **Phase 1（后端）**：DTO、`summaries()`、`openEntryPoint()`、runtime control、`/api/apps`、`apps_open`（隐藏 bridge 会话）、后端测试。
2. **Phase 2（前端 app 页面）**：client/state、侧栏 Apps、`/apps` 路由、AppPage、AppViewHost page 布局、前端测试。
3. **Phase 3（宿主对话面板）**：`ui/open-chat`、AppChatPanel、惰性创建可见 chat、provenance/限流、前端测试。
4. **Phase 4（打磨）**：内嵌卡片“整页打开”、恢复、i18n、a11y、手动验收。

## 13. 留给 builder 的决定

- 侧栏 app 的图标：v1 用通用图标还是 app 名首字母；如果后续要支持 `entryPoints[].icon`，需要新增 app 资源读取接口。
- `apps` runtime control 放在 `bridge.ts` 还是新的 `host-control.ts`。
- `AppPage` 无 target 时显示空态还是直接跳回 `/main`（建议空态 + 可选 app 列表）。
- page 模式顶部是否加极简的 app 名称/刷新条（本设计倾向不加，保留右上角浮动刷新按钮）。
- `AppViewHost` page 模式中 `ui/request-display-mode` 的响应细节（始终 fullscreen，或允许 app 请求 inline 但宿主忽略）。
- `AppChatPanel` 复用现有聊天组件的边界（整页 HomePage 复用 vs 轻量消息列表 + composer）。
- 对话面板新建 chat 的标题格式（建议 `manifest.name` 或 `<manifest.name> · AI 对话`）。
- `ui/open-chat` 的成功返回值是否携带 chatId（建议只返回 ok，避免 app 依赖宿主会话 id）。
- 隐藏 bridge 会话的 workspace 目标如何从当前项目选择状态取得（复用现有 `WebuiSessionTarget` 解析）。

## 14. 验收清单

- [ ] `GET /api/apps` 只返回白名单字段，包含 `hasUi`、状态和错误。
- [ ] 侧栏只显示有 UI 的 app；failed/missing_credentials 置灰但仍可进入错误页；disabled 不可进。
- [ ] 点击侧栏 app 不触发模型 turn、不创建可见 chat、不改变当前 chat、不写聊天 transcript。
- [ ] app 页面使用隐藏 bridgeChatId；反向 `tools/call` / `resources/read` 正常。
- [ ] 整页 AppViewHost 填满主区域，iframe 仍是 `sandbox="allow-scripts"` + CSP。
- [ ] 聊天内嵌卡片的“整页打开”复用同一个 view 和 chat。
- [ ] `ui/open-chat` 打开宿主对话面板；面板惰性创建/复用可见 chat；app 消息带 provenance 和限流。
- [ ] app 不能读取 assistant 回复；没有 chat/send API。
- [ ] 入口工具失败/超时/无 UI 时整页显示可读错误和重试。
- [ ] 大结果通过 `resultRef` 恢复。
- [ ] 刷新/重进 app 页按 §7.6 恢复；聊天来源的 view 可从聊天重新打开。
- [ ] FinanceBuddy 端到端：侧栏打开整页 reader、反向读取 review、AI 对话面板、下载/外链能力。
- [ ] 现有聊天内嵌 app 视图行为不回归。

## 15. 已确认的决定

### 用户确认

1. app 提供页面时，不要 chat 页面：app 页面独立，不创建/切换/显示聊天。
2. demo 的“AI 对话”采用宿主聊天面板：app 请求宿主打开 Cuby 对话面板，宿主负责对话 UI 和模型；app 不自己渲染聊天，也不通过 chat API 读取回复。

### 设计决定（含 builder check 后的处理）

1. **独立 app 页面**：侧栏打开 app 只生成隐藏 `bridgeChatId`，不建 Session、不写 transcript、不进聊天列表、不改当前 chat（§6.4、§7.2）。
2. **bridge 会话**：反向调用绑定的 `bridgeChatId` 来自 chat 来源的原 chat，或侧栏入口的隐藏 UUID；`app_bridge` 只要求连接 attach，允许没有真实 Session（§6.4）。
3. **workspace**：隐藏会话使用前端传入的当前项目/目标 workspace；没有时用默认 workspace（§6.3、§6.4）。
4. **外部 GUI chat**：不复用外部会话作为 bridge；使用隐藏 bridgeChatId，AI 对话面板创建 native chat（§6.4）。
5. **view 持久化**：侧栏入口不写 transcript；完整 `AppPageTarget` 存 sessionStorage。聊天来源的 view 继续在 transcript 里，整页 target 引用同一个 view（§6.7、§7.6）。
6. **整页刷新**：`origin: "entry"` 重新执行入口；`origin: "chat"` 只 remount 当前 view（§7.3、§7.6）。
7. **AI 对话面板**：`ui/open-chat` / `ui/message` → 宿主面板；`appMessages: "allow"` 才可用；面板只在用户主动打开时创建可见 chat；app 不读取回复（§7.7、§9）。
8. **失败恢复**：session-scope 的单会话失败不把 app 标记为全局 failed；全局失败 `apps/open` 先尝试一次重启；failed/missing_credentials 仍可进入错误页重试（§6.1、§6.5、§8）。

### 仍需你确认的产品取舍

- 侧栏打开 app 完全不碰聊天（没有 trace、没有当前 chat 变化），聊天来源的整页才绑定原 chat。
- AI 对话面板打开时会创建一个可见 chat（标题为 app 名称或 `<app 名称> · AI 对话`），这是 app 页面之外唯一会产生聊天的地方。
- app 页面默认没有常驻 host 顶栏，只保留右上角浮动刷新按钮。
- 入口失败的 app 可点击进入错误页并重试；只有 `disabled` 不可进入。
