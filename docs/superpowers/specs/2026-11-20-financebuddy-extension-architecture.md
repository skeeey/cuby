# FinanceBuddy 解耦与扩展机制调研：MCP Apps vs Cordis，以及 Cuby 的演进路径

- 日期：2026-11-20
- 状态：调研总结 / 决策输入
- 背景分支：`upstream/financebuddy`（19 commits，146 files，+22,987/−113，基线 `6694af40`）
- Spike：DeepSeek Harness `0.2.2-rc.5` + `dsh-mcp-apps@0.2.6` + FinanceBuddy packaged MCP server `0.5.1`

## TL;DR

1. **FinanceBuddy 和未来垂直场景的边界应该用 MCP Apps，不要用进程内插件。** MCP Apps 是标准化的跨进程 UI/能力协议；Cordis 是进程内的插件/依赖注入框架，`isolate()` 是服务作用域隔离，不是安全沙箱。
2. **DSH 用 Cordis 的方式值得借鉴，但不要照搬。** 它把 Cordis 只当组合层，安全放在独立的“能力接缝”上（`tools/pre-execute`、`ctx.tools.guard()`、`ctx.sandbox`、`ctx.approval`、凭证引用、工作区分级）。代价是插件仍是可信代码，第三方插件生态安全依赖人工审计。
3. **Cuby 的推荐演进：core 增加通用 MCP Apps 宿主 + 最小 extension manifest；FinanceBuddy 变成独立发版的 MCP 包（Python server + skills + `ui://` reader）；Cordis 只作为 core 内部或 extension 包内部的实现选择，单独评估。**
4. Spike 已证明：20 个 MCP 工具、7 个 skills、项目建/存/审/读、Reader 原页渲染、反向工具调用、App→Chat 消息全部可用。剩余问题集中在 skill/工具名 host 耦合、semantic 模型配置、C2 进程内状态和 host 折叠行为。

---

## 0. 背景与目标

`upstream/financebuddy` 是一个把 FinanceBuddy 整套接进 Cuby 桌面端的分支。按改动面粗略拆分：

- **约 90% 是 FinanceBuddy 领域代码**：React 工作台/Reader/一致性界面（约 6k 行）、finance 专用 contracts（约 1.2k 行）、finance WebSocket 路由、Windows 内嵌 Python 运行时与打包脚本。
- **约 10% 是与 finance 无关、值得单独进 main 的通用修复**：
  - OpenAI Responses 流式工具调用身份保留（`call_id`/`item_id`/`output_index` 别名映射，`App/memmy-agent/src/providers/openai-responses/parsing.ts`）
  - 工具 schema `strict` 默认值与 nullable 联合类型还原（`converters.ts`）
  - `tools.allowedTools` 白名单（`config/schema.ts` + `ToolRegistry` 注册过滤）
  - `gateway({ sessionDir })` 隔离 session store
  - WebSocket 首条消息重试与 session retarget 拒绝的先后顺序
  - 可推广的“生成 prompt 的显示摘要”机制（目前还是 finance 专用命名）

目标是：**main 保持通用，未来垂直场景可接；不把领域代码和领域 UI 强耦合进 core。**

为此做了一个隔离 spike：在 WSL 内独立 `DSH_HOME` 起 DSH web profile，挂载分支里的 packaged FinanceBuddy MCP server、7 个 `SKILL.md`、官方 PDF，并用一个标准 `ui://` MCP App 做 Reader。

---

## 1. MCP Apps vs Cordis

### 1.1 一句话定义

- **MCP Apps**（SEP-1865，Final；规范修订 `2026-01-26`）：MCP server 通过 `ui://` resource 提供 HTML，工具用 `_meta.ui.resourceUri` 声明交互界面；宿主在 **sandboxed iframe** 中渲染，通过 MCP JSON-RPC 双向通信（工具调用、host context、`ui/message`、`ui/open-link`、display mode）。它是一个**跨进程、可独立发版的能力/UI 协议**。
- **Cordis**（cordiverse）：一个 TypeScript 插件化 meta-framework。核心是 `Context`（服务容器）、`ctx.plugin()` + fiber 生命周期、`inject` 依赖、effect 自动清理、`isolate()/fork()` 作用域。它是**进程内代码插件框架**，为框架作者设计，Koishi 与 DSH 都在用。

