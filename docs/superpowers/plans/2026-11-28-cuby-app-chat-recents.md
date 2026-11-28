# Cuby App 对话「最近」入口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「最近」列表里给 app 来源的 chat 显示 app 标记，并提供「在 app 中打开」——跳到 app 整页并在右侧 Ask Cuby 面板恢复该 chat（含历史与实时订阅）。

**Architecture:** 服务端从会话第一条 user 消息推导 app 归属并写进 session summary；前端把它透传到 `AgentTaskView`，在 `TaskRow` 渲染 badge 和 hover 动作。动作复用 `openAgentTask` 的历史加载路径（同时让该 chat 成为 current chat，从而复用 bridge 的单 chat 订阅），再用 `apps_open` 带 `chatId` 打开 app 页，`openPanel` 作为一次性意图让 `AppPage` 自动打开面板。

**Tech Stack:** TypeScript、React 18、Vitest、Node.js（memmy-agent）、Electron desktop renderer。

**Spec:** `docs/superpowers/specs/2026-11-28-cuby-app-chat-recents-design.md`

## Global Constraints

- 工作目录是 worktree：`/home/skeeey/workspace/cuby/.claude/worktrees/feat+cuby-app-entry-points`（分支 `worktree-feat+cuby-app-entry-points`）。
- 桌面端命令在 `App/frontend/desktop` 下运行；agent 命令在 `App/memmy-agent` 下运行。
- UI 文案必须同时提供中文（zhCNMessages）和英文（enUSMessages）两份。
- 不改变「最近」点击打开聊天的行为。
- 所有新增 summary / task 字段必须可选（optional），不破坏旧数据。
- 每个 commit 消息结尾必须包含：`Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 单元测试直接跑 `npx vitest run <files>`，避免 `npm test` 的 prebuild。

## Review Focus

- 首条 user 消息只有 `appId`（没有 `webui_app_context.name`，旧 app 消息）时，badge 仍要显示（Task 1 / Task 3 / Task 5 的测试覆盖）。
- 之前成功打开过 app 后新的打开失败：错误页不能被 sessionStorage 旧 target 的自动恢复覆盖（Task 6 的守卫测试覆盖）。
- `openPanel` 若留在 sessionStorage，窗口 reload 会意外重开面板：写入时必须剥掉（Task 4 的存储测试覆盖）。
- 历史加载失败（404 / 网络错误）不能阻塞 app 打开（Task 5 的测试覆盖）。
- 有 app 归属但没有名称的旧会话：badge 必须回落到 `appId`，不能空白（Task 5 的名称解析测试覆盖）。

---

### Task 1: Agent 侧 app 归属（持久化 + session summary）

**Files:**
- Modify: `App/memmy-agent/src/apps/context.ts`
- Modify: `App/memmy-agent/src/integrations/channels/websocket.ts:3543-3558`
- Modify: `App/memmy-agent/src/core/agent-runtime/loop.ts:2737-2770`
- Modify: `App/memmy-agent/src/core/session/manager.ts:91-116`
- Test: `App/memmy-agent/tests/core/session/session-summary-app.test.ts`（新建）
- Test: `App/memmy-agent/tests/core/agent-runtime/loop-save-turn.test.ts`（追加用例）

**Interfaces:**
- Produces: `export type WebuiAppContext = { appId: string; name?: string }`
- Produces: `export function normalizeWebuiAppContext(value: unknown): WebuiAppContext | null`（`apps/context.ts`）
- Produces: session summary 可选字段 `appId?: string`、`appName?: string`

- [ ] **Step 1: 写失败测试 — summary 推导**

新建 `App/memmy-agent/tests/core/session/session-summary-app.test.ts`：

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../../../src/core/session/manager.js";

const roots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memmy-app-summary-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function webuiSession(key: string): { sessions: SessionManager; session: ReturnType<SessionManager["getOrCreate"]> } {
  const root = tempRoot();
  const sessions = new SessionManager(path.join(root, "sessions"));
  const session = sessions.getOrCreate(key);
  session.metadata.webui = true;
  session.metadata.webuiProjectId = null;
  session.metadata.webuiWorkspaceCwd = fs.realpathSync(root);
  return { sessions, session };
}

describe("session summary app origin", () => {
  it("exposes the app context of the first user message", () => {
    const { sessions, session } = webuiSession("websocket:chat-1");
    session.addMessage("user", "hi", {
      webui_app_context: { appId: "example-notes", name: "Example Notes" },
    });
    session.addMessage("assistant", "hello");

    expect(sessions.webuiSessionSummary(session)).toMatchObject({
      appId: "example-notes",
      appName: "Example Notes",
    });
  });

  it("recognizes an app-controlled first message without a context name", () => {
    const { sessions, session } = webuiSession("websocket:chat-2");
    session.addMessage("user", "hi", { app_source: "mcp-app", appId: "example-notes" });

    const summary = sessions.webuiSessionSummary(session);
    expect(summary.appId).toBe("example-notes");
    expect(summary.appName).toBeUndefined();
  });

  it("ignores app messages that do not start the chat", () => {
    const { sessions, session } = webuiSession("websocket:chat-3");
    session.addMessage("user", "normal question");
    session.addMessage("user", "from app", { app_source: "mcp-app", appId: "example-notes" });

    expect(sessions.webuiSessionSummary(session).appId).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd App/memmy-agent && npx vitest run tests/core/session/session-summary-app.test.ts`
