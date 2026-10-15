# memmy → cuby 改名实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把产品身份从 memmy 改成 cuby——打包身份、磁盘与环境变量、写进用户机器的产物、端口、吉祥物素材、页面文案——同时保留 npm 包名与内部代码标识符不变。

**Architecture:** 分层推进，每层独立提交、独立验证。改的是"值"而不是"结构"：绝大多数步骤是按 token 精确替换（不是全仓字符串替换），每层配一条 grep 验证命令，要求返回空。三个面明确不动：`scripts/install.sh`（Linux CLI 安装面）、`README*` 与 `docs/`（文档面）、`@memmy/*` 与 `@memtensor/memmy-memory-*` 包名。

**Tech Stack:** TypeScript、Electron（electron-builder）、Fastify、React、Vitest、npm workspaces、PNG 素材（从 `cuby.html` 提取）。

**Spec:** `docs/superpowers/specs/2026-10-15-memmy-to-cuby-rename-design.md`

## Global Constraints

- **命名规则（素材）**：`cuby-<姿态名>.png`，全小写、短横线连接，放进 `App/frontend/desktop/src/assets/mascot/`。姿态名用 `MemmyPose`（改名后 `CubyPose`）里的英文 id。
- **端口映射（5 个，逐字照抄）**：18960→28960（memory 服务）、18970→28970（agent gateway health）、18980→28980（agent websocket）、18990→28990（agent local API）、19100→29100（packaged renderer）。开发端口 19000 / 19001 / 18961 **不改**。
- **环境变量**：`MEMMY_<NAME>` → `CUBY_<NAME>`，名字其余部分逐字不变（例：`MEMMY_AGENT_DATA_DIR` → `CUBY_AGENT_DATA_DIR`）。
- **协议头**：`x-memmy-<name>` → `x-cuby-<name>`，17 个，逐字对应。
- **机械替换的文件类型范围**：`--include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.json' --include='*.sh' --include='*.ps1' --include='*.cmd' --include='*.nsh'`。**别漏了 shell / PowerShell / NSIS / cmd** —— `scripts/package-win.sh`、`scripts/clear-data.sh`、`scripts/clear-all-windows.ps1`、`App/shell/desktop/build/installer-win-unsigned.nsh` 等文件里同样有路径、环境变量与产品名。
- **绝不动**：`scripts/install.sh`、`scripts/internal/linux/**`、`Memory/installers/**`（独立的 Memory CLI 安装器，装到 `~/.memmy/cli` 与 `~/.memmy/bin`；与 Linux CLI 安装面同类，同样延后，见 Ruling 15）、`README.md`、`README.zh-CN.md`、`docs/**`、`package.json` 的 `name` 字段与所有 `@memmy/*` / `@memtensor/memmy-memory-*` 包名、`App/memmy-agent/` 目录名、`App/memmy-agent/src/memmy-memory/` 模块目录名、`memmy.cn` / `memmy.bot` 域名、config schema 键（`memmyAgent` / `memmyMemory`）、内部标识符（`MemmyAgentClient`、`memmyConfigPath` 等）。
- **排除模式必须用 `grep -vE`**：计划里的排除清单用扩展正则（`'^(\./)?…'`）。用基础正则的 `grep -v` 时 `(\./)?` 会被当作字面字符，整条模式匹配不到任何东西，排除静默失效——**执行时先按 Step 3 的 `wc -l` 与"是否仍含禁改项"两步自检**。
- **清理工具要"加"不要"换"**：`scripts/clear-data.sh`、`scripts/clear-all.sh`、`scripts/clear-all-windows.ps1`、`scripts/clear-win-app-data.cmd` 的职责本就包括清掉**旧安装**的数据，整批改名会让它们再也清不了老 Memmy。这几个文件**排除在机械扫描之外**，由 Task 15 Step 3 单独处理成"同时覆盖 Cuby 与 Memmy"。
- **Windows PowerShell 片段里的 `Add-Type -Namespace Memmy`**（`windows-cli-path.ts:188`）：内部实现细节，不改。
- **提交粒度**：一个 Task 一个提交；每个 Task 结束时该层的测试必须全绿。

## Review Focus

以下五类是 spec 没有逐条规定、但最可能伤到真实使用者的输入/情形。每一条都已在对应 Task 里配了测试：

1. **老 Memmy 与新 Cuby 同时安装**：`~/.local/bin` 下的软链、`~/.claude` 下的技能目录与 hook、shell profile 里的标记块——任何一处同名都会让两个 App 互相覆盖对方产物（Task 6）。
2. **老 App 正在运行时启动新 App**：5 个固定端口被占用会直接启动失败（Task 7）。
3. **机器上 `~/.cuby` 尚不存在**：首次启动必须自建目录并落到新路径，而不是回退读 `~/.memmy`（Task 3）。
4. **升级路径**：已装 Memmy 的用户拉到新版本包名（`Cuby-*.dmg` / `Cuby-*.exe`）时的行为——不会自动覆盖旧安装（Task 1 Step 1 的 artifactName 断言 + Task 14 Step 2 的 `test:release-workflow` + Task 15 Step 4 的本地打包冒烟）。
5. **素材切换时的视觉跳动**：5 个预留姿态回落到 neutral 后，宠物窗与首页空状态之间切换时头顶基准与脚底位置必须不跳（Task 8 Step 2 的尺寸表逐张比对 + Task 11 Step 1 的回落断言）。

---

### Task 1: 打包身份

**Files:**
- Modify: `App/shell/desktop/electron-builder.yml:1-3,70-71,84`
- Modify: `App/shell/desktop/electron-builder.win.yml:1-3,84`
- Modify: `App/shell/desktop/electron-builder.unsigned.yml:1-3,70-71,81`
- Modify: `App/shell/desktop/electron-builder.win.unsigned.yml:1-3,81`
- Modify: `App/shell/desktop/src/main/main.ts:492`
- Modify: `scripts/package-win-local.sh:139,143,157`
- Modify: `scripts/internal/mac/install-dev-computer-use.mjs:52`
- Test: `App/shell/desktop/tests/windows-installer-nsis-compile.test.ts:37,41,57`
- Test: `tests/ocu-dev-install.test.mjs`
- Test: `App/shell/desktop/tests/computer-use-permission-panel.test.ts:33`

**Interfaces:**
- Consumes: 无（首个 Task）。
- Produces: `productName = Cuby`、`appId = cn.memtensor.cuby`、`artifactName = Cuby-${version}-${arch}.${ext}`、`app.setName("Cuby")`、开发安装目录 `~/Applications/Cuby Development`。后续 Task 14（文案）、Task 15（发布）依赖这些名字。

- [ ] **Step 1: 先改测试里的期望值（会失败）**

`App/shell/desktop/tests/windows-installer-nsis-compile.test.ts`：把三处 `Memmy` 改成 `Cuby`（第 37 行 artifact、第 41 行 `Memmy.exe`、第 57 行 `--config.artifactName`）。

`App/shell/desktop/tests/computer-use-permission-panel.test.ts:33` 与 `App/memmy-agent/tests/tools/computer-use/native-agent-lifecycle.test.ts:41`：把 fixture 路径里的 `Memmy Development` 改成 `Cuby Development`。**注意**：`native-agent-lifecycle.test.ts` 的路径是 socket 哈希的输入，改完必须同步更新那条断言里的哈希值（实现时的实测值：`8f6a862c735ba596` → `3ea0aa865f3b08de`）。

`App/shell/desktop/tests/packaged-runtime-boundary.test.ts:490`（**计划原先漏了这个文件**）：该用例直接断言 `main.ts` 源码里存在 `app.setName("Memmy")`，不改它 Step 5 不可能通过，所以它属于本 Task 而不是后续。

`tests/ocu-dev-install.test.mjs`：**本 Task 不改**——它里面没有 `Memmy Development` fixture（原计划写错了），只有一个 dev 包标识 `cn.memtensor.memmy.computeruse.dev`，归 Task 1B。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm --prefix App/shell/desktop test -- tests/windows-installer-nsis-compile.test.ts`
Expected: FAIL —— 断言 `Cuby-nsis-compile-check.exe`，但配置里仍是 `Memmy`。

- [ ] **Step 3: 改四份 electron-builder 配置**

四份文件的第 1-3 行统一改为：

```yaml
appId: cn.memtensor.cuby
productName: Cuby
artifactName: Cuby-${version}-${arch}.${ext}
```

（两个 unsigned 变体的 `artifactName` 保留各自的 `-unsigned` 后缀。）

同文件其余位置：
- `electron-builder.yml:70-71` 与 `electron-builder.unsigned.yml:70-71`：`NSMicrophoneUsageDescription` / `NSAppleEventsUsageDescription` 文案里 `Memmy` → `Cuby`。
- `electron-builder.yml:84` 与 `electron-builder.unsigned.yml:81`：`dmg.title: Cuby Installer`。
- `electron-builder.win.yml:84` 与 `electron-builder.win.unsigned.yml:81`：`shortcutName: Cuby`。

- [ ] **Step 4: 改进程内应用名与两个脚本**

`App/shell/desktop/src/main/main.ts:492`：

```ts
  app.setName("Cuby");
