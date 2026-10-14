# 工具页 MCP 分区 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 桌面端「连接与工具」页改为分区级显隐（渠道 / MCP / Composio），新增 MCP 分区（preset 安装器 + 开发者折叠组 + 自定义 server 表单），并把 agent 侧 preset 收敛为 4 个。

**Architecture:** 桌面端通过 `MemmyAgentClient` 直连 memmy-agent 的 `/api/settings/mcp-presets` 系列端点（bootstrap token 机制复用现有实现），凭据值走 `x-memmy-agent-mcp-values` 头；工具页把「整页 gate」换成「集成分区按云可用性显隐」；agent 侧删除 7 个 preset、保留 4 个并给 Figma/Firecrawl 打 `group: "dev"` 标记。

**Tech Stack:** React 19（函数组件，无外部状态库）、zod、vitest（SSR `renderToString` + `@vitest-environment happy-dom` 交互测试）；memmy-agent 侧 vitest。

**Spec:** `docs/superpowers/specs/2026-10-14-tools-page-mcp-design.md`

## Global Constraints

- 服务器错误信息原样透出（不翻译、不改写）；
- 新文案 zh（`zhCNMessages`）/ en（`enUSMessages`）双语同步添加，键名两处一致；
- 新中文文案不得包含「集成」二字（测试以 `not.toContain("集成")` 断言集成分区隐藏）；
- preset 删除只删 `MCP_PRESETS` 数组条目，不迁移、不清理用户已有的 `mcpServers` 配置；
- 值一律走 `x-memmy-agent-mcp-values` 头（JSON），不再使用 URL 查询参数携带凭据；
- 测试命令：agent 侧 `cd App/memmy-agent && npx vitest run <file>`；桌面侧 `cd App/frontend/desktop && npx vitest run <file>`。

## Review Focus

1. 凭据错误/服务连不通时安装"成功"（enable 只写配置、不验证连通）：管理弹窗必须有显眼的「测试连接」，且 `last_action` 的失败信息原样展示 → Task 3 交互测试（测试失败信息渲染）。
2. 本机缺运行时依赖（docker/uvx/npx）：状态是 `missing_dependency`，卡片显示「缺少依赖」而不是空白或崩溃 → Task 3 SSR 测试（状态映射）。
3. agent 未就绪（client 为 null / bootstrap 失败）：工具页其余分区照常渲染，MCP 分区显示 loading/错误态，不整页崩 → Task 3 交互测试（client=null 与拉取失败）+ Task 4 SSR 测试（cuberouter 渲染其它分区）。
4. 自定义表单值超 64KB 或含非法键：服务端 400、信息英文原文；弹窗内错误必须可见、不静默失败 → Task 2 测试（4xx 抛出原文）+ Task 3 交互测试（弹窗错误渲染）。
5. 用户粘贴带首尾空格的 token：服务端会 trim，客户端不做 trim、也不做多余校验（单一事实来源在服务端）→ Task 2 测试（值原样进 header）。

---

### Task 1: agent 侧 — preset 收敛为 4 个 + 开发者分组标记

**Files:**
- Modify: `App/memmy-agent/src/entrypoints/frontend-bridge/mcp-presets-api.ts`（`MCP_PRESETS` 数组 67-238、`presetPayload` 565-592、顶部常量区 52-59）
- Test: `App/memmy-agent/tests/entrypoints/frontend-bridge/mcp-presets-api.test.ts`

**Interfaces:**
- Consumes: 无（首个任务）
- Produces: `mcpPresetsPayload()` 的每个 preset 行新增 `group: "dev" | ""` 字段；`MCP_PRESETS` 只剩 `firecrawl / exa / brave-search / figma`（桌面端 Task 2 的 schema 与 Task 3 的折叠组依赖这两个事实）。

- [ ] **Step 1: 写失败测试**

在 `mcp-presets-api.test.ts` 的 `describe("mcp presets api", ...)` 内、`it("lists supported preset cards", ...)` 之后新增：

```ts
it("serves only the four office-facing presets and marks the developer pair", () => {
  useConfig();

  const payload = mcpPresetsPayload();
  const presets = payload.presets as Array<Record<string, any>>;

  expect(presets.map((preset) => preset.name)).toEqual(["firecrawl", "exa", "brave-search", "figma"]);
  expect(presets.find((preset) => preset.name === "figma")?.group).toBe("dev");
  expect(presets.find((preset) => preset.name === "firecrawl")?.group).toBe("dev");
  expect(presets.find((preset) => preset.name === "exa")?.group).toBe("");
  expect(presets.find((preset) => preset.name === "brave-search")?.group).toBe("");
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd App/memmy-agent && npx vitest run tests/entrypoints/frontend-bridge/mcp-presets-api.test.ts -t "office-facing"`
Expected: FAIL —— 列表含 11 个名称，且没有 `group` 字段。

- [ ] **Step 3: 实现**

在 `mcp-presets-api.ts` 的 `DEFAULT_CUSTOM_TIMEOUT`（58 行）附近新增：

```ts
/** Presets that target developers; the desktop UI folds them into a collapsed group. */
export const DEV_PRESET_NAMES = new Set(["figma", "firecrawl"]);
```

在 `presetPayload`（565 行）返回对象里，`category: preset.category,` 之后加一行：

```ts
    group: DEV_PRESET_NAMES.has(preset.name) ? "dev" : "",
```

从 `MCP_PRESETS` 数组（67-238 行）中整块删除这 7 个 `new McpPreset(...)` 条目：`browserbase`、`context7`、`microsoft-learn`、`aws-docs`、`postman`、`github`、`supabase`。删完数组只剩 `firecrawl`、`exa`、`brave-search`、`figma`，顺序不变。

- [ ] **Step 4: 运行确认通过**

Run: `cd App/memmy-agent && npx vitest run tests/entrypoints/frontend-bridge/mcp-presets-api.test.ts -t "office-facing"`
Expected: PASS

- [ ] **Step 5: 修复被删除 preset 影响的既有测试**

先跑全文件看失败清单：`cd App/memmy-agent && npx vitest run tests/entrypoints/frontend-bridge/mcp-presets-api.test.ts`

按以下映射逐条修改（被删的 preset 不能再出现在任何测试里）：

| 原引用 | 处理 |
|---|---|
| `it("lists supported preset cards")` | 期望名单改为 `["firecrawl", "exa", "brave-search", "figma"]`；正文里对 `browserbase` 的抽查改为 `brave-search`（`installed` false、`install_supported` true、`required_fields[0].configured` false、`connection_summary` 不含密钥、`manifest` 的 `id` 换为 `brave-search`） |
| `it("enables browserbase and scrubs the returned payload")` | 改为 `brave-search`：`mcpPresetsAction("enable", { name: ["brave-search"], brave_api_key: ["BSA_test"] })`；断言 `loadConfig().tools.mcpServers["brave-search"].env.BRAVE_API_KEY === "BSA_test"`、`JSON.stringify(payload)` 不含 `"BSA_test"` |
| `it("preserves current image catalog ...")`、`it("preserves session DAG ...")`、`it("reuses existing preset credentials ...")`、`it("requires missing preset secrets")` 中用到 `browserbase`/`browserbase_api_key` 的地方 | 一律替换为 `brave-search`/`brave_api_key`（值为 `BSA_test`），断言形态不变 |
| `it("appends the optional context7 API key arg")` | 整条删除（保留列表里没有带可选字段的 preset） |
| `it("writes nanobot-aligned builtin server configs for GitHub, Figma, Brave, Postman, and Supabase")` | 重命名为 `it("writes builtin server configs for Figma and Brave")`，只保留 Figma（streamableHttp → `http://127.0.0.1:3845/mcp`）与 Brave（stdio → `npx -y @brave/brave-search-mcp-server@latest --transport stdio` + env `BRAVE_API_KEY`）两组断言，删除 GitHub/Postman/Supabase/`docker` 相关断言 |
| `it("does not enable unlisted OAuth placeholders")` | 若用例依赖被删 preset（github/context7），改为对 `exa`（无字段、免 key）断言：enable 后配置写入 `url: "https://mcp.exa.ai/mcp"`、不出现任何密钥字段 |
| `it("normalizes known preset mentions only")` | 已知名单更新为保留的 4 个；被删 preset 的 mention 仍应被丢弃（保留一个 `github` 作为"已删预设被丢弃"的负例） |