Expected: FAIL — `summary.appId` 为 `undefined`（第一、二条用例）。

- [ ] **Step 3: 写失败测试 — 用户消息持久化 app context**

在 `App/memmy-agent/tests/core/agent-runtime/loop-save-turn.test.ts` 的 `describe("AgentLoop turn persistence", ...)` 内追加：

```ts
it("persists the app context of a panel message on the session message", () => {
  const loop = makeLoop();
  const session = new Session({ key: "websocket:app-context" });
  const msg = new InboundMessage({
    channel: "websocket",
    chatId: "app-context",
    senderId: "u",
    content: "hi",
    metadata: {
      webui_app_context: { appId: "example-notes", name: "Example Notes" },
    },
  });

  expect(loop.persistUserMessageEarly(msg, session)).toBe(true);
  expect(session.messages[0].webui_app_context).toEqual({
    appId: "example-notes",
    name: "Example Notes",
  });
});
```

- [ ] **Step 4: 跑测试确认失败**

Run: `cd App/memmy-agent && npx vitest run tests/core/agent-runtime/loop-save-turn.test.ts -t "persists the app context"`
Expected: FAIL — `webui_app_context` 为 `undefined`。

- [ ] **Step 5: 实现 helper 并接入 websocket 元数据写入**

在 `App/memmy-agent/src/apps/context.ts` 增加（保留现有 `appContextRuntimeLines` 不变）：

```ts
export type WebuiAppContext = { appId: string; name?: string };

export function normalizeWebuiAppContext(value: unknown): WebuiAppContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const appId = typeof (value as any).appId === "string" ? (value as any).appId.trim() : "";
  if (!appId) return null;
  const name = typeof (value as any).name === "string" ? (value as any).name.trim() : "";
  return { appId, ...(name ? { name } : {}) };
}
```

在 `App/memmy-agent/src/integrations/channels/websocket.ts` 的 `app_context` 分支改用：

```ts
const appContext = normalizeWebuiAppContext(envelope.app_context);
if (appContext) metadata.webui_app_context = appContext;
```

（替换原来 3548-3558 的内联对象构造；行为一致：trim appId、name 可选。）

- [ ] **Step 6: 实现 loop 持久化**

在 `App/memmy-agent/src/core/agent-runtime/loop.ts` 的 `appendUserMessage` 中，`metadataExtra` 的 `mcpSessionExtra(msg.metadata)` 之后加入：

```ts
...(normalizeWebuiAppContext(msg.metadata?.webui_app_context)
  ? { webui_app_context: normalizeWebuiAppContext(msg.metadata?.webui_app_context) }
  : {}),
```

（可在函数顶部先算 `const appContext = normalizeWebuiAppContext(msg.metadata?.webui_app_context);` 再展开，避免调用两次。需要 import。）

- [ ] **Step 7: 实现 summary 推导**

在 `App/memmy-agent/src/core/session/manager.ts` 的 `sessionSummary` 中，`summary` 对象构造之后加入：

```ts
const firstUser = visibleMessages.find((message) => message.role === "user") ?? visibleMessages[0] ?? null;
const appContext = firstUser?.webui_app_context;
const appId = typeof firstUser?.appId === "string" && firstUser.appId.trim()
  ? firstUser.appId.trim()
  : typeof appContext?.appId === "string" && appContext.appId.trim()
    ? appContext.appId.trim()
    : "";
const appName = typeof appContext?.name === "string" ? appContext.name.trim() : "";
if (appId) summary.appId = appId;
if (appName) summary.appName = appName;
```

- [ ] **Step 8: 跑测试确认通过**

Run: `cd App/memmy-agent && npx vitest run tests/core/session/session-summary-app.test.ts tests/core/agent-runtime/loop-save-turn.test.ts`
Expected: PASS。

- [ ] **Step 9: Commit**