```

`scripts/package-win-local.sh`：第 139、143、157 行的 `Memmy` → `Cuby`（`Get-Process Cuby`、提示语）。

`scripts/internal/mac/install-dev-computer-use.mjs:52`：`'Memmy Development'` → `'Cuby Development'`。

- [ ] **Step 5: 运行打包守卫与相关测试**

Run: `npm run test:packaging-guards && npm --prefix App/shell/desktop test`
Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add App/shell/desktop/electron-builder*.yml App/shell/desktop/src/main/main.ts scripts/package-win-local.sh scripts/internal/mac/install-dev-computer-use.mjs App/shell/desktop/tests tests/ocu-dev-install.test.mjs App/memmy-agent/tests
git commit -m "feat(desktop): rename the packaged app identity to Cuby"
```

---

### Task 1B: 安装器脚本与已安装应用路径

> **为什么有这个任务**：Task 1 把 `productName` 改成 `Cuby` 之后，可执行文件叫 `Cuby.exe` / `Cuby.app`，但安装器、Windows 升级链路与 macOS 后台更新仍在找 `Memmy.exe` / `Memmy.app`。这些文件的测试**不会因此变红**（它们断言的是自己的字面量），所以缺口是静默的——由 Task 1 的实现者在报告里发现。

**Files:**
- Modify: `App/shell/desktop/src/main/main.ts:203`（`WINDOWS_APP_USER_MODEL_ID` 仍是 `cn.memtensor.memmy`，`:494` 用它调 `app.setAppUserModelId`）、`:1436`（`MemmyUpdatePrompt.ps1` 的安装路径）、`:2358,2386,2401`（`/Applications/Memmy.app`）
- Rename + Modify: `App/shell/desktop/build/MemmyWindowsDataMigration.ps1` → `CubyWindowsDataMigration.ps1`
- Rename + Modify: `App/shell/desktop/build/MemmyWindowsUpgradeRelay.ps1` → `CubyWindowsUpgradeRelay.ps1`
- Rename + Modify: `App/shell/desktop/build/MemmyWindowsUpgradeRecovery.ps1` → `CubyWindowsUpgradeRecovery.ps1`
- Rename + Modify: `App/shell/desktop/build/MemmyWindowsUpgradeCleanup.ps1` → `CubyWindowsUpgradeCleanup.ps1`
- Rename + Modify: `App/shell/desktop/build/MemmyWindowsStandardUpgradeCheck.ps1` → `CubyWindowsStandardUpgradeCheck.ps1`
- Rename + Modify: `App/shell/desktop/build/MemmyUpdatePrompt.ps1` → `CubyUpdatePrompt.ps1`
- Modify: `App/shell/desktop/build/installer-win-unsigned.nsh`
- Modify: `scripts/internal/mac/build-dmg.sh:311,660,663`
- Modify: `tests/ocu-dev-install.test.mjs:117`（dev 包标识 `cn.memtensor.memmy.computeruse.dev` → `cn.memtensor.cuby.computeruse.dev`）
- Test: `App/shell/desktop/tests/packaged-runtime-boundary.test.ts:62,919,922,981,984,1421`
- Test: `App/shell/desktop/tests/{windows-upgrade-relay,windows-standard-upgrade-check,windows-data-migration,windows-update-launcher}.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `productName = Cuby`。
- Produces: 安装器、Windows 升级/迁移链路、macOS 后台更新全部按 `Cuby.exe` / `Cuby.app` 工作；`CubyUpdatePrompt.ps1` 的安装路径与 Task 2 的 `%LOCALAPPDATA%\Cuby\launcher\` 一致。

- [ ] **Step 1: 先改测试里的期望值（会失败）**

`packaged-runtime-boundary.test.ts`：`:62` 的脚本路径、`:919`/`:922` 的 NSIS 行、`:981`/`:984` 的 PowerShell 函数名断言、`:1421` 的 `WINDOWS_APP_USER_MODEL_ID` 字面量，全部 `Memmy` → `Cuby`。

`windows-upgrade-relay.test.ts`、`windows-standard-upgrade-check.test.ts`、`windows-data-migration.test.ts`、`windows-update-launcher.test.ts`：把断言与 fixture 里的 `Memmy.exe`、`MemmyWindows*.ps1`、`MemmyUpdatePrompt.ps1`、函数名 `*-Memmy*` 改成对应的 Cuby 名。**注意**：这几个文件里用 `Memmy.exe` 当纯 fixture 文件名的用例（例如 `windows-upgrade-relay.test.ts:154,175,392,406,422,430-431,483,546,596` 里既创建又断言同名文件）**必须整组一起改**，否则创建与断言会不匹配。

- [ ] **Step 2: 运行确认失败**

Run: `npm --prefix App/shell/desktop test -- tests/packaged-runtime-boundary.test.ts tests/windows-upgrade-relay.test.ts`
Expected: FAIL。

- [ ] **Step 3: 重命名七个脚本并改文件内引用**

```bash
cd App/shell/desktop/build
git mv MemmyWindowsDataMigration.ps1 CubyWindowsDataMigration.ps1
git mv MemmyWindowsUpgradeRelay.ps1 CubyWindowsUpgradeRelay.ps1
git mv MemmyWindowsUpgradeRecovery.ps1 CubyWindowsUpgradeRecovery.ps1
git mv MemmyWindowsUpgradeCleanup.ps1 CubyWindowsUpgradeCleanup.ps1
git mv MemmyWindowsStandardUpgradeCheck.ps1 CubyWindowsStandardUpgradeCheck.ps1
git mv MemmyUpdatePrompt.ps1 CubyUpdatePrompt.ps1
```

文件内容按下面三类替换（逐文件核对，不要全仓替换）：

1. **可执行/应用名**：`Memmy.exe` → `Cuby.exe`
2. **脚本互相引用**：`MemmyWindowsDataMigration.ps1` → `CubyWindowsDataMigration.ps1`（`MemmyWindowsUpgradeRelay.ps1:35`、`MemmyWindowsUpgradeRecovery.ps1:54,460` 等）
3. **路径与数据根**：`%APPDATA%\Memmy` → `%APPDATA%\Cuby`、`%LOCALAPPDATA%\Memmy\...` → `%LOCALAPPDATA%\Cuby\...`、`MemmyData` → `CubyData`、`MemmyData\.memmy` → `CubyData\.cuby`

`CubyUpdatePrompt.ps1` 额外改：mutex 名 `Local\MemmyUpdatePrompt-…` → `Local\CubyUpdatePrompt-…`（**必须改**，否则新旧两个 App 会争同一个单例互斥量）、以及 `Join-MemmyChars`、`Get-MemmyUpdatePromptMutexName`、`Enter-MemmyUpdatePromptSingleton`、`Exit-MemmyUpdatePromptSingleton`、`Resolve-MemmyPromptLanguage`、`Get-MemmyAppProcessIds`、`Test-MemmyUpdatePromptDone` 等函数名与其调用点。

- [ ] **Step 4: 改 NSIS include 与 macOS 打包脚本**

`installer-win-unsigned.nsh`：`:405,406,413,414,653,685,688,690,857,868` 的 `File`/`StrCpy`/`FileWrite` 引用改成新的 `.ps1` 文件名；`:460` 的 `Memmy.exe` → `Cuby.exe`。NSIS 变量名（`$MemmyUpgradeRoute`、`$MemmyMigrationScriptPath` 等）与标签（`memmy_standard_check_fresh` 等）属于内部实现，**不改**。

`scripts/internal/mac/build-dmg.sh`：`:311` 的 `APP_PATH="/Applications/Memmy.app"`、`:660`、`:663` 的 `Memmy.app` → `Cuby.app`。

`tests/ocu-dev-install.test.mjs:117`：dev 包标识 `cn.memtensor.memmy.computeruse.dev` → `cn.memtensor.cuby.computeruse.dev`（与 Task 1 已改的 `~/Applications/Cuby Development` 保持一致；本地 dev 安装下次重装时重新注册，无迁移成本）。

- [ ] **Step 5: 改 main.ts 的 AUMID 与已安装路径**

`App/shell/desktop/src/main/main.ts`：

```ts
const WINDOWS_APP_USER_MODEL_ID = "cn.memtensor.cuby";
```

**必须与 `appId` 一致**：electron-builder 用 `appId` 给开始菜单/桌面快捷方式打 AUMID（`node_modules/app-builder-lib/templates/nsis/include/installer.nsh:200,209,225` 的 `WinShell::SetLnkAUMI "${APP_ID}"`）。两边不一致时，Windows 会把装出来的快捷方式和运行中的应用当成两个应用——任务栏固定分组、通知归属、跳转列表都会错乱。Task 1 只改了 `appId`，此处是它的配对项。

```ts
    throw new Error("Cannot resolve installed Cuby.app path for background update");
```

```ts
  const installedCubyAppPath = "/Applications/Cuby.app";
  if (existsSync(installedCubyAppPath)) {
    return installedCubyAppPath;
  }
```

（`:2386` 的注释一并对齐；局部变量名 `installedMemmyAppPath` 同步改名。）

```ts
  const scriptPath = join(localAppData, "Cuby", "launcher", "CubyUpdatePrompt.ps1");
```

- [ ] **Step 6: 运行测试**

Run: `npm --prefix App/shell/desktop test && npm run test:packaging-guards && node --test tests/ocu-dev-install.test.mjs`
Expected: PASS（`ocu-dev-install` 的断言在非 macOS 上会 skip，属正常）。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "fix(desktop): point the installer and upgrade paths at Cuby"
```

---

### Task 2: Windows 本地目录

