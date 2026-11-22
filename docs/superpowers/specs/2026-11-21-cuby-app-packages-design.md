# Cuby App 包设计

- 日期：2026-11-21
- 状态：Draft / 待批准
- 关联文档：
  - `docs/superpowers/specs/2026-11-20-financebuddy-extension-architecture.md`
  - `docs/superpowers/specs/2026-11-21-financebuddy-open-issues.md`
- 范围：Cuby 的 app 包格式、开发者契约、宿主机契约、构建与开发流程；不包含具体实施计划

## 1. 意图与为什么

Cuby core 不引入 finance 或其他垂类概念。垂类以 **app 包** 的形式存在：一个目录里同时包含 MCP server、MCP App UI、skills、资产和运行时声明。app 包可以：

- 在仓库内开发（`apps/<id>/`）；
- 在 build Cuby 时按选择预装进安装包；
- 在开发模式下从源码直接加载，不需要重建 Cuby；
- 未来可以打成独立分发包，安装到已发布的 Cuby 里（第一版不实现安装器）。

这样 FinanceBuddy 这类垂类可以独立版本、独立测试、独立发版，Cuby 只负责通用的宿主能力。

## 2. 目标 / 非目标 / 反目标

### 目标

1. 定义一个 **app 开发者只需实现一次** 的契约：manifest、MCP server、UI bundle、可选 skills。
2. build 支持选择要打包的 app，产出可复现的安装包。
3. dev 模式从源码加载 app，UI 有热更新，server 可重启。
4. 同一个 app 契约同时适用于 build-time 预装和未来的运行时安装。
5. app 之间、app 与 Cuby 之间进程隔离；app UI 运行在 sandboxed iframe 中。
6. 工具、skills、UI 的失败可见、可降级，不静默消失。
7. app UI 与 Cuby 的视觉/交互保持一致：宿主外框 + 标准 token + 可预测交互，同时保留 app 自己的品牌。

### 非目标（第一版）

- 不做运行时安装/卸载/升级 UI。
- 不做 app 商店、签名、第三方分发。
- 不允许 app 注入任意 React 组件或修改 Cuby 原生页面。
- 不做 app server 的热更新（dev 模式重启即可）。
- 不引入 Cordis 或其他进程内插件框架。
- 不解决 PyMuPDF 的许可问题（见 FB-001，属于 app 自己的发行决策）。

### 反目标

- app 的 UI 被编译进 Cuby 的 React bundle。
- app 直接 import Cuby 的内部模块、contracts、组件或路由。
- app 在没有声明的情况下访问文件系统、网络、凭证或 workspace。
- manifest 里出现明文密钥。
- app 缺失或启动失败时静默跳过，让模型和用户不知道能力不可用。
- 把 app 的 Python/Node 运行时假设成“用户机器上本来就有”。

## 3. 约束

- Cuby 是 Electron：`contextIsolation: true`、`nodeIntegration: false`，渲染进程不能直接拿 Node API。
- 现有 MCP 客户端只面向模型：tools/prompts/resources 都被包装成工具，`_meta` 被丢弃，`structuredContent` 被拼成文本。需要新增 app 宿主，而不是改坏现有 MCP 行为。
- 现有工具事件走 `tool_events` 进入 webui transcript；这是 app view 持久化最自然的落点。
- 现有 MCP 配置支持 stdio/sse/streamableHttp、env/headers、`enabledTools`；可以复用传输层，但 app 生命周期、manifest、安装目录是新的。
- FinanceBuddy 的 server 是 Python，依赖 PyMuPDF；运行时打包和许可是 app 侧要解决的问题，host 只提供声明和校验。
- app 的 UI 必须是标准 MCP App（`ui://` resource + `_meta.ui.resourceUri` + sandboxed iframe bridge），否则无法跨宿主复用。

## 4. 方案

### A. 纯 build-time

`apps/*` 是 workspace 包，build 时编译进安装包。最简单，但 app 不能独立升级，每个组合都要重新出包。

### B. 纯运行时安装

app 打成 `.cubyapp` 包，用户安装/卸载。独立发版，但签名、兼容、更新、安全都要先做。

### C. 同一套包格式，两种交付（选中）

- **包格式**：从第一天就按“可独立安装”设计（manifest、固定目录、hash、版本、平台声明）。
- **第一版交付**：build-time 预装 + dev 从源码加载。
- **后续**：增加安装器/更新器时，不需要改 app 的 manifest 和目录结构。

选择 C 的原因：A 和 C 在 app 开发者契约上几乎一样，但 A 会在未来加安装器时推翻包格式；B 的第一版成本过高。C 把成本放在一次性的 manifest/校验上，换来后续演进空间。

## 5. 总体架构

```
apps/financebuddy/                  app 包（源码）
  app.json                         唯一契约入口
  server/                          MCP server（Python/Node/二进制）
  ui/                              MCP App 源码，构建为自包含 bundle
  skills/                          可选
  assets/                          可选
  runtime/                         可选：随包携带的运行时
  tests/                           manifest / MCP / bridge 一致性测试

build:
  apps/*  ──选择/校验/构建──>  dist/apps/<id>/ + dist/apps/registry.json
                                      │
                                      └─ electron-builder extraResources
                                           └─ resources/apps/

runtime:
  AppManager（memmy-agent）
    ├─ 读取 bundled registry + 用户安装 registry + dev 覆盖
    ├─ 启动 MCP server（每个 app 一个进程/连接）
    ├─ 注册工具 mcp_<app>_<tool>
    ├─ 挂载 skills
    └─ 提供 app view 元数据

renderer:
  AppViewHost（sandboxed iframe）
    └─ postMessage JSON-RPC ──> renderer bridge ──WebSocket──> agent AppManager
                                                                  └─ MCP session
```

关键约束：**同一个作用域内，agent 工具调用和 app 反向调用必须走同一个 MCP session**。否则 server 侧的内存状态（例如 FinanceBuddy 的 C2 prepare/finalize）会分裂。

app 有两种作用域，由 `server.scope` 声明：

