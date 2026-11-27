# Example Notes

一个完整的、最小的 Cuby app 示例：一个零依赖的 stdio MCP server、一个单文件整页 UI、一份可以直接运行的 manifest。

它演示了：

- 侧栏 Apps 入口：点击后执行 `entryPoints` 里的 home 入口，不触发模型 turn，直接打开整页；
- 宿主 bridge：UI 通过 `tools/call` 调用本 app 的 MCP 工具（`list_notes` / `add_note` / `delete_note`）；
- host context：读取并应用宿主的主题 token；
- 宿主 AI 对话：点击 **Ask Cuby**，通过 Cuby 扩展 `ui/open-chat` 打开宿主的聊天面板；
- 配置：`app.json` 的 server / ui / capabilities / entryPoints，以及 `CUBY_APPS` / `CUBY_DEV_APPS` 的用法。

## 快速运行

在仓库根目录：

```sh
CUBY_DEV_APPS="$PWD/apps/example-notes" npm run dev:desktop
```

> `CUBY_DEV_APPS` 的相对路径是从 agent 进程的 cwd 解析的（dev 时通常是
> `App/shell/desktop`），所以这里用 `$PWD` 传绝对路径；直接写
> `apps/example-notes` 会找不到。

打开桌面端后：

1. 左侧栏的 **Apps** 分区会出现 **Example Notes**；
2. 点击后打开整页，输入一条 note 并点 **Add**；
3. 点 **Ask Cuby**（app 里的按钮，或 app 页右上角的宿主按钮），右侧会并排打开 Cuby 的 AI 对话面板，并带上当前 notes 的上下文；
4. 在聊天里让模型调用 `mcp_example_notes_list_notes`，也能得到同一个 UI 的内嵌卡片；卡片右上角的“在整页打开”会跳到整页。

> 这个 app 的 server 没有第三方依赖，所以 `CUBY_DEV_APPS` 和 `apps:build` 都不需要额外安装。如果你在自己的 app 里 import npm 包，需要把依赖一并放进 app 包或它声明的 runtime（v1 不会自动打包 `node_modules`）。

## 文件结构

```text
apps/example-notes/
  app.json          # 唯一的配置入口
  server.mjs        # 零依赖 stdio MCP server
  ui/index.html     # 整页 UI（HTML/CSS/JS，一个文件）
  README.md
```

### `app.json`

```json
{
  "schemaVersion": 1,
  "id": "example-notes",
  "name": "Example Notes",
  "version": "0.1.0",
  "engines": { "cuby": ">=0.0.1" },
  "server": {
    "scope": "global",
    "transport": "stdio",
    "command": "node",
    "args": ["server.mjs"],
    "cwd": "${APP_ROOT}",
    "toolTimeout": 30
  },
  "ui": {
    "resources": [
      { "uri": "ui://example-notes/home", "entry": "ui/index.html" }
    ],
    "defaultResourceUri": "ui://example-notes/home",
    "prefersBorder": true,
    "csp": {}
  },
  "capabilities": {
    "appToolCalls": ["list_notes", "add_note", "delete_note"],
    "appMessages": "allow",
    "openLinks": false,
    "downloads": false,
    "workspace": "none"
  },
  "entryPoints": [
    {
      "surface": "home",
      "title": "Example Notes",
      "description": "Open the notes app",
      "action": { "kind": "tool", "tool": "list_notes", "arguments": {} }
    }
  ],
  "build": {
    "include": ["app.json", "server.mjs", "ui/**", "README.md"]
  }
}
```

关键字段：

| 字段 | 作用 |
|---|---|
| `server.command` / `args` / `cwd` | 启动 app 的 stdio MCP server；`${APP_ROOT}` 是 app 包目录 |
| `server.scope` | `global` 表示整个 Cuby 进程共享一个 server；需要 per-chat 状态时用 `session` |
| `ui.resources[]` | UI 资源 URI 与 HTML 入口；`uri` 必须匹配服务器 `resources/list` |
| `ui.defaultResourceUri` | 没有 tool result 时默认打开的 resource |
| `capabilities.appToolCalls` | UI 允许反向调用的工具白名单；不在名单里的 `tools/call` 会被拒绝 |
| `capabilities.appMessages` | `"allow"` 才允许 `ui/message` / `ui/open-chat` 打开宿主聊天 |
| `capabilities.workspace` | `none` / `read` / `write`；这个示例不需要 workspace |
| `entryPoints` | 侧栏入口；v1 取第一个 `surface: "home"` 的入口，执行它的 tool |
| `build.include` | `apps:build` 时复制到 `dist/apps/<id>` 的文件 |

