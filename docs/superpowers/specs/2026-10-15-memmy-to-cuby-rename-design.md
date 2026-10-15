# memmy → cuby：品牌与身份改名 — 设计

- 日期：2026-10-15
- 状态：待评审
- 涉及仓库：`memmy-agent`（本仓库）
- 素材规范：仓库根 `cuby.html`《Cuby 机器人素材设计规范 v1.0》（当前未跟踪）
- 相关分支：`feat/cuberouter-login`

## 1. 背景

产品对外从 memmy 改叫 cuby（cube + y，方块机器人形象），与 cuberouter 体系已有的 `cuby-desktop-<用户名>` key 前缀（`.env.example:25`）对齐。

现状盘点（排除 `node_modules`/`dist`/`.git`/`undefined`）：

| 事实 | 数字 | 出处 |
| :--- | :--- | :--- |
| 含 "memmy" 的文件 | 1311 | 全仓 grep |
| "memmy" 出现次数 | 15334 | 同上 |
| 打包身份 | appId `cn.memtensor.memmy`、productName `Memmy` | `App/shell/desktop/electron-builder.yml:1-2`、`electron-builder.win.yml:1-2`、另有 unsigned 两份 |
| `MEMMY_*` 环境变量读点 | 单文件最高 134（`MEMMY_AGENT_DATA_DIR`）、`MEMMY_CONFIG` 100、`MEMMY_HOME` 39 | 全仓 `process.env.*` 统计 |
| `x-memmy-*` 协议头 | 17 个 | 全仓 grep |
| 固定端口 | 18960（memory，35 处）/ 18970 / 18980 / 18990 / 19100 | `App/shell/desktop/src/main/runtime-services.ts:16,18-19`、`main/window-mode.ts:4`、`App/memmy-agent/src/config/schema.ts:1030,1055` |
| 吉祥物素材 | 24 张 PNG + 2 个动效，其中 5 张 PNG 无引用；2 个动效均为旧形象 | `App/frontend/desktop/src/assets/mascot/` |
| 品牌文案 | i18n 中 Memmy 165 处（`messages.ts` 163 + `error-notice-messages.ts` 2）；`"brand.name": "Memmy"` | `i18n/messages.ts:24,1842` |
| 文档（本次不动） | README 两版 107 处；`docs/` 站点 51 个文件 997 处 | `README.md`、`README.zh-CN.md`、`docs/{cn,en}/**/*.mdx` |
| Linux CLI 安装面（本次不动） | 安装到 `~/.local/share/memmy-agent`、命令 `memmy`/`memmy-memory`、systemd 单元、产物 `memmy-agent-linux-cli.tar.gz` | `scripts/install.sh:7,14-15,225,238` |

素材侧已有新版规范：`cuby.html` 定义 **14 个必做姿态 + 5 个预留位 + 1 条待机循环动画**，并已点名代码侧目标文件名 `App/frontend/desktop/src/components/mascot/cuby.tsx`。其中 14 个必做姿态为 Cuby 正式素材（内嵌在该 HTML 中），5 个预留位仍是旧形象参考。

## 2. 目标与非目标

### 目标

1. **用户可见身份全部为 cuby**：页面文案、桌面端应用名与安装目录、安装包名、菜单栏、启动/错误弹窗、通知、更新提示。
2. **磁盘与环境身份为 cuby**：`~/.cuby` 数据目录、`CUBY_*` 环境变量、`x-cuby-*` 协议头。
3. **写进用户机器的产物落在 cuby 命名空间**，与旧 Memmy 的产物互不覆盖（这是"两个 App 共存"的前提）。
4. **新 App 与老 App 可以同时运行**，互不抢端口。
5. **吉祥物换成 Cuby**：14 个必做姿态接正式素材，组件与资源映射按《Cuby 机器人素材设计规范》落地。

### 非目标