- `"global"`（默认）：每个 app 一个进程，所有 session 共享。适合无状态 server。
- `"session"`：每个活跃 session 一个进程，空闲回收。适合有会话内状态、需要 `${SESSION_WORKSPACE}` 的 app。FinanceBuddy 使用 `"session"`。

`${SESSION_WORKSPACE}` 只在 `scope: "session"` 且 `capabilities.workspace != "none"` 时可用。

## 6. 包格式

### 6.1 目录

仓库根目录使用 `apps/`，加入 npm workspaces：

```json
"workspaces": [
  "apps/*"
]
```

不叫 `plugins/apps`：`plugins` 容易让人以为是进程内插件，和 MCP App 的进程边界冲突。名字可以改，契约不变。

app 包在磁盘上的布局就是未来 `.cubyapp` 归档的布局，1:1 对应：

```
apps/financebuddy/
  app.json
  server/
  ui/
  skills/
  assets/
  runtime/
  tests/
  package.json            # 可选，仅用于 UI 构建/测试脚本
```

### 6.2 `app.json`

示例：

```json
{
  "schemaVersion": 1,
  "id": "financebuddy",
  "name": "FinanceBuddy",
  "version": "0.5.1",
  "description": "Finance report consistency review",
  "engines": {
    "cuby": ">=2.1.0"
  },
  "server": {
    "scope": "session",
    "transport": "stdio",
    "command": {
      "win32-x64": "runtime/win32-x64/python.exe",
      "darwin-arm64": "runtime/darwin-arm64/bin/python3",
      "linux-x64": "runtime/linux-x64/bin/python3"
    },
    "args": [
      "server/main.py",
      "--config",
      "${APP_DATA}/config.json"
    ],
    "cwd": "${APP_ROOT}",
    "env": {
      "FINANCEBUDDY_PACKAGED_WORKSPACE": "${APP_DATA}/workspace"
    },
    "toolTimeout": 120,
    "enabledTools": ["*"]
  },
  "credentials": [
    {
      "key": "FINANCEBUDDY_MODEL_API_KEY",
      "label": "Model API key",
      "type": "secret",
      "required": false
    },
    {
      "key": "FINANCEBUDDY_REVIEW_PROFILE",
      "label": "Review profile",
      "type": "json",
      "required": false,
      "schema": {
        "type": "object",
        "properties": {
          "language": { "type": "string" },
          "strictness": { "type": "string", "enum": ["normal", "strict"] }
        }
      }
    }
  ],
  "ui": {
    "resources": [
      {
        "uri": "ui://financebuddy/consistency-reader",
        "entry": "ui/dist/index.html"
      }
    ],
    "defaultResourceUri": "ui://financebuddy/consistency-reader",
    "displayModes": ["inline", "fullscreen", "pip"],
    "prefersBorder": true,
    "csp": {
      "connectDomains": [],
      "resourceDomains": [],
      "frameDomains": [],
      "baseUriDomains": []
    }
  },
  "skills": [
    {
      "path": "skills",
      "readonly": true
    }
  ],
  "entryPoints": [
    {
      "surface": "home",
      "title": "FinanceBuddy",
      "description": "Open the consistency reader",
      "icon": "assets/icon.png",
      "action": {
        "kind": "tool",
        "tool": "open_financebuddy",
        "arguments": {}
      }
    }
  ],
  "capabilities": {
    "appToolCalls": [
      "build_consistency_review",
      "read_consistency_review",
      "read_consistency_page"
    ],
    "appMessages": "allow",
    "downloads": true,
    "openLinks": true,
    "workspace": "none",
    "modelConfig": {
      "required": false,
      "protocols": ["openai-responses"]
    }
  },
  "runtime": {
    "kind": "python",
    "version": "3.12",
    "bundled": true,
    "platforms": {
      "win32-x64": "runtime/win32-x64",
      "darwin-arm64": "runtime/darwin-arm64",
      "linux-x64": "runtime/linux-x64"
    }
  },
  "build": {
    "ui": {
      "command": "npm run build",
      "output": "ui/dist"
    },
    "include": [
      "app.json",
      "server/**",
      "ui/dist/**",
      "skills/**",
      "assets/**",
      "runtime/**"
    ],
    "exclude": [
      "**/*.pyc",
      "**/__pycache__/**",
      "**/.venv/**",
      "**/node_modules/**"
    ]
  },
  "licenses": [
    {
      "name": "PyMuPDF",
      "spdx": "AGPL-3.0-or-later",
      "noticeFile": "THIRD_PARTY_NOTICES.md",
      "sourceOffer": "https://example.invalid/source"
    }
  ],
  "integrity": {
    "algorithm": "sha256"
  }
}
```

### 6.3 字段语义

