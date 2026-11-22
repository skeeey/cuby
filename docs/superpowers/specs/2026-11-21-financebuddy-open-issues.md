# FinanceBuddy 未决问题记录

- 日期：2026-11-21
- 状态：Open / 跟踪中
- 关联文档：`docs/superpowers/specs/2026-11-20-financebuddy-extension-architecture.md`
- 范围：`upstream/financebuddy`（19 commits，基线 `6694af40`）；本文只记录问题、影响与建议，不包含实施计划

| ID | 问题 | 优先级 | 阻塞 |
|---|---|---|---|
| FB-001 | PyMuPDF 的 AGPL/商业许可 | P0 | 闭源分发前必须解决 |
| FB-002 | “10% common” 与 finance 代码纠缠，无法干净拆分 | P1 | 影响 main 合并与分支 rebase |

---

## FB-001：PyMuPDF 的 AGPL-3.0 / 商业许可

### 现状

FinanceBuddy 的 Python payload 有 **18 个模块** `import pymupdf`，覆盖两类能力：

**读 / 渲染 / 坐标**

- `c2_review.py`、`report_consistency_bundle.py`、`read_public_pdf.py`、`review_reader.py`、`report_input.py`、`peer_comparison.py`、`finance_projects.py` 等
- 典型 API：`get_text(sort=True)`、`get_text('words'/'blocks')`、`search_for`、`get_pixmap(...).tobytes('png')`、页数/加密检测

**原版式编辑（重）**

- `consistency_pdf.py`、`consistency_presentation.py`、`consistency_editor.py`
- 典型 API：`xref_get_key`/`xref_set_key`/`update_stream`/`get_new_xref`、`extract_font`、`pymupdf.Font`、ToUnicode CMap、`get_texttrace()`、`add_redact_annot`、内容流重写、字形宽度/颜色/bbox

这不是简单的 `insert_text`，而是深度定制的 PDF 编辑引擎。

### 许可事实

- PyMuPDF 是 **AGPL-3.0-or-later 或 Artifex 商业许可** 二选一；没有免费闭源选项。
- AGPL 是强 copyleft；分发含 PyMuPDF 的软件时，需提供 Corresponding Source（含修改、构建/安装脚本），整体按 AGPL 授权，保留 notices，不得附加冲突限制；网络交互（§13）在“修改 + 远程交互”时需向用户提供源码。
- 组合作品 vs 独立程序是 fact-specific：同进程/链接/嵌入通常是组合作品；通过 API/进程/协议通信可能是独立程序，但**进程边界本身不等于豁免**。
- PyMuPDF/MuPDF 还有额外的 AGPL 要求（如允许用户替换/重链接 MuPDF、生成的 PDF 保留相关 producer/copyright 元数据）——以官方 licensing 页和 MuPDF guide 为准。
- 商业许可由 Artifex 提供，解除 AGPL 的源码披露/copyleft；常见模式为 OEM Distribution / Subscription，按份/季度最低费/年度报告，价格不公开，需按产品形态询价。

### 对 FinanceBuddy / Cuby 的影响

1. `local_server.py` `import pymupdf`，**FinanceBuddy Python server 本身是 AGPL 覆盖作品**。如果随 Cuby 安装包分发，必须：
   - 提供 server 的完整对应源码（含修改、构建/安装脚本）
   - 附带 PyMuPDF/MuPDF 的 LICENSE/NOTICE 与源码获取方式
   - 或购买 Artifex 商业许可
2. Cuby 通过 MCP stdio 调 server；Cuby 是否构成组合作品需要法务判断。至少不能假设“独立进程”就自动不受影响。
3. 分支 CI 已经上传 `financebuddy-third-party-source`（`.github/workflows/build-desktop.yml`），这是好的起点，但**不等于完整合规**：还缺 LICENSE/NOTICE、对应源码的完整性、书面 offer/下载入口、修改说明、EULA 冲突检查、重链接要求等。
4. 原版式编辑没有成熟的 permissive 替代；读/渲染可以用 pypdfium2 + pdfplumber 替换，但编辑层仍需 PyMuPDF 或商业 SDK。

### 可选方案

| 方案 | 适用 | 成本/风险 |
|---|---|---|
| **A. 买 Artifex 商业许可** | 闭源商业产品，编辑是核心卖点 | 费用按用例；最省事；需确认覆盖 PyMuPDF+MuPDF、分发方式、修改权、支持/ indemnity |
| **B. 走 AGPL** | FinanceBuddy server 可以开源 | 需公开 server 完整源码、EULA 不得冲突、允许重链接、维护合规流程；Cuby 闭源部分的边界需律师确认 |
| **C. 换掉读/渲染路径** | 只想降低许可风险，编辑可保留 | pypdfium2（Apache-2.0/BSD-3）+ pdfplumber/pdfminer（MIT）；CJK/阅读顺序/bbox 需真实语料验证；编辑层仍要 AGPL/商业 |
| **D. 换掉编辑层** | 不想被 AGPL 约束且不愿买 PyMuPDF | 商业 SDK（Apryse/Aspose/Foxit/PSPDFKit）或自研 pikepdf+fontTools；自研成本高、回归风险大 |
| **E. 改产品形态** | 编辑不是必须 | 不做 PDF 原地改字，改为批注/差异高亮 PDF 或并排 HTML/Word 修订；pypdfium2/pypdf 可覆盖 |