1. 不改 npm 包名：`@memmy/*` 10 个工作区包，以及已发布的 `@memtensor/memmy-memory-cli` / `-dsh` / `-openclaw`。
2. 不改内部代码标识符：`memmyMemory`、`memmyConfigPath`、`MemmyAgentClient` 等数千处。
3. 不改配置文件 schema 键：`memmyAgent`、`memmyMemory`——这些键写在**用户自己项目的 package.json 与 `config.yaml`** 里（`App/memmy-agent/src/integrations/channels/registry.ts:120`、`Memory/src/cli/config.ts:51` 等），改了会牵连用户的文件。
4. 不改域名：`memmy.cn`、`memmy.bot`（`.env.example:16-17`，服务端资产）。
5. **不做老用户数据迁移**：`~/.memmy` 与旧 userData 原样保留，Cuby 不读也不动。
6. **不清理旧 Memmy 在用户机器上的残留**（技能目录、hook、标记块）。
7. 不重绘 logo/字标：`docs/assets/logo-{light,dark}.svg` 的 Memmy 字标是矢量轮廓（`<desc>` 里写明 "wordmark converted to vector outlines"），改字需重绘，等新稿。
8. 不改仓库目录 `App/memmy-agent/`（见 D9）。
9. **本次不动文档**：README 与 `docs/` 站点保持原样，留到改名落地后单独一轮（见 D12）。
10. **本次不动 Linux CLI 安装面**：`scripts/install.sh` 一行不改，接受该安装路径在本轮后失效（见 D10）。

## 3. 关键决策

| # | 决策 | 理由 |
| :--- | :--- | :--- |
| D1 | 改名深度 = **产品层 + 磁盘/环境身份** | 用户可见与运维接触到的全部统一为 cuby；内部标识符与包名保留，避免 1300 文件级别的纯机械 diff 带来的回归面 |
| D2 | **不做数据迁移**，`~/.memmy` 与旧 userData 原样不动 | 只有少量测试用户；两套数据目录天然隔离，Cuby 用 `~/.cuby` 从零开始 |
| D3 | **换端口**：18970/28970、18980/28980、19100/29100 | 允许新旧两个 App 同时运行。端口是硬编码默认值不是动态分配，共用会 EADDRINUSE（`runtime-services.ts:2415` 已记录该坑） |
| D4 | **不清理旧残留，但自己的产物必须改名** | "各管各的"要求 Cuby 的技能目录/hook/标记块不能与 Memmy 同名，否则两个 App 会互相覆盖对方的产物 |
| D5 | 吉祥物 14 个必做姿态**从 `cuby.html` 提取**为正式素材 | 已验证：内嵌 PNG 尺寸与规范表逐条吻合（neutral 512×354、chat 512×323、think 512×414…） |
| D6 | 5 个预留姿态（work/point/box/wrench/peek）**先指向 neutral** | 规范中它们仍是旧形象；代码有定义但无场景调用（`mascot/memmy.tsx` 的 `MemmyPose` 联合类型） |
| D7 | **删掉两个旧形象动效**（`memo-idle-alpha.webm` 4.1MB、`pet-entrance.webp` 384×384/85 帧），待机与入场都用静态 neutral | 两者内容已确认为旧形象（米团子）；规范嫌 idle 动画重且明确允许"先给一张静态 neutral，我们沿用现在的上下浮动效果…视频就绪后再替换" |
| D8 | `cuby.jpg` **不进 App 内吉祥物位** | 1376×768 横版、带米色背景与烘焙字标；App 内三处（首页空状态 165px、启动页 205px、宠物窗 120px）要透明底 PNG。可用于 README 头图/官网/DMG 背景（需重裁） |
| D9 | 仓库目录 `App/memmy-agent/` **保留** | 包名不改，目录改了反而错位；改名会连带 CI、`sync-project-version.mjs`、workspaces 配置 |
| D10 | **Linux CLI 安装面本次不动**：`install.sh`、安装目录、命令名、systemd 单元名、产物名全部保持 memmy | 用户决定；代价已确认——该路径在本轮后失效（见 §4.2 说明），完整改名留到后续 |
| D11 | `cuby.html` 归档进 `docs/brand/`，`cuby.jpg` 一并归档 | 作为素材来源与验收依据留档，避免只存在于某人本地 |
| D12 | **文档（README 与 docs 站点）本次不改** | 文档面 1104 处，且要逐条分辨哪些是包名/域名不能改；适合改名落地后单独一轮，避免和 1300 文件的代码改动混在一起审阅 |