```bash
git add App/memmy-agent/src/apps/context.ts App/memmy-agent/src/integrations/channels/websocket.ts App/memmy-agent/src/core/agent-runtime/loop.ts App/memmy-agent/src/core/session/manager.ts App/memmy-agent/tests/core/session/session-summary-app.test.ts App/memmy-agent/tests/core/agent-runtime/loop-save-turn.test.ts
git commit -m "feat(apps): expose app origin in session summaries

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: 前端会话类型 → AgentTaskView

**Files:**
- Modify: `App/frontend/desktop/src/api/memmy-agent-client.ts:319-329`
- Modify: `App/frontend/desktop/src/state/agent-chat-slice.ts:88-103, 1401-1495`
- Test: `App/frontend/desktop/src/state/tests/agent-chat-slice.test.ts`（追加用例）

**Interfaces:**
- Consumes: summary 可选 `appId` / `appName`（Task 1）
- Produces: `AgentTaskView` 可选字段 `appId?: string; appName?: string`

- [ ] **Step 1: 写失败测试**

在 `agent-chat-slice.test.ts` 中按现有 `sessionsLoaded` 用例风格追加：

```ts
it("maps app origin from session summaries onto tasks", () => {
  const state = agentReducer(initialAgentState, {
    type: "agent/sessionsLoaded",
    sessions: [
      {
        key: "websocket:chat-app",
        title: "Notes chat",
        preview: "hi",
        projectId: null,
        cwd: "/tmp",
        appId: "example-notes",
        appName: "Example Notes"
      }
    ]
  });

  expect(state.tasks).toContainEqual(expect.objectContaining({
    chatId: "chat-app",
    appId: "example-notes",
    appName: "Example Notes"
  }));
});
```

（沿用该文件已有的 `initialAgentState` 与原生 action 对象写法，不要引入新的 helper。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd App/frontend/desktop && npx vitest run src/state/tests/agent-chat-slice.test.ts -t "maps app origin"`
Expected: FAIL — task 上没有 `appId`。

- [ ] **Step 3: 实现**

- `SessionSummarySchema` 增加：

```ts
appId: z.string().optional(),
appName: z.string().optional(),
```

- `AgentTaskView` 增加：

```ts
appId?: string;
appName?: string;
```

- `buildAgentTasksForState` 的两处 `buildTaskView(...)` 调用（canonical rows 与 optimistic rows）中，canonical rows 追加参数 `session.appId`、`session.appName`；optimistic rows 不传。
- `buildTaskView` 签名末尾增加可选参数：

```ts
appId?: string,
appName?: string
```

并在返回对象中加入：

```ts
...(appId ? { appId } : {}),
...(appName ? { appName } : {}),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd App/frontend/desktop && npx vitest run src/state/tests/agent-chat-slice.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add App/frontend/desktop/src/api/memmy-agent-client.ts App/frontend/desktop/src/state/agent-chat-slice.ts App/frontend/desktop/src/state/tests/agent-chat-slice.test.ts
git commit -m "feat(apps): carry app origin onto sidebar tasks

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: TaskRow 的 app badge 与 hover 动作

**Files:**
- Modify: `App/frontend/desktop/src/pages/app-frame.tsx:2261-2340, 2332-2490`（`ProjectTreeSection` / `TaskRow`）
- Modify: `App/frontend/desktop/src/i18n/messages.ts`（`appFrame.task.openInApp`，zh + en）
- Modify: `App/frontend/desktop/src/styles.css`（badge 样式，放在 `.app-frame-task-row__title-row` 附近 10579 行）
- Test: `App/frontend/desktop/src/pages/tests/app-frame.test.tsx`（SSR badge 用例）
- Test: `App/frontend/desktop/src/pages/tests/app-frame-task-app.test.tsx`（新建，happy-dom hover/click）

**Interfaces:**
- Consumes: `task.appId` / `task.appName`（Task 2）
- Produces: `TaskRow` 新 props `appDisplayName?: string | null`、`onOpenInApp?: () => void`
- Produces: `ProjectTreeSection` 新 props `resolveAppDisplayName?: (task: AgentTaskView) => string | null`、`onOpenInApp?: (task: AgentTaskView) => void`

- [ ] **Step 1: 写 SSR 失败测试（badge）**

在 `app-frame.test.tsx` 追加：

```tsx
it("shows the app badge only for app-origin tasks", () => {
  const appTask = task("app-chat", { appId: "example-notes", appName: "Example Notes" });
  const html = renderToString(
    <I18nProvider language="zh-CN">
      <TaskRow
        task={appTask}
        appDisplayName="Example Notes"
        isCurrent={false}
        showPreview={false}
        onOpen={() => undefined}
        onContextMenu={() => undefined}
        onPin={() => undefined}
        archiveConfirming={false}
        onRequestArchive={() => undefined}
        onConfirmArchive={() => undefined}
        onUnarchive={() => undefined}
        onDeleteArchived={() => undefined}
        onOpenInApp={() => undefined}
      />
    </I18nProvider>
  );

  expect(html).toContain('data-app-id="example-notes"');
  expect(html).toContain("Example Notes");

  const plain = renderToString(
    <I18nProvider language="zh-CN">
      <TaskRow
        task={task("plain")}
        isCurrent={false}
        showPreview={false}
        onOpen={() => undefined}
        onContextMenu={() => undefined}
        onPin={() => undefined}
        archiveConfirming={false}
        onRequestArchive={() => undefined}
        onConfirmArchive={() => undefined}
        onUnarchive={() => undefined}
        onDeleteArchived={() => undefined}
      />
    </I18nProvider>
  );
  expect(plain).not.toContain("data-app-id");
});
```

（文件内已有 `task(chatId, overrides)` helper，直接传 `appId` / `appName`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd App/frontend/desktop && npx vitest run src/pages/tests/app-frame.test.tsx -t "app badge"`
Expected: FAIL — 没有 `data-app-id`。