### 待确认

- [ ] FinanceBuddy 是闭源商业分发，还是可以 AGPL 开源？
- [ ] Cuby host 与 MCP server 的法律边界（组合作品 vs 独立程序）——需要法务意见
- [ ] Artifex 商业许可的覆盖范围/报价/是否含 MuPDF/是否允许修改
- [ ] 若走 AGPL：安装包如何提供对应源码、EULA 如何改写、重链接要求如何满足
- [ ] 若替换读路径：在亿都/HKEX 中英文语料上的文本一致性、bbox、CJK、性能是否达标

### 建议

1. **先向 Artifex 询价**，同时让法务评估 MCP 边界；通常商业许可比自研 PDF 编辑引擎便宜。
2. 如果预算不允许：把读/渲染层换到 pypdfium2 + pdfplumber，编辑层保留 PyMuPDF 商业许可或商业 SDK；或把编辑功能降级为批注/差异输出。
3. 在许可问题解决前，不要把 FinanceBuddy 打进闭源安装包对外分发；内部 spike 不受影响。

---

## FB-002：“10% common” 与 finance 代码纠缠

### 背景

分支按改动面粗略估计约 **10% 是与 finance 无关、值得进 main 的通用修复**。实际情况比这个比例更糟：这些改动分布在 **混合提交** 里，很多无法直接 cherry-pick；还有一部分只是“看起来通用”，实际与 finance 或产品变体耦合。

### 清单

| 变更 | 主要位置 | 所在 commit | 分类 | 风险 / 动作 |
|---|---|---|---|---|
| Responses 流式工具调用身份保留 | `App/memmy-agent/src/providers/openai-responses/parsing.ts`（+ test） | `47bd8251` | **A 干净通用** | 最小、自带测试；优先拆成独立 PR |
| tool schema `strict: false` + nullable 还原 | `providers/openai-responses/converters.ts` | `7cfa2af5`（混合提交） | **B 通用待验证** | 需独立测试；确认对所有 MCP/工具 schema 的影响 |
| `tools.allowedTools` 白名单 | `config/schema.ts`、`tools/loader.ts`、`tools/registry.ts`（+ test） | `7cfa2af5` | **B 通用但未使用** | 分支里没有任何配置实际设置它；要决定是否作为公开能力，补语义/测试 |
| `gateway({ sessionDir })` | `entrypoints/cli/commands.ts` | `d6c57c2e`（初始功能提交） | **A 小型通用** | 只影响程序化开发宿主；小、易拆 |
| WebSocket 首条消息重试与 retarget 拒绝顺序 | `integrations/channels/websocket.ts` | `d6c57c2e` | **A/B 通用** | 有行为修复价值；需保留 finance 测试外的独立回归；与 main 的 WebSocket 改动可能冲突 |
| 生成 prompt 的显示摘要 | `core/session/webui-user-content.ts` | `d6c57c2e` | **B 耦合** | 直接 import `financeWorkflowDisplayText`；不能原样进 main，需改成通用 registry/扩展注册 |
| `VITE_CUBY_LAN_TRIAL` 分支 | `pages/app-frame.tsx` | `7cfa2af5` | **C 产品变体** | 不是 finance 通用修复；是 Cuby 的产品/发行决定，需单独评审 |
| 项目发现 / search palette 元数据 | `pages/project-discovery.ts`、`app-frame.tsx`、`components/search-palette.tsx`（+ tests） | `7cfa2af5` | **B/C** | UI 能力本身可通用，但当前由 finance saved projects 驱动；要决定是否抽象成通用 project metadata |
| Windows 内嵌 Python 运行时 | `shell/desktop/src/main/financebuddy-runtime.ts`、`electron-builder.win*.yml`、`.github/workflows/build-desktop.yml`、`scripts/financebuddy/*` | `7cfa2af5` | **D finance 专用** | 未来应变成通用 extension payload 安装钩子；不要进 main 的 finance 专用形态 |
| 导出下载 token / 128MiB 限制 | `finance-reader-api.ts`、`websocket.ts`、`memmy-agent-client.ts` | `9b8c501b` | **D 偏 finance** | 与 finance 导出绑定；若未来 host 需要通用下载，再单独抽象 |

### 为什么这是问题