## 4. 改名映射

### 4.1 打包身份

| 文件 | 现值 | 目标 |
| :--- | :--- | :--- |
| `electron-builder.yml:1-3` | `cn.memtensor.memmy` / `Memmy` / `Memmy-${version}-${arch}.${ext}` | `cn.memtensor.cuby` / `Cuby` / `Cuby-…` |
| `electron-builder.win.yml:1-3` | 同上 | 同上 |
| `electron-builder.unsigned.yml:1-3` | 同上 + `-unsigned` | 同上 |
| `electron-builder.win.unsigned.yml:1-3` | 同上 + `-unsigned` | 同上 |
| `electron-builder.win.yml:84`、`win.unsigned.yml:81` | `shortcutName: Memmy`（开始菜单） | `Cuby` |
| `electron-builder.yml:84`、`unsigned.yml:81` | `dmg.title: Memmy Installer` | `Cuby Installer` |
| `electron-builder.yml:70-71` | macOS 权限说明文案含 "Memmy uses the microphone…" | 改 Memmy→Cuby |
| `App/shell/desktop/src/main/main.ts:492` | `app.setName("Memmy")` | `Cuby`（同时决定 userData 与菜单栏名） |
| `scripts/package-win-local.sh:139,143,157` | 按进程名 `Memmy` 停止旧进程 | `Cuby`——与 productName 耦合，不改则本地打包时停不掉新应用 |
| `scripts/internal/mac/install-dev-computer-use.mjs:52` | 开发安装目录 `~/Applications/Memmy Development` | `Cuby Development` |

Windows 安装目录 = `%LOCALAPPDATA%\Programs\<productName>`（nsis `perMachine: false`），随 productName 变为 `Cuby`；macOS 应用包名变为 `Cuby.app`。

### 4.2 Linux CLI 安装面（本次不做）

**本节不落地**：`scripts/install.sh` 一行不改，`~/.local/share/memmy-agent`、`memmy`/`memmy-memory` 命令、systemd 单元名、产物 `memmy-agent-linux-cli.tar.gz` 全部保持原样。

**已知后果：该安装路径在本轮后失效。** install.sh 不是纯文本，它实时给运行时接线：

| 它做的事 | 位置 | 失效原因 |
| :--- | :--- | :--- |
| launcher 里 `export MEMMY_HOME` / `MEMMY_CONFIG` / `MEMMY_AGENT_WORKSPACE` | `install.sh:217-218,232-233` | 新代码读 `CUBY_*`，这些变量被忽略；配置写在 `~/.memmy`，运行时去 `~/.cuby` 找 |
| systemd 单元 `Environment=MEMMY_HOME=…` 等 | `install.sh:269-271,297-300` | 同上，memory 服务与 gateway 的落点与安装脚本不一致 |
| `--endpoint http://127.0.0.1:18960`、`--port 18960` | `install.sh:182,272` | 新代码的 memory 默认端口是 28960 |
| 安装目录、命令名、systemd 单元名、产物名 | `install.sh:7,14-15,225,238` | 与桌面端改名后不一致（命名问题，非功能问题） |

Linux CLI 的完整改名（含上面的功能接线）作为后续单独一轮；在那之前这条路视为不可用。`tests/linux-cli-packaging.test.mjs` 断言的是 install.sh 自身内容（`:243,258,260-262`），本轮不受影响。