**Files:**
- Modify: `App/shell/desktop/src/main/windows-launch-at-login.ts:54`
- Modify: `App/shell/desktop/src/main/windows-data-layout.ts:38,46,58-59,335,397`（`:38` 是 `%APPDATA%\Memmy` 用户数据目录名，`:46` 是安装盘 `MemmyData` 容器，`:335`/`:397` 是它的派生路径）
- Test: `App/shell/desktop/tests/windows-launch-at-login.test.ts`
- Test: `App/shell/desktop/tests/windows-data-layout.test.ts:32,43-44`
- Test: `App/shell/desktop/tests/windows-standard-upgrade-check.test.ts:58`
- Test: `App/shell/desktop/tests/windows-data-migration-state.test.ts:221`

**Interfaces:**
- Consumes: Task 1 的 `productName = Cuby`（目录名与产品名保持一致）。
- Produces: `%LOCALAPPDATA%\Cuby\launcher\CubyLauncher.vbs`、`%LOCALAPPDATA%\Cuby\data-migration\state.json`、`%LOCALAPPDATA%\Cuby\data-layout\last-install.json`、安装盘数据目录 `CubyData\` 及其下的 `.cuby` 运行时家目录。Task 1B 依赖 `CubyUpdatePrompt.ps1` 的目录名与此处一致。

- [ ] **Step 1: 先改测试里的断言（会失败）**

`App/shell/desktop/tests/windows-launch-at-login.test.ts` 与 `windows-data-layout.test.ts`：把 fixture 与断言里的 `Memmy` 路径段改成 `Cuby`，`MemmyLauncher.vbs` 改成 `CubyLauncher.vbs`。`windows-standard-upgrade-check.test.ts:58` 的 `MemmyData\.memmy` 改成 `CubyData\.cuby`。

- [ ] **Step 2: 运行确认失败**

Run: `npm --prefix App/shell/desktop test -- tests/windows-launch-at-login.test.ts tests/windows-data-layout.test.ts`
Expected: FAIL。

- [ ] **Step 3: 改源码**

`windows-launch-at-login.ts:54`：

```ts
  const launcherPath = windowsPath.join(localAppDataPath, "Cuby", "launcher", "CubyLauncher.vbs");
```

`windows-data-layout.ts:58-59`：

```ts
    migrationStatePath: win32.join(localAppDataPath, "Cuby", "data-migration", "state.json"),
    installationRecordPath: win32.join(localAppDataPath, "Cuby", "data-layout", "last-install.json"),
```

同文件 `:46` 的安装盘数据目录名 `"MemmyData"` → `"CubyData"`（`:335`、`:397` 两处派生路径里的 `MemmyData` 与 `.memmy` 随之变为 `CubyData` 与 `.cuby`）。

同文件 `:38` 的 `%APPDATA%` 用户数据目录名 `"Memmy"` → `"Cuby"`（这是新应用自己的数据目录，必须与 `app.setName("Cuby")` 决定的 Electron userData 一致）。

> **`:376` 与 `:472` 不要动。** 那两处的 `"Memmy"` 是 `state.preparedCopies` 里的 **`SourcePath` 比较基准**——它们校验的是"这次迁移的源，是不是旧安装的账号目录"。源就是旧的 memmy 安装，所以必须留 `Memmy`，与 PS1 侧保持一致（`CubyWindowsDataMigration.ps1:504,1182,1372`、`CubyWindowsUpgradeRelay.ps1:431,494`、`CubyWindowsUpgradeRecovery.ps1:166`、`.nsh:791,866` 保留的都是源路径）。把它们改成 `Cuby` 会让 TS 校验器拒绝 PS1 写出的迁移状态，迁移直接失败。

对应测试 `windows-data-migration-state.test.ts:221` 的 fixture 改法是**只改目标**：`userDataPath: join(root, "AppData", "Roaming", "Cuby")`，而 `SourcePath` 那侧的 `data\Memmy` 保持不变。

- [ ] **Step 4: 运行测试**

Run: `npm --prefix App/shell/desktop test`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add App/shell/desktop/src/main/windows-launch-at-login.ts App/shell/desktop/src/main/windows-data-layout.ts App/shell/desktop/tests
git commit -m "feat(desktop): move the Windows launcher and data layout under Cuby"
```

---

### Task 3: 磁盘家目录 `~/.memmy` → `~/.cuby`

**Files:**
- Modify: 源码里 78 个含 `.memmy` 路径的 `.ts`/`.tsx`/`.mjs` 文件（`Memory/src/cli/`、`App/memmy-agent/src/`、`App/backend/src/`、`App/shell/desktop/src/`、`App/frontend/desktop/src/`）
- Modify: 89 个相关测试文件
- Test（新增）: `Memory/tests/home-directory.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces: 默认家目录常量 `~/.cuby`；派生目录 `.cuby-knowledge`、`.cuby-upgrade-backup`、`.cuby-bridge-source-hash`、`~/.cuby/{workspace,computer-history,memory-service,analytics-client-id,runtime.json}`。Task 4/6 依赖同一份路径常量。

- [ ] **Step 1: 写失败测试（新增守卫）**

新增 `Memory/tests/home-directory.test.ts`：

```ts
import { afterEach, describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaultConfigPaths } from "../src/cli/config.js";

describe("default config paths", () => {
  afterEach(() => {
    delete process.env.CUBY_CONFIG;
    delete process.env.MEMMY_CONFIG;
  });

  it("falls back to ~/.cuby/config.yaml", () => {
    expect(defaultConfigPaths()).toEqual([join(homedir(), ".cuby", "config.yaml")]);
  });

  it("never references the Memmy era path", () => {
    expect(defaultConfigPaths().join("\n")).not.toContain(".memmy");
  });
});
```

> `Memory/src/cli/config.ts:48` 的 `defaultConfigPaths()` 当前返回 `join(homedir(), ".memmy", "config.yaml")`；本 Task 只改路径分支，环境变量分支由 Task 4 处理。

- [ ] **Step 2: 运行确认失败**

Run: `npm run memory:test -- tests/home-directory.test.ts`
Expected: FAIL —— 实际返回 `~/.memmy/config.yaml`。

- [ ] **Step 3: 生成待改文件清单并审阅**

```bash
grep -rl '\.memmy' --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.json' \
  --include='*.sh' --include='*.ps1' --include='*.cmd' --include='*.nsh' \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=.superpowers . \
  | grep -vE '^(\./)?scripts/install\.sh$' \
  | grep -vE '^(\./)?scripts/clear-' \
  | grep -vE '^(\./)?scripts/internal/linux/' \
  | grep -vE '^(\./)?tests/linux-cli-packaging\.test\.mjs$' \
  | grep -vE '^(\./)?docs/' \
  | grep -vE '^(\./)?README' \
  | grep -vE '^(\./)?Memory/installers/' \
  > /tmp/cuby-home-files.txt
