# Cuby App 对话与「最近」入口设计

- 日期：2026-11-28
- 状态：Draft（待确认）
- 关联文档：
  - `docs/superpowers/specs/2026-11-27-cuby-app-entry-points-design.md`
  - `docs/app-packages.md`
- 范围：「最近」列表里 **app 来源 chat** 的标记与「在 app 中打开」动作；不改变点击「最近」打开聊天的主行为。

## 1. 意图与为什么

现状（已核对代码）：

- Ask Cuby 面板创建的 chat 是普通可见 chat，会进「最近」；点击任意「最近」条目会走 `openAgentTask`，导航到 `/main` 打开聊天，与 app 无关。
- app 归属只存在**消息级**：app 消息带 `app_source` / `appId` / `viewId` / `appControlled`；面板里用户输入的消息只有**当轮** `webui_app_context`，没有持久化。session summary 和 `AgentTaskView` 都没有 app 字段。
- 离开 app 页后 `AppPage` 的面板状态丢失；之后再点 Ask Cuby 会新建 chat，旧的面板对话只能在「最近」里以普通聊天打开，无法回到 app 现场。

用户已确认采用 **A**：

- 保持「最近」= 对话历史，点击永远能读到对话（app 不可用也不影响）；
- 对 app 来源的 chat 增加 app 标记 + 「在 app 中打开」动作：跳到 app 整页，右侧 Ask Cuby 面板直接恢复该 chat（含历史）。

放弃 B（点击直接进 app 页）：历史可读性依赖 app 启动成功，且与「最近」的心智不一致。放弃 C（按 app 分组）：改动侧栏信息架构，超出本次范围。

## 2. 目标 / 非目标 / 反目标

### 目标

1. 「最近」行能识别 app 来源 chat：显示 app 标记（图标 + 名称）。
2. hover 动作「在 app 中打开」：打开 app 页并恢复该 chat 到右侧面板，历史消息可用。
3. 打开失败可重试，重试保留 chat / openPanel 意图。
4. 不写数据迁移：旧会话能推导的就推导；新消息补持久化。

### 非目标

- 不改变点击「最近」打开聊天的行为。
- 不做 app 分组、不做聊天页内的「回到 app」按钮（后续可以加）。
- 不做多 app 关联（一个 chat 取第一条 user 消息的 app）。
- v1 不加右键菜单入口，只在行 hover trail 提供动作。

### 反目标

- 普通 chat 被误标成 app 来源。
- 历史条目因 app 不可用而不可读（点击仍进聊天）。
- 打开失败后丢失 chat / openPanel 意图，落到空白或错误状态无法恢复。

## 3. 约束

- 服务端会话 summary 由 `SessionSummary` 生成；前端 `SessionSummarySchema` 是 `passthrough()`。
- `apps_open` 带 `chat_id` 时会复用该 chat 作 `bridgeChatId`，且 workspace 从该 chat 的 session binding 取（`resolveAppsOpenWorkspace`）→ `AppPageTarget` 变 `origin: "chat"`、`chatId` 为该 chat。
- `AppPageTarget` 会写入 sessionStorage（窗口 reload 恢复）；`isAppPageTarget` 允许额外字段。
- 面板消息读 `state.agent.messagesByChatId`；`ensureChatSubscription` 只订阅实时事件，不加载历史 → 恢复面板时必须 hydrate。
- `AppFrame` 可以拿到 `agentRuntimeBridge.connection` 和 `clients.memmyAgent`。

## 4. 方案

| 方案 | 行为 | 取舍 |
| --- | --- | --- |
| **A（选中）** | 点击仍打开聊天；行上 app 标记 + 「在 app 中打开」 | 历史始终可读；app 现场需要一次显式操作 |
| B | app 来源 chat 点击 → app 页 | 现场感最好；app 不可用时历史不可读，语义不一致 |
| C | 按 app 分组「最近」 | 导航结构改动大，不属于本次范围 |

## 5. 设计

### 5.1 会话的 app 归属（服务端）

**写入（新消息）**

`App/memmy-agent/src/core/agent-runtime/loop.ts` 的 `appendUserMessage` 在 `metadataExtra` 中增加：

```ts
...(isWebuiAppContext(msg.metadata?.webui_app_context)
  ? { webui_app_context: { appId, ...(name ? { name } : {}) } }
  : {})
```