边界说明：**只有安装脚本与打包面不动**。`App/memmy-agent/src/entrypoints/cli/linux-systemd-gateway.ts` 属于代码层（端口、路径、env 名随 §4.3/§4.6 一起改）——否则同一份代码里会并存两套"默认端口"。本轮的取舍是"代码统一为 cuby 语义，安装脚本留在 memmy 语义"，两者对不上就是上面那张表的后果。

### 4.3 磁盘数据与环境变量

| 类别 | 现值 | 目标 |
| :--- | :--- | :--- |
| 主目录默认值 | `~/.memmy`（`Memory/src/cli/config.ts:51`、`setup.ts:149,237`、`App/shell/desktop/src/main/main.ts:5647` 等） | `~/.cuby` |
| 派生产物 | `.memmy-knowledge`、`.memmy-upgrade-backup`、`.memmy-bridge-source-hash`、`~/.memmy/{workspace,computer-history,memory-service,analytics-client-id,runtime.json}` | 同名换前缀 |
| 环境变量 | `MEMMY_HOME`(39)、`MEMMY_CONFIG`(100)、`MEMMY_AGENT_DATA_DIR`(134)、`MEMMY_AGENT_SESSION_DAG_DIR`(54)、`MEMMY_CLOUD_SERVICE`(44)、`MEMMY_AGENT_WORKSPACE`(30) 等（含 `MEMMY_CUBEROUTER_*`） | `CUBY_*`，逐名替换 |
| 注入点 | `App/shell/desktop/src/main/main.ts:498,506` 向子进程写 `process.env.MEMMY_HOME` | 写 `CUBY_HOME` |

`App/backend/src/infrastructure/app-state-store/local-data-store.ts:82` 的 memory sqlite 路径、`byok-token-usage/register.ts:53` 的 home 解析等均以此为单一来源，改常量即可传导。

### 4.4 协议头

17 个 `x-memmy-*`（`x-memmy-user-id`、`x-memmy-project-id`、`x-memmy-profile-id`、`x-memmy-session-key`、`x-memmy-workspace-path`、`x-memmy-local-token` 等）→ `x-cuby-*`。

注意：这些头由**生成到用户目录的桥接脚本**发送（`App/backend/src/adapters/outbound/skill-writer/workspace-bridge/runtime.ts:587-590`），头名与生成端必须同批改，否则新 App 与旧脚本不匹配。

### 4.5 写进用户机器的产物

| 产物 | 现值 | 说明 |
| :--- | :--- | :--- |
| 技能目录 | `skills/memmy-memory/`、`skills/memmy-resume/`（`skill-writer/templates/memmy-skill-directory.ts:3-4`，Memory 侧同名副本） | → `cuby-memory`、`cuby-resume` |
| Claude Code 产物 | `hooks/memmy-resume-hook.mjs`、`commands/memmy-resume.md`、`settings.json` 中的 hook 注册 | 同上前缀 |
| 标记块 | CLAUDE.md/AGENTS.md 的 `<!-- memmy:start v=1 -->`、shell profile 的 `# Memmy CLI PATH`（`main.ts:718`） | 两处标记必须改名，否则与 Memmy 争同一区块 |
| 其余 agent | cursor、codex、opencode、deepseek-harness、hermes、pi、qwenwork、workbuddy 的对应产物 | 同上 |

### 4.6 端口

共 5 个会互相争夺的固定端口。代码里已明确记录争用点：`App/shell/desktop/src/main/main.ts:4990` 注释 "contending for the fixed ports (memory 18960 / agent gateway) and causing a startup failure"。