wc -l /tmp/cuby-home-files.txt
grep -n 'memmyMemory\|memmyConfigPath\|memmyAgent' /tmp/cuby-home-files.txt | head
```

**替换前必须先跑这两条自检**（排除模式一旦写错会静默失效，把禁改文件一起改掉）：

```bash
# 1) 禁改文件一个都不该出现——无输出才算通过
grep -E 'scripts/install\.sh|scripts/clear-|scripts/internal/linux/|tests/linux-cli-packaging|Memory/installers/|^docs/|^README' /tmp/cuby-home-files.txt
# 2) 数量应与预期同量级（实测基线：216 个文件）
wc -l < /tmp/cuby-home-files.txt
```

两类命中都不该出现在清单里：①禁改清单里的文件；②`.superpowers/`（本计划的 SDD ledger 里就写着 `~/.memmy`，被扫进去会被一并改写）。任一条不符就**停下**修排除模式，不要继续替换。

Expected: 清单里**不应**出现 `docs/`、`README*`、`scripts/install.sh`、`scripts/clear-*`、`scripts/internal/linux/*`、`Memory/installers/*`、`tests/linux-cli-packaging.test.mjs`，也不应出现 `.superpowers/`。

- [ ] **Step 4: 精确替换并复核 diff**

```bash
xargs -a /tmp/cuby-home-files.txt perl -pi -e 's/\.memmy\b/.cuby/g; s/\.memmy-/.cuby-/g'
git diff --stat
git diff | grep '^[-+].*cuby' | grep -v 'cuby-bob\|cuby-account' | head -40
```

Expected: `.memmy` → `.cuby`（`\.memmy\b` 不会命中 `.memmyMemory` / `.memmyConfigPath` 这类驼峰标识符，它们前后都不是词边界）。逐条扫一遍 diff 确认没有把标识符改名。

- [ ] **Step 5: 全仓验证没有漏网**

```bash
grep -rn '\.memmy' --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.json' \
  --include='*.sh' --include='*.ps1' --include='*.cmd' --include='*.nsh' \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=.superpowers . \
  | grep -vE '^(\./)?(docs/|README|scripts/install\.sh|scripts/clear-|scripts/internal/linux/|Memory/installers/|tests/linux-cli-packaging\.test\.mjs)'
```

Expected: 无输出。

- [ ] **Step 6: 跑测试**

Run: `npm run memory:test && npm run workspace:test && npm --prefix App/memmy-agent test`
Expected: PASS（若个别测试断言旧路径，改断言为新路径后重跑）。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "refactor: move the on-disk home from ~/.memmy to ~/.cuby"
```

---

### Task 4: 环境变量 `MEMMY_*` → `CUBY_*`

**Files:**
- Modify: 156 个含 `MEMMY_` 的测试文件 + 所有读取这些变量的源码文件
- Modify: `.env.example`
- Test: 复用 Task 3 新增的 `Memory/tests/home-directory.test.ts`（`CUBY_HOME` 用例）

**Interfaces:**
- Consumes: Task 3 的 `.cuby` 路径。
- Produces: 全部 `CUBY_*` 变量名。Task 6（生成到用户机器的模板里也引用这些变量）与 Task 7（端口相关的 `CUBY_CUBEROUTER_*`）依赖它。

- [ ] **Step 1: 补环境变量用例（会失败）**

在 `Memory/tests/home-directory.test.ts` 追加：

```ts
  it("honours CUBY_CONFIG", () => {
    process.env.CUBY_CONFIG = "/tmp/cuby-config.yaml";
    expect(defaultConfigPaths()[0]).toBe("/tmp/cuby-config.yaml");
  });

  it("no longer reads MEMMY_CONFIG", () => {
    process.env.MEMMY_CONFIG = "/tmp/memmy-config.yaml";
    expect(defaultConfigPaths().join("\n")).not.toContain("memmy-config.yaml");
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run memory:test -- tests/home-directory.test.ts`
Expected: FAIL —— `defaultConfigPaths()` 仍读 `MEMMY_CONFIG`，对 `CUBY_CONFIG` 无反应。

- [ ] **Step 3: 生成清单并替换**

```bash
grep -rl 'MEMMY_' --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=.superpowers . \
  | grep -vE '^(\./)?scripts/install\.sh$' \
  | grep -vE '^(\./)?scripts/clear-' \
  | grep -vE '^(\./)?scripts/internal/linux/' \
  | grep -vE '^(\./)?tests/linux-cli-packaging\.test\.mjs$' \
  | grep -vE '^(\./)?docs/' \
  | grep -vE '^(\./)?README' \
  | grep -vE '^(\./)?Memory/installers/' \
  > /tmp/cuby-env-files.txt
wc -l /tmp/cuby-env-files.txt
xargs -a /tmp/cuby-env-files.txt perl -pi -e 's/\bMEMMY_/CUBY_/g'
```

- [ ] **Step 4: 验证**

```bash
grep -rn '\bMEMMY_\|process\.env\.MEMMY_\|env\.MEMMY_' --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=.superpowers . \
  | grep -vE '^(\./)?(docs/|README|scripts/install\.sh|scripts/clear-|scripts/internal/linux/|Memory/installers/|tests/linux-cli-packaging\.test\.mjs)'
```

Expected: 无输出。

- [ ] **Step 5: 确认 `.env.example` 已改且语义正确**

Run: `grep -n 'CUBY_' .env.example`
Expected: 列出 `CUBY_LEGAL_CN_BASE_URL`、`CUBY_LEGAL_INTL_BASE_URL`、`CUBY_CUBEROUTER_*` 等，且注释里的 `cuby-desktop-<用户名>` key 命名保持原样。

- [ ] **Step 6: 跑测试**

Run: `npm run memory:test && npm run workspace:test && npm --prefix App/memmy-agent test`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "refactor: rename MEMMY_* environment variables to CUBY_*"
```

---

### Task 5: 协议头 `x-memmy-*` → `x-cuby-*`

**Files:**
- Modify: 40 个含 `x-memmy` 的测试文件 + 发送/解析这些头的源码（`App/backend/src/adapters/outbound/skill-writer/workspace-bridge/runtime.ts:587-590`、`App/shell/desktop/src/main/`、`App/backend/src/adapters/inbound/local-api/`）

**Interfaces:**
- Consumes: 无。
- Produces: 17 个 `x-cuby-*` 头名，逐一对应：`x-cuby-agent-auth`、`x-cuby-agent-kind`、`x-cuby-agent-mcp-values`、`x-cuby-composio-token`、`x-cuby-device-id`、`x-cuby-local-token`、`x-cuby-mcp-token`、`x-cuby-profile-id`、`x-cuby-profile-label`、`x-cuby-project-id`、`x-cuby-session-key`、`x-cuby-tenant-id`、`x-cuby-time-zone`、`x-cuby-user-id`、`x-cuby-viewer`、`x-cuby-workspace-id`、`x-cuby-workspace-path`。

- [ ] **Step 1: 替换**

```bash
grep -rl 'x-memmy' --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=.superpowers . \
  | grep -vE '^(\./)?docs/' | grep -vE '^(\./)?README' \
  > /tmp/cuby-header-files.txt
xargs -a /tmp/cuby-header-files.txt perl -pi -e 's/\bx-memmy-/x-cuby-/g'
```

- [ ] **Step 2: 验证头名齐全且无漏网**

```bash
grep -rho 'x-cuby-[a-z-]*' --exclude-dir=node_modules --exclude-dir=dist . | sort -u | wc -l   # 期望 17
grep -rn 'x-memmy' --exclude-dir=node_modules --exclude-dir=dist . | grep -vE '^(\./)?(docs/|README|Memory/installers/)'
```

Expected: 17，且第二条无输出。

- [ ] **Step 3: 跑测试**

Run: `npm run workspace:test && npm --prefix App/memmy-agent test`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "refactor: rename the x-memmy-* protocol headers to x-cuby-*"
```

---

### Task 6: 写进用户机器的产物

**Files:**
- Modify: `App/backend/src/adapters/outbound/skill-writer/templates/memmy-skill-directory.ts:3-4,18`
- Modify: `Memory/src/agent-source/integration/templates/memmy-skill-directory.ts:3-4`
- Modify: `App/backend/src/adapters/outbound/skill-writer/claude-code/target.ts`（hook 文件名、命令文件名、CLAUDE.md 标记）
- Modify: `App/backend/src/adapters/outbound/skill-writer/**/target.ts`（cursor、codex、opencode、deepseek-harness、hermes、pi、qwenwork、workbuddy）
- Modify: `Memory/src/agent-source/integration/**`（**24 个文件——这是 skill-writer 的第二份副本**，与 App/backend 那份是各自独立、内容不同的两套实现；漏掉它会让两条代码路径生成不同命名的产物）
- Modify: `App/shell/desktop/src/main/main.ts:570-571,601,611-623`
- Modify: `App/shell/desktop/src/main/windows-cli-path.ts:54-55`
- Modify: `App/backend/src/infrastructure/cli-binary/index.ts:15`
- Modify: `Memory/src/cli/skills/memmy-memory/SKILL.md`（`name:` 字段与正文里的命令名）
- Rename: `Memory/src/cli/skills/memmy-memory/` → `Memory/src/cli/skills/cuby-memory/`
- Test: `App/backend/src/adapters/outbound/skill-writer/claude-code/tests/target.test.ts`
- Test: `App/shell/desktop/tests/windows-cli-path.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `CUBY_*` 变量名。
- Produces: 安装态名 `cuby-memory` / `cuby-resume`；hook 文件 `cuby-resume-hook.mjs`；命令文件 `cuby-resume.md`；标记 `<!-- cuby:start v=1 -->` 与 `# Cuby CLI PATH`；PATH 软链 `cuby`、`cuby-memory`（Windows 为 `cuby.cmd`、`cuby-memory.cmd`）。

- [ ] **Step 1: 先改测试期望（会失败）**

```bash
grep -rl '"memmy-memory"\|skills/memmy-memory\|memmy-resume-hook\|memmy:start\|Memmy CLI PATH\|memmy-memory-resume-hook\|memmy-memory-config' \
  --include='*.test.ts' --include='*.test.tsx' --include='*.test.mjs' --exclude-dir=node_modules . \
  > /tmp/cuby-artifact-tests.txt
xargs -a /tmp/cuby-artifact-tests.txt perl -pi -e '
  s/"memmy-memory"/"cuby-memory"/g;
  s/"memmy-resume"/"cuby-resume"/g;
  s{skills/memmy-memory}{skills/cuby-memory}g;
  s{skills/memmy-resume}{skills/cuby-resume}g;
  s/memmy-resume-hook/cuby-resume-hook/g;
  s/memmy-resume\.md/cuby-resume.md/g;
  s/<!-- memmy:start v=1 -->/<!-- cuby:start v=1 -->/g;
  s/<!-- memmy:end v=1 -->/<!-- cuby:end v=1 -->/g;
  s/# Memmy CLI PATH/# Cuby CLI PATH/g;
'
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run test -w @memmy/backend`
Expected: FAIL —— 期望 `skills/cuby-memory/SKILL.md`，实际写出 `skills/memmy-memory/`。

- [ ] **Step 3: 改源码常量与模板**

`templates/memmy-skill-directory.ts`：

```ts
export const MEMMY_SKILL_DIRECTORY_NAME = "cuby-memory";
export const MEMMY_RESUME_SKILL_DIRECTORY_NAME = "cuby-resume";
```

同文件 `renderMemmySkillDirectoryFiles` 里渲染的 `SKILL.md` frontmatter：`name: cuby-memory`、`description: Use shared Cuby memory when prior context may be relevant.`。

`Memory/src/agent-source/integration/templates/memmy-skill-directory.ts` 同步。

各 `target.ts`：hook 脚本文件名 `memmy-resume-hook.mjs` → `cuby-resume-hook.mjs`（保留 `LEGACY_HOOK_SCRIPT_FILE_NAME = "memmy-memory-resume-hook.mjs"` 不动——它用于清理更老的版本，且属于旧品牌清理逻辑，见下）、命令文件 `memmy-resume.md` → `cuby-resume.md`、标记 `<-- memmy:start v=1 -->` → `<!-- cuby:start v=1 -->`（`START_MARKER` / `END_MARKER` 常量）。

`main.ts:570-571`：

```ts
    await installSymlink(memoryCli, join(binDirectory, "cuby-memory"));
    await installSymlink(cubyCli, join(binDirectory, "cuby"));
```

（同时把局部变量 `memmyCli` 重命名为 `cubyCli`；`resolveCliToolEntries()` 的两处 `{ name: "memmy-memory", … }` 改为 `"cuby-memory"`。）

`main.ts:601`：marker 参数 `"# Cuby CLI PATH"`。

`windows-cli-path.ts:54-55`：

```ts
    { name: "cuby-memory", source: win32.join(binDirectory, "cuby-memory.cmd") },
    { name: "cuby", source: win32.join(binDirectory, "cuby.cmd") }
```

`App/backend/src/infrastructure/cli-binary/index.ts:15`：`join(homedir(), ".local", "bin", "cuby")`。

- [ ] **Step 4: 重命名技能源目录并改 SKILL.md**

```bash
git mv Memory/src/cli/skills/memmy-memory Memory/src/cli/skills/cuby-memory
```

`Memory/src/cli/skills/cuby-memory/SKILL.md`：frontmatter `name: cuby-memory`；正文里的 `memmy-memory` 命令名 → `cuby-memory`；标题 `# Memmy Memory CLI` → `# Cuby Memory CLI`。同时更新所有引用该目录的路径（`skill-only-target.ts:45`、打包脚本、`Memory/package.json` 的 files 字段）。

- [ ] **Step 5: 运行测试**

Run: `npm run test -w @memmy/backend && npm --prefix App/shell/desktop test && npm run memory:test`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat: install the Cuby skill, hooks, PATH markers and CLI symlinks"
```

---

### Task 7: 端口

**Files:**
- Modify: `App/shell/desktop/src/main/runtime-services.ts:16,18-19`
- Modify: `App/shell/desktop/src/main/window-mode.ts:4`
- Modify: `Memory/src/cli/config.ts:6`（`DEFAULT_MEMORY_URL`）
- Modify: `App/memmy-agent/src/config/schema.ts:1030,1055`
- Modify: `App/memmy-agent/src/memmy-memory/discovery.ts:7`
- Modify: `App/memmy-agent/src/integrations/channels/websocket.ts:574`
- Modify: `App/memmy-agent/src/entrypoints/cli/linux-systemd-gateway.ts:168,290,303`
- Modify: `App/backend/src/adapters/outbound/memmy-agent-admin-client/http-memmy-agent-admin-client.ts:10`
- Modify: `App/backend/src/adapters/outbound/skill-writer/workspace-bridge/runtime.ts:37`
- Modify: `App/backend/src/adapters/outbound/skill-writer/{templates/memmy-resume-hook.ts,templates/memmy-opencode-plugin.ts,templates/memmy-deepseek-harness-plugin.ts,openclaw/target.ts,hermes/target.ts,memmy-runtime-config.ts}`
- Modify: `App/frontend/desktop/src/api/memmy-agent-client.ts:145`、`App/frontend/desktop/vite.config.ts:9`
- Test（新增）: `App/shell/desktop/tests/fixed-ports.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces: 5 个新端口常量；`DEFAULT_MEMORY_URL = "http://127.0.0.1:28960"`；`DEFAULT_AGENT_WEBSOCKET_PORT = 28980`；`DEFAULT_AGENT_GATEWAY_HEALTH_PORT = 28970`；`PACKAGED_RENDERER_DEFAULT_PORT = 29100`。Task 6 生成到用户机器的模板引用 28960。

- [ ] **Step 1: 写失败守卫测试**

新增 `App/shell/desktop/tests/fixed-ports.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PACKAGED_RENDERER_DEFAULT_PORT } from "../src/main/window-mode.js";

const MEMMY_ERA_PORTS = /(\b18960\b|\b18970\b|\b18980\b|\b18990\b|\b19100\b)/;

function sourceFiles(root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(root, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("fixed ports never revert to the Memmy era", () => {
  it("packaged renderer uses 29100", () => {
    expect(PACKAGED_RENDERER_DEFAULT_PORT).toBe(29100);
  });

  it("no desktop source file still binds a Memmy-era fixed port", () => {
    const offenders = sourceFiles(join(import.meta.dirname, "..", "src"))
      .filter((file) => MEMMY_ERA_PORTS.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
```

> 其余四个端口分属 `App/memmy-agent`、`App/backend`、`Memory` 各包，跨包 import 脆弱，由 Step 4 的全仓 grep 验证覆盖。

- [ ] **Step 2: 运行确认失败**

Run: `npm --prefix App/shell/desktop test -- tests/fixed-ports.test.ts`
Expected: FAIL —— 实际为 19100。

- [ ] **Step 3: 替换端口值**

```bash
grep -rl '18960\|18970\|18980\|18990\|19100' --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.json' --include='*.css' \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=.superpowers . \
  | grep -vE '^(\./)?scripts/install\.sh$' \
  | grep -vE '^(\./)?scripts/clear-' \
  | grep -vE '^(\./)?scripts/internal/linux/' \
  | grep -vE '^(\./)?docs/' | grep -vE '^(\./)?README' \
  > /tmp/cuby-port-files.txt
xargs -a /tmp/cuby-port-files.txt perl -pi -e '
  s/\b18960\b/28960/g;
  s/\b18970\b/28970/g;
  s/\b18980\b/28980/g;
  s/\b18990\b/28990/g;
  s/\b19100\b/29100/g;
'
```

> 注意：不要把 19000 / 19001 / 18961 一起替换——它们是开发端口，不在改名列内（`\b` 边界不会让 `19000` 命中 `19100`，但**不要**扩大正则范围）。

- [ ] **Step 4: 验证**

```bash
grep -rn '\b18960\b\|\b18970\b\|\b18980\b\|\b18990\b\|\b19100\b' --exclude-dir=node_modules --exclude-dir=dist . \
  | grep -vE '^(\./)?(docs/|README|scripts/install\.sh|scripts/clear-|scripts/internal/linux/|Memory/installers/|tests/linux-cli-packaging\.test\.mjs)'
grep -rn '\b28960\b' --exclude-dir=node_modules --exclude-dir=dist . | wc -l   # 期望 ≈35
```

Expected: 第一条无输出。

- [ ] **Step 5: 跑测试**

Run: `npm --prefix App/shell/desktop test && npm --prefix App/memmy-agent test && npm run workspace:test`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat: move the five fixed service ports off the Memmy range"
```

---

### Task 8: 从 `cuby.html` 提取 14 个姿态素材

**Files:**
- Create: `App/frontend/desktop/src/assets/mascot/cuby-{neutral,chat,think,celebrate,sleep,wave,read,shield,brain,connect,hum,blush,sad,plead}.png`
- Create: `docs/brand/cuby-mascot-spec.html`（归档，来自仓库根 `cuby.html`）
- Create: `docs/brand/cuby.jpg`（归档，来自仓库根 `cuby.jpg`）
- Test: 复用 Task 11 的尺寸断言（见该 Task）

**Interfaces:**
- Consumes: 无。
- Produces: 14 个 `cuby-<pose>.png`，尺寸分别为 neutral 512×354、chat 512×323、think 512×414、celebrate 512×282、sleep 512×331、wave 512×327、read 512×403、shield 512×417、brain 512×330、connect 512×342、hum 512×335、blush 512×470、sad 512×403、plead 512×350。Task 9/11 依赖这些文件名。

- [ ] **Step 1: 提取（顺序即姿态顺序）**

`cuby.html` 内嵌 23 张 base64 PNG：第 1-4 张是同一张 neutral 的尺寸演示，第 5-18 张依次是 14 个必做姿态（尺寸与规范表逐条对应），第 19-23 张是 5 个预留位的旧形象缩略图（**不要提取**）。

```bash
python3 - <<'PY'
import re, base64, os
POSE = ["neutral","chat","think","celebrate","sleep","wave","read","shield",
        "brain","connect","hum","blush","sad","plead"]
src = open('cuby.html', encoding='utf-8').read()
imgs = re.findall(r'<img[^>]*src="data:image/png;base64,([^"]+)"', src, re.S)
out = 'App/frontend/desktop/src/assets/mascot'
assert len(imgs) == 23, f"expected 23 embedded PNGs, got {len(imgs)}"
for pose, b64 in zip(POSE, imgs[4:18]):
    path = os.path.join(out, f'cuby-{pose}.png')
    open(path, 'wb').write(base64.b64decode(b64))
    print('wrote', path)
PY
```

- [ ] **Step 2: 逐张核对尺寸与透明底**

```bash
python3 - <<'PY'
from PIL import Image
import os
EXPECT = {"neutral":(512,354),"chat":(512,323),"think":(512,414),"celebrate":(512,282),
          "sleep":(512,331),"wave":(512,327),"read":(512,403),"shield":(512,417),
          "brain":(512,330),"connect":(512,342),"hum":(512,335),"blush":(512,470),
          "sad":(512,403),"plead":(512,350)}
ok = True
for pose,(w,h) in EXPECT.items():
    p = f"App/frontend/desktop/src/assets/mascot/cuby-{pose}.png"
    im = Image.open(p)
    mode_ok = im.mode in ("RGBA","P")
    if im.size != (w,h) or not mode_ok:
        ok = False; print("MISMATCH", pose, im.size, im.mode)
print("all 14 poses match the spec table" if ok else "FIX BEFORE CONTINUING")
PY
```

Expected: `all 14 poses match the spec table`。

- [ ] **Step 3: 归档源文件**

`cuby.html` 与 `cuby.jpg` 当前是未跟踪文件，直接移动后 `git add`：

```bash
mkdir -p docs/brand
mv cuby.html docs/brand/cuby-mascot-spec.html
mv cuby.jpg docs/brand/cuby.jpg
git add docs/brand/cuby-mascot-spec.html docs/brand/cuby.jpg
```

> `cuby-mascot-spec.html` 是 14 张素材的来源与验收依据，归档进仓库便于后续补 5 个预留姿态时对照。

- [ ] **Step 4: 提交**

```bash
git add App/frontend/desktop/src/assets/mascot docs/brand
git commit -m "feat(brand): add the 14 Cuby mascot poses and archive the asset spec"
```

---

### Task 9: 吉祥物组件改名 `memmy.tsx` → `cuby.tsx`

**Files:**
- Rename: `App/frontend/desktop/src/components/mascot/memmy.tsx` → `cuby.tsx`
- Modify: 31 个引用该组件的文件（`pages/home-page.tsx:27,2694`、`pages/pet-page.tsx`、`pages/agent-thread-messages.tsx:42,1267`、`pages/improvement-program-modal.tsx:2,21`、`components/search-palette.tsx` 等）
- Test: 现有 mascot 相关测试 + `App/frontend/desktop/src/pages/tests/**`

**Interfaces:**
- Consumes: Task 8 的 `cuby-<pose>.png` 文件名。
- Produces: 组件 `Cuby`、类型 `CubyPose`、`CubyProps`、`CubyAssetPreloadOptions`、函数 `preloadCubyAsset`；文件 `components/mascot/cuby.tsx`（规范点名）。Task 10/11 依赖这些名字。

- [ ] **Step 1: 先改引用点（会类型报错）**

```bash
grep -rl 'mascot/memmy\|\bMemmy\b *pose=\|preloadMemmyAsset\|MemmyPose\|MemmyProps\|MemmyAssetPreloadOptions' \
  --include='*.ts' --include='*.tsx' --exclude-dir=node_modules App/frontend/desktop/src > /tmp/cuby-mascot-files.txt
xargs -a /tmp/cuby-mascot-files.txt perl -pi -e '
  s{mascot/memmy\.js}{mascot/cuby.js}g;
  s{components/mascot/memmy}{components/mascot/cuby}g;
  s/\bpreloadMemmyAsset\b/preloadCubyAsset/g;
  s/\bMemmyPose\b/CubyPose/g;
  s/\bMemmyProps\b/CubyProps/g;
  s/\bMemmyAssetPreloadOptions\b/CubyAssetPreloadOptions/g;
'
```

> `\bMemmy\b` 单独处理：组件名 `<Memmy …>` 与 `import { Memmy }` 改成 `Cuby`，但**不要**动 `MemmyAgentClient` 这类内部标识符（词边界保证不命中）。执行：

```bash
xargs -a /tmp/cuby-mascot-files.txt perl -pi -e 's/\bMemmy\b(?!Agent|Memory|Request|Goal|Message|WebSocket|Slash|Project|Session|Ui)/Cuby/g'
```

- [ ] **Step 2: 运行类型检查确认报错**

Run: `npm run typecheck`
Expected: FAIL —— `Cannot find module '../components/mascot/cuby.js'`。

- [ ] **Step 3: 重命名组件文件并改内部命名**

```bash
git mv App/frontend/desktop/src/components/mascot/memmy.tsx App/frontend/desktop/src/components/mascot/cuby.tsx
```

文件内：`export type MemmyPose` → `CubyPose`、`interface MemmyProps` → `CubyProps`、`function Memmy(` → `function Cuby(`、`preloadMemmyAsset` → `preloadCubyAsset`、`MemmyAssetPreloadOptions` → `CubyAssetPreloadOptions`、`const poseToAsset` → **`export const poseToAsset`**（Task 11 的测试要 import 它），`poseToAsset` 的右侧资源引用改为 `cuby-<pose>.png`（`neutral: cubyNeutralUrl` 等），`memmyRiceUrl` 之类的 import 名与路径一并改为 `cuby-neutral.png` 等。

**14 个必做姿态**指向各自的 `cuby-<pose>.png`；**5 个预留姿态**（`work`/`point`/`box`/`wrench`/`peek`）删除各自的 import，`poseToAsset` 里一律指向 `cubyNeutralUrl`（Task 8 不产出这 5 张图，若照旧指向会留下指向不存在文件的 import，构建会坏）。这一步之后树必须能 typecheck 通过。

- [ ] **Step 4: 运行类型检查与前端测试**

Run: `npm run typecheck && npm run test -w @memmy/frontend-desktop`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "refactor(desktop): rename the mascot component to Cuby"
```

---

### Task 10: CSS 类 `memmy-*` → `cuby-*`

**Files:**
- Modify: 183 处 `memmy-*` 类名，分布在 `App/frontend/desktop/src/**/*.css` 与 `*.tsx`
- Test: `App/frontend/desktop/src/theme/tests/style-alignment.test.ts`

**Interfaces:**
- Consumes: Task 9 的组件改名。
- Produces: 全部 `cuby-*` 类名（含 `cuby-bob`）。无后续 Task 依赖。

- [ ] **Step 1: 替换并验证成对**

```bash
grep -rl 'memmy-' --include='*.css' --include='*.tsx' --include='*.ts' --exclude-dir=node_modules App/frontend/desktop/src \
  > /tmp/cuby-css-files.txt