- 只接受 `{ appId: string, name?: string }` 形状，与 `websocket.ts` 的写入保持一致。
- app 消息原有的 `app_source` / `appId` / `viewId` / `appControlled` 不变。

**读取（推导，无迁移）**

`App/memmy-agent/src/core/session/manager.ts` 的 `sessionSummary`：

```ts
const firstUser = visibleMessages.find((m) => m.role === "user") ?? visibleMessages[0] ?? null;
const appContext = firstUser?.webui_app_context;
const appId = firstString(firstUser?.appId) ?? firstString(appContext?.appId);
const appName = firstString(appContext?.name);
if (appId) summary.appId = appId;
if (appName) summary.appName = appName;
```

语义：**只有第一条 user 消息带 app 上下文才标记**，表示「这个 chat 是从 app 面板开始的」。

- 旧面板会话若首条是 app 消息（`app_source === "mcp-app"`，已有 `appId`）→ 可识别。
- 旧面板会话若用户先发言（当时 `webui_app_context` 未持久化）→ 不可识别（已知限制，不做迁移）。
- 普通 chat 后续被 app 面板使用 → 不标记。

### 5.2 前端类型与状态

- `App/frontend/desktop/src/api/memmy-agent-client.ts`：`SessionSummarySchema` 增加 `appId: z.string().optional()`、`appName: z.string().optional()`。
- `App/frontend/desktop/src/state/agent-chat-slice.ts`：
  - `AgentTaskView` 增加 `appId?: string; appName?: string`。
  - `buildAgentTasksForState` 把 `session.appId` / `session.appName` 透传给 `buildTaskView`。
  - optimistic rows（本地草稿）没有 app 字段。
- 名称兜底顺序：`state.apps.items` 里同 id 的 manifest 名称 → `task.appName`（面板持久化的 label）→ `task.appId`。

> 决定：badge 优先显示 manifest 名称（稳定、可读）；持久化的 `appName` 只是 app 不在列表里时的兜底。面板写给 agent 的 `appContext.name`（entry 标题）保持不变。

### 5.3 「最近」行 UI（`app-frame.tsx` `TaskRow`）

- 标题行：当 `task.appId` 存在时，在标题前渲染 app 标记：

```tsx
<span className="app-frame-task-app-badge" title={appDisplayName} data-app-id={task.appId}>
  <AppWindow size={12} aria-hidden="true" />
  <span className="truncate">{appDisplayName}</span>
</span>
```

- hover trail（`app-frame-task-row__trail`）：在 pin 之前增加 `TaskIconButton`：
  - label = `t("appFrame.task.openInApp")`，`tooltip` 开启，图标 `AppWindow`（或 `PanelRightOpen`）。
  - 仅当 `task.appId` 且传入 `onOpenInApp` 时渲染。
- `TaskRow` 新增可选 prop `onOpenInApp`；`TaskSection` / 项目分组等所有 `TaskRow` 调用点透传。
- i18n 新增 `appFrame.task.openInApp`：中文「在 app 中打开」，英文 "Open in app"。

### 5.4 打开动作

**`AppFrame`**

新增 `openTaskInApp(task: AgentTaskView)`：

```ts
if (!task.appId || !clients?.memmyAgent || !connection) return;

// 1) 像 openAgentTask 一样加载并“选中”这个 chat：
//    - historyLoading 会 switchCurrentChat → bridge 的单 chat 订阅自动指向它；
//    - historyLoaded 填 messages，面板打开即有历史。
const requestId = nextAgentHistoryRequestId(task.chatId);
dispatch(agentActions.historyLoading(task.sessionKey, task.chatId, requestId));
void clients.memmyAgent.readWebuiThread(task.sessionKey)
  .then((thread) => dispatch(agentActions.historyLoaded(thread, requestId)))
  .catch((error) => {
    if (error instanceof MemmyAgentRequestError && error.status === 404) {
      dispatch(agentActions.historyOpenMissing(task.sessionKey, task.chatId, requestId));
      return;
    }
    dispatch(agentActions.historyOpenFailed(task.chatId, requestId, createAgentOperationError({
      source: "history",
      message: error instanceof Error ? error.message : String(error),
      chatId: task.chatId
    })));
  });

// 2) 打开 app 页（apps_open 带 chatId → 复用该 chat 的 workspace，origin=chat）
void appsActions.openApp(connection, dispatch, {
  appId: task.appId,
  chatId: task.chatId,
  target: task.projectId ? { kind: "project", projectId: task.projectId } : { kind: "standalone" },
  openPanel: true
});
```