1. **混合提交**：`7cfa2af5`（Windows 打包）同时含 `allowedTools`、tool schema、`VITE_CUBY_LAN_TRIAL`、项目发现和大量 finance UI/测试；`d6c57c2e`（初始功能）同时含 `sessionDir`、显示摘要、WebSocket 顺序修复。直接 cherry-pick 会把 finance 代码带进 main。
2. **落后 main 13 个提交**：main 已有 skills 管理、WeKnora preset、cuberouter 图像模型、session-dag 修复等；分支与 main 只有 2 个文件重叠（`local-api-contracts/src/index.ts`、`memmy-agent-client.ts`），但 `commands.ts`/`websocket.ts`/`home-page.tsx` 等也会冲突。
3. **测试上下文**：很多“通用”改动只有 finance 场景测试，缺少脱离 finance 的回归；拆出后要补单测。
4. **隐藏耦合**：`webui-user-content.ts` 直接 import finance 契约；`home-page.tsx`/`app-frame.tsx` 的通用外观下混着 finance 状态；`VITE_CUBY_LAN_TRIAL` 是产品开关。
5. **语义未定**：`allowedTools` 目前没有被任何配置使用；tool schema 的 `strict`/nullable 修复是否应该对所有 provider/工具生效，需要明确。
6. **提取顺序**：如果先 rebase financebuddy 到 main，再拆通用修复，冲突会更大；应先按 A/B 拆出小 PR，再 rebase。

### 建议拆分顺序

**Phase 1：A 类，独立小 PR**

1. `fix(providers): preserve Responses streaming tool identities` —— 直接取 `47bd8251` 的 commit（已自带测试）
2. `feat(gateway): allow an isolated sessionDir` —— 从 `d6c57c2e` 抽 `commands.ts` 的几行
3. `fix(websocket): coalesce first-request retries before retarget rejection` —— 从 `d6c57c2e` 抽 `websocket.ts` 的顺序调整 + 独立回归

**Phase 2：B 类，先通用化再进 main**

4. `fix(providers): keep optional MCP tool args optional` —— `strict`/nullable，补 provider 层测试
5. `feat(tools): add an explicit allowedTools allowlist` —— 决定是否公开配置；补注册/加载/MCP/skills 交互测试
6. `feat(webui): map generated prompts to display text via a registry` —— 把 `financeWorkflowDisplayText` 改成可注册的 mapper，main 不 import finance 包
7. 项目发现 / search palette：如果决定作为通用能力，抽成 project metadata provider；否则留在分支

**Phase 3：产品/发行决定**

8. `VITE_CUBY_LAN_TRIAL`：确认是不是 Cuby 的 LAN trial 产品功能；是则单独 PR，否则删除
9. Windows 内嵌运行时：先留在 finance 分支；等 extension payload 机制落地后再通用化

**Phase 4：rebase 与验证**

10. 上述 A/B 合并后，把 financebuddy rebase 到最新 main；逐个解决冲突
11. 跑 finance 侧的完整测试 + main 的 provider/WebSocket/MCP/skills 回归
12. 更新 `docs/financebuddy-workspace.md`（如需）与分支说明

### 验证清单

- [ ] 每个 A/B 项都有不依赖 finance 包的单测/回归
- [ ] `tools.allowedTools` 的语义（null = 全部；[] = 全禁；未知名称如何处理）明确
- [ ] tool schema 修复覆盖 OpenAI Responses 的 strict、nullable、optional 参数
- [ ] WebSocket 顺序修复覆盖：首条消息重试、已存在 session retarget、并发/重复 request id
- [ ] 显示摘要机制不 import 任何 finance 代码
- [ ] `VITE_CUBY_LAN_TRIAL` 有明确产品归属
- [ ] financebuddy rebase 后，skills/MCP/reader/PDF 导出测试全绿

### 待确认

- [ ] 每项的 owner 与优先级
- [ ] `VITE_CUBY_LAN_TRIAL` 是否保留为产品能力
- [ ] 项目发现/search palette 是否值得通用化
- [ ] `allowedTools` 是否作为公开配置，还是仅内部打包时使用
- [ ] Responses 修复是否与 main 的 provider 改动重叠（需 rebase 后验证）
- [ ] 分支 rebase 的节奏：每拆一个 PR rebase 一次，还是一次性？

---

## 附录：排查命令

```sh
# 通用改动归属
git log --oneline -S'allowedTools' upstream/main..upstream/financebuddy -- App
git log --oneline -S'sessionDir' upstream/main..upstream/financebuddy -- App
git log --oneline -S'financeWorkflowDisplayText' upstream/main..upstream/financebuddy -- App
git log --oneline -S'VITE_CUBY_LAN_TRIAL' upstream/main..upstream/financebuddy -- App
git log --oneline -S'responsesToolSchema' upstream/main..upstream/financebuddy -- App

# 混合提交范围
git show --stat 7cfa2af5
git show --stat d6c57c2e
git show --stat 9b8c501b

# PyMuPDF 使用面
git grep -l 'import pymupdf\|import fitz' upstream/financebuddy -- scripts/financebuddy/windows-payload
```

## 参考

- PyMuPDF Licensing: https://pymupdf.io/licensing
- Artifex Licensing Overview: https://wiki.licenseware.io/wiki/artifex-software-licensing/
- MuPDF License Guide: https://www.ghostscript.com/~robin/mupdf_explored/mupdf_exploredse2.html
- GNU AGPL-3.0: https://www.gnu.org/licenses/agpl-3.0.html
- AGPL §13 说明: https://safeguard.sh/resources/blog/agpl-network-clause-saas-obligation
- pypdfium2: https://pypdfium2.readthedocs.io/en/stable/
- pdfplumber: https://github.com/jsvine/pdfplumber