xargs -a /tmp/cuby-css-files.txt perl -pi -e 's/\bmemmy-/cuby-/g'
```

- [ ] **Step 2: 验证每个新类名在 CSS 与 TSX 两侧都有定义/使用**

```bash
grep -rho 'cuby-[a-z-]*' App/frontend/desktop/src --include='*.css' | sort -u > /tmp/css-defined.txt
grep -rho 'cuby-[a-z-]*' App/frontend/desktop/src --include='*.tsx' --include='*.ts' | sort -u > /tmp/tsx-used.txt
comm -13 /tmp/css-defined.txt /tmp/tsx-used.txt | grep -v 'cuby-body\|cuby-rice\|cuby-paddle\|cuby-peek\|cuby-wrench\|cuby-box\|cuby-point\|cuby-work\|cuby-sad\|cuby-plead\|cuby-blush\|cuby-brain\|cuby-chat\|cuby-connect\|cuby-hum\|cuby-read\|cuby-shield\|cuby-sleep\|cuby-think\|cuby-wave\|cuby-neutral\|cuby-celebrate' | head
```

Expected: 无输出（剩余的差异应只有姿态资源名）。

- [ ] **Step 3: 跑前端测试与样式对齐测试**

Run: `npm run test -w @memmy/frontend-desktop`
Expected: PASS（`style-alignment.test.ts:359` 里的 `memo-idle-alpha.webm` 断言在 Task 11 处理）。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "refactor(desktop): rename the memmy-* CSS classes to cuby-*"
```