- 关键点：**不**用 `hydrateAgentThreadInBackground`。它不切换当前 chat，而 bridge 只维护一个 chat 订阅（`state.agent.currentChatId`），面板会收不到流式事件。这里复用 `openAgentTask` 的加载路径（只是不导航到 `/main`），同时解决「有历史」和「有实时订阅」。
- `openApp` 成功 dispatch `navigation/appPageOpened`，自动导航到 `/apps`。
- `readWebuiThread` 失败（例如 chat 已删除）只记录，不阻塞 app 打开；面板显示空历史。

**`app-actions.ts` / `apps-slice.ts`**

- `appsActions.openApp` input 增加 `openPanel?: boolean`。
- `AppPageTarget` 增加 `openPanel?: boolean`，只在 true 时写入。
- 新增 `appActions.consumeAppPageOpenPanel()` → `navigation/appPagePanelConsumed`：把 `appPage.openPanel` 清除（一次性意图）。
- `openAppPageFailed` 参数增加 `chatId?: string`、`openPanel?: boolean`；`AppPageError` 同字段。
- `writeStoredAppPageTarget` 写入时**剥掉 `openPanel`**：面板恢复是一次性导航意图，窗口 reload 后不自动重开。

**`AppPage`**

- 重置面板的 effect（依赖 `target?.view.viewId`）：

```ts
setPanelOpen(target?.openPanel === true);
setPanelChatId(null);
...
if (target?.openPanel) dispatch(appActions.consumeAppPageOpenPanel());
```

- 面板 chat：`panelChatIdForView = target?.origin === "chat" ? target.chatId ?? null : panelChatId`（已有）。从「最近」打开时 `origin: "chat"`，面板直接绑定该 chat。
- 因为已经 `historyLoading` 选中了 chat，bridge 订阅与消息历史都就绪；面板打开时 `AppChatPanel` 不需要 `onEnsureChat`（`chatId` 非空）也正常。
- 打开面板时现有 `resolvePanelChat` → `openPanelChat` 的 origin chat 分支仍用于 Ask Cuby 主动打开面板的场景（attach + ensureChatSubscription）。

**错误页与恢复的竞争**

- `AppPage` 的 sessionStorage 恢复 effect（target 为空时）增加 `if (pageError) return;` 守卫：打开失败后错误页必须稳定，不能被上一次成功 target 的自动恢复覆盖。
- 错误页重试时使用 `pageError.appId`、`pageError.target`、`pageError.chatId`、`pageError.openPanel`，保持「打开 app + 恢复面板」意图。
- 窗口 reload 后错误态不持久化，恢复的是上一次成功 target（既有行为），面板不自动重开。

### 5.5 面板行为

- 恢复的 chat 就是原 app chat；provenance / 消息展示不变。
- 关闭面板后，app 的 Ask Cuby 再次打开：origin chat 分支复用同一 chat。
- 发送消息仍带 `appContext`（已有），不需要改。

## 6. 错误与状态

| 场景 | 行为 |
| --- | --- |
| app 不存在 / 禁用 / 启动失败 | 现有 app 错误页 + 重试；重试保留 chatId / openPanel；错误页期间禁止 sessionStorage 自动恢复覆盖 |
| 工作区不可用 | `apps_open` 返回错误 → 错误页 + 重试 |
| chat 历史加载失败 | 不阻塞 app 打开；面板历史可能为空，仍可继续发消息（订阅随后建立） |
| chat 已被删除 | `readWebuiThread` 404 记录后忽略；`apps_open` 仍可打开 app；面板发送走现有错误提示 |
| 窗口 reload | 恢复上一次成功 target；`openPanel` 是一次性意图，不持久化，面板保持关闭 |

## 7. 安全

- 只使用本机已有的 `appId` / `chatId`，不新增网络面。
- app 页面仍走 sandbox iframe + bridge 白名单；不向 app 暴露 chat 内容。
- 「在 app 中打开」只对用户自己的会话生效。

## 8. 文件改动清单

Agent / 服务端：