### 1.2 对比

| 维度 | MCP Apps | Cordis |
|---|---|---|
| 定位 | 跨进程能力 + UI 协议 | 进程内插件 / DI / 生命周期框架 |
| 信任边界 | sandboxed iframe；host 按 server/tool 白名单转发工具调用 | 插件与宿主同进程、同权限，无内置沙箱 |
| API 面 | 协议定义的窄接口：`ui://` resource、`tools/call`、`ui/message`、host context、CSP/permissions | 任意内部 service/context/事件，能力最强 |
| 分发 | MCP server 独立安装、独立版本；任何语言 | npm 包 + bundle/profile patch；JS/TS、ESM |
| 版本兼容 | 协议版本 + 向后兼容；host 可同时支持多版本 | 与宿主/Cordis 版本强相关，peer range 不匹配会拒绝加载 |
| 安全 | host 控制 CSP、iframe sandbox、工具作用域、消息审批、下载边界 | `isolate()` 只是服务作用域；安全需要另外设计 |
| UI 形态 | HTML/iframe；主题与布局由 host 注入 | React 组件/任意宿主 UI，原生体验最好 |
| 成熟度 | SEP Final、规范稳定；生态仍早期，跨厂商 | v4，Koishi/DSH 生产使用；插件生态质量参差 |
| 最适合 | 其他团队/垂直场景提供的扩展、第三方 app | 同仓库、同发版、同信任级别的一等模块 |

### 1.3 对 Cuby 的优缺点

**MCP Apps**

- 优点：
  - core 不需要认识 finance 领域类型、路由或组件；垂直代码可独立发版、独立测试。
  - 自带 sandbox/CSP/工具作用域，安全边界清晰；支持 Python/Node/任何语言的扩展后端。
  - 与 DSH、Claude、ChatGPT、VS Code 等宿主共享协议，未来可复用生态。
- 缺点：
  - iframe 内 UX 不如原生 React：主题、resize、上传/下载、深链、会话上下文都要走 host bridge。
  - host 必须自己实现并跟进规范修订；当前各家 host 对 `ui/message`、`updateModelContext` 等能力支持不一致。
  - 年轻标准，社区 host 插件质量参差（Spike 里就遇到 DSH host 的折叠 DOM 兼容 bug）。

**Cordis**

- 优点：
  - 依赖注入 + 生命周期 + effect 清理 + HMR，极适合“一切皆插件”的一等模块组合。
  - 服务/事件/瀑布式 middleware 能把策略、审批、工具链做成可替换插件。
  - 对同仓库、同发版的团队，开发体验和可组合性很好（DSH 已证明）。
- 缺点：
  - **不提供安全边界**：插件是进程内可信代码，能直接改 sandbox 策略、读凭证；`isolate` 不是沙箱。
  - 与宿主版本强耦合；插件兼容性、启动顺序、调试复杂度都会上升。
  - 引入它是一次架构押注，收益主要在 core 内部模块化，不解决“领域代码别进 main”。

### 1.4 结论

两者不是二选一：

- **扩展边界用 MCP Apps**：FinanceBuddy 和未来垂直场景以 MCP server + `ui://` app + skills 的形式存在。
- **Cordis 只做组合层**：可以出现在 Cuby core 内部，或 extension 包内部；不要用它承担第三方扩展的信任边界。

Spike 已经验证：FinanceBuddy 后端是 Python，完全不需要 Cordis；DSH 自己的 MCP Apps host 反而是 Cordis 插件。**协议边界和实现框架是两层，不要混为一谈。**

---

## 2. DSH 如何使用 Cordis（以及如何绕开 Cordis 的短板）

### 2.1 架构

DSH 是“everything is a plugin”的微内核：

- **Service**：插件在 `ctx` 上注册稳定 key（`ctx.tools`、`ctx.llm`、`ctx.sessions`、`ctx.agents`），其他插件按 key 注入。
- **Event**：`emit` / `waterfall` / `parallel` / `serial`；审批与安全拦截都走 waterfall。
- **Effect**：注册通过 `ctx.effect()`，插件卸载自动撤销，支持热挂载/卸载。
- **Profile / Bundle / Patch**：运行中的 DSH 是按层叠配置组装出的插件树（profile bundles → profile patch → home patch → `--patch` overlay）。