---

### Task 11: 姿态映射、旧素材清理与账号 logo

**Files:**
- Modify: `App/frontend/desktop/src/components/mascot/cuby.tsx`（`poseToAsset` 与 import 清理）
- Modify: `App/frontend/desktop/src/pages/pet-page.tsx:16,2569-`（`resolveMemmyPose` → `resolveCubyPose`、删除 idle webm 引入）
- Delete: `App/frontend/desktop/src/assets/mascot/{memo-idle-alpha.webm,pet-entrance.webp}`
- Delete: `App/frontend/desktop/src/assets/mascot/{memmy-body-blush,memmy-paddle,memmy-rice-poc,memmy-rice-transparent,memmy-rice-white,memmy-rice}.png`
- Delete: 18 张 `memmy-<pose>.png`（已被 `cuby-<pose>.png` 取代）
- Rename: `App/frontend/desktop/src/assets/brand/memmy-cover.png` → `cuby-cover.png`
- Rename: `App/frontend/desktop/src/assets/llm-provider-logo/memmy-account.png` → `cuby-account.png`
- Modify: `App/frontend/desktop/src/components/model-provider-logo.tsx:1,16,43,91`
- Modify: `App/frontend/desktop/src/pages/llm-provider-logo.tsx:6`
- Test（新增）: `App/frontend/desktop/src/components/mascot/tests/pose-assets.test.ts`
- Test: `App/frontend/desktop/src/theme/tests/style-alignment.test.ts:359`

**Interfaces:**
- Consumes: Task 8 的 14 张 `cuby-<pose>.png`；Task 9 的 `CubyPose`。
- Produces: `poseToAsset` 覆盖全部 19 个姿态（14 个指向各自素材，5 个预留指向 `cubyNeutralUrl`）；`resolveCubyPose`。

- [ ] **Step 1: 写失败测试（姿态覆盖 + 素材尺寸）**