- `App/memmy-agent/src/core/agent-runtime/loop.ts`：持久化 `webui_app_context`。
- `App/memmy-agent/src/core/session/manager.ts`：`sessionSummary` 推导 `appId` / `appName`。
- `App/memmy-agent/tests/...`：session summary / user message 持久化测试（沿用现有测试位置与风格）。

前端：

- `App/frontend/desktop/src/api/memmy-agent-client.ts`：`SessionSummarySchema`。
- `App/frontend/desktop/src/state/agent-chat-slice.ts`：`AgentTaskView`、`buildTaskView`。
- `App/frontend/desktop/src/state/apps-slice.ts`：`AppPageTarget.openPanel`、`AppPageError.chatId/openPanel`。
- `App/frontend/desktop/src/state/app-actions.ts`：`appsActions.openApp`、`openAppPageFailed`、`consumeAppPageOpenPanel`。
- `App/frontend/desktop/src/state/app-reducer.ts`：`navigation/appPageFailed` 透传字段、`navigation/appPagePanelConsumed`。
- `App/frontend/desktop/src/app/app-page-storage.ts`：写入时剥掉 `openPanel`（一次性意图）。
- `App/frontend/desktop/src/pages/app-frame.tsx`：`TaskRow` badge / 动作、`openTaskInApp` 接线。
- `App/frontend/desktop/src/pages/app-page.tsx`：`openPanel` 初始化、hydrate 兜底、错误重试参数。
- `App/frontend/desktop/src/i18n/messages.ts`：`appFrame.task.openInApp`（zh/en）。
- `App/frontend/desktop/src/styles.css`：badge 样式（若 Tailwind 不足）。

## 9. 测试

服务端：

- `appendUserMessage` 把 `webui_app_context` 写到 session 消息（含 name 可选）。
- `sessionSummary`：首条 user 消息带 `appId` 或 `webui_app_context` → summary 有 `appId`/`appName`；首条不带、后续才带 → 没有；普通会话 → 没有。

前端：

- `buildAgentTasksForState` 映射 `appId`/`appName`。
- `TaskRow`：有 `appId` 时渲染 badge 和「在 app 中打开」；无 `appId` 时不渲染。
- `openTaskInApp`：dispatch `historyLoading` 选中 chat，并调用 `openApp({ chatId, openPanel: true })`；历史加载失败不阻塞。
- `appsActions.openApp`：把 `chatId`、`openPanel` 写入 `AppPageTarget`；失败时写入错误态（含 chatId/openPanel）。
- `appReducer`：`navigation/appPagePanelConsumed` 清除 `openPanel`。
- `AppPage`：`openPanel: true` 的目标会自动打开面板并绑定 `chatId`，且消费一次；`pageError` 存在时不执行 sessionStorage 自动恢复（happy-dom / 现有 interaction 测试方式）。
- `app-page-storage`：持久化时剥掉 `openPanel`。
- i18n key 存在性。

## 10. 我的决定（builder 可自行处理）

- v1 只在 hover trail 放入口，不加右键菜单。
- 只按「第一条 user 消息」判定 app 来源。
- 「在 app 中打开」复用 `openAgentTask` 的历史加载路径（切换当前 chat），因此 bridge 的单 chat 订阅和面板历史自然成立；不引入多 chat 订阅，也不保留原有当前 chat。
- `openPanel` 是一次性导航意图，apply 后消费掉，且不写入 sessionStorage。
- 打开失败落现有 app 错误页（不回退聊天），重试保留意图；错误页期间禁止自动恢复抢占。
- 历史加载 best effort，不阻塞 app 打开。
- badge 名称优先 app 列表的 manifest 名称，其次持久化的 `appName`，最后 `appId`。

## 11. 已知限制

- 旧的面板会话（用户先发言、当时未持久化 app context）不会被标记。
- 一个 chat 只关联一个 app（第一条 user 消息）；跨 app 复用同一 chat 不支持。
- 点击「在 app 中打开」会把该 chat 设为当前 chat；回到 `/main` 时看到的就是它（与现有面板新建 chat 的行为一致）。
- `openPanel` 不持久化：窗口 reload 后面板保持关闭，chat 仍可从「最近」再次打开。
- 若 agent 客户端尚未就绪，动作直接不可用（按钮不渲染/不响应）。