### 2.2 安全接缝（Cordis 不负责的部分）

| 能力 | DSH 的机制 |
|---|---|
| 权限门 | `tools/pre-execute` waterfall 返回 `deny` / `ask` / `next()`；`ctx.tools.guard()` 用于不可绕过的单调最终拒绝 |
| 子进程沙箱 | `ctx.sandbox` 后端（Linux Landlock / macOS sandbox-exec），由 `dsh-bash-sandbox` 等插件提供 |
| 用户审批 | `tools/pre-execute` 返回 `ask`，经 `ctx.approval` 提问；answerer 缺失/抛错/不合规一律视为不可用（fail closed） |
| 凭证 | 以环境变量/引用传递，不传明文；Web UI 存在 `$DSH_HOME/.credentials.yaml`，界面只显示 masked 描述 |
| 工作区权限 | ReadOnly / Workspace Write / Full access 三级 |
| 工具作用域 | preset 声明工具集合；subagent 行会 deny 指定工具；MCP 工具按 server 命名空间隔离 |

### 2.3 它没有解决的问题

- **插件仍是可信代码**：进程内插件可以直接绕过 `tools/pre-execute`、改 `ctx.sandbox`、读凭证。Cordis 不提供插件级沙箱或 auth 隔离。
- **DSH 官方 SAFETY.md 明确说未做安全审计、不能视为生产安全。**
- 第三方审阅已经给出实例：一个 TUI 皮肤插件可以重写 sandbox 策略，在 Windows 上强制 `danger-full-access`；一个“auto”权限插件并没有新增沙箱层级，只是审批预设；装十个热门插件可能直接起不来。
- 账号认证/登录不在 Cordis 层；DSH 的 Electron 到 “authenticated Host” 的机制文档也没有细说。

### 2.4 优缺点

**优点**

- 组合能力极强：模型适配器、工具、会话日志、agent loop、sandbox、存储、UI、启动器都能替换。
- 热挂载/卸载、effect 清理、profile/patch 分层，适合长期演进与多发行版。
- 安全策略可以做成插件（审批、guard、sandbox），便于统一治理。

**缺点**

- 插件信任模型弱；安全取决于用户装了哪些插件、是否读过源码。
- 兼容性/版本/启动顺序/调试复杂度上升；插件生态质量参差。
- 宿主 DOM/API 变更会直接打断上层插件。Spike 里 DSH `0.2.2-rc.5` 改了 turn/“Called tools” 的折叠 DOM，`dsh-mcp-apps@0.2.6` 的 reveal 逻辑失配，App 在回复完成后被折叠消失；我们只能在本地 patch 插件。

### 2.5 对 Cuby 的启示

- **可以借鉴 DSH 的“安全接缝”设计**：工具 pre-execute 策略、单调 guard、审批 fail-closed、凭证引用、工作区分级。
- **不要用 Cordis 来承载第三方扩展**；如果引入 Cordis，先定义安全接缝，再谈“一切皆插件”。
- **垂直扩展仍然走 MCP Apps**；Cordis 只作为 core 内部模块化或 extension 包内部的实现选择。

---

## 3. Cuby 可能的演进路径

### 3.1 路径 A：MCP Apps 扩展宿主（推荐）

core 增加一个通用扩展宿主，domain-agnostic：

1. **Extension manifest**（最小）：
   - `id` / 版本 / 显示名
   - `mcpServers`（stdio/streamable-http 配置）
   - `skills`（安装到哪个 skill root）
   - `entryPoints`（首页卡片、设置页、侧栏动作）
   - `ui.resource`（`ui://` app）与 `capabilities`（允许 app 反向调工具、发消息、下载）
   - `installer`（可选的 bundled payload 安装钩子）
2. **Host 能力**：
   - 发现 `ui://` resource，渲染 sandboxed iframe/webview，支持常驻侧面板/分屏/全屏
   - 反向 `tools/call`：按 extension 的 MCP server + tool 白名单作用域
   - `ui/message`：审批 + provenance 标注（“app-controlled content”）
   - host context：主题、locale、当前 session/workspace；artifact 打开/下载
   - extension 生命周期：install/enable/disable/update；bundled payload 的通用安装钩子