- [ ] **Step 3: 写 happy-dom 失败测试（hover 动作）**

新建 `App/frontend/desktop/src/pages/tests/app-frame-task-app.test.tsx`：

```tsx
// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/i18n-provider.js";
import { TaskRow } from "../app-frame.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const task = {
  sessionKey: "websocket:chat-app",
  chatId: "chat-app",
  title: "Notes chat",
  preview: "",
  updatedAt: null,
  runStartedAt: null,
  completedUnseen: false,
  pinned: false,
  archived: false,
  tags: [],
  projectId: null,
  groupProjectId: null,
  cwd: "/tmp",
  missingProject: false,
  appId: "example-notes",
  appName: "Example Notes",
};

describe("TaskRow app action", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("opens the app from the hover action", async () => {
    const onOpenInApp = vi.fn();
    await act(async () => {
      root.render(
        <I18nProvider language="zh-CN">
          <TaskRow
            task={task}
            appDisplayName="Example Notes"
            isCurrent={false}
            showPreview={false}
            onOpen={() => undefined}
            onContextMenu={() => undefined}
            onPin={() => undefined}
            archiveConfirming={false}
            onRequestArchive={() => undefined}
            onConfirmArchive={() => undefined}
            onUnarchive={() => undefined}
            onDeleteArchived={() => undefined}
            onOpenInApp={onOpenInApp}
          />
        </I18nProvider>
      );
    });

    const row = container.querySelector(".app-frame-task-row");
    await act(async () => {
      row?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });

    const button = container.querySelector('[aria-label="在 app 中打开"]');
    expect(button).not.toBeNull();
    await act(async () => {
      (button as HTMLButtonElement).click();
    });
    expect(onOpenInApp).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 4: 跑测试确认失败**

Run: `cd App/frontend/desktop && npx vitest run src/pages/tests/app-frame-task-app.test.tsx`
Expected: FAIL — 找不到按钮。

- [ ] **Step 5: 实现 UI**

- i18n 两处（中文 140 行附近、英文对应分组）新增：

```ts
"appFrame.task.openInApp": "在 app 中打开",
"appFrame.task.openInApp": "Open in app",
```

- `TaskRow` props 增加 `appDisplayName?: string | null; onOpenInApp?: () => void;`
- 标题区域统一包一层 `app-frame-task-row__title-row`（三个分支都包），并在标题前插入：

```tsx
{props.task.appId && props.appDisplayName ? (
  <span className="app-frame-task-app-badge" title={props.appDisplayName} data-app-id={props.task.appId}>
    <AppWindow size={12} aria-hidden="true" />
    <span className="truncate">{props.appDisplayName}</span>
  </span>
) : null}
```

（`AppWindow` 从 `lucide-react` import；注意不要改变 IM 图标在标题前的既有顺序，测试会校验顺序。）
- hover trail 的 pin 按钮之前插入：

```tsx
{props.task.appId && props.onOpenInApp ? (
  <TaskIconButton label={t("appFrame.task.openInApp")} tooltip onClick={props.onOpenInApp}>
    <AppWindow size={14} />
  </TaskIconButton>
) : null}
```

- `ProjectTreeSection` props 增加 `resolveAppDisplayName?`、`onOpenInApp?`；在其 `renderTask` 的 `TaskRow` 上传：

```tsx
appDisplayName={props.resolveAppDisplayName?.(task) ?? null}
onOpenInApp={props.onOpenInApp ? () => props.onOpenInApp?.(task) : undefined}
```

- `styles.css` 在 `.app-frame-task-row__title-row` 之后新增：

```css
.app-frame-task-app-badge {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  max-width: 8rem;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--color-canvas-oat);
  color: color-mix(in srgb, var(--color-text-ink) 55%, transparent);
  font-size: 11px;
  line-height: 18px;
}