| 用途 | 现值 | 目标 | 位置 |
| :--- | :--- | :--- | :--- |
| memory 服务 | 18960 | 28960 | `runtime-services.ts:16`、`App/memmy-agent/src/memmy-memory/discovery.ts:7`、`App/backend/.../workspace-bridge/runtime.ts:37`，以及**生成到用户机器的技能/插件模板**（`templates/memmy-resume-hook.ts:767`、`memmy-opencode-plugin.ts:530`、`memmy-deepseek-harness-plugin.ts:298`、`openclaw/target.ts:231,800,897`、`hermes/target.ts:448,1334`）——共 35 处 |
| agent gateway health | 18970 | 28970 | `runtime-services.ts:18`、`App/memmy-agent/src/config/schema.ts:1055` |
| agent websocket | 18980 | 28980 | `runtime-services.ts:19`、`websocket.ts:574`、`linux-systemd-gateway.ts:290`、`http-memmy-agent-admin-client.ts:10`、`api/memmy-agent-client.ts:145`、`vite.config.ts:9` |
| agent local API | 18990 | 28990 | `App/memmy-agent/src/config/schema.ts:1030` |
| packaged renderer | 19100 | 29100 | `App/shell/desktop/src/main/window-mode.ts:4` |

仅开发期使用、不参与争用，**不改**：19000 / 19001（前端 dev + HMR，`App/frontend/desktop/vite.config.ts:80,85`）、18961（Memory viewer dev，`Memory/viewer/vite.config.ts:19`）。

18960 是与 §4.5 同类的耦合：它同时出现在运行时代码和生成到用户机器的模板里，必须与生成端同批改。

### 4.7 吉祥物与素材

组件与类型：

| 位置 | 现值 | 目标 |
| :--- | :--- | :--- |
| 组件文件 | `src/components/mascot/memmy.tsx` | `cuby.tsx`（规范点名） |
| 导出 | `Memmy`、`MemmyPose`、`MemmyProps`、`preloadMemmyAsset` | `Cuby`、`CubyPose`、`CubyProps`、`preloadCubyAsset` |
| 引用 | 31 个文件 `<Memmy …>` | 同步改名 |
| CSS 类 | 183 处 `memmy-*`（含 `memmy-bob`） | `cuby-*` |
| 姿态映射 | `pet-page.tsx:2569` `resolveMemmyPose`、`pet-page.tsx:36` `PET_TIMING.mascotSize=120`、`window-mode.ts:107` 宠物窗参数 | 函数改名；尺寸/锚点不变 |

资源（`src/assets/mascot/`）：

- **14 个必做姿态**：从 `cuby.html` 提取 → `cuby-<pose>.png`，尺寸如下（与规范表一致，均已验证）：

  | pose | 尺寸 | 用途 |
  | :--- | :--- | :--- |
  | neutral | 512×354 | 待机默认 + 加载失败兜底 |
  | chat | 512×323 | 对话中 / 激活 |
  | think | 512×414 | 任务处理中；首页与对话流思考占位 |
  | celebrate | 512×282 | 任务完成 / 首次报告 |
  | sleep | 512×331 | 30 分钟无操作 |
  | wave | 512×327 | 欢迎页、登录页 |
  | read | 512×403 | 首次扫描历史记录 |
  | shield | 512×417 | 隐私说明；记忆插件冲突弹窗 |
  | brain | 512×330 | 产品导览"记忆"两步 |
  | connect | 512×342 | 工具 / 集成页 |
  | hum | 512×335 | 设置页；改进计划弹窗 |
  | blush | 512×470 | 设置昵称弹窗 |
  | sad | 512×403 | 额度耗尽提示 |
  | plead | 512×350 | 启动失败页 |