| 字段 | 必填 | 说明 |
|---|---|---|
| `schemaVersion` | 是 | 当前为 `1`；不兼容变更时递增 |
| `id` | 是 | 稳定、唯一、`[a-z0-9-]+`；不可变 |
| `version` | 是 | semver；app 自己的版本 |
| `engines.cuby` | 是 | semver range；不满足时禁用并显示原因 |
| `server.transport` | 是 | 第一版支持 `stdio`；`streamableHttp` 预留 |
| `server.scope` | 否 | `"global"`（默认）或 `"session"`；`session` 每会话一个进程，支持 `${SESSION_WORKSPACE}` |
| `server.command` | 是 | 字符串或按平台映射；相对路径基于 `${APP_ROOT}` |
| `server.args` / `cwd` / `env` | 否 | 支持占位符展开 |
| `server.enabledTools` | 否 | 复用现有语义，默认 `["*"]` |
| `credentials[]` | 否 | 声明 `key`、`type`（`secret` / `json`）、`label`、`required`、可选 `schema`；值由 host 注入，不进 manifest |
| `ui.resources[]` | 否 | 有 UI 时必填；每项 `uri` + `entry`；所有工具声明的 `_meta.ui.resourceUri` 必须在此列表中 |
| `ui.defaultResourceUri` | 否 | 入口卡片默认打开的 resource；缺省用 `resources[0].uri` |
| `ui.displayModes` | 否 | 标准 `inline` / `fullscreen` / `pip`；Cuby 的 side panel 是 inline 的宽容器，不新增协议模式 |
| `ui.prefersBorder` | 否 | 是否请求宿主绘制边框/背景；默认 `true` |
| `ui.csp` | 否 | 标准 `McpUiResourceCsp`：`connectDomains` / `resourceDomains` / `frameDomains` / `baseUriDomains`；默认全空 |
| `skills[]` | 否 | skill 目录；安装到 app 专属 skill root |
| `entryPoints[]` | 否 | 声明式入口；第一版支持 `home` 卡片和 `settings` 信息 |
| `capabilities.appToolCalls` | 是 | 允许 app 反向调用的工具白名单；`[]` 表示禁止 |
| `capabilities.appMessages` | 是 | `false` / `"ask"` / `"allow"`；控制 `ui/message` |
| `capabilities.downloads` | 否 | 是否允许 app 触发文件保存 |
| `capabilities.openLinks` | 否 | 是否允许打开外部链接 |
| `capabilities.workspace` | 否 | `none` / `read` / `write`；是否暴露 session workspace；`server.scope` 必须为 `session` |
| `capabilities.modelConfig` | 否 | 声明需要的模型协议；host 注入 `CUBY_MODEL_CONFIG`，复用 Cuby 已配置的模型 |
| `runtime` | 否 | 运行时类型、版本、平台路径；build 时校验 |
| `build` | 否 | UI 构建命令、staging include/exclude |
| `licenses[]` | 否 | 第三方许可与 notices；build 复制并检查 |
| `integrity` | 否 | 哈希算法；build 生成 |

平台键统一使用 `${process.platform}-${process.arch}`：`win32-x64`、`win32-arm64`、`darwin-x64`、`darwin-arm64`、`linux-x64`、`linux-arm64`。`server.command` 和 `runtime.platforms` 使用同一套键。

### 6.4 占位符

只允许在 `server.command` / `args` / `cwd` / `env` 中使用：

| 占位符 | 值 |
|---|---|
| `${APP_ROOT}` | app 包根目录（打包后在 `resources/apps/<id>`） |
| `${APP_DATA}` | 持久化数据目录 `$CUBY_APP_DATA_DIR/<id>/` |
| `${SESSION_WORKSPACE}` | 当前 session workspace；仅当 `server.scope == "session"` 且 `capabilities.workspace != "none"` 时注入 |
| `${CUBY_USER_DATA}` | Cuby 用户数据根目录 |

规则：

- 未声明的占位符 → manifest 校验失败。
- `${SESSION_WORKSPACE}` 在 `server.scope != "session"` 或 capability 为 `none` 时 → 校验失败。
- 不允许在 `ui` 或 `version` 等字段中展开。
- 环境变量只注入 manifest 声明的 key + 最小基础变量（`PATH`、`HOME`/`USERPROFILE`、locale、temp），不继承 Cuby 的全部环境。

根目录由桌面 shell 通过环境变量传给 agent 进程：

| 环境变量 | 默认值（CLI/TUI） | 打包后的值 |
|---|---|---|
| `CUBY_BUNDLED_APPS_DIR` | 空 | `<resources>/apps` |
| `CUBY_USER_APPS_DIR` | `~/.cuby/apps` | `<userData>/apps` |
| `CUBY_APP_DATA_DIR` | `~/.cuby/app-data` | `<userData>/app-data` |
| `CUBY_USER_DATA` | `~/.cuby` | `<userData>` |

`${APP_DATA}` 解析为 `CUBY_APP_DATA_DIR/<id>/`；`${CUBY_USER_DATA}` 解析为 `CUBY_USER_DATA`。

### 6.5 凭证与模型配置

- manifest 只声明 `key`、`type`、`label`、`required`、可选 `schema`。
- `type: "secret"`：作为 env 字符串注入。
- `type: "json"`：host 按 `schema` 校验后，以 JSON 字符串注入。
- 值来自 Cuby 的设置/钥匙串；第一版可以存在 Cuby 配置里，钥匙串迁移留给 builder。
- 必填凭证缺失 → app 状态为 `missing_credentials`，工具不注册，入口卡片显示可操作提示。
- manifest 中出现明文密钥 → build 校验失败。

`capabilities.modelConfig` 是内置能力：app 声明需要的协议（例如 `openai-responses`），host 把用户当前配置的模型以 `CUBY_MODEL_CONFIG` 注入（JSON 文件路径或 JSON 字符串，由 host 决定）。app 不应自己保存模型 API key。若用户未配置模型，app 状态为 `missing_credentials`，并提示“在 Cuby 设置中配置模型”。

## 7. 开发者契约

一个 app 开发者必须提供：

1. **`app.json`**：符合上面的 schema。
2. **MCP server**：实现 `initialize`、`tools/list`、`tools/call`、`resources/list`、`resources/read`。有 UI 的工具必须在 tool definition 上声明：
   ```json
   "_meta": { "ui": { "resourceUri": "ui://<app>/<view>" } }
   ```
   声明的 URI 必须在 `app.json.ui.resources[]` 中。`initialize` / `tools/list` / `resources/list` 必须能在没有凭证的情况下完成；凭证只在 `tools/call` 时需要。
3. **MCP App UI bundle**：每个 `ui.resources[]` 对应一个自包含 HTML/JS/CSS；不 import Cuby 任何代码；通过 `@modelcontextprotocol/ext-apps`（或等价 bridge）完成 handshake、`tools/call`、`ui/message`、host context。第一版只需一个 resource，但 manifest 支持多个。
4. **可选 skills**：只写 raw MCP tool 名，不写 host 前缀。host 在加载时注入解析后的工具映射。
5. **可选 assets**：图标、模板、示例数据。
6. **可选 runtime**：按平台声明的 Python/Node/二进制；build 时校验存在。
7. **测试**：
   - manifest schema 校验；
   - 无凭证启动的 MCP conformance（initialize / list / read）；
   - 每个带 `_meta.ui.resourceUri` 的工具都有对应 resource，且 URI 在 manifest 中；
   - UI bridge handshake（可用 headless Playwright）。