.app-frame-task-app-badge > span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd App/frontend/desktop && npx vitest run src/pages/tests/app-frame.test.tsx src/pages/tests/app-frame-task-app.test.tsx`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add App/frontend/desktop/src/pages/app-frame.tsx App/frontend/desktop/src/i18n/messages.ts App/frontend/desktop/src/styles.css App/frontend/desktop/src/pages/tests/app-frame.test.tsx App/frontend/desktop/src/pages/tests/app-frame-task-app.test.tsx
git commit -m "feat(apps): badge app-origin tasks and add open-in-app action

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: AppPageTarget / 错误态的 openPanel 与 chatId 管道

**Files:**
- Modify: `App/frontend/desktop/src/state/apps-slice.ts:21-34`
- Modify: `App/frontend/desktop/src/state/app-actions.ts:89-110, 168-186, 734-760`
- Modify: `App/frontend/desktop/src/state/app-reducer.ts:223-260`
- Modify: `App/frontend/desktop/src/app/app-page-storage.ts`
- Test: `App/frontend/desktop/src/state/tests/apps-slice.test.ts`（追加）
- Test: `App/frontend/desktop/src/app/tests/app-page-storage.test.ts`（追加）

**Interfaces:**
- Produces: `AppPageTarget.openPanel?: boolean`
- Produces: `AppPageError.chatId?: string`、`AppPageError.openPanel?: boolean`
- Produces: `appsActions.openApp(connection, dispatch, input: { appId; chatId?; target?; openPanel? })`
- Produces: `appActions.consumeAppPageOpenPanel(): AppAction`

- [ ] **Step 1: 写失败测试**

`apps-slice.test.ts` 追加：

```ts
it("carries chat and open-panel intent into the app page target", async () => {
  const opened = await appsActions.openApp(
    { openApp: async () => ({ bridge_chat_id: "chat-1", view }) },
    () => undefined,
    { appId: "demo", chatId: "chat-1", openPanel: true }
  );
  expect(opened).toMatchObject({
    origin: "chat",
    chatId: "chat-1",
    openPanel: true,
  });
});

it("keeps chat and panel intent on open failure", async () => {
  const actions: any[] = [];
  await appsActions.openApp(
    { openApp: async () => { throw new Error("boom"); } },
    (action) => actions.push(action),
    { appId: "demo", chatId: "chat-1", openPanel: true }
  );
  expect(actions.at(-1)).toMatchObject({
    type: "navigation/appPageFailed",
    chatId: "chat-1",
    openPanel: true,
  });
});