文件顶部 `oldPresetEnv`（21-27 行）删除 `GITHUB_PERSONAL_ACCESS_TOKEN`、`POSTMAN_API_KEY`、`SUPABASE_ACCESS_TOKEN` 三项，保留 `FIRECRAWL_API_KEY`、`BRAVE_API_KEY`。

其余用例（`firecrawl`、`exa`、hyphenated names、custom/import/mention 相关）不受影响，保持不动。

- [ ] **Step 6: 全文件运行**

Run: `cd App/memmy-agent && npx vitest run tests/entrypoints/frontend-bridge/mcp-presets-api.test.ts`
Expected: PASS（全部）

- [ ] **Step 7: Commit**

```bash
git add App/memmy-agent/src/entrypoints/frontend-bridge/mcp-presets-api.ts App/memmy-agent/tests/entrypoints/frontend-bridge/mcp-presets-api.test.ts
git commit -m "feat(mcp): trim presets to the office-facing four and mark the dev pair

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: 桌面端 client — MemmyAgentClient 增加 mcp-presets 方法

**Files:**
- Modify: `App/frontend/desktop/src/api/memmy-agent-client.ts`（schema 区 ~212、接口 `MemmyAgentClient` ~708、类 `HttpMemmyAgentClient` ~1015、`getSettings` ~1061）
- Test: `App/frontend/desktop/src/api/tests/memmy-agent-client.test.ts`

**Interfaces:**
- Consumes: Task 1 的 payload 形状（`presets[].group`、`last_action`）。
- Produces（Task 3/4 依赖的精确签名）：
  - `McpPresetField` / `McpPresetPayload` / `McpPresetsPayload` 类型
  - `McpCustomServerInput` 接口
  - `MemmyAgentClient` 新增 5 个方法：`listMcpPresets()`、`enableMcpPreset(name, values?)`、`removeMcpServer(name)`、`testMcpServer(name)`、`addCustomMcpServer(input)`，均返回 `Promise<McpPresetsPayload>`

- [ ] **Step 1: 写失败测试**

在 `memmy-agent-client.test.ts` 末尾（最后一个 `describe` 内）追加：

```ts
describe("mcp presets", () => {
  const emptyPayload = { presets: [], installed_count: 0 };

  it("lists MCP presets from the agent settings surface", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/webui/bootstrap") return json(bootstrap);
      expect(url.pathname).toBe("/api/settings/mcp-presets");
      return json(emptyPayload);
    });
    const client = createMemmyAgentClient({ baseUrl: "http://127.0.0.1:18980", fetchFn: fetchMock as typeof fetch });

    await expect(client.listMcpPresets()).resolves.toEqual(emptyPayload);
  });

  it("enables a preset through the values header and forwards values verbatim", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/webui/bootstrap") return json(bootstrap);
      expect(url.pathname).toBe("/api/settings/mcp-presets/enable");
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("x-memmy-agent-mcp-values")).toBe(
        JSON.stringify({ name: "brave-search", brave_api_key: " BSA_test " })
      );
      return json({ presets: [], installed_count: 1 });
    });
    const client = createMemmyAgentClient({ baseUrl: "http://127.0.0.1:18980", fetchFn: fetchMock as typeof fetch });

    await expect(client.enableMcpPreset("brave-search", { brave_api_key: " BSA_test " })).resolves.toEqual({
      presets: [],
      installed_count: 1
    });
  });

  it("posts a custom MCP server with its structured fields intact", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/webui/bootstrap") return json(bootstrap);
      expect(url.pathname).toBe("/api/settings/mcp-presets/custom");
      const headers = new Headers(init?.headers);
      expect(JSON.parse(String(headers.get("x-memmy-agent-mcp-values")))).toEqual({
        name: "my-server",
        transport: "stdio",
        command: "npx",
        args: ["-y", "my-server"]
      });
      return json(emptyPayload);
    });
    const client = createMemmyAgentClient({ baseUrl: "http://127.0.0.1:18980", fetchFn: fetchMock as typeof fetch });

    await expect(
      client.addCustomMcpServer({ name: "my-server", transport: "stdio", command: "npx", args: ["-y", "my-server"] })
    ).resolves.toEqual(emptyPayload);
  });

  it.each([
    ["removeMcpServer", "/api/settings/mcp-presets/remove"],
    ["testMcpServer", "/api/settings/mcp-presets/test"]
  ] as const)("%s posts the server name to %s", async (method, path) => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/webui/bootstrap") return json(bootstrap);
      expect(url.pathname).toBe(path);
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(JSON.parse(String(headers.get("x-memmy-agent-mcp-values")))).toEqual({ name: "exa" });
      return json(emptyPayload);
    });
    const client = createMemmyAgentClient({ baseUrl: "http://127.0.0.1:18980", fetchFn: fetchMock as typeof fetch });

    await expect(client[method]("exa")).resolves.toEqual(emptyPayload);
  });

  it("surfaces the agent error message verbatim when an action is rejected", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/webui/bootstrap") return json(bootstrap);
      return new Response("MCP settings payload is too large", { status: 400 });
    });
    const client = createMemmyAgentClient({ baseUrl: "http://127.0.0.1:18980", fetchFn: fetchMock as typeof fetch });

    await expect(client.enableMcpPreset("exa")).rejects.toMatchObject({
      message: "MCP settings payload is too large",
      status: 400
    });
  });
});
```

注：`json(...)` 与 `bootstrap` 是该文件已有的工具函数/常量，直接复用。

- [ ] **Step 2: 运行确认失败**

Run: `cd App/frontend/desktop && npx vitest run src/api/tests/memmy-agent-client.test.ts -t "mcp presets"`
Expected: FAIL —— `client.listMcpPresets is not a function`（TypeScript 未编译前先看 vitest 运行时报错）。

- [ ] **Step 3: 实现 schema 与类型**

在 `memmy-agent-client.ts` 的 `AgentSettingsSchema`（212 行）附近新增：

```ts
const MCP_VALUES_HEADER = "x-memmy-agent-mcp-values";

export const McpPresetFieldSchema = z.object({
  name: z.string(),
  label: z.string(),
  secret: z.boolean().optional(),
  required: z.boolean().optional(),
  env_var: z.string().nullable().optional(),
  placeholder: z.string().optional(),
  configured: z.boolean().optional()
});

export const McpPresetSchema = z
  .object({
    name: z.string(),
    display_name: z.string(),
    category: z.string().optional(),
    description: z.string().optional(),
    docs_url: z.string().optional(),
    transport: z.string().optional(),
    install_supported: z.boolean().optional(),
    installed: z.boolean(),
    configured: z.boolean().optional(),
    available: z.boolean().optional(),
    status: z.string(),
    logo_url: z.string().nullable().optional(),
    brand_color: z.string().optional(),
    requires: z.string().optional(),
    note: z.string().optional(),
    group: z.string().optional(),
    required_fields: z.array(McpPresetFieldSchema).default([]),
    connection_summary: z.string().optional(),
    enabled_tools: z.array(z.string()).optional(),
    source: z.string(),
    custom: z.boolean().optional(),
    tool_names: z.array(z.string()).optional()
  })
  .passthrough();