8. **许可与 notices**：在 `licenses[]` 中声明；build 复制 notice 文件。

开发者 **不能** 依赖：

- Cuby 的 React 组件、路由、contracts、状态管理；
- Cuby 的内部文件路径；
- 宿主未声明的环境变量或凭证；
- 其他 app 的 server 或工具。

## 8. Host 契约

### 8.1 发现与注册

AppManager 运行在独立的 agent 进程里，不能假设自己能拿到 Electron 的 `app.getPath()` 或 `process.resourcesPath`。路径全部来自 §6.4 的四个环境变量。

- 启动时读取：
  1. 打包内置：`$CUBY_BUNDLED_APPS_DIR/registry.json`
  2. 用户安装：`$CUBY_USER_APPS_DIR/registry.json`（第一版为空，预留）
  3. dev 覆盖：`CUBY_DEV_APPS` 指向的本地 app 目录
- 校验顺序：schema → `engines.cuby` → runtime 平台可用 → 凭证 → 启动 server。
- 同一个 `id` 多处出现时，dev 覆盖 > 用户安装 > 内置；版本不同则按显式选择，不自动合并。

### 8.2 生命周期

状态：`discovered → validated → enabled → starting → ready | failed | disabled | missing_credentials`

- 默认在 agent 启动时启动所有 enabled 的 `scope: "global"` app；单个 app 启动失败不阻塞其他 app。
- `scope: "session"` app 在对应 session 第一次需要时启动；空闲 10 分钟后回收（可配置）。
- 启动超时（第一版 30s）→ `failed`，记录日志，工具不注册。
- 崩溃重启：最多 3 次，指数退避；仍失败则 `failed`，入口卡片显示错误。
- 必填凭证缺失 → `missing_credentials`；补全后自动重试。
- disable：停止 server、注销工具、隐藏入口、保留 `${APP_DATA}`。
- 第一版不做自动升级；未来的安装器可以替换版本目录后重启 app。

### 8.3 工具映射

- 现有命名规则复用：`mcp_<appId>_<rawTool>`（`sanitizeName`）；app 的 MCP server 以 `app.id` 注册，保证命名空间稳定。
- 同时保留 raw name → namespaced name 的映射，供 skills 和 app bridge 使用。
- `capabilities.appToolCalls` 只约束 **app UI 的反向调用**；模型侧仍由 `server.enabledTools` 约束。
- 反向调用必须校验：`viewId` 属于该 app、工具属于该 app 的 server、工具在 `appToolCalls` 白名单内。
- `scope: "session"` 的工具在调用时按 `ToolExecutionContext` 的 session key 路由到对应 server 进程；`global` 直接路由到单例。
- 同一个作用域内，模型调用和 UI 反向调用复用同一个 MCP session。
- app UI 发起的 `app/callTool` **默认不进入模型可见的 `tool_events`**，只写 app 审计日志（`$CUBY_USER_DATA/logs/apps/<id>.log`）。app 需要让模型知道结果时，用 `ui/message`。
- 审计日志记录：时间、viewId、appId、工具名、耗时、是否成功；不记录凭证和完整敏感结果。

### 8.4 Skills

- app 的 skills 安装到 app 专属 root，不污染用户/项目 skills。
- skill 文件使用 raw tool 名；host 在加载 skill 时注入一段“app 工具映射”上下文：
  ```
  App FinanceBuddy tools:
  - build_consistency_review -> mcp_financebuddy_build_consistency_review
  ```
- 注入机制由 builder 决定（system prompt section / skill 前处理 / 生成文件），但契约是：**skill 源文件不出现 host 前缀**。
- app 未启动或工具缺失时，skill 加载要给出明确警告，不静默。

### 8.5 App view

- app view 由 **被调用工具的定义** 触发：工具 definition 的 `_meta.ui.resourceUri` 决定是否有 UI，而不是结果。现有 `MCPToolWrapper` 需要保留 `toolDef._meta` 并关联到 call id；`convertMcpToolContent` 现在会丢掉它。
- 当工具声明了 `_meta.ui.resourceUri`，agent 生成一个 app view 记录：

  ```json
  {
    "viewId": "av_...",
    "appId": "financebuddy",
    "resourceUri": "ui://financebuddy/consistency-reader",
    "toolCallId": "call_...",
    "toolName": "build_consistency_review",
    "title": "FinanceBuddy consistency review",
    "displayMode": "inline",
    "protocol": "mcp-apps/2026-01-26",
    "initialResult": {
      "content": [{ "type": "text", "text": "..." }],
      "structuredContent": {}
    },
    "artifacts": []
  }
  ```

- `initialResult` 是 MCP Apps host 必须回放给 iframe 的 `tool-input` / `tool-result` 数据；没有它，刷新后 app 无法恢复。
- 持久化策略：
  - `structuredContent` 和文本块默认内联；单个 view 的 JSON 超过 256 KiB 时，完整结果写到 `${APP_DATA}/views/<viewId>/result.json`，transcript 只保留引用。
  - 内联图片/二进制替换为 artifact 引用，文件写到 `${APP_DATA}/views/<viewId>/artifacts/`；transcript 不存 base64。
  - app 需要更多数据时，用反向调用重新获取（例如 FinanceBuddy 用 `run_id` 调 `read_consistency_review`）。
- app view 记录随 `tool_events` 进入 webui transcript；前端在对应 tool call 位置渲染 `AppViewHost`，刷新/重载后从 transcript 重建。
- 宿主通过 MCP `resources/read` 获取 HTML，缓存 key 为 `(appId, resourceUri, contentHash)`。
- iframe 使用 `srcdoc`，`sandbox="allow-scripts"`，**不加** `allow-same-origin`；CSP 注入 HTML head。
- host 在 iframe handshake 后发送 `ui/notifications/tool-input` 和 `ui/notifications/tool-result`；第一版必须实现这两个通知。
- app view 的 `viewId` 是反向调用的作用域；卸载时取消该 view 的 in-flight 调用。
- 首页入口打开的 view 没有原始 tool call 时，`initialResult` 为 `null`，由 app 在 handshake 后通过反向调用自行加载。