- **5 个预留姿态**（work/point/box/wrench/peek）：规范中仍为旧形象 → 按 D6 指向 neutral，删除对应 `memmy-*.png`。
- **待机与入场动画**：删 `memo-idle-alpha.webm`（4.1MB）与 `pet-entrance.webp`（384×384、85 帧，已确认是旧形象入场动画），`pet-page.tsx:16` 的引入改为静态 neutral + 现有 bob；新动画到位后按规范替换 `cuby-idle-alpha.webm`，程序不用改。
- **无引用素材**（5 张）：`memmy-body-blush.png`、`memmy-paddle.png`、`memmy-rice-poc.png`、`memmy-rice-transparent.png`、`memmy-rice-white.png` → 删除。
- **`memmy-rice.png`（5 处引用的 neutral 底图）**：删除，由 `cuby-neutral.png` 取代。
- **账号 logo**：`assets/brand/memmy-cover.png`（`components/model-provider-logo.tsx:1`）、`assets/llm-provider-logo/memmy-account.png`（`pages/llm-provider-logo.tsx:6`）→ 改名；图形内容待新稿。

### 4.8 页面文案

`App/frontend/desktop/src/i18n/messages.ts` 中 165 处 Memmy（`"brand.name": "Memmy"` 位于 `:24` 与 `:1842`）、启动/失败弹窗（`main.ts:812` "Memmy 启动失败"）、启动页文案（`startup-splash.ts:55,59,61`）、更新提示文案。

### 4.9 发布与 CI

| 位置 | 现值 | 目标 |
| :--- | :--- | :--- |
| `scripts/auto-release-mac.sh:159,168` | `Memmy-<ver>-darwin-arm64-{cn,intl}-signed.dmg` | `Cuby-…` |
| `scripts/internal/win/build-nsis.sh:127-128,354` | `Memmy-<ver>-win32-….exe`、`Memmy.exe` | `Cuby-…` |
| `.github/workflows/build-desktop.yml:147` | `Memmy-<ver>-win32-x64-…-unpacked.zip` | `Cuby-…` |
| `.github/workflows/memory-release.yml:100` | release 名 `Memmy Memory <ver>` | `Cuby Memory <ver>` |
| 更新清单 | `DEFAULT_UPDATE_MANIFEST_URL`（`main.ts:3155`）返回的包名/URL | **服务端同步**，见 §8 |

Linux CLI 的发布链路（`scripts/install.sh:5` 产物名、`.github/workflows/linux-cli-installer.yml`）随 §4.2 不动。

### 4.10 文档（本次不做）

**本节不落地**，只作为后续单独一轮的底稿：文档改动面大（1104 处），且代码改名尚未定型前写文档容易返工。改完代码后按下面的盘点执行。

| 位置 | 规模 | 目标 |
| :--- | :--- | :--- |
| `README.md` / `README.zh-CN.md` | 54 / 53 处 | 产品名按 cuby 改写 |
| `docs/cn/**`、`docs/en/**`（.mdx 站点） | 51 个文件、997 处 | 同上 |

改名规则（三档，避免改错）：

1. **跟随改名**：产品名 "Memmy"→"Cuby"、产品模块名 "Memmy Memory"→"Cuby Memory"、路径 `~/.memmy`→`~/.cuby`、环境变量 `MEMMY_*`→`CUBY_*`、命令 `memmy`→`cuby`、安装产物名 `Memmy-*`→`Cuby-*`。
2. **保持原样**：包名 `@memmy/*`、`@memtensor/memmy-memory-*`、仓库目录 `App/memmy-agent/`、域名 `memmy.cn`/`memmy.bot`。
3. **人工判断**：引用旧版本截图/素材的文档页，文案改了但图还是旧形象——按 §7 的素材缺口一并记录，不阻塞。

### 4.11 明确不改

npm 包名（10 个 `@memmy/*` + 3 个 `@memtensor/memmy-memory-*`）、内部代码标识符、config schema 键（`memmyAgent`/`memmyMemory`）、域名 `memmy.cn`/`memmy.bot`、仓库目录 `App/memmy-agent/`、`~/.memmy` 与旧 userData、README 与 `docs/` 站点（D12）、Linux CLI 安装面（D10）。