export const McpPresetsPayloadSchema = z
  .object({
    presets: z.array(McpPresetSchema),
    installed_count: z.number().optional(),
    requires_restart: z.boolean().optional(),
    last_action: z
      .object({
        ok: z.boolean().optional(),
        message: z.string().optional(),
        error: z.string().optional(),
        tool_count: z.number().optional(),
        tool_names: z.array(z.string()).optional(),
        checked_at: z.string().optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough();

export type McpPresetField = z.infer<typeof McpPresetFieldSchema>;
export type McpPresetPayload = z.infer<typeof McpPresetSchema>;
export type McpPresetsPayload = z.infer<typeof McpPresetsPayloadSchema>;

export interface McpCustomServerInput {
  name: string;
  transport: "stdio" | "sse" | "streamableHttp";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  tool_timeout?: number;
}
```

在 `export interface MemmyAgentClient`（708 行）里、`getSettings(): Promise<MemmyAgentSettings>;` 之后新增：

```ts
  listMcpPresets(): Promise<McpPresetsPayload>;
  enableMcpPreset(name: string, values?: Record<string, string>): Promise<McpPresetsPayload>;
  removeMcpServer(name: string): Promise<McpPresetsPayload>;
  testMcpServer(name: string): Promise<McpPresetsPayload>;
  addCustomMcpServer(input: McpCustomServerInput): Promise<McpPresetsPayload>;
```

- [ ] **Step 4: 实现类方法**

在 `HttpMemmyAgentClient` 的 `getSettings()`（1061 行附近）之后新增：

```ts
  async listMcpPresets(): Promise<McpPresetsPayload> {
    return this.request("/api/settings/mcp-presets", McpPresetsPayloadSchema);
  }

  async enableMcpPreset(name: string, values: Record<string, string> = {}): Promise<McpPresetsPayload> {
    return this.request("/api/settings/mcp-presets/enable", McpPresetsPayloadSchema, {
      method: "POST",
      headers: { [MCP_VALUES_HEADER]: JSON.stringify({ name, ...values }) }
    });
  }

  async removeMcpServer(name: string): Promise<McpPresetsPayload> {
    return this.request("/api/settings/mcp-presets/remove", McpPresetsPayloadSchema, {
      method: "POST",
      headers: { [MCP_VALUES_HEADER]: JSON.stringify({ name }) }
    });
  }

  async testMcpServer(name: string): Promise<McpPresetsPayload> {
    return this.request("/api/settings/mcp-presets/test", McpPresetsPayloadSchema, {
      method: "POST",
      headers: { [MCP_VALUES_HEADER]: JSON.stringify({ name }) }
    });
  }

  async addCustomMcpServer(input: McpCustomServerInput): Promise<McpPresetsPayload> {
    return this.request("/api/settings/mcp-presets/custom", McpPresetsPayloadSchema, {
      method: "POST",
      headers: { [MCP_VALUES_HEADER]: JSON.stringify(input) }
    });
  }
```

- [ ] **Step 5: 运行确认通过 + 类型检查**

Run: `cd App/frontend/desktop && npx vitest run src/api/tests/memmy-agent-client.test.ts -t "mcp presets"`
Expected: PASS

Run: `cd App/frontend/desktop && npx tsc -p tsconfig.json --noEmit`
Expected: 无输出（通过）

- [ ] **Step 6: Commit**

```bash
git add App/frontend/desktop/src/api/memmy-agent-client.ts App/frontend/desktop/src/api/tests/memmy-agent-client.test.ts
git commit -m "feat(desktop): add mcp-presets methods to the agent client

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: MCP 分区组件（卡片 + 折叠组 + 三个弹窗）

**Files:**
- Create: `App/frontend/desktop/src/components/mcp-tools-section.tsx`
- Create: `App/frontend/desktop/src/components/mcp-server-modal.tsx`
- Modify: `App/frontend/desktop/src/i18n/messages.ts`（zh 段 ~752 后、en 段 ~2520 后）
- Test: `App/frontend/desktop/src/components/tests/mcp-tools-section.test.tsx`（SSR）
- Test: `App/frontend/desktop/src/components/tests/mcp-tools-section.interaction.test.tsx`（happy-dom）

**Interfaces:**
- Consumes: Task 2 的 `McpPresetsPayload` / `McpPresetPayload` / `McpCustomServerInput` / 5 个方法。
- Produces（Task 4 依赖的精确接口）：
  - `export type McpPresetsClient = Pick<MemmyAgentClient, "listMcpPresets" | "enableMcpPreset" | "removeMcpServer" | "testMcpServer" | "addCustomMcpServer">;`
  - `export function McpToolsSection(props: { client: McpPresetsClient | null })`（容器，自管状态）
  - `export function McpToolsSectionView(props: McpToolsSectionViewProps)`（纯视图，测试入口）
  - `export function mcpStatusKey(status: string): MessageKey`
  - `export type McpSectionModal`

- [ ] **Step 1: 加 i18n 文案（两段都要）**

在 `messages.ts` 的 `zhCNMessages` 中 `"tools.search": "搜索技能...",`（757 行）之后插入：

```ts
  "tools.mcp.title": "MCP 服务器",
  "tools.mcp.devGroup": "开发者工具",
  "tools.mcp.customAdd": "添加自定义服务器",
  "tools.mcp.loadFailed": "MCP 服务器列表加载失败。",
  "tools.mcp.status.notInstalled": "未安装",
  "tools.mcp.status.configured": "已配置",
  "tools.mcp.status.missingCredentials": "缺少凭据",
  "tools.mcp.status.missingDependency": "缺少依赖",
  "tools.mcp.status.comingSoon": "即将支持",
  "tools.mcp.modal.installTitle": "安装 {name}",
  "tools.mcp.modal.manageTitle": "管理 {name}",
  "tools.mcp.modal.install": "安装",
  "tools.mcp.modal.test": "测试连接",
  "tools.mcp.modal.remove": "移除",
  "tools.mcp.modal.requirements": "运行要求：{requirements}",
  "tools.mcp.custom.title": "添加自定义 MCP 服务器",
  "tools.mcp.custom.name": "名称",
  "tools.mcp.custom.transport": "传输方式",
  "tools.mcp.custom.command": "命令",
  "tools.mcp.custom.args": "参数（每行一个）",
  "tools.mcp.custom.env": "环境变量（KEY=VALUE，每行一个）",
  "tools.mcp.custom.cwd": "工作目录（可选）",
  "tools.mcp.custom.url": "URL",
  "tools.mcp.custom.headers": "请求头（KEY=VALUE，每行一个）",
  "tools.mcp.custom.timeout": "超时（秒）",
  "tools.mcp.custom.save": "保存",
  "tools.mcp.custom.nameInvalid": "请填写合法的服务器名称（小写字母、数字、-、_）。",
  "tools.mcp.custom.commandRequired": "stdio 传输需要填写命令。",
  "tools.mcp.custom.urlRequired": "远程传输需要填写 URL。",
```

在 `enUSMessages` 中 `"tools.search": "Search skills...",`（2525 行）之后插入同键名英文：

```ts
  "tools.mcp.title": "MCP servers",
  "tools.mcp.devGroup": "Developer tools",
  "tools.mcp.customAdd": "Add custom server",
  "tools.mcp.loadFailed": "Could not load MCP servers.",
  "tools.mcp.status.notInstalled": "Not installed",
  "tools.mcp.status.configured": "Configured",
  "tools.mcp.status.missingCredentials": "Missing credentials",
  "tools.mcp.status.missingDependency": "Missing dependency",
  "tools.mcp.status.comingSoon": "Coming soon",
  "tools.mcp.modal.installTitle": "Install {name}",
  "tools.mcp.modal.manageTitle": "Manage {name}",
  "tools.mcp.modal.install": "Install",
  "tools.mcp.modal.test": "Test connection",
  "tools.mcp.modal.remove": "Remove",
  "tools.mcp.modal.requirements": "Requirements: {requirements}",
  "tools.mcp.custom.title": "Add a custom MCP server",
  "tools.mcp.custom.name": "Name",
  "tools.mcp.custom.transport": "Transport",
  "tools.mcp.custom.command": "Command",
  "tools.mcp.custom.args": "Arguments (one per line)",
  "tools.mcp.custom.env": "Environment (KEY=VALUE, one per line)",
  "tools.mcp.custom.cwd": "Working directory (optional)",
  "tools.mcp.custom.url": "URL",
  "tools.mcp.custom.headers": "Headers (KEY=VALUE, one per line)",
  "tools.mcp.custom.timeout": "Timeout (seconds)",
  "tools.mcp.custom.save": "Save",
  "tools.mcp.custom.nameInvalid": "Enter a valid server name (lowercase letters, digits, -, _).",
  "tools.mcp.custom.commandRequired": "stdio transport requires a command.",
  "tools.mcp.custom.urlRequired": "Remote transport requires a URL.",
```

- [ ] **Step 2: 写 SSR 测试（先失败）**

`App/frontend/desktop/src/components/tests/mcp-tools-section.test.tsx`：

```tsx
/** MCP tools section tests. */
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../i18n/i18n-provider.js";
import { McpToolsSectionView, mcpStatusKey, type McpToolsSectionViewProps } from "../mcp-tools-section.js";
import type { McpPresetPayload } from "../../api/memmy-agent-client.js";

function preset(overrides: Partial<McpPresetPayload> & Pick<McpPresetPayload, "name" | "display_name" | "status">): McpPresetPayload {
  return {
    installed: overrides.status === "configured",
    source: "preset",
    required_fields: [],
    ...overrides
  } as McpPresetPayload;
}

const noop = () => undefined;

function renderView(overrides: Partial<McpToolsSectionViewProps> = {}): string {
  return renderToString(
    <I18nProvider language="en-US">
      <McpToolsSectionView
        status="ready"
        presets={[
          preset({ name: "exa", display_name: "Exa", status: "not_installed" }),
          preset({ name: "brave-search", display_name: "Brave Search", status: "configured" }),
          preset({ name: "docker-thing", display_name: "Docker Thing", status: "missing_dependency" }),
          preset({ name: "figma", display_name: "Figma", status: "not_installed", group: "dev" })
        ]}
        modal={{ kind: "closed" }}
        busy={false}
        modalError=""
        testResult={null}
        onOpenInstall={noop}
        onOpenManage={noop}
        onOpenCustom={noop}
        onCloseModal={noop}
        onSubmitInstall={noop}
        onTestServer={noop}
        onRemoveServer={noop}
        onSubmitCustom={noop}
        {...overrides}
      />
    </I18nProvider>
  );
}

describe("McpToolsSectionView", () => {
  it("renders the general presets with status labels", () => {
    const html = renderView();

    expect(html).toContain("MCP servers");
    expect(html).toContain("Exa");
    expect(html).toContain("Brave Search");
    expect(html).toContain("Configured");
    expect(html).toContain("Not installed");
    expect(html).toContain("Missing dependency");
  });

  it("folds the developer presets behind a collapsed group", () => {
    const html = renderView();

    expect(html).toContain("Developer tools");
    expect(html).not.toContain("Figma");
  });

  it("shows the load failure message instead of the grid", () => {
    const html = renderView({ status: "error", message: "boom" });

    expect(html).toContain("boom");
    expect(html).not.toContain("Brave Search");
  });

  it("renders the install modal with declared fields", () => {
    const html = renderView({
      modal: {
        kind: "install",
        preset: preset({
          name: "brave-search",
          display_name: "Brave Search",
          status: "not_installed",
          requires: "Node.js, npx, and Brave Search API key",
          required_fields: [{ name: "brave_api_key", label: "Brave Search API key", secret: true, required: true, configured: false }]
        })
      }
    });

    expect(html).toContain("Install Brave Search");
    expect(html).toContain("Brave Search API key");
    expect(html).toContain("Requirements: Node.js, npx, and Brave Search API key");
  });

  it("renders the manage modal with test, remove, and the last action", () => {
    const html = renderView({
      modal: { kind: "manage", preset: preset({ name: "exa", display_name: "Exa", status: "configured" }) },
      testResult: { ok: true, message: "Exa connected with 3 tools.", tool_names: ["a", "b", "c"] }
    });

    expect(html).toContain("Manage Exa");
    expect(html).toContain("Test connection");
    expect(html).toContain("Remove");
    expect(html).toContain("Exa connected with 3 tools.");
  });

  it("maps every server status to its label key", () => {
    expect(mcpStatusKey("not_installed")).toBe("tools.mcp.status.notInstalled");
    expect(mcpStatusKey("configured")).toBe("tools.mcp.status.configured");
    expect(mcpStatusKey("missing_credentials")).toBe("tools.mcp.status.missingCredentials");
    expect(mcpStatusKey("missing_dependency")).toBe("tools.mcp.status.missingDependency");
    expect(mcpStatusKey("coming_soon")).toBe("tools.mcp.status.comingSoon");
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `cd App/frontend/desktop && npx vitest run src/components/tests/mcp-tools-section.test.tsx`
Expected: FAIL —— 模块 `../mcp-tools-section.js` 不存在。

- [ ] **Step 4: 实现 `mcp-tools-section.tsx`**

```tsx
/** MCP tools section module. */
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Plus, Server } from "lucide-react";
import type {
  McpCustomServerInput,
  McpPresetPayload,
  McpPresetsPayload,
  MemmyAgentClient
} from "../api/memmy-agent-client.js";
import type { MessageKey } from "../i18n/messages.js";
import { useTranslation } from "../i18n/use-translation.js";
import { McpCustomServerModal, McpServerModal } from "./mcp-server-modal.js";

export type McpPresetsClient = Pick<
  MemmyAgentClient,
  "listMcpPresets" | "enableMcpPreset" | "removeMcpServer" | "testMcpServer" | "addCustomMcpServer"
>;

export type McpSectionModal =
  | { kind: "closed" }
  | { kind: "install"; preset: McpPresetPayload }
  | { kind: "manage"; preset: McpPresetPayload }
  | { kind: "custom" };

export interface McpToolsSectionViewProps {
  status: "loading" | "ready" | "error";
  message?: string;
  presets: McpPresetPayload[];
  modal: McpSectionModal;
  busy: boolean;
  modalError: string;
  testResult: McpPresetsPayload["last_action"] | null;
  onOpenInstall: (preset: McpPresetPayload) => void;
  onOpenManage: (preset: McpPresetPayload) => void;
  onOpenCustom: () => void;
  onCloseModal: () => void;
  onSubmitInstall: (values: Record<string, string>) => void;
  onTestServer: (name: string) => void;
  onRemoveServer: (name: string) => void;
  onSubmitCustom: (input: McpCustomServerInput) => void;
}

/** Handles mcp tools section view. */
export function McpToolsSectionView(props: McpToolsSectionViewProps) {
  const { t } = useTranslation();
  const [devOpen, setDevOpen] = useState(false);
  const general = props.presets.filter((preset) => preset.group !== "dev");
  const dev = props.presets.filter((preset) => preset.group === "dev");

  return (
    <section className="mb-8">
      <div className="mb-4 flex items-center justify-between gap-2.5">
        <span className="text-base font-semibold text-text-ink">{t("tools.mcp.title")}</span>
        <button
          type="button"
          onClick={props.onOpenCustom}
          className="flex items-center gap-1.5 rounded-btn border border-content-panel bg-background-paper px-3 py-1.5 text-xs text-text-ink/65 transition-colors hover:bg-canvas-oat/40"
        >
          <Plus size={13} />
          {t("tools.mcp.customAdd")}
        </button>
      </div>

      {props.status === "loading" && <p className="text-sm text-text-ink/55">{t("common.loading")}</p>}
      {props.status === "error" && (
        <p className="rounded-card border-content-panel bg-background-paper p-4 text-sm text-text-ink/55">
          {props.message || t("tools.mcp.loadFailed")}
        </p>
      )}
      {props.status === "ready" && (
        <>
          <div className="tools-icon-grid">
            {general.map((preset) => (
              <McpServerCard
                key={preset.name}
                preset={preset}
                onOpen={preset.installed ? props.onOpenManage : props.onOpenInstall}
              />
            ))}
          </div>
          {dev.length > 0 && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setDevOpen((open) => !open)}
                className="flex items-center gap-1.5 text-xs text-text-ink/55 transition-colors hover:text-text-ink"
              >
                <ChevronDown size={13} className={devOpen ? "rotate-180 transition-transform" : "transition-transform"} />
                {t("tools.mcp.devGroup")} ({dev.length})
              </button>
              {devOpen && (
                <div className="tools-icon-grid mt-3">
                  {dev.map((preset) => (
                    <McpServerCard
                      key={preset.name}
                      preset={preset}
                      onOpen={preset.installed ? props.onOpenManage : props.onOpenInstall}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {(props.modal.kind === "install" || props.modal.kind === "manage") && (
        <McpServerModal
          mode={props.modal.kind}
          preset={props.modal.preset}
          busy={props.busy}
          error={props.modalError}
          testResult={props.testResult}
          onClose={props.onCloseModal}
          onSubmitInstall={props.onSubmitInstall}
          onTest={props.onTestServer}
          onRemove={props.onRemoveServer}
        />
      )}
      {props.modal.kind === "custom" && (
        <McpCustomServerModal busy={props.busy} error={props.modalError} onClose={props.onCloseModal} onSubmit={props.onSubmitCustom} />
      )}
    </section>
  );
}

function McpServerCard(props: { preset: McpPresetPayload; onOpen: (preset: McpPresetPayload) => void }) {
  const { t } = useTranslation();
  const label = t(mcpStatusKey(props.preset.status));

  return (
    <button
      type="button"
      className={`integration-card rounded-card integration-card-integration ${mcpCardStatusClass(props.preset.status)}`}
      title={props.preset.description}
      aria-label={`${props.preset.display_name}, ${label}.`}
      onClick={() => props.onOpen(props.preset)}
    >
      {props.preset.logo_url ? (
        <img src={props.preset.logo_url} alt="" className="integration-card-logo" />
      ) : (
        <span className="integration-card-logo flex items-center justify-center text-text-ink/45">
          <Server size={20} />
        </span>
      )}
      <span className="integration-card-content">
        <span className="integration-card-name">{props.preset.display_name}</span>
        <span className={`integration-card-state-label ${mcpStatusTextClass(props.preset.status)}`}>{label}</span>
      </span>
    </button>
  );
}

/** Handles mcp status key. */
export function mcpStatusKey(status: string): MessageKey {
  switch (status) {
    case "configured":
      return "tools.mcp.status.configured";
    case "missing_credentials":
      return "tools.mcp.status.missingCredentials";
    case "missing_dependency":
      return "tools.mcp.status.missingDependency";
    case "coming_soon":
      return "tools.mcp.status.comingSoon";
    default:
      return "tools.mcp.status.notInstalled";
  }
}

function mcpCardStatusClass(status: string): string {
  if (status === "configured") {
    return "integration-card-status-connected";
  }
  if (status === "missing_credentials" || status === "missing_dependency") {
    return "integration-card-status-error";
  }
  return "integration-card-status-default";
}

function mcpStatusTextClass(status: string): string {
  if (status === "configured") {
    return "text-status-success";
  }
  if (status === "missing_credentials" || status === "missing_dependency") {
    return "text-status-error";
  }
  return "text-text-ink/45";
}

/** Handles mcp tools section. */
export function McpToolsSection(props: { client: McpPresetsClient | null }) {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; message?: string; presets: McpPresetPayload[] }>({
    status: "loading",
    presets: []
  });
  const [modal, setModal] = useState<McpSectionModal>({ kind: "closed" });
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState("");
  const [testResult, setTestResult] = useState<McpPresetsPayload["last_action"] | null>(null);

  const load = useCallback(async () => {
    if (!props.client) {
      setState({ status: "loading", presets: [] });
      return;
    }
    try {
      const payload = await props.client.listMcpPresets();
      setState({ status: "ready", presets: payload.presets });
    } catch (error) {
      setState({ status: "error", presets: [], message: error instanceof Error ? error.message : String(error) });
    }
  }, [props.client]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = useCallback(
    async (action: () => Promise<McpPresetsPayload>, options: { keepModal?: boolean } = {}) => {
      setBusy(true);
      setModalError("");
      try {
        const payload = await action();
        setState({ status: "ready", presets: payload.presets });
        setTestResult(payload.last_action ?? null);
        if (payload.last_action?.ok === false) {
          setModalError(payload.last_action.message ?? "");
        }
        if (!options.keepModal) {
          setModal({ kind: "closed" });
        }
      } catch (error) {
        setModalError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    []
  );

  return (
    <McpToolsSectionView
      status={state.status}
      message={state.message}
      presets={state.presets}
      modal={modal}
      busy={busy}
      modalError={modalError}
      testResult={testResult}
      onOpenInstall={(preset) => {
        setModalError("");
        setTestResult(null);
        setModal({ kind: "install", preset });
      }}
      onOpenManage={(preset) => {
        setModalError("");
        setTestResult(null);
        setModal({ kind: "manage", preset });
      }}
      onOpenCustom={() => {
        setModalError("");
        setTestResult(null);
        setModal({ kind: "custom" });
      }}
      onCloseModal={() => setModal({ kind: "closed" })}
      onSubmitInstall={(values) => {
        if (modal.kind === "install" && props.client) {
          void runAction(() => props.client!.enableMcpPreset(modal.preset.name, values));
        }
      }}
      onTestServer={(name) => {
        if (props.client) {
          void runAction(() => props.client!.testMcpServer(name), { keepModal: true });
        }
      }}
      onRemoveServer={(name) => {
        if (props.client) {
          void runAction(() => props.client!.removeMcpServer(name));
        }
      }}
      onSubmitCustom={(input) => {
        if (props.client) {
          void runAction(() => props.client!.addCustomMcpServer(input));
        }
      }}
    />
  );
}
```

（容器不引 `useTranslation`，只有视图与弹窗需要 `t`。）

- [ ] **Step 5: 实现 `mcp-server-modal.tsx`**

```tsx
/** MCP server modal module. */
import { useState } from "react";
import { X } from "lucide-react";
import type { McpCustomServerInput, McpPresetPayload, McpPresetsPayload } from "../api/memmy-agent-client.js";
import { useTranslation } from "../i18n/use-translation.js";

export interface McpServerModalProps {
  mode: "install" | "manage";
  preset: McpPresetPayload;
  busy: boolean;
  error: string;
  testResult: McpPresetsPayload["last_action"] | null;
  onClose: () => void;
  onSubmitInstall: (values: Record<string, string>) => void;
  onTest: (name: string) => void;
  onRemove: (name: string) => void;
}

/** Handles mcp server modal. */
export function McpServerModal(props: McpServerModalProps) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>({});

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-text-ink/30 backdrop-blur-sm" role="presentation" onClick={(event) => event.target === event.currentTarget && props.onClose()}>
      <div className="w-full max-w-md overflow-hidden rounded-card-lg border border-border-stone/30 bg-background-paper shadow-2xl">
        <header className="flex items-center justify-between border-b border-border-stone/30 px-4 py-3">
          <h2 className="text-sm font-semibold text-text-ink">
            {t(props.mode === "install" ? "tools.mcp.modal.installTitle" : "tools.mcp.modal.manageTitle", {
              name: props.preset.display_name
            })}
          </h2>
          <button type="button" onClick={props.onClose} aria-label={t("common.close")} className="text-text-ink/45 hover:text-text-ink">
            <X size={16} />
          </button>
        </header>
        <div className="space-y-3 px-4 py-4">
          {props.preset.requires && (
            <p className="text-xs text-text-ink/55">{t("tools.mcp.modal.requirements", { requirements: props.preset.requires })}</p>
          )}
          {props.preset.note && <p className="text-xs text-text-ink/55">{props.preset.note}</p>}

          {props.mode === "install" &&
            props.preset.required_fields.map((field) => (
              <label key={field.name} className="block space-y-1">
                <span className="text-xs text-text-ink/70">{field.label}</span>
                <input
                  type={field.secret ? "password" : "text"}
                  value={values[field.name] ?? ""}
                  placeholder={field.configured ? t("common.configured") : field.placeholder}
                  onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                  className="w-full rounded-input border-content-panel bg-background-paper px-3 py-2 text-sm focus:outline-none"
                />
              </label>
            ))}

          {props.mode === "manage" && (
            <>
              {props.preset.connection_summary && (
                <p className="break-all rounded-card border-content-panel bg-canvas-oat/30 px-3 py-2 text-xs text-text-ink/65">
                  {props.preset.connection_summary}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={props.busy}
                  onClick={() => props.onTest(props.preset.name)}
                  className="rounded-btn border border-content-panel bg-background-paper px-3 py-1.5 text-xs text-text-ink/70 hover:bg-canvas-oat/40 disabled:opacity-50"
                >
                  {t("tools.mcp.modal.test")}
                </button>
                <button
                  type="button"
                  disabled={props.busy}
                  onClick={() => props.onRemove(props.preset.name)}
                  className="rounded-btn border border-status-error/30 bg-status-error/10 px-3 py-1.5 text-xs text-status-error hover:bg-status-error/20 disabled:opacity-50"
                >
                  {t("tools.mcp.modal.remove")}
                </button>
              </div>
              {props.testResult?.message && (
                <p className={`text-xs ${props.testResult.ok === false ? "text-status-error" : "text-status-success"}`}>
                  {props.testResult.message}
                </p>
              )}
            </>
          )}

          {props.error && <p className="text-xs text-status-error">{props.error}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-border-stone/30 px-4 py-3">
          <button type="button" onClick={props.onClose} className="rounded-btn px-3 py-1.5 text-xs text-text-ink/65 hover:bg-canvas-oat/40">
            {t("common.cancel")}
          </button>
          {props.mode === "install" && (
            <button
              type="button"
              disabled={props.busy}
              onClick={() => props.onSubmitInstall(values)}
              className="rounded-btn bg-action-sky px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {t("tools.mcp.modal.install")}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

export interface McpCustomServerModalProps {
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (input: McpCustomServerInput) => void;
}

function parseLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseKeyValueLines(value: string): Record<string, string> {
  return Object.fromEntries(
    parseLines(value)
      .map((line) => {
        const index = line.indexOf("=");
        if (index <= 0) return null;
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      })
      .filter((entry): entry is [string, string] => entry !== null)
  );
}

/** Handles mcp custom server modal. */
export function McpCustomServerModal(props: McpCustomServerModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<McpCustomServerInput["transport"]>("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState("");
  const [cwd, setCwd] = useState("");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState("");
  const [timeout, setTimeoutValue] = useState("30");
  const [validationError, setValidationError] = useState("");

  function submit() {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(name.trim())) {
      setValidationError(t("tools.mcp.custom.nameInvalid"));
      return;
    }
    if (transport === "stdio" && !command.trim()) {
      setValidationError(t("tools.mcp.custom.commandRequired"));
      return;
    }
    if (transport !== "stdio" && !url.trim()) {
      setValidationError(t("tools.mcp.custom.urlRequired"));
      return;
    }
    setValidationError("");

    const parsedTimeout = Number.parseInt(timeout, 10);
    const input: McpCustomServerInput = {
      name: name.trim().toLowerCase(),
      transport,
      ...(transport === "stdio" ? { command: command.trim() } : { url: url.trim() }),
      ...(parseLines(args).length ? { args: parseLines(args) } : {}),
      ...(Object.keys(parseKeyValueLines(env)).length ? { env: parseKeyValueLines(env) } : {}),
      ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
      ...(transport !== "stdio" && Object.keys(parseKeyValueLines(headers)).length
        ? { headers: parseKeyValueLines(headers) }
        : {}),
      tool_timeout: Number.isFinite(parsedTimeout) ? parsedTimeout : 30
    };
    props.onSubmit(input);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-text-ink/30 backdrop-blur-sm" role="presentation" onClick={(event) => event.target === event.currentTarget && props.onClose()}>
      <div className="w-full max-w-md overflow-hidden rounded-card-lg border border-border-stone/30 bg-background-paper shadow-2xl">
        <header className="flex items-center justify-between border-b border-border-stone/30 px-4 py-3">
          <h2 className="text-sm font-semibold text-text-ink">{t("tools.mcp.custom.title")}</h2>
          <button type="button" onClick={props.onClose} aria-label={t("common.close")} className="text-text-ink/45 hover:text-text-ink">
            <X size={16} />
          </button>
        </header>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto px-4 py-4">
          <label className="block space-y-1">
            <span className="text-xs text-text-ink/70">{t("tools.mcp.custom.name")}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-input border-content-panel bg-background-paper px-3 py-2 text-sm focus:outline-none" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-text-ink/70">{t("tools.mcp.custom.transport")}</span>
            <select value={transport} onChange={(event) => setTransport(event.target.value as McpCustomServerInput["transport"])} className="w-full rounded-input border-content-panel bg-background-paper px-3 py-2 text-sm focus:outline-none">
              <option value="stdio">stdio</option>
              <option value="sse">sse</option>
              <option value="streamableHttp">streamableHttp</option>
            </select>
          </label>
          {transport === "stdio" ? (
            <>
              <label className="block space-y-1">
                <span className="text-xs text-text-ink/70">{t("tools.mcp.custom.command")}</span>
                <input value={command} onChange={(event) => setCommand(event.target.value)} className="w-full rounded-input border-content-panel bg-background-paper px-3 py-2 text-sm focus:outline-none" />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-text-ink/70">{t("tools.mcp.custom.args")}</span>
                <textarea value={args} onChange={(event) => setArgs(event.target.value)} rows={3} className="w-full rounded-input border-content-panel bg-background-paper px-3 py-2 text-sm focus:outline-none" />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-text-ink/70">{t("tools.mcp.custom.cwd")}</span>
                <input value={cwd} onChange={(event) => setCwd(event.target.value)} className="w-full rounded-input border-content-panel bg-background-paper px-3 py-2 text-sm focus:outline-none" />
              </label>
            </>
          ) : (
            <>
              <label className="block space-y-1">
                <span className="text-xs text-text-ink/70">{t("tools.mcp.custom.url")}</span>
                <input value={url} onChange={(event) => setUrl(event.target.value)} className="w-full rounded-input border-content-panel bg-background-paper px-3 py-2 text-sm focus:outline-none" />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-text-ink/70">{t("tools.mcp.custom.headers")}</span>
                <textarea value={headers} onChange={(event) => setHeaders(event.target.value)} rows={2} className="w-full rounded-input border-content-panel bg-background-paper px-3 py-2 text-sm focus:outline-none" />
              </label>
            </>
          )}
          <label className="block space-y-1">
            <span className="text-xs text-text-ink/70">{t("tools.mcp.custom.env")}</span>
            <textarea value={env} onChange={(event) => setEnv(event.target.value)} rows={2} className="w-full rounded-input border-content-panel bg-background-paper px-3 py-2 text-sm focus:outline-none" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-text-ink/70">{t("tools.mcp.custom.timeout")}</span>
            <input type="number" value={timeout} onChange={(event) => setTimeoutValue(event.target.value)} className="w-full rounded-input border-content-panel bg-background-paper px-3 py-2 text-sm focus:outline-none" />
          </label>
          {(validationError || props.error) && <p className="text-xs text-status-error">{validationError || props.error}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-border-stone/30 px-4 py-3">
          <button type="button" onClick={props.onClose} className="rounded-btn px-3 py-1.5 text-xs text-text-ink/65 hover:bg-canvas-oat/40">
            {t("common.cancel")}
          </button>
          <button type="button" disabled={props.busy} onClick={submit} className="rounded-btn bg-action-sky px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            {t("tools.mcp.custom.save")}
          </button>
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: 运行 SSR 测试**

Run: `cd App/frontend/desktop && npx vitest run src/components/tests/mcp-tools-section.test.tsx`
Expected: PASS

- [ ] **Step 7: 写交互测试（happy-dom）**

`App/frontend/desktop/src/components/tests/mcp-tools-section.interaction.test.tsx`：

```tsx
// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/i18n-provider.js";
import { McpToolsSection, type McpPresetsClient } from "../mcp-tools-section.js";
import type { McpPresetsPayload } from "../../api/memmy-agent-client.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const basePreset = {
  name: "brave-search",
  display_name: "Brave Search",
  status: "not_installed",
  installed: false,
  source: "preset",
  required_fields: [{ name: "brave_api_key", label: "Brave Search API key", secret: true, required: true, configured: false }]
} as McpPresetsPayload["presets"][number];

function createClient(overrides: Partial<McpPresetsClient> = {}): McpPresetsClient {
  return {
    listMcpPresets: vi.fn(async () => ({ presets: [basePreset], installed_count: 0 })),
    enableMcpPreset: vi.fn(async () => ({ presets: [{ ...basePreset, status: "configured", installed: true }], installed_count: 1 })),
    removeMcpServer: vi.fn(async () => ({ presets: [basePreset], installed_count: 0 })),
    testMcpServer: vi.fn(async () => ({ presets: [{ ...basePreset, status: "configured", installed: true }], installed_count: 1, last_action: { ok: true, message: "Brave Search connected with 2 tools." } })),
    addCustomMcpServer: vi.fn(async () => ({ presets: [basePreset], installed_count: 0 })),
    ...overrides
  };
}

describe("McpToolsSection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  function render(client: McpPresetsClient | null) {
    return act(async () => {
      root.render(
        <I18nProvider language="en-US">
          <McpToolsSection client={client} />
        </I18nProvider>
      );
    });
  }

  it("lists presets, installs one through the modal, and updates the card", async () => {
    const client = createClient();
    await render(client);

    const card = container.querySelector<HTMLButtonElement>(".integration-card");
    expect(card?.textContent).toContain("Brave Search");

    await act(async () => card?.click());
    const input = container.querySelector<HTMLInputElement>('input[type="password"]');
    expect(input).not.toBeNull();

    await act(async () => {
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, "BSA_test");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    const install = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Install");
    await act(async () => install?.click());

    expect(client.enableMcpPreset).toHaveBeenCalledWith("brave-search", { brave_api_key: "BSA_test" });
    expect(container.textContent).toContain("Configured");
  });

  it("keeps the manage modal open and shows the test result verbatim", async () => {
    const client = createClient();
    await render(client);

    await act(async () => container.querySelector<HTMLButtonElement>(".integration-card")?.click());
    // 先安装态场景：直接用已安装的 payload 重新渲染
    await render(
      createClient({
        listMcpPresets: vi.fn(async () => ({ presets: [{ ...basePreset, status: "configured", installed: true }], installed_count: 1 }))
      })
    );

    await act(async () => container.querySelector<HTMLButtonElement>(".integration-card")?.click());
    const test = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Test connection");
    await act(async () => test?.click());

    expect(container.textContent).toContain("Brave Search connected with 2 tools.");
  });

  it("surfaces a failed action's message inside the modal", async () => {
    const client = createClient({
      enableMcpPreset: vi.fn(async () => {
        throw new Error("MCP settings payload is too large");
      })
    });
    await render(client);

    await act(async () => container.querySelector<HTMLButtonElement>(".integration-card")?.click());
    const install = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Install");
    await act(async () => install?.click());

    expect(container.textContent).toContain("MCP settings payload is too large");
  });

  it("shows a section-level error when the listing fails, and loading without a client", async () => {
    await render(
      createClient({
        listMcpPresets: vi.fn(async () => {
          throw new Error("bootstrap failed");
        })
      })
    );
    expect(container.textContent).toContain("bootstrap failed");
    expect(container.textContent).not.toContain("Brave Search");

    await render(null);
    expect(container.textContent).toContain("Loading");
  });
});
```

注：第二个用例里 `render` 用重新 render 切换 payload —— 两次 render 到同一 root 是允许的（`act` 包裹）；如果实现者发现断言不稳（旧 state 残留），把该用例拆成两个独立 `it`，各自新建 root。

- [ ] **Step 8: 运行交互测试**

Run: `cd App/frontend/desktop && npx vitest run src/components/tests/mcp-tools-section.interaction.test.tsx`
Expected: PASS

- [ ] **Step 9: 类型检查**

Run: `cd App/frontend/desktop && npx tsc -p tsconfig.json --noEmit`
Expected: 通过。若 `messages.ts` 的 `MessageKey` 是 `keyof typeof zhCNMessages`，两段键名必须完全一致，否则这里会报错。

- [ ] **Step 10: Commit**

```bash
git add App/frontend/desktop/src/components/mcp-tools-section.tsx App/frontend/desktop/src/components/mcp-server-modal.tsx App/frontend/desktop/src/components/tests/mcp-tools-section.test.tsx App/frontend/desktop/src/components/tests/mcp-tools-section.interaction.test.tsx App/frontend/desktop/src/i18n/messages.ts
git commit -m "feat(desktop): add the MCP tools section with preset installer and custom form

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: 工具页 — 分区级显隐接线

**Files:**
- Modify: `App/frontend/desktop/src/pages/tools-page.tsx`
- Modify: `App/frontend/desktop/src/i18n/messages.ts`（删除 `tools.cloudUnavailable` 两个条目：zh 752、en 2520）
- Test: `App/frontend/desktop/src/pages/tests/tools-page.test.tsx`
- Test: `App/frontend/desktop/src/pages/tests/cloud-feature-gate.test.tsx`

**Interfaces:**
- Consumes: Task 3 的 `McpToolsSection`、`McpPresetsClient`；Task 2 的 client 方法（经 `clients.memmyAgent`）。
- Produces: `ToolsPageViewProps` 新增 `mcpClient?: McpPresetsClient | null;` 与 `integrationsEnabled?: boolean;`（默认 `true`）。

- [ ] **Step 1: 写失败测试**

`cloud-feature-gate.test.tsx` 里把第一个用例替换为：

```tsx
  it("hides the composio integrations from a cuberouter identity but keeps channels and MCP", () => {
    mocks.state = createStateWithIdentity("cuberouter");
    const cuberouterHtml = renderToolsPage();

    expect(cuberouterHtml).toContain("渠道");
    expect(cuberouterHtml).toContain("MCP 服务器");
    expect(cuberouterHtml).not.toContain("Tools & Automation");
    expect(cuberouterHtml).not.toContain(toolsUnavailableText);

    mocks.state = createStateWithIdentity("memmy_cloud");
    const cloudHtml = renderToolsPage();

    expect(cloudHtml).toContain("Tools & Automation");
    expect(cloudHtml).not.toContain(toolsUnavailableText);
  });
```

（`toolsUnavailableText` 常量保留，作为"旧整页提示不得回归"的护栏。）

`tools-page.test.tsx` 的 `renderView` 增加选项并新增用例：

```tsx
// renderView 的 options 增加：mcpClient?: McpPresetsClient | null; integrationsEnabled?: boolean;
// 并在 <ToolsPageView ...> 上传入 mcpClient={options.mcpClient ?? null} integrationsEnabled={options.integrationsEnabled}
```

```tsx
  it("integrationsEnabled=false 时只渲染渠道和 MCP 分区", () => {
    const html = renderView(initialToolsState, { integrationsEnabled: false });

    expect(html).toContain("Channels");
    expect(html).toContain("MCP servers");
    expect(html).not.toContain("Integrations");
    expect(html).not.toContain("Tools & Automation");
  });

  it("默认渲染三个分区", () => {
    const html = renderView(initialToolsState);

    expect(html).toContain("Channels");
    expect(html).toContain("MCP servers");
    expect(html).toContain("Integrations");
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `cd App/frontend/desktop && npx vitest run src/pages/tests/cloud-feature-gate.test.tsx src/pages/tests/tools-page.test.tsx`
Expected: FAIL —— cuberouter 仍渲染整页提示；`integrationsEnabled` 无效果。

- [ ] **Step 3: 改 `tools-page.tsx`**

1) `ToolsPageViewProps` 增加：

```ts
  mcpClient?: McpPresetsClient | null;
  integrationsEnabled?: boolean;
```

2) 顶部 import 增加：

```ts
import { McpToolsSection, type McpPresetsClient } from "../components/mcp-tools-section.js";
```

3) `ToolsPage`（38-111 行）中：

- 删除整页 gate 分支（85-95 行的 `if (!cloudFeaturesEnabled) { ... }`），`cloudFeaturesEnabled` 改名 `integrationsEnabled` 继续用于传参；
- return 里给 `ToolsPageView` 传：

```tsx
      mcpClient={clients?.memmyAgent ?? null}
      integrationsEnabled={integrationsEnabled}
```

4) `ToolsPageView`（124 行起）中：

- 在渠道 `<section>`（163-177 行）之后、集成 `<section>`（179 行起）之前插入 `<McpToolsSection client={props.mcpClient ?? null} />`；
- 把集成 `<section>` 包成条件渲染：`{props.integrationsEnabled !== false && ( <section> ... </section> )}`；
- `props.tools.loadError` 的 Banner 保持在 `data-tour-anchor` 容器内、两个门控之外（渠道/MCP 加载失败与它无关）。

5) 删除 `messages.ts` 中 `"tools.cloudUnavailable"` 的 zh（752 行）与 en（2520 行）条目。

- [ ] **Step 4: 运行确认通过**

Run: `cd App/frontend/desktop && npx vitest run src/pages/tests/cloud-feature-gate.test.tsx src/pages/tests/tools-page.test.tsx`
Expected: PASS

- [ ] **Step 5: 全量桌面测试 + 类型检查**

Run: `cd App/frontend/desktop && npx vitest run`
Expected: PASS（若既有用例因 MCP 分区新增文本发生字符串冲突——例如对 "Loading"/"Settings" 的全局断言——按用例意图收窄断言，不要放宽产品行为）

Run: `cd App/frontend/desktop && npx tsc -p tsconfig.json --noEmit`
Expected: 通过

- [ ] **Step 6: Commit**

```bash
git add App/frontend/desktop/src/pages/tools-page.tsx App/frontend/desktop/src/pages/tests/tools-page.test.tsx App/frontend/desktop/src/pages/tests/cloud-feature-gate.test.tsx App/frontend/desktop/src/i18n/messages.ts
git commit -m "feat(desktop): gate the composio section by cloud identity, keep channels and MCP always visible

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: 文档同步

**Files:**
- Modify: `docs/cn/tools/mcp.mdx`
- Modify: `docs/en/tools/mcp.mdx`

**Interfaces:** 无代码接口。

- [ ] **Step 1: 中文文档**

在 `docs/cn/tools/mcp.mdx` 的「内置工具开关」之前插入：

```mdx
## 桌面端管理

桌面端「连接与工具」页的 MCP 分区提供与设置接口等价的图形界面：内置的精选预设（Brave Search、Exa，以及折叠在「开发者工具」下的 Figma、Firecrawl）可以一键安装、测试、移除；也可以填写自定义 server。所有改动写入同一份 `tools.mcpServers` 配置并自动热重载。
```

- [ ] **Step 2: 英文文档**

在 `docs/en/tools/mcp.mdx` 对应位置插入：

```mdx
## Desktop management

The MCP section on the desktop tools page mirrors the settings API: install, test, and remove the curated presets (Brave Search and Exa, with Figma and Firecrawl folded into a developer group), or add a custom server. Every change writes the same `tools.mcpServers` config and hot-reloads automatically.
```

- [ ] **Step 3: Commit**

```bash
git add docs/cn/tools/mcp.mdx docs/en/tools/mcp.mdx
git commit -m "docs(tools): document the desktop MCP management surface

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Self-Review 记录

- **Spec coverage**：分区显隐→Task 4；MCP 分区（安装器/折叠组/自定义表单/测试/移除）→Task 3；数据通路→Task 2；preset 收敛（删 7、Figma/Firecrawl 加标记）→Task 1；「本轮不做」（Cursor 导入、白名单编辑器、导览文案）→ 未实现即满足；文档→Task 5。
- **Placeholder scan**：无 TBD；所有代码步骤含完整代码或精确行号锚点。
- **Type consistency**：`McpPresetsPayload` / `McpPresetPayload` / `McpCustomServerInput` / `McpPresetsClient` / `mcpStatusKey` 在 Task 2/3/4 中签名一致；payload 字段名（`display_name`、`required_fields`、`last_action.ok`）以 agent 端 `presetPayload`（565 行）为准。
- **Review Focus**：5 条均已挂到具体任务的测试（见各条末尾）。