### 8.6 反向调用桥

renderer ↔ iframe 用 `postMessage` JSON-RPC（MCP Apps 协议）；renderer ↔ agent 复用现有 WebSocket 通道，新增：

- `app/callTool`：`{ viewId, tool, arguments }` → 校验 → MCP `tools/call` → 返回原始 `content` / `structuredContent`。
- `app/readResource`：`{ viewId, uri }` → 只允许该 app 自己的 `ui://` 和资源白名单。
- `ui/open-link`（标准）：`{ url }` → 校验 `capabilities.openLinks` 和 scheme（仅 `http`/`https`），由 renderer 调 preload 的 `openExternal`，不经过 agent。
- `ui/download-file`（标准）：`{ contents: (EmbeddedResource | ResourceLink)[] }` → 校验 `capabilities.downloads`，host 弹确认后保存。`ResourceLink` 由 host 通过 MCP `resources/read` 读取；app 不能提供任意文件系统路径。大文件优先用 `ResourceLink`，避免把 base64 塞进 iframe 消息。
- `ui/message`（标准）：见 §8.7。
- `ui/request-display-mode`（标准）：见 §8.10。
- `app/callTool` / `app/readResource` 是 renderer↔agent 的内部消息名，对应 iframe 侧的 MCP Apps `tools/call` / `resources/read`；经过 agent 便于统一鉴权和审计。`ui/open-link` / `ui/download-file` 由 renderer/main 执行，但 capability 检查也在 renderer 侧做一次。
- `app/message`：`{ viewId, content }` → 校验 `capabilities.appMessages` → 作为用户消息进入 session。

约束：

- 每个 view 的调用串行；每个 app 最多 4 个并发调用。
- 超时沿用 app 的 `server.toolTimeout`；取消随 view 卸载/abort。
- 错误以 JSON-RPC error 返回，UI 显示可读信息，不把内部异常/凭证泄露给 iframe。

### 8.7 `ui/message`

- `appMessages: false` → 拒绝。
- `appMessages: "ask"` → host 弹出确认，显示 app 名称和消息预览。
- `appMessages: "allow"` → 直接进入 session，但消息 metadata 必须带：
  ```json
  {
    "source": "mcp-app",
    "appId": "financebuddy",
    "viewId": "av_...",
    "appControlled": true
  }
  ```
- UI 将该消息标记为“来自 FinanceBuddy”，不能伪装成用户直接输入。
- 第一版对内置 app 默认 `"allow"`，未来安装的第三方 app 默认 `"ask"`。
- 限流：每个 view 每分钟最多 10 条，防止 app 循环触发。

### 8.8 Host context

只向 iframe 提供最小必要信息：

```json
{
  "theme": "light",
  "locale": "zh-CN",
  "displayMode": "inline",
  "viewId": "av_...",
  "appId": "financebuddy",
  "resourceUri": "ui://financebuddy/consistency-reader",
  "session": { "chatId": "...", "workspaceAvailable": false }
}
```

不提供：API key、完整配置、其他 session 数据、文件系统路径（除非 `workspace != none`）。

### 8.9 入口

- `entryPoints[].action.kind = "tool"`：host 调用指定工具，用结果的 `ui://` 打开 view。
- session 规则：当前 chat 空闲则复用；否则新建一个 chat。入口调用不触发模型 turn，只执行工具并记录一个合成 tool event + app view。当前 chat 正在运行时必须新建，避免和进行中的 turn 交错。
- 第一版只支持 `surface: "home"`；`settings` 显示 app 信息、启用/禁用、凭证缺失提示。
- 不支持任意 React 页面注入。

### 8.10 UI 一致性与体验

目标：**原生外框 + 一致 token + 可预测交互**。不要求像素级一致，app 内部可以保留自己的品牌。

**Host 外框**

- Cuby 渲染卡片、标题、app 名称/图标、工具栏（展开、全屏、刷新、关闭）、加载骨架、错误/重试、空状态；iframe 只渲染内容。
- resource meta 的 `prefersBorder` 决定是否显示边框/背景；Cuby 默认给卡片样式。
- 第三方 app 显示“由 X 提供”徽标；内置 app 显示 app 名称。

**主题 token**

- 映射 MCP Apps 标准 host context：
  - `theme`：`light` / `dark`
  - `styles.variables`：标准 CSS 变量（background / text / border / ring、`--font-sans` / `--font-mono`、字号/行高、圆角、阴影）
  - `styles.css.fonts`：host 注入的 `@font-face`
- 通过 `ui/initialize` 和 `ui/notifications/host-context-changed` 下发；运行时值覆盖 app 的构建时兜底。
- 提供 `@cuby/app-ui-tokens`（CSS + JSON）作为 app 构建时兜底；v1 同时提供最小 `@cuby/app-ui`（button / chip / card / empty state），完整组件库 Phase 2。
- app 必须使用 token 变量，不硬编码颜色/字体；由 conformance 检查。

**布局**

- 使用 `displayMode` / `availableDisplayModes`（inline / fullscreen / pip）、`containerDimensions`、`safeAreaInsets`、`platform`、`deviceCapabilities`。
- inline 最大高度约 `70vh`，超出后内部滚动；side panel 是 inline 的宽容器，fullscreen 全高。
- Cuby 不新增协议 display mode；“side panel”只是宿主对 inline 容器的布局选择，app 通过 `containerDimensions` 适配。
- app 用 `ui/notifications/size-changed` 报告尺寸；host 动画调整容器，避免双滚动条。
- `ui/request-display-mode` 由 app 请求切换；host 返回实际模式，可能因不支持而不同。

**加载与生命周期**

- 工具开始时就预取 `ui://` HTML 并显示骨架；收到 `ui/notifications/tool-input-partial` / `tool-result` 后填充。
- iframe 按 `viewId` 常驻；离屏 view 懒挂载；重渲染不重建。
- 5 秒内未完成 handshake 显示 fallback（重试、查看日志），不白屏。
- 关闭/卸载时发 `ui/resource-teardown`，取消该 view 的 in-flight 调用。
- 错误/空状态优先由 app 用自己的组件渲染；host 提供通用 fallback。