新增 `App/frontend/desktop/src/components/mascot/tests/pose-assets.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { poseToAsset } from "../cuby.js";

const POSES = ["wave","think","work","celebrate","shield","read","connect","sleep","neutral",
  "point","box","brain","chat","wrench","blush","peek","hum","plead","sad"] as const;
const RESERVED = ["work","point","box","wrench","peek"] as const;
const ASSET_DIR = join(import.meta.dirname, "../../../assets/mascot");

describe("mascot pose assets", () => {
  it("maps every pose to an existing file", () => {
    for (const pose of POSES) {
      const url = poseToAsset[pose];
      expect(url, `pose ${pose}`).toBeTruthy();
    }
  });

  it("falls the five reserved poses back to neutral", () => {
    for (const pose of RESERVED) {
      expect(poseToAsset[pose], `pose ${pose}`).toBe(poseToAsset.neutral);
    }
  });

  it("ships no Memmy-era artwork", () => {
    for (const stale of ["memo-idle-alpha.webm", "pet-entrance.webp", "memmy-rice.png"]) {
      expect(existsSync(join(ASSET_DIR, stale)), stale).toBe(false);
    }
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run test -w @memmy/frontend-desktop -- src/components/mascot/tests/pose-assets.test.ts`
Expected: FAIL —— `ships no Memmy-era artwork` 用例失败（旧素材还在）。姿态映射与预留位回落已在 Task 9 落地，这两个用例此时应当是绿的。

- [ ] **Step 3: 改映射、删旧素材**

`cuby.tsx`：`poseToAsset` 里 `neutral`/`chat`/`think`/`celebrate`/`sleep`/`wave`/`read`/`shield`/`brain`/`connect`/`hum`/`blush`/`sad`/`plead` 指向各自的 `cuby-<pose>.png`；`work`/`point`/`box`/`wrench`/`peek` 一律指向 `cubyNeutralUrl`，并删除它们对应的 import。

```bash
git rm App/frontend/desktop/src/assets/mascot/memo-idle-alpha.webm \
       App/frontend/desktop/src/assets/mascot/pet-entrance.webp \
       App/frontend/desktop/src/assets/mascot/memmy-*.png
```

`pet-page.tsx`：删除 `import memoIdleUrl from "../assets/mascot/memo-idle-alpha.webm";`（`:16`）与 `pet-entrance.webp` 的引入；待机改为渲染 `pose="neutral"` 并保留现有 bob 效果类；`resolveMemmyPose` → `resolveCubyPose`（`:2569`），调用点同步。

`style-alignment.test.ts:359`：从允许清单里移除 `memo-idle-alpha.webm`。

- [ ] **Step 4: 账号 logo 改名**

```bash
git mv App/frontend/desktop/src/assets/brand/memmy-cover.png App/frontend/desktop/src/assets/brand/cuby-cover.png
git mv App/frontend/desktop/src/assets/llm-provider-logo/memmy-account.png App/frontend/desktop/src/assets/llm-provider-logo/cuby-account.png
```

同步改 `model-provider-logo.tsx`（`memmyCoverLogoUrl` → `cubyCoverLogoUrl` 及引用）与 `llm-provider-logo.tsx:6`（`memmyAccountLogoUrl` → `cubyAccountLogoUrl`）。

- [ ] **Step 5: 跑测试**