> 因此改名完成后，代码里仍会出现 "memmy" 字样（包名与标识符），文档与 Linux 安装脚本整段仍是旧品牌。这是 D1/D10/D12 的既定取舍，不是遗漏。

## 5. 分层与顺序

每层独立可回滚、可单独验证；建议按此顺序提交：

1. **打包身份**（4.1）→ 验证：打包产物名、appId、`app.getName()`
2. **磁盘 + 环境变量 + 协议头**（4.3、4.4）→ 验证：路径解析与环境变量相关测试
3. **写进用户机器的产物**（4.5）→ 验证：skill-writer 测试
4. **端口**（4.6）→ 验证：新增端口常量测试（防回退）
5. **吉祥物组件与素材**（4.7）→ 验证：规范验收清单 + 现有 mascot 测试
6. **页面文案**（4.8）→ 验证：i18n 测试
7. **发布与 CI**（4.9）→ **需服务端/发布流程配合**

第 5 步可与第 2-4 步并行（素材独立于代码）。**文档（4.10）与 Linux CLI（4.2）不在本轮**，各自单独一轮。

## 6. 验证

- 现有测试面：`npm test`（含 `test:packaging-guards`、`test:contracts`、`memory:test`、`workspace:test`）——注意 tsconfig 两侧都排除了测试目录，改路径常量后要按各包自己的测试命令跑。
- 新增：端口常量测试（3 个端口不得回退到旧值）、`~/.cuby` 优先路径测试。
- 素材：按 `cuby.html` 的验收清单逐条对（14 姿态齐全、512px 宽、RGBA、本体宽约 59% 水平居中、缩到 26px 可辨认、无烘焙投影、深浅桌面成立）。
- 端到端：本地打包一次 Windows 与 macOS，确认安装目录、开始菜单名、dmg 卷标、应用名。

## 7. 风险与外部依赖

| 风险 | 影响 | 应对 |
| :--- | :--- | :--- |
| **更新链路依赖服务端** | 老版本拉到的清单若指向 `Cuby-*.dmg`，安装后与旧 App 并存而非覆盖 | 服务端同步产出新包名与清单；接受"并存 + 用户手动卸载旧版" |
| 安装包与 appId 变更 | 操作系统视为新应用，旧安装不自动迁移 | 已接受（D2）；测试用户手动卸旧版 |
| 桥接头名与生成端不同批 | 新 App 与旧桥接脚本不匹配 | 4.5 与 4.4 同批落地 |
| 165 处 i18n 文案改动面 | 可能有截图/快照类测试或文档不一致 | 走 i18n 测试；文档与 README 同步 |
| 素材仅 14/19 姿态 | 5 个预留位显示为 neutral | 已接受（D6）；新稿到位后按同一规范补 |
| 无 Cuby 版动效 | 宠物窗待机与入场均为静态图 | 规范明确允许（D7） |
| **文档停留在旧品牌** | 代码与界面已是 cuby，README 与文档站仍是 Memmy，对外不一致 | 已接受（D12）；改名落地后单独一轮补，间隔越短越好 |
| **Linux CLI 安装路径本轮后失效** | install.sh 传的 env 名与端口新代码不再认，配置/数据落点不一致 | 已接受（D10）；完整改名作为后续单独一轮，期间这条路视为不可用 |

## 8. 待定

- 更新清单服务端（`DEFAULT_UPDATE_MANIFEST_URL`）由谁改、何时改——客户端改名不依赖它，但老用户升级路径依赖它。
- `cuby.jpg` 的最终用途（README 头图 / DMG 背景 / 官网）——按 D8 确定不进 App 内吉祥物位，落地位置待选。
- 5 个预留姿态与 Cuby 版待机动画的新稿时间。
- 文档面（README + docs 站点，1104 处）的单独一轮何时做——底稿见 §4.10。
- Linux CLI 安装面的完整改名（含 install.sh 的 env 与端口接线）何时做——底稿见 §4.2；在此之前该安装路径不可用。