**交互**

- `ui/open-link` 打开外部链接前确认；`ui/download-file` 下载前确认。
- `ui/message` 标注“来自 <app>”；第三方 app 首次使用时可要求确认。
- 焦点：Escape 退出全屏而不是直接关闭；不抢 chat 快捷键；iframe 有可访问标题。
- 深色/浅色、locale/timeZone 随 host context 更新。

**验收**

- 视觉回归矩阵：light/dark × narrow/wide × inline/fullscreen。
- token lint 禁止硬编码颜色/字体；axe 可访问性检查。
- 加载、空、错误、长任务四种状态截图。

## 9. 安全模型

| 面 | 规则 |
|---|---|
| 信任模型 | 第一版只加载 build-time 内置的 app，视为第一方可信代码；server 进程不做 OS 级沙箱。运行时安装的第三方 app 在 Phase 4 必须签名 + OS 沙箱后才能加载。 |
| iframe | `sandbox="allow-scripts"`；无 `allow-same-origin`；无 Node；CSP 默认 `default-src 'none'` |
| 网络 | iframe 默认禁止；`ui.csp` 的 `connectDomains` / `resourceDomains` 声明 origin，host 注入 CSP 并拦截。server 进程的网络不受此限制，靠第一方信任 + 代码审查。 |
| 反向工具 | 仅限本 app 的 server + `appToolCalls` 白名单 |
| `ui/message` | 能力开关 + provenance + 限流；第三方默认 `ask` |
| 文件 | iframe/bridge 默认只能用 `${APP_DATA}`；workspace 需显式 capability；下载走标准 `ui/download-file`，只接受 `EmbeddedResource` / `ResourceLink`，不接受文件系统路径。server 进程本身不受此限制。 |
| 进程 | 独立子进程；env allowlist；不继承 Cuby 全部环境。这是故障隔离和生命周期边界，**不是**文件系统/网络沙箱。 |
| 凭证 | manifest 只声明 key；值由 host 注入；不写日志 |
| 供应链 | build 生成 hash；第一版不做签名；未来安装器校验签名 |
| 许可 | `licenses[]` 声明；AGPL 等 copyleft 在闭源构建中默认拒绝，需显式 flag |

## 10. 构建流程

### 10.1 选择

仓库根目录 `cuby.apps.json`：

```json
{
  "schemaVersion": 1,
  "apps": ["financebuddy"]
}
```

优先级：

1. CLI / 环境变量 `CUBY_APPS`：逗号分隔；空字符串 = 不打包任何 app；`*` = 全部。
2. `cuby.apps.json`。
3. 默认：`[]`（不打包第三方垂类）。

默认空集合是有意的：FinanceBuddy 的 PyMuPDF 许可未解决前，普通发行版不应自动带上它。需要 FinanceBuddy 的构建显式选择。

### 10.2 步骤

1. 读取选择，发现 `apps/*/app.json`。
2. 校验：
   - JSON schema；
   - `id` 唯一、`version` semver、`engines.cuby` 满足；
   - 当前平台有 `server.command` / `runtime`；
   - `capabilities.appToolCalls` 非空时，对应工具在 `tools/list` 中存在（仅在动态探测时检查；跨平台构建跳过并在日志标记为未验证）；
   - 没有明文密钥；
   - 所有 `ui.resources[].uri` 在 `resources/list` 中存在；
   - 所有工具声明的 `_meta.ui.resourceUri` 都在 `ui.resources[]` 中；
   - `ui.csp` / `ui.prefersBorder` 与 `resources/list` 的 `_meta.ui` 不一致时失败（运行时以 resource metadata 为准）。
3. 构建 UI：执行 app 自己的 `build.ui.command`，检查 `build.ui.output`。
4. staging 到 `dist/apps/<id>/`，只复制 `include` 且不匹配 `exclude` 的文件。
5. 生成 `dist/apps/registry.json`：

   ```json
   {
     "schemaVersion": 1,
     "hostApiVersion": 1,
     "generatedAt": "2026-11-21T00:00:00.000Z",
     "apps": [
       {
         "id": "financebuddy",
         "version": "0.5.1",
         "path": "financebuddy",
         "hash": "sha256-...",
         "manifest": "financebuddy/app.json"
       }
     ]
   }
   ```

6. 复制 `licenses[].noticeFile` 到 app 目录；检查 copyleft 策略。
7. electron-builder 增加：

   ```json
   "extraResources": [
     { "from": "dist/apps", "to": "apps" }
   ]
   ```

8. 冒烟测试 `scripts/apps/smoke.mjs`：
   - 启动 server；
   - `initialize`；
   - `tools/list` / `resources/list`；
   - 读取每个 `ui.resources[].uri`；
   - 校验 hash 与 registry 一致。
   失败则 build 失败。

**动态探测策略：**

- 静态校验（schema、manifest 引用、文件存在）在所有目标平台执行。
- 启动 server 的动态探测只在“目标平台 == 构建主机”且 `CUBY_APPS_PROBE != "0"` 时执行；跨平台构建跳过，避免在 macOS 上执行 Windows Python。
- 每个目标平台在 CI matrix 的原生 runner 上跑 smoke test；跨平台构建只保证静态一致性和 hash。
- app server 必须支持 **无凭证启动** 完成 `initialize` / `tools/list` / `resources/list`；凭证只在 `tools/call` 时需要。这不满足时，app 的 manifest 校验失败。

### 10.3 平台、运行时与 SKU

- app 可以只声明部分平台；不匹配时默认警告并跳过，`CUBY_APPS_STRICT=1` 时失败。
- `runtime.kind = "python" | "node"` 的 app 在 release 构建中必须 `bundled: true`，且对应平台路径存在；`bundled: false` 只允许在 `CUBY_ALLOW_SYSTEM_RUNTIME=1` 的内部/开发构建中使用。
- `runtime.kind = "binary"` 可以是随包二进制，也可以是系统命令；系统命令必须声明最低版本，并在启动时检查。
- SKU 构建示例：
  - 默认：`CUBY_APPS=`（无 app）
  - FinanceBuddy 内部版：`CUBY_APPS=financebuddy CUBY_ALLOW_AGPL=1`