Run: `npm run test -w @memmy/frontend-desktop`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat(brand): wire the Cuby poses and drop the Memmy-era artwork"
```

---

### Task 12: 产品名字符串与契约字面量

**Files:**
- Modify: `App/backend/src/adapters/outbound/cloud-client/types.ts:40,74`
- Modify: `App/backend/local-api-contracts/src/index.ts:1211,1380`
- Modify: `App/frontend/desktop/src/pages/agent-source-logos.ts:28-29`
- Modify: `App/backend/src/adapters/outbound/skill-writer/codex/hook-trust.ts:59`
- Modify: `App/memmy-agent/src/integrations/channels/feishu-registration.ts:50`
- Test: `App/backend/src/adapters/outbound/cloud-client/http-cloud-client.test.ts:40`
- Test: `App/backend/src/tests/**`（contracts 相关）

**Interfaces:**
- Consumes: 无。
- Produces: `loginSource: "Cuby"`（类型与 zod 字面量一致）、agent-source 显示名 `Cuby`/`Cuby Agent`、codex 信任提示标题 `Cuby`、飞书应用预设名 `Cuby`。

- [ ] **Step 1: 先改测试期望（会失败）**

`App/backend/src/adapters/outbound/cloud-client/http-cloud-client.test.ts:40`：`loginSource: "Memmy"` → `"Cuby"`。同时全仓找出断言 `loginSource` 的其它测试：

```bash
grep -rln 'loginSource' --include='*.test.ts' --exclude-dir=node_modules . \
  | xargs perl -pi -e 's/loginSource: "Memmy"/loginSource: "Cuby"/g'
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run test -w @memmy/backend`
Expected: FAIL —— zod 契约仍只接受 `"Memmy"`。

- [ ] **Step 3: 改源码（三处必须同批改，否则契约校验失败）**

```ts
// App/backend/src/adapters/outbound/cloud-client/types.ts:40,74
  loginSource: "Cuby";
```

```ts
// App/backend/local-api-contracts/src/index.ts:1211,1380
        loginSource: z.literal("Cuby"),
```

```ts
// App/frontend/desktop/src/pages/agent-source-logos.ts:28-29
  memmy: "Cuby",
  memmy_agent: "Cuby",
```

```ts
// App/backend/src/adapters/outbound/skill-writer/codex/hook-trust.ts:59
        title: "Cuby",
```

```ts
// App/memmy-agent/src/integrations/channels/feishu-registration.ts:50
        appPreset: { name: "Cuby" },
```

> 键名（`memmy`、`memmy_agent`）保持不变——它们是内部标识符。

- [ ] **Step 4: 跑测试**

Run: `npm run test -w @memmy/backend && npm run test:contracts && npm --prefix App/memmy-agent test`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat: switch the user-visible product-name literals to Cuby"
```

---

### Task 13: 页面文案（i18n 165 处）

**Files:**
- Modify: `App/frontend/desktop/src/i18n/messages.ts`（163 处）
- Modify: `App/frontend/desktop/src/i18n/error-notice-messages.ts`（2 处）
- Modify: `App/shell/desktop/src/main/startup-splash.ts:55,59,61`
- Modify: `App/shell/desktop/src/main/main.ts:812`
- Test: `App/frontend/desktop/src/i18n/tests/**`

**Interfaces:**
- Consumes: Task 1 的 `productName = Cuby`。
- Produces: 用户可见文案里的产品名全部为 `Cuby`；`"brand.name": "Cuby"`（两处 locale）。

- [ ] **Step 1: 先改测试期望（会失败）**

```bash
grep -rl '"Memmy\|Memmy 启动失败\|Memmy Starting' --include='*.test.ts' --include='*.test.tsx' --exclude-dir=node_modules App/frontend/desktop/src App/shell/desktop/tests \
  > /tmp/cuby-copy-tests.txt
xargs -a /tmp/cuby-copy-tests.txt perl -pi -e 's/"Memmy"/"Cuby"/g; s/Memmy 启动失败/Cuby 启动失败/g; s/Memmy Starting/Cuby Starting/g'
```

> **必须按匹配项替换，不能整文件替换 `\bMemmy\b`**：命中的文件里还有属于其它层的字符串——例如 `windows-data-migration-state.test.ts:221` 的 `join(root, "AppData", "Roaming", "Memmy")` 是 Task 2 的数据目录 fixture。整文件替换会把它们一起改掉，造成与源码不一致。

- [ ] **Step 2: 运行确认失败**

Run: `npm run test -w @memmy/frontend-desktop`
Expected: FAIL —— 文案仍是 `Memmy`。

- [ ] **Step 3: 改文案源**

```bash
perl -pi -e 's/\bMemmy\b/Cuby/g' \
  App/frontend/desktop/src/i18n/messages.ts \
  App/frontend/desktop/src/i18n/error-notice-messages.ts \
  App/shell/desktop/src/main/startup-splash.ts
```

`App/shell/desktop/src/main/main.ts:812`：`"Memmy 启动失败"` → `"Cuby 启动失败"`。

> 只改文案字符串。`main.ts` 里的标识符（`MemmyAgentAdminClient` 等）不得受影响——上面只对 i18n 文件与 splash 做全词替换，`main.ts` 只改指定行。

- [ ] **Step 4: 验证文案侧无残留**

```bash
grep -rn '\bMemmy\b' App/frontend/desktop/src/i18n App/shell/desktop/src/main/startup-splash.ts
grep -n 'Memmy' App/shell/desktop/src/main/main.ts | grep -v 'MemmyAgent\|memmy'
```

Expected: 第一条无输出；第二条只剩 `main.ts` 里 Task 2/6 之外尚未处理的注释与日志（如果有，逐条判断是文案还是标识符）。

- [ ] **Step 5: 跑测试**

Run: `npm run test -w @memmy/frontend-desktop && npm --prefix App/shell/desktop test`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat(desktop): switch the user-facing copy to Cuby"
```

---

### Task 14: 发布与 CI 产物名

**Files:**
- Modify: `scripts/auto-release-mac.sh:159,168`（另有 `:52` 的通知标题、`:20,189` 的本机路径）
- Modify: `scripts/internal/win/build-nsis.sh:127-128`
- Modify: `.github/workflows/build-desktop.yml:147`
- Modify: `.github/workflows/memory-release.yml:100`
- Modify: `.github/workflows/github-draft-release-v2.yml`（`:393-396,428-429,699-706,900,907` —— 产物名、MD5/SHA 校验、发布说明里的下载链接、release 标题、上传 glob 全按 `Memmy-*` 写死；构建已改名 `Cuby-*`，不改则草稿发布找不到产物）
- Test: `tests/release-workflow.test.ts`、`tests/package-version-guard.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `artifactName = Cuby-${version}-${arch}.${ext}`。
- Produces: 产物名 `Cuby-<ver>-darwin-arm64-{cn,intl}-signed.dmg`、`Cuby-<ver>-win32-….exe`、`Cuby-<ver>-win32-x64-…-unpacked.zip`、release 名 `Cuby Memory <ver>`。

- [ ] **Step 1: 先改测试期望（会失败）**

```bash
grep -rl 'Memmy-' --include='*.test.ts' --include='*.test.mjs' --exclude-dir=node_modules tests App/shell/desktop/tests \
  | xargs perl -pi -e 's/\bMemmy-/Cuby-/g'
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run test:release-workflow`
Expected: FAIL。

- [ ] **Step 3: 改发布脚本与 workflow**

```bash
perl -pi -e 's/\bMemmy-/Cuby-/g' scripts/auto-release-mac.sh scripts/internal/win/build-nsis.sh
perl -pi -e 's/\bMemmy-/Cuby-/g' .github/workflows/build-desktop.yml .github/workflows/github-draft-release-v2.yml
perl -pi -e 's/name: Memmy Memory/name: Cuby Memory/' .github/workflows/memory-release.yml
perl -pi -e 's/--title "Memmy \$TAG"/--title "Cuby $TAG"/; s/drag Memmy to Applications/drag Cuby to Applications/; s/for a real Memmy release/for a real Cuby release/; s/scoring for Memmy/scoring for Cuby/; s/the 106 Memmy draft endpoint/the 106 Cuby draft endpoint/' .github/workflows/github-draft-release-v2.yml
```

`build-nsis.sh:354` 的 `set "APP_EXEC=%APP_DIR%\Memmy.exe"` → `Cuby.exe`；`:358` 的报错文案同步。`auto-release-mac.sh:52` 的通知标题 `"Memmy Auto Release"` → `"Cuby Auto Release"`（`:20,189` 是本机 checkout 路径，属于个人环境，不改）。

- [ ] **Step 4: 验证并跑测试**

```bash
grep -rn '\bMemmy-' scripts/ .github/ | grep -v 'memmy-agent\|memmy-memory'
npm run test:release-workflow && npm run test:packaging-guards
```

Expected: 第一条只剩 Linux CLI 相关（`scripts/internal/linux/`、`install.sh`）；测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "build: publish the desktop artifacts under the Cuby name"
```

---

### Task 15: 收尾验证

**Files:**
- Modify: 任何 Task 1-14 遗漏的注释与文档字符串（例如 `runtime-services.ts:2417`、`main.ts:2855,5189` 里提到 `Memmy.exe` 的注释）
- Test: 全量

**Interfaces:**
- Consumes: Task 1-14 的全部产出。
- Produces: 全仓白名单校验通过 + 一次本地打包冒烟。

- [ ] **Step 1: 跑全量测试**

Run: `npm test && npm --prefix App/memmy-agent test`
Expected: PASS，**除三个既有的环境失败**（改名前就已失败，本地 Node 24.18 而项目 CI 用 Node 22）：

1. `Memory/tests/agent-source-runtime.test.ts > owns startup and recurring scans in the Memory process`（`automatic scan did not complete`）
2. `App/memmy-agent/tests/entrypoints/frontend-bridge/mcp-presets-api.test.ts > detects bundled OCU with an empty PATH and preserves the portable config`
3. `App/memmy-agent/tests/core/agent-runtime/mcp-connection.test.ts > registers bundled OCU tools without looking up the launcher on PATH`

这三个文件都不被本计划任何 Task 触碰。不要为它们改动代码。

> `App/memmy-agent` 不在 package.json 的 workspaces 列表里，`npm test` → `workspace:test`（`--workspaces`）不会覆盖它，而它的测试套件同样断言了本计划改动的路径、环境变量与端口，所以必须显式补跑。

- [ ] **Step 2: 白名单校验——确认"该改的都改了"**

```bash
grep -rni 'memmy' --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude-dir=.codegraph . \
  | grep -vE '^(\./)?(docs/|README|scripts/install\.sh|scripts/internal/linux/|tests/linux-cli-packaging\.test\.mjs|docs/brand/)' \
  | grep -viE '@memmy/|@memtensor/memmy-memory|memmy-agent|memmyMemory|memmyConfigPath|memmyConfigWriter|memmyAgent(Admin|Client|WebSocket|Project|Session|Ui|Slash|Goal|Message|Request|Unsubscribe)?|MemmyAgent|memmy-runtime-config|memmy-skill-directory|memmy-plugin|memmy-resume-hook|memmy-deepseek-harness|memmy-opencode|memmy-workspace-bridge|memmy-migrations|memmy-account|memmy-memory-cli|memmy_bridge|memmy-bridge|MemmyLauncher|memmy\.cn|memmy\.bot|memmy-memory|memmy-resume' \
  > /tmp/cuby-leftovers.txt
wc -l /tmp/cuby-leftovers.txt
```

逐条审阅 `/tmp/cuby-leftovers.txt`：每一条要么是**内部标识符/包名**（保留），要么是需要改的漏网（改掉）。改完重跑至清单只剩白名单项。

- [ ] **Step 3: 更新仍描述旧名的注释与清理工具**

已知几处注释：`App/shell/desktop/src/main/runtime-services.ts:2417`、`main.ts:2855`、`main.ts:5189`（提到 `Memmy.exe` 与端口范围）。同时把 `runtime-services.ts:2415` 那条注释里的端口号更新为新值。

另有几处**功能性**的漏网（Task 1B 审查发现，前一处 Task 1B 已改文件但未改到）：

- `scripts/internal/mac/build-dmg.sh:163` 的 `APP_EXEC="$MACOS_DIR/Memmy"` → `Cuby`。它现在靠下面 `:166-173` 的"取唯一可执行文件"兜底仍能工作，所以不报错——但 `packaged-runtime-boundary.test.ts:2727` 断言了这个字面量，**脚本与测试必须同批改**，否则要么测试挂、要么 DMG 冒烟只在兜底路径下通过。
- `App/shell/desktop/src/main/main.ts:3217` 的兜底下载文件名 `Memmy-${version}-…` → `Cuby-…`（仅在更新 URL 的 basename 不可用时使用，但会写进用户磁盘）。

其余纯注释/用例标题的残留（`installer-win-unsigned.nsh:22,37,659` 的旧路径与话术、`packaged-runtime-boundary.test.ts:2724` 的用例标题）由 Step 2 的白名单扫描一并列出。

清理工具单独处理——`scripts/clear-data.sh`、`scripts/clear-all.sh`、`scripts/clear-all-windows.ps1`、`scripts/clear-win-app-data.cmd` 目前只认 `Memmy` 的进程名、安装路径与数据家目录。它们要**同时覆盖两套**（Cuby 与 Memmy），而不是把 Memmy 换成 Cuby：这些脚本的用处之一正是清掉旧安装。具体做法是在各文件的进程名匹配、安装路径探测与数据家目录枚举处**各加一组 Cuby 条目**，保留原有 Memmy 条目；`clear-all-windows.ps1` 的 `-AdditionalMemmyHome` 参数及其"目录名须以 Memmy 或 .memmy 开头"的校验放宽为同时接受 Cuby / .cuby。

- [ ] **Step 4: 本地打包冒烟（Windows 与 macOS 各一次）**

Run: `npm run package:win:x64:unsigned`（在 Windows 上）与 `npm run package:mac:arm64:cn:unsigned`（在 macOS 上）
Expected: 产物名为 `Cuby-<version>-…`；安装后应用名、开始菜单快捷方式、dmg 卷标、`%LOCALAPPDATA%\Programs\Cuby`、`~/Applications/Cuby.app` 全部为 Cuby；启动后 `~/.cuby/` 被创建。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "docs: align the remaining comments with the Cuby rename"
```

---

## 计划外的后续轮次（不在本计划范围）

- **文档面**：README 与 `docs/` 站点 1104 处（spec §4.10 有三档规则底稿）。
- **Linux CLI 安装面**：`scripts/install.sh` 的 env 与端口接线（spec §4.2）；在此之前该安装路径不可用。
- **Memory CLI 安装器**：`Memory/installers/install.sh` 与 `install.ps1` 同样把 `MEMMY_MEMORY_HOME` 与 `~/.memmy` 写死（装到 `~/.memmy/cli` 与 `~/.memmy/bin`）。与 Linux CLI 同类，同一轮处理；在此之前该安装路径不可用。仓库内无任何代码引用它们。
- **服务端更新清单**：让 `DEFAULT_UPDATE_MANIFEST_URL` 指向 `Cuby-*` 产物。
- **素材补全**：5 个预留姿态、Cuby 版待机动画（`cuby-idle-alpha.webm`）、新 logo/字标、`cuby.jpg` 的落地位置。