3. **技能/入口去 host 化**：
   - skills 只写 raw tool name，host 负责映射（Cuby 的 `mcp_<server>_<tool>`、DSH 的 `mcp__<server>__<tool>`）
   - manifest 声明 skill 依赖的 server/tool；缺失时显式降级，不要静默失败
4. **FinanceBuddy 包**：
   - Python MCP server + 7 个 skills + `ui://` reader；不包含任何 Cuby React/contracts/路由代码
   - 独立版本、独立测试；由 extension manifest 接入 Cuby
   - Windows pilot 的内嵌 Python 运行时改为通用的 “bundled extension payload” 安装钩子
5. **迁移顺序**：
   1. 先把第 0 节列出的通用修复单独进 main
   2. 落地 host + manifest 契约 + 安全模型
   3. 把 finance UI 改成 `ui://` app，删掉 core 里的 finance contracts/routes/components
   4. 打包改为通用 extension payload
   5. 再把 FinanceBuddy 仓库/包独立发版

**风险**：host 自己实现规范；iframe UX 需要桥接能力；协议仍在演进。但这些都是 core 一次性投入，能被未来所有垂直场景复用。

### 3.2 路径 B：core 内部 Cordis 化（独立议题）

把 `memmy-agent` 的 tools/providers/sessions/channels 逐步服务化，采用 Cordis 的 Service/Event/Effect 模型，并借鉴 DSH 的安全接缝。

- 收益：生命周期、依赖注入、热更新、模块边界更清晰。
- 成本：第三方 meta-framework 押注、版本/调试复杂度、需要先设计安全接缝。
- **它不解决 finance 解耦**：finance 代码是否在 main，取决于“core 认识哪些领域概念”，不取决于 DI 框架。
- 建议：先做一个单接缝 spike（例如只把 tool policy/approval 做成 service），验证收益后再决定是否全面引入。

### 3.3 路径 C：混合（长期推荐）

- 边界：MCP Apps（跨进程、独立发版、可沙箱）
- core 内部：Cordis 风格的服务/插件组合（可选）
- extension 包内部：可以用 Cordis 组合自己的服务，但 core 只通过 manifest + MCP 通信
- 安全：统一走 core 的审批/guard/sandbox/凭证引用接缝，而不是依赖插件框架

### 3.4 路径 D：长分支/变体发行（兜底）

如果短期没有资源做 host：

- 保留 `financebuddy` 长分支或 overlay repo，从 main 定期 rebase
- 只把通用修复 cherry-pick 回 main
- 用独立变体构建 FinanceBuddy pilot 安装包

成本最低、见效最快；长期维护成本最高，且分支会随 main 演进持续漂移。适合作为过渡，不适合作为终态。

### 3.5 决策标准

| 问题 | 选 MCP Apps host | 选长分支 | 选 Cordis 内部化 |
|---|---|---|---|
| 未来还有多个垂直场景？ | ✅ 强需求 | ❌ 每个都开分支 | 不直接相关 |
| 垂直代码由其他团队维护？ | ✅ 独立发版 | 一般 | ❌ 同仓库才行 |
| 需要沙箱/最小权限？ | ✅ | 取决于分支 | ❌ 不提供 |
| UI 必须是原生 React 深度集成？ | 需要 host bridge | ✅ 分支里随便写 | ✅ |
| 6 个月内要交付？ | 需要 host 投入 | ✅ 最快 | ❌ 重构周期长 |
| 团队愿意维护第三方框架？ | 协议可控 | 不涉及 | ✅ 才考虑 |

### 3.6 推荐顺序

1. **拆通用修复**：把第 0 节的通用改动从 financebuddy 分支拆出来，单独 PR 进 main。
2. **定义 host 契约**：MCP Apps host + 最小 manifest + 安全模型 + 面板交互（这一步可以基于本次 spike 的 Reader app 直接演）。
3. **迁移 FinanceBuddy**：修 skill/工具名、QA skill、C2 进程内状态、semantic 模型配置；把 UI 搬回 `ui://` app。
4. **可选评估 Cordis**：用单接缝 spike 验证 core 内部模块化收益，不与 finance 解耦绑定。
5. **打包**：把 Windows 内嵌运行时改成通用 extension payload 安装钩子。