- build 日志输出实际打包的 app 列表、版本、hash、runtime 路径。

## 11. 开发流程

### 11.1 从源码加载

```sh
CUBY_DEV_APPS=apps/financebuddy npm run dev:desktop
```

- host 直接读取本地 `app.json`，不依赖 `dist/apps`。
- 可选 `app.json` 的 `dev` 段（build 时剥离）：

  ```json
  "dev": {
    "server": {
      "command": "server/.venv/bin/python",
      "args": ["server/main.py", "--config", "server/dev-config.json"]
    },
    "ui": {
      "urls": {
        "ui://financebuddy/consistency-reader": "http://127.0.0.1:5173"
      }
    }
  }
  ```

- dev 模式下 iframe 加载对应 resource 的 `dev.ui.urls[uri]`；CSP 仅放行 `http://127.0.0.1:*`。
- dev 段不允许出现在打包产物中；build 校验会拒绝。

### 11.2 UI 热更新

- app 自己选择 Vite/esbuild；host 不规定工具。
- UI dev server 提供 HMR；host 只需重新加载 iframe。
- server 改动由 app 的 dev 命令重启；host 检测到 MCP 断开会重连/重启。

### 11.3 一致性命令

```sh
npm run app:check -w @cuby/app-financebuddy
```

检查：

- manifest schema；
- MCP initialize / tools/list / resources/list；
- 每个 `_meta.ui.resourceUri` 都在 `ui.resources[]` 中；
- 每个 `ui.resources[].entry` 存在；
- `capabilities.appToolCalls` 都是真实工具；
- token lint：UI 不硬编码颜色/字体；
- 可选：headless 浏览器完成 app bridge handshake；
- 可选：light/dark × narrow/wide 的视觉回归。

### 11.4 新增 app

```sh
npm run app:new -- my-app
```

生成最小模板：`app.json`、一个 stdio MCP server、一个 `ui://` 示例、一个 skill、一个 conformance test。模板第一版可以手写，命令后续补。

## 12. 版本与兼容

- `app.json.schemaVersion`：manifest 结构版本。
- `engines.cuby`：host 版本范围。
- `registry.hostApiVersion`：bridge/宿主 API 版本；不兼容时 host 拒绝加载并提示升级 app。
- `id` 不可变；`name` 可变。
- 同一 app 多版本共存留给安装器；第一版只允许一个版本。
- 升级时 `${APP_DATA}` 保留；数据结构迁移由 app 自己负责。

## 13. FinanceBuddy 迁移映射

| 现有 | 目标 |
|---|---|
| `scripts/financebuddy/windows-payload/` | `apps/financebuddy/server/` + `runtime/win32-x64/` |
| `cuby/reader-consistency/index.html` | `apps/financebuddy/ui/` 构建产物 |
| 7 个 `SKILL.md` | `apps/financebuddy/skills/`，改用 raw tool 名 |
| `local_server.py` + `server.py` | 保持 stdio MCP；`_meta.ui.resourceUri` 已在 spike 中验证；`server.scope = "session"` |
| Windows 内嵌 Python 启动逻辑 | `app.json.runtime` + `server.command` 平台映射 |
| Cuby core 的 finance contracts/routes/components | 删除；只保留通用 app host |
| `VITE_CUBY_LAN_TRIAL`、finance 项目发现 | 由 app 的 entry point / 配置替代，或留在产品分支单独评审 |
| PyMuPDF 许可 | app 的 `licenses[]` + build 策略；未解决前默认不打包 |

迁移后的 app 不包含任何 Cuby React/contracts/路由代码。FinanceBuddy 可以继续在自己的仓库开发，通过 workspace 链接或 submodule 挂到 `apps/financebuddy`；host 不关心 app 源码放在哪。

### 13.1 FinanceBuddy 作为参考 app

实现完成后，用 FinanceBuddy 做端到端验收，覆盖：

1. `CUBY_APPS=financebuddy` 构建，registry、hash、runtime 平台校验通过。
2. `server.scope: "session"`：两个并发 chat 的 C2 状态互不污染。
3. 模型调用 `build_consistency_review`，app view 以宿主外框 + Cuby token 渲染；长任务期间骨架和 `tool-input-partial` 可见。
4. reader 反向调用 `read_consistency_review` / `read_consistency_page`；白名单外调用被拒绝。
5. “在對話中問這項” 走 `ui/message`，消息带 FinanceBuddy provenance。
6. PDF 导出走 `ui/download-file`（`ResourceLink`），host 弹确认，不暴露文件路径。
7. 刷新/重载后 app view 从 `initialResult` 恢复，reader 用 `run_id` 重新拉取数据。
8. light/dark、窄/宽、inline/fullscreen 的视觉回归；token lint 无硬编码颜色。
9. 模型未配置时进入 `missing_credentials`，配置后自动恢复。
10. disable app 后工具、skills、入口同时消失，UI 有明确提示，不静默。

## 14. 验证清单