`id` 必须和目录名一致，且只能是小写字母、数字和连字符。

### `server.mjs`

这是一个手写的最小 MCP stdio server，不依赖 `@modelcontextprotocol/sdk`：

- 从 stdin 逐行读 JSON-RPC，向 stdout 逐行写 JSON-RPC；
- 支持 `initialize`、`tools/list`、`tools/call`、`resources/list`、`resources/read`、`ping`；
- 日志只写 stderr，避免污染协议流；
- 工具定义里的 `_meta.ui.resourceUri` 告诉宿主：这个工具调用后应该渲染哪个 UI resource；
- `list_notes` 的 `_meta.ui.resourceUri` 同时被侧栏 entry point 使用；
- `structuredContent` 是给 UI 的结构化数据，`content` 是给模型看的文本结果。

最简单的工具定义：

```js
{
  name: "list_notes",
  description: "List the notes in this example app",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  _meta: { ui: { resourceUri: "ui://example-notes/home" } }
}
```

### `ui/index.html`

UI 是自包含 HTML，运行在宿主的 sandboxed iframe 里（`sandbox="allow-scripts"`，没有 same-origin）。它只使用标准 postMessage JSON-RPC：

1. `ui/initialize` → 宿主返回 `hostContext`（主题、locale、容器尺寸等）；
2. 应用 `hostContext.styles.variables` 到 `document.documentElement`，让页面跟随 Cuby 主题；
3. 发 `ui/notifications/initialized`；
4. 用 `tools/call` 调 `list_notes` / `add_note` / `delete_note`；
5. 用 `ui/open-chat` 打开宿主 AI 面板（可选 `message` 会作为 app 消息发进去）；
6. 监听 `ui/notifications/tool-result`、`ui/notifications/host-context-changed`。

UI 里的请求是一个很小的 `pending` map：

```js
function request(method, params) {
  const id = state.nextId++;
  pending.set(id, method);
  window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
  return id;
}
```

如果 app 需要网络请求或外部图片，在 `app.json` 的 `ui.csp` 里声明对应 origin；默认 CSP 是 `default-src 'none'`。

## 构建与配置

开发时直接指向源码目录：

```sh
CUBY_DEV_APPS="$PWD/apps/example-notes" npm run dev:desktop
```

构建到 `dist/apps/`：

```sh
CUBY_APPS=example-notes npm run apps:build
```

或者在 `cuby.apps.json` 里选中它：

```json
{
  "schemaVersion": 1,
  "apps": ["example-notes"]
}
```

然后正常打包 Cuby；默认的 `cuby.apps.json` 是空数组，意味着普通构建不会自动带上示例 app。

常用命令：

```sh
npm run apps:list
CUBY_APPS=example-notes npm run apps:build
CUBY_DEV_APPS="$PWD/apps/example-notes" npm run dev:desktop
```

## 继续改这个示例

- **加一个工具**：在 `server.mjs` 的 `tools` 和 `callTool` 里加，并把工具名加入 `capabilities.appToolCalls`；UI 里用 `tools/call` 调用。
- **加一个 UI 入口**：在 `ui.resources` 里加 `uri` + `entry`，并在工具 `_meta.ui.resourceUri` 里指向它。
- **加一个侧栏入口**：在 `entryPoints` 里加一个 `surface: "home"` 的 tool action；同 app 的多个 entry point 在 v1 只取第一个。
- **持久化 notes**：把 `notes` 从内存改为读写 `${APP_DATA}/notes.json`；`APP_DATA` 是每个 app 独立的持久化目录。
- **需要 workspace**：把 `server.scope` 改成 `session`，并把 `capabilities.workspace` 改成 `read` 或 `write`；server 里可以读 `${SESSION_WORKSPACE}`。

## 安全边界

- UI 在 sandboxed iframe 中运行，不能访问宿主 DOM、localStorage 或 `window.memmy`；
- 默认 CSP 拒绝网络，除非在 `ui.csp` 里声明；
- UI 反向调用只允许 `appToolCalls` 白名单里的工具；
- manifest 里禁止明文密钥；需要凭证时用 `credentials` 声明，由宿主注入；
- app server 在 v1 视为可信的 build-time 代码，没有 OS 级沙箱。

更多约定见 [`docs/app-packages.md`](../../docs/app-packages.md) 和 [`docs/superpowers/specs/2026-11-21-cuby-app-packages-design.md`](../../docs/superpowers/specs/2026-11-21-cuby-app-packages-design.md)。