it("consumes the one-shot openPanel intent", () => {
  let state = createInitialAppState();
  state = appReducer(state, appActions.openAppPage({
    appId: "demo",
    bridgeChatId: "chat-1",
    origin: "chat",
    chatId: "chat-1",
    openPanel: true,
    view,
  }));
  state = appReducer(state, appActions.consumeAppPageOpenPanel());
  expect(state.navigation.appPage?.openPanel).toBeUndefined();
});
```

`app-page-storage.test.ts` 追加：

```ts
it("does not persist the one-shot openPanel intent", () => {
  const storage = memoryStorage();
  writeStoredAppPageTarget(storage, { ...target, openPanel: true });
  expect(readStoredAppPageTarget(storage)?.openPanel).toBeUndefined();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd App/frontend/desktop && npx vitest run src/state/tests/apps-slice.test.ts src/app/tests/app-page-storage.test.ts`
Expected: FAIL — 字段不存在 / action 不存在。

- [ ] **Step 3: 实现状态与动作**

- `apps-slice.ts`：

```ts
export interface AppPageTarget {
  appId: string;
  bridgeChatId: string;
  origin: AppPageOrigin;
  chatId?: string;
  target?: WebuiSessionTarget;
  openPanel?: boolean;
  view: AgentAppView;
}

export interface AppPageError {
  appId: string;
  target?: WebuiSessionTarget;
  chatId?: string;
  openPanel?: boolean;
  error: string;
}
```

- `app-actions.ts`：
  - `AppAction` union 增加 `| { type: "navigation/appPagePanelConsumed" }`
  - `appActions` 增加：

```ts
consumeAppPageOpenPanel(): AppAction {
  return { type: "navigation/appPagePanelConsumed" };
}
```

  - `openAppPageFailed` input 增加 `chatId?: string; openPanel?: boolean;`，返回值透传。
  - `appsActions.openApp` input 增加 `openPanel?: boolean`；构造 target 时：

```ts
...(input.openPanel ? { openPanel: true } : {}),
```

  失败时把 `chatId` / `openPanel` 一起传给 `openAppPageFailed`。
- `app-reducer.ts`：
  - `navigation/appPageFailed` 的 `appPageError` 增加：

```ts
...(action.chatId ? { chatId: action.chatId } : {}),
...(action.openPanel ? { openPanel: true } : {}),
```

  - 新增 case：

```ts
case "navigation/appPagePanelConsumed":
  return state.navigation.appPage
    ? {
        ...state,
        navigation: {
          ...state.navigation,
          appPage: { ...state.navigation.appPage, openPanel: undefined },
        },
      }
    : state;
```

- `app-page-storage.ts` 的 `writeStoredAppPageTarget`：

```ts
const { openPanel: _openPanel, ...persisted } = target;
storage.setItem(APP_PAGE_TARGET_STORAGE_KEY, JSON.stringify(persisted));
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd App/frontend/desktop && npx vitest run src/state/tests/apps-slice.test.ts src/app/tests/app-page-storage.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add App/frontend/desktop/src/state/apps-slice.ts App/frontend/desktop/src/state/app-actions.ts App/frontend/desktop/src/state/app-reducer.ts App/frontend/desktop/src/app/app-page-storage.ts App/frontend/desktop/src/state/tests/apps-slice.test.ts App/frontend/desktop/src/app/tests/app-page-storage.test.ts
git commit -m "feat(apps): carry chat and panel intent on app page navigation

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: open-in-app 领域模块（请求构造 / 历史加载 / 名称解析）

**Files:**
- Create: `App/frontend/desktop/src/pages/open-task-in-app.ts`
- Test: `App/frontend/desktop/src/pages/tests/open-task-in-app.test.ts`（新建）

**Interfaces:**
- Consumes: `AgentTaskView.appId/appName`（Task 2）
- Produces: `taskOpenInAppRequest(task): TaskOpenInAppRequest | null`，其中 `TaskOpenInAppRequest = { appId: string; chatId: string; target: WebuiSessionTarget; openPanel: true }`
- Produces: `loadTaskChatForPanel(client: Pick<MemmyAgentClient, "readWebuiThread"> | null, dispatch, task): void`
- Produces: `resolveTaskAppDisplayName(apps: Array<{ id: string; name: string }>, task): string | null`

- [ ] **Step 1: 写失败测试**

新建 `open-task-in-app.test.ts`：

```ts
import { describe, expect, it, vi } from "vitest";
import type { AgentTaskView } from "../../state/agent-chat-slice.js";
import {
  loadTaskChatForPanel,
  resolveTaskAppDisplayName,
  taskOpenInAppRequest,
} from "../open-task-in-app.js";

function task(overrides: Partial<AgentTaskView> = {}): AgentTaskView {
  return {
    sessionKey: "websocket:chat-1",
    chatId: "chat-1",
    title: "Notes",
    preview: "",
    updatedAt: null,
    runStartedAt: null,
    completedUnseen: false,
    pinned: false,
    archived: false,
    tags: [],
    projectId: null,
    groupProjectId: null,
    cwd: "/tmp",
    missingProject: false,
    ...overrides,
  };
}

describe("taskOpenInAppRequest", () => {
  it("returns null without an app", () => {
    expect(taskOpenInAppRequest(task())).toBeNull();
  });

  it("prefers the project workspace", () => {
    expect(taskOpenInAppRequest(task({ appId: "example-notes", projectId: "p1" }))).toEqual({
      appId: "example-notes",
      chatId: "chat-1",
      target: { kind: "project", projectId: "p1" },
      openPanel: true,
    });
  });

  it("falls back to standalone", () => {
    expect(taskOpenInAppRequest(task({ appId: "example-notes" }))).toMatchObject({
      target: { kind: "standalone" },
    });
  });
});

describe("resolveTaskAppDisplayName", () => {
  it("prefers the app list name over the persisted panel label", () => {
    expect(resolveTaskAppDisplayName(
      [{ id: "example-notes", name: "Example Notes" }],
      task({ appId: "example-notes", appName: "Notes panel title" })
    )).toBe("Example Notes");
  });

  it("falls back to the persisted label, then the app id", () => {
    expect(resolveTaskAppDisplayName([], task({ appId: "example-notes", appName: "Notes" }))).toBe("Notes");
    expect(resolveTaskAppDisplayName([], task({ appId: "example-notes" }))).toBe("example-notes");
    expect(resolveTaskAppDisplayName([], task())).toBeNull();
  });
});

describe("loadTaskChatForPanel", () => {
  it("selects and loads the chat for the panel", async () => {
    const dispatch = vi.fn();
    loadTaskChatForPanel(
      { readWebuiThread: async () => ({ sessionKey: "websocket:chat-1", messages: [] } as any) },
      dispatch,
      task()
    );

    expect(dispatch.mock.calls[0][0]).toMatchObject({ type: "agent/historyLoading", chatId: "chat-1" });
    const requestId = dispatch.mock.calls[0][0].requestId;
    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
        type: "agent/historyLoaded",
        requestId,
      }));
    });
  });

  it("records a missing chat without throwing", async () => {
    const dispatch = vi.fn();
    loadTaskChatForPanel(
      { readWebuiThread: async () => { throw new MemmyAgentRequestError("missing", 404); } },
      dispatch,
      task()
    );
    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "agent/historyOpenMissing" }));
    });
  });
});
```

（`MemmyAgentRequestError` 从 `../../api/memmy-agent-client.js` import；构造签名是 `(message, status, code?)`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd App/frontend/desktop && npx vitest run src/pages/tests/open-task-in-app.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现模块**

新建 `open-task-in-app.ts`，导出三个函数：

- `taskOpenInAppRequest(task)`：无 `task.appId` 返回 null；否则返回 `{ appId, chatId: task.chatId, target: task.projectId ? { kind: "project", projectId: task.projectId } : { kind: "standalone" }, openPanel: true }`。
- `resolveTaskAppDisplayName(apps, task)`：无 `task.appId` 返回 null；依次取 app 列表 `name` → `task.appName` → `task.appId`。
- `loadTaskChatForPanel(client, dispatch, task)`：
  - 客户端为空直接返回；
  - 生成 requestId（本地计数器，参考 `app-frame.tsx` 的 `nextAgentHistoryRequestId`）；
  - `dispatch(agentActions.historyLoading(task.sessionKey, task.chatId, requestId))`；
  - `readWebuiThread(task.sessionKey)` → `historyLoaded(thread, requestId)`；
  - `MemmyAgentRequestError` 且 `status === 404` → `historyOpenMissing`；
  - 其他错误 → `historyOpenFailed(chatId, requestId, createAgentOperationError({ source: "history", message, chatId }))`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd App/frontend/desktop && npx vitest run src/pages/tests/open-task-in-app.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add App/frontend/desktop/src/pages/open-task-in-app.ts App/frontend/desktop/src/pages/tests/open-task-in-app.test.ts
git commit -m "feat(apps): add open-task-in-app helpers

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: AppPage 应用/消费 openPanel + 错误恢复守卫

**Files:**
- Modify: `App/frontend/desktop/src/pages/app-page.tsx:27-124, 286-360`
- Test: `App/frontend/desktop/src/pages/tests/app-page-panel.test.ts`（新建）

**Interfaces:**
- Consumes: `AppPageTarget.openPanel`、`AppPageError.chatId/openPanel`、`appActions.consumeAppPageOpenPanel`（Task 4）
- Consumes: `loadTaskChatForPanel`（Task 5）
- Produces: `panelOpenForTarget(target: AppPageTarget | null): boolean`
- Produces: `canRestoreAppPageTarget(target: AppPageTarget | null, pageError: AppPageError | null): boolean`

- [ ] **Step 1: 写失败测试**

新建 `app-page-panel.test.ts`：

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AppPageTarget } from "../../state/apps-slice.js";
import { canRestoreAppPageTarget, panelOpenForTarget } from "../app-page.js";
import type { AppPageError } from "../../state/apps-slice.js";

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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd App/frontend/desktop && npx vitest run src/pages/tests/app-page-panel.test.ts`
Expected: FAIL — 导出不存在。

- [ ] **Step 3: 实现 AppPage**

- 导出两个纯函数（放在 `AppPageView` 附近）：

```ts
export function panelOpenForTarget(target: AppPageTarget | null): boolean {
  return target?.openPanel === true;
}

export function canRestoreAppPageTarget(target: AppPageTarget | null, pageError: AppPageError | null): boolean {
  return target == null && pageError == null;
}
```

（`AppPageError` 从 `../state/apps-slice.js` import 类型。）

- 重置 effect（**只在 `viewId` 变化时**运行；`consumeAppPageOpenPanel` 会改变 target 身份，不能让 effect 因它再次触发把面板关掉，所以沿用现有 deps + eslint disable）：

```ts
useEffect(() => {
  setPanelOpen(panelOpenForTarget(target));
  setPanelChatId(null);
  setPendingAppMessage(null);
  panelChatNeedsTargetRef.current = false;
  panelChatModelPresetRef.current = null;
  if (target?.openPanel) dispatch(appActions.consumeAppPageOpenPanel());
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [target?.view.viewId]);
```

- 恢复 effect 在 `if (target) { ... return; }` 之后加入：

```ts
if (!canRestoreAppPageTarget(target, pageError)) return;
```

并把 `pageError` 加入依赖。
- 错误页重试按钮：

```tsx
void appsActions.openApp(connection, dispatch, {
  appId: pageError.appId,
  ...(pageError.target ? { target: pageError.target } : {}),
  ...(pageError.chatId ? { chatId: pageError.chatId } : {}),
  ...(pageError.openPanel ? { openPanel: true } : {}),
});
```

若 `pageError.chatId` 存在也一并转发；重试前**不**额外调用 `loadTaskChatForPanel`（重试发生时该 chat 通常已是 current chat；窗口 reload 后的重试不在本计划范围）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd App/frontend/desktop && npx vitest run src/pages/tests/app-page-panel.test.ts src/pages/tests/app-page.test.tsx src/pages/tests/app-page-layout.test.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add App/frontend/desktop/src/pages/app-page.tsx App/frontend/desktop/src/pages/tests/app-page-panel.test.ts
git commit -m "feat(apps): apply one-shot panel intent on the app page

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: AppFrame 接线（openTaskInApp + 透传）

**Files:**
- Modify: `App/frontend/desktop/src/pages/app-frame.tsx`（`openTaskInApp`、3 个 `ProjectTreeSection` 调用点、`ProjectTreeSection` 透传——Task 3 已加 props）
- Test: `App/frontend/desktop/src/pages/tests/app-frame.test.tsx`（追加 source 级断言）

**Interfaces:**
- Consumes: `taskOpenInAppRequest` / `loadTaskChatForPanel` / `resolveTaskAppDisplayName`（Task 5）
- Consumes: `appsActions.openApp` 的 `chatId` / `openPanel`（Task 4）

- [ ] **Step 1: 写失败测试（接线断言）**

在 `app-frame.test.tsx` 追加：

```ts
it("wires open-in-app through the sidebar task sections", () => {
  const source = readFileSync(resolve(__dirname, "..", "app-frame.tsx"), "utf8");
  expect(source).toContain("function openTaskInApp(task: AgentTaskView)");
  expect(source).toContain("loadTaskChatForPanel(clients?.memmyAgent ?? null, dispatch, task)");
  expect(source).toContain("appsActions.openApp(connection, dispatch, request)");
  expect(source).toContain("onOpenInApp={openTaskInApp}");
  expect(source).toContain("resolveAppDisplayName={resolveTaskAppDisplayNameForTask}");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd App/frontend/desktop && npx vitest run src/pages/tests/app-frame.test.tsx -t "wires open-in-app"`
Expected: FAIL。

- [ ] **Step 3: 实现**

- import：`taskOpenInAppRequest, loadTaskChatForPanel, resolveTaskAppDisplayName` from `./open-task-in-app.js`。
- AppFrame 内（靠近 `openAgentTask`）：

```ts
const appItems = state.apps.items;
function resolveTaskAppDisplayNameForTask(task: AgentTaskView): string | null {
  return resolveTaskAppDisplayName(appItems, task);
}

function openTaskInApp(task: AgentTaskView): void {
  const request = taskOpenInAppRequest(task);
  const connection = agentRuntimeBridge?.connection;
  if (!request || !connection) return;
  loadTaskChatForPanel(clients?.memmyAgent ?? null, dispatch, task);
  void appsActions.openApp(connection, dispatch, request);
}
```

- 3 个 `<ProjectTreeSection ... />` 调用点都加：

```tsx
resolveAppDisplayName={resolveTaskAppDisplayNameForTask}
onOpenInApp={openTaskInApp}
```

（`ProjectTreeSection` 已在 Task 3 接受这两个 props。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd App/frontend/desktop && npx vitest run src/pages/tests/app-frame.test.tsx src/pages/tests/app-frame-task-app.test.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add App/frontend/desktop/src/pages/app-frame.tsx App/frontend/desktop/src/pages/tests/app-frame.test.tsx
git commit -m "feat(apps): open app pages from the recent task list

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: 全量验证

**Files:** 无新增；只运行验证命令。

- [ ] **Step 1: 桌面端 typecheck**

Run: `cd App/frontend/desktop && npm run typecheck`
Expected: exit 0。

- [ ] **Step 2: 桌面端全量测试**

Run: `cd App/frontend/desktop && npx vitest run`
Expected: 全部通过（此前基线为 209 files / 2000 tests；新增用例后数量增加）。

- [ ] **Step 3: 桌面端 lint（改动文件）**

Run: `cd App/frontend/desktop && npx eslint src/pages/app-frame.tsx src/pages/app-page.tsx src/pages/open-task-in-app.ts src/state/agent-chat-slice.ts src/state/app-actions.ts src/state/app-reducer.ts src/state/apps-slice.ts src/app/app-page-storage.ts src/pages/tests/app-frame-task-app.test.tsx src/pages/tests/open-task-in-app.test.ts src/pages/tests/app-page-panel.test.ts`
Expected: exit 0。

- [ ] **Step 4: Agent 侧相关测试**

Run: `cd App/memmy-agent && npx vitest run tests/core/session/session-summary-app.test.ts tests/core/agent-runtime/loop-save-turn.test.ts tests/integrations/channels/websocket-channel.test.ts tests/integrations/channels/websocket-integration.test.ts`
Expected: PASS。

- [ ] **Step 5: Agent typecheck**

Run: `cd App/memmy-agent && npm run typecheck`
Expected: exit 0。

- [ ] **Step 6: 手动冒烟（用户执行）**

```sh
cd /home/skeeey/workspace/cuby/.claude/worktrees/feat+cuby-app-entry-points
CUBY_DEV_APPS="$PWD/apps/example-notes" npm run dev:desktop
```

验证：左侧栏 Apps 打开 Example Notes → Ask Cuby 发一条消息 → 回到聊天/刷新 `最近` → 该 chat 有 app 标记 → hover 点「在 app 中打开」→ app 整页 + 右侧面板恢复该会话并继续流式对话。

- [ ] **Step 7: Commit（若验证过程有修正）**

```bash
git add -A
git commit -m "test(apps): verify app-origin recent task flow

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```