- [ ] manifest schema 接受合法示例，拒绝未知占位符、明文密钥、缺失平台 runtime、`scope != session` 却使用 `${SESSION_WORKSPACE}`。
- [ ] `CUBY_APPS` / `cuby.apps.json` 选择正确；空集合不打包 app。
- [ ] registry 的 hash 与 staging 文件一致。
- [ ] 打包后 `resources/apps/<id>/app.json` 可被 host 读取。
- [ ] app 启动失败不阻塞其他 app，且 UI 可见错误。
- [ ] `missing_credentials` 状态可见，补全凭证后自动恢复。
- [ ] `scope: "session"` 的 app 每个 session 独立进程，C2/run 状态不跨 chat 泄漏；空闲回收生效。
- [ ] 工具命名与 raw→namespaced 映射正确；skills 不含 host 前缀。
- [ ] 带 `_meta.ui.resourceUri` 的工具会生成 app view，`initialResult` 能在 transcript 重载后回放。
- [ ] 超过 256 KiB 的 view 结果与图片 artifact 正确外置，transcript 不存 base64。
- [ ] 多 UI resource 的 app 能分别打开、缓存、恢复。
- [ ] iframe 无 `allow-same-origin`；CSP 默认拒绝网络；`ui.csp` 只放行声明 origin。
- [ ] 反向调用白名单外被拒绝；跨 app 调用被拒绝。
- [ ] app UI 发起的 `callTool` 不进入模型可见的 tool events，但写入审计日志。
- [ ] `ui/message` 的 `false` / `ask` / `allow` 行为正确，provenance 可见，限流生效。
- [ ] `capabilities.workspace = none` 时 `${SESSION_WORKSPACE}` 不可用。
- [ ] `ui/open-link` 只允许 http/https 且需确认；`ui/download-file` 只接受 `EmbeddedResource` / `ResourceLink`，不接受文件路径。
- [ ] host context 的 `theme` / `styles.variables` / `styles.css.fonts` 正确注入；app 在 light/dark 下都使用 token。
- [ ] 宿主外框、加载骨架、错误/重试、空状态、app 徽标正常；`prefersBorder` 生效。
- [ ] `displayMode` / `containerDimensions` / `safeAreaInsets` 正确；`size-changed` 不会产生双滚动条。
- [ ] 工具开始时预取 UI，`tool-input-partial` 和 `tool-result` 按顺序送达；handshake 超时有 fallback。
- [ ] iframe 按 viewId 常驻，离屏懒挂载；关闭时发 `ui/resource-teardown`。
- [ ] token lint 禁止硬编码颜色/字体；light/dark × narrow/wide × inline/fullscreen 视觉回归通过；axe 无严重问题。
- [ ] `modelConfig` 能力注入的配置可用；用户未配置模型时显示 `missing_credentials`。
- [ ] build 拒绝 dev 段、`.venv`、`node_modules`、密钥。
- [ ] release 构建中 Python/Node app 必须 bundled runtime；系统 runtime 需要显式 flag。
- [ ] 跨平台构建跳过动态探测；原生 CI runner 上 smoke test 通过。
- [ ] AGPL app 在未显式允许时不能进入闭源构建。
- [ ] FinanceBuddy 端到端：create/save/build/read、reader app view、反向调用、`ui/message`、`ui/download-file`、session 隔离、UI 视觉回归。

## 15. 留给 builder 的决定

以下是设计有意留白的实现选择：

- iframe 用 `srcdoc` 还是自定义协议；CSP 用 meta 还是 Electron session header。
- 凭证存配置还是系统钥匙串；迁移策略。
- skill 工具映射的注入方式（system prompt section / 前处理 / 生成文件）。
- `scope: "session"` 的工具如何从 `ToolExecutionContext` 拿到 session key，以及 registry 如何持有每 session 的 server 实例。
- registry hash 粒度（整包 vs 逐文件）。
- app view 在 transcript 中的具体字段名（`app_views` vs 嵌入 `tool_events`）。
- 超过 256 KiB 的 view 结果和 artifact 的清理策略（随 transcript 删除、LRU、保留天数）。
- UI 构建工具（app 自选，host 不强制）。
- 平台 runtime 的打包细节（Python 裁剪、macOS 签名/公证）。
- `modelConfig` 注入格式（JSON 文件路径 vs env JSON）。
- `ui/open-link` / `ui/download-file` 的 main 侧确认 UI 与一次性 token 方案。
- Cuby token → `McpUiStyleVariableKey` 的映射表维护方式（设计系统导出 vs 手写）。
- `@cuby/app-ui` v1 的最小组件范围（button / chip / card / empty state）。
- 视觉回归工具（Playwright screenshot、Storybook harness 或其他）。
- 审计日志的轮转和保留。
- 未来安装器的包格式（zip / tar / 目录）和签名方案。

## 16. 分阶段

**Phase 1：契约与宿主 MVP**

- `app.json` schema + 校验器；
- `apps/` workspace + 构建选择 + registry；
- AppManager：发现、启动、工具注册、skills、失败降级；
- `scope: "global"` 与 `"session"` 两种进程模型；
- AppViewHost：iframe + bridge + `initialResult` 持久化/回放；
- 宿主外框、加载/错误/空状态、token 注入（`theme` / `styles.variables` / `styles.css.fonts`）；
- `@cuby/app-ui-tokens` + 最小 `@cuby/app-ui`（button / chip / card / empty state）；
- 反向调用、`ui/message`、`ui/open-link`、`ui/download-file`；
- 用 spike 的 FinanceBuddy reader 做端到端验证。

**Phase 2：开发体验与打包**

- dev 模式 + HMR + `app:check`；
- 视觉回归、token lint、axe 检查；
- 完整 `@cuby/app-ui` 组件库；
- electron-builder `extraResources`；
- 平台 runtime 校验 + 原生 smoke test + 跨平台静态校验；
- 许可/notice 检查；
- app 模板与开发者文档。

**Phase 3：FinanceBuddy 迁移**

- 把 server/UI/skills 移入 app 包；
- 删除 Cuby core 的 finance 代码；
- 凭证注入（模型配置、WeKnora）；
- SKU 构建；
- 解决 PyMuPDF 许可或明确不随闭源包分发。

**Phase 4（后续）**

- 运行时安装/卸载/升级；
- 签名、信任等级、第三方 app 的 OS 沙箱；
- 第三方 app 的 `ask` 默认与权限面板；
- 更多 display mode（side panel、fullscreen）。

## 17. 参考

- MCP Apps SEP-1865：https://modelcontextprotocol.org/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp
- MCP Apps 规范（2026-01-26）：https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
- 本仓库架构调研：`docs/superpowers/specs/2026-11-20-financebuddy-extension-architecture.md`
- FinanceBuddy 未决问题：`docs/superpowers/specs/2026-11-21-financebuddy-open-issues.md`