---

## 4. Spike 证据（2026-11-19/20）

### 4.1 已验证

- DSH web profile 通过 `dsh-mcp-apps` 挂载 FinanceBuddy packaged MCP server，**20 个工具全部注册**为 `mcp__financebuddy_reports__*`
- 7 个 `SKILL.md` 从 `$DSH_HOME/skills` 原生加载
- project `create → save → build → read` 全链路通过；官方 PDF SHA-256 与 `yeebo-public-reports.json` 完全一致
- `read_consistency_page` 返回 124,862 字节 PNG data URL，`highlight_status=located`
- MCP App Reader 正常渲染：2 项 checks、coverage chips、PDF p.41 原页 + 高亮
- App 反向 `tools/call` 正常；`ui/message` 成功送达，模型基于该页给出完整分析（Scope 2 基准、2003/2023 年份笔误、FY2024/25 是否重算等）

### 4.2 暴露的问题

1. **Skill 与 packaged payload 错配**：`financebuddy-qa` 引用 WeKnora-only 的 `mcp_financebuddy_*`，packaged pilot 不存在。
2. **Skill 硬编码 host 专属工具名**：Cuby 是 `mcp_financebuddy_reports_*`，DSH 是 `mcp__financebuddy_reports__*`；skills 应只写 raw name 或由 manifest 做 alias。
3. **Semantic 审阅硬耦合 Cuby 配置**：`consistency_semantic.py` 只接受 `protocol: openai-responses` + 内联 `apiKey`；当前 DSH provider 是 `anthropic-messages`，无法直接跑。
4. **C2 的 prepare/finalize 依赖进程内状态**：`local_server.py` 用 `self.c2_reviews` 校验“同一 MCP 连接内 prepare → finalize”；如果模型与 App 走两个连接（例如 host 的 UI bridge 独立连接），finalize 会拒绝。host-agnostic 需要改成磁盘/可恢复状态。
5. **Host 折叠行为**：DSH `0.2.2-rc.5` 改了 turn/“Called tools” 的折叠 DOM（`aria-expanded`、按钮自身带 `data-turn-process`），`dsh-mcp-apps@0.2.6` 的 reveal 逻辑失配；App 在回复完成后被折叠。我们在 spike 里 patch 了插件的 `client.js`（识别 `aria-expanded`、观察 `[data-chat-flow]`、每秒重试），并验证新 turn 的 App 会保持展开。刷新后历史 turn 仍需手动展开一次，因为 App 还没 mount，reveal 无法运行。

### 4.3 结论

- FinanceBuddy 的**工具与 skills 几乎零成本**就能在另一个 host 跑起来。
- **Reader UI 用标准 MCP App 可行**，并且跨 host 复用。
- 真正的 cost 在 **host 能力**（面板、消息、审批、常驻展示）和 **extension 包的 host 中性化**（tool 名、skill 依赖、C2 状态、模型配置）。

---

## 5. 参考

- MCP Apps SEP-1865: https://modelcontextprotocol.org/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp
- MCP Apps 规范（2026-01-26）: https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
- Cordis: https://github.com/cordiverse/cordis
- Cordis 架构概览: https://deepwiki.com/cordiverse/cordis/1-overview
- DSH 架构: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.zh.md
- DSH Extension Cookbook: https://deepseek-harness.github.io/deepseek-harness/en/reference/cookbook/extension-cookbook.md
- DSH MCP client: https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md
- DSH MCP Apps host（社区）: https://github.com/sugarforever/dsh-mcp-apps
- DSH 插件生态审阅: https://www.leiphone.com/category/yanxishe/nTnT9RZW5p5Q23hG.html

## 附录：Spike 位置

- `~/workspace/dsh-finance-spike/`（WSL，隔离 `DSH_HOME`）
- `README.md`：启动方式、Reader app、host 补丁、已验证项、open findings
- `reader-app/`：TypeScript MCP App + esbuild
- `payload/.../cuby/reader-consistency/index.html`：内联 Reader app
- 本地 host 补丁：`dsh-home/profiles/web/node_modules/dsh-mcp-apps/lib/client.js`
