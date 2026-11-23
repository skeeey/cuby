# Cuby 本地协议文档设计

日期：2026-11-23
状态：待评审

## 背景

Cuby 桌面端的《服务协议》《数据协议》目前打开的是外部链接：

- 早先指向 `memmy.cn/terms`、`memmy.cn/privacy`（Memmy 品牌，主体是记忆张量）。
- 本轮先改成了 `cuberouter.cn/user-agreement`、`cuberouter.cn/privacy-policy`，但那是 CubeRouter 云服务/API 网关的协议：实名、备案、充值退款、资源到期等条款面向 API 客户，不覆盖 Cuby 的桌面端、记忆采集、BYOK 等场景。

Cuby 与 CubeRouter 是不同产品，协议不能共用。Cuby 的最终托管地址又尚未确定，因此协议正文不依赖远程 URL，直接随桌面端打包。

## 目标

1. 产出 Cuby 独立的两份协议正文，中英双语：
   - 《Cuby 服务协议》 / Cuby Terms of Service
   - 《Cuby 数据协议（数据使用与隐私政策）》 / Cuby Data Agreement (Data Use and Privacy Policy)
2. 正文以 Markdown 形式随桌面端打包，离线可用，不依赖任何域名。
3. 登录/注册页与设置页的协议入口改为应用内阅读层（Modal），保留当前页面状态，不丢失登录表单。
4. 清理桌面端对 `CUBY_LEGAL_*` 远程地址的构建依赖。

## 非目标

- 不修改 CubeRouter 仓库、后台配置或线上协议。
- 不发布到官网/对象存储；托管方案确定后再做远程化。
- 不覆盖 Cuby 的其他文档（Memory 文档、帮助中心等）。
- 不替代法务审核。

## 约束与事实

- 运营主体：上海算丰信息有限公司；英文对外名称使用官网一致的 **Suanova Technology Ltd**。
- 联系方式：只保留邮箱 `info@isuanova.com`，不写邮寄地址。
- 账号与模型服务由 CubeRouter 提供；CubeRouter 同样由上海算丰运营，正文统一用“我们”表述。账号注册/登录、API Key、额度与计费按 CubeRouter 平台规则执行。
- Cuby 客户端使用 MIT 许可证（仓库 `LICENSE`），协议中的知识产权条款不得与开源许可证冲突。
- 桌面端技术栈：Electron + React + Vite；已有 `react-markdown`、`remark-gfm` 和共享 `Modal` 组件。
- 应用语言：`zh-CN` / `en-US`，协议正文按当前 UI 语言加载。
- **正文不出现 Memmy / 记忆张量 / MemTensor 的品牌、主体或政策引用**。当前构建仍依赖 `api.memmy.cn` 的分析、更新检查与账号模式语音转写，数据协议只以“云服务提供商 / 我们委托的云基础设施”这一类别披露，不点名 Memmy，也不链接其政策。
- **BYOK / 自定义模型**：当前版本在登录后仍可通过「设置 → 模型 → 添加连接」配置自定义供应商，但产品计划后续禁用。**本次协议正文不写 BYOK**，也不把它描述为一种使用模式；若禁用没有随协议发布版本上线，需要重新评估披露（见“风险”）。
- **语音输入**：账号模式经我们委托的云服务转写；自定义模型模式下也可能发往 DashScope 兼容端点（当前固定使用阿里云 `qwen3-asr-flash`），该模式计划禁用，协议正文不单独展开。数据协议把语音输入作为收集类别披露。
- **线路选择**：一个安装包同时配置 `cn=https://cuberouter.cn` 与 `hk=https://cuberouter.com`，用户可在登录页选择线路；选择香港线路时数据可能在香港处理。按已确认决定：只在数据协议中披露，不加单独的跨境同意 UI。
- **改进计划**：正文按产品设想描述——开启后可能使用并存储对话内容、提示词、Agent 操作记录、记忆数据、功能使用行为、崩溃与错误信息，用于改进产品和训练模型；可随时关闭。当前代码未发现内容上传路径，发布前需产品/法务确认实现与正文一致。
- 正文需法务复核后才能视为最终版本。

## 方案对比

### A. 保持远程链接（现状）

优点：改正文不用发版。
缺点：Cuby 托管地址未定；继续复用 CubeRouter/Memmy 页面会把错误的产品条款给用户。淘汰。

### B. 本地 HTML，用系统浏览器打开 `file://`

优点：正文与代码分离。
缺点：Electron 对 `file://` 有限制；跳出 App，界面与品牌割裂；无法复用应用主题和语言切换。淘汰。

### C. 本地 Markdown + 应用内阅读层（采用）

正文作为 Markdown 打包进 renderer，用现有 `react-markdown` 渲染，在应用内 Modal 中阅读。

优点：
- 不依赖域名，离线可用；托管未定不阻塞。
- 不新增路由，登录表单状态不丢。
- 复用现有 Modal 的焦点管理、Esc/遮罩关闭和主题样式。
- 后续有托管地址时，可在同一入口加“远程优先、失败回落本地”，UI 不变。

缺点：正文更新需跟随桌面端发版。当前产品阶段可接受。

## 详细设计

### 1. 文件布局

```
App/frontend/desktop/src/legal/
  content/
    user-agreement.zh-CN.md
    user-agreement.en-US.md
    data-agreement.zh-CN.md
    data-agreement.en-US.md
  legal-content.ts
  LegalDocumentModal.tsx
  tests/
    legal-content.test.ts
```

### 2. 内容加载

`legal-content.ts`：

- 用 Vite 的 `?raw` 导入四份 Markdown。
- 导出 `LegalDocumentKind = "terms" | "data"`（沿用现有类型）。
- `resolveLegalDocument(kind, language)` 返回对应语言的正文；`ResolvedLanguage` 只有 `zh-CN` / `en-US` 两个值，直接映射。
- 删除 `legal-links.ts` 与 `legal-links.test.ts`。

### 3. UI 与状态

新增全局状态，而不是给每个入口复制一份 Modal：

- `AppState.legalDocument: LegalDocumentKind | null`。
- 新 action：`openLegalDocument(kind)` / `closeLegalDocument()`。
- 在 `router.tsx` 根部渲染 `<LegalDocumentModal />`，与 `GlobalUpdateDialog` 同级，确保从任何页面（欢迎页、登录页、设置页、首次引导）都能打开，且切页不丢失状态。
- Modal 使用共享 `Modal` 组件：
  - 标题：`t("legal.terms")` / `t("legal.data")`
  - 关闭按钮文案：`t("legal.back")`
  - 内容区可滚动，宽度适合长文阅读（约 720–800px），移动/窄窗口下自适应。
  - 正文使用独立的 `legal-markdown` 样式作用域，支持标题、段落、列表、表格、引用；跟随应用明暗主题。
  - Markdown 中的外部链接通过 `openExternalUrl` 打开，禁止在 Electron renderer 内直接导航。

触发点（全部改为 dispatch，不再调用 `getLegalLinkUrl` / `openExternalUrl`）：

| 位置 | 文档 |
| --- | --- |
| `components/account-auth-panel.tsx`（登录/注册页底部） | terms / data |
| `pages/settings-page.tsx` 隐私与改进计划“了解更多” | data |
| `pages/settings-page.tsx` 关于区“服务协议” | terms |
| `pages/app-frame.tsx` 改进计划弹窗“了解更多” | data |

### 4. 远程配置清理

协议改为本地后，桌面端不再需要 `CUBY_LEGAL_CN_BASE_URL` / `CUBY_LEGAL_INTL_BASE_URL`：

- `App/frontend/desktop/vite.config.ts`：移除 `LEGAL_BASE_URL_ENV_KEYS`、`validateLegalEnv`、test 模式默认值，并从 `PUBLIC_MEMMY_RENDERER_ENV_KEYS` 移除两个 key。
- `.env.example`：移除两个变量。
- `.github/workflows/build-desktop.yml`：移除 Windows/macOS 两个 job 中的变量。
- `scripts/package-win-local.sh`：`REQUIRED_ENV_KEYS` 只保留 `CUBY_CLOUD_SERVICE`，同步更新注释。
- `App/memmy-agent/tests/build-assets.test.ts`、`tests/skills/office-skills.test.ts`：移除只为旧构建要求而 stub 的 legal 变量（若运行证明无关）。
- 后端 `bootstrap.legal` / `cloudClient.getLegalUrls()` 保留不动：memmy-cloud 后端仍在使用，Cuby 前端只是不再消费。

### 5. 测试

- `legal-content.test.ts`：
  - 四份文档都能按 `kind` + 语言解析；
  - 中文标题、英文标题、运营主体、联系邮箱存在（中文断言“上海算丰信息有限公司”，英文断言“Suanova Technology Ltd”）；
  - 文档包含关键章节（账号、计费、记忆、语音、改进计划、第三方、数据保留、免责、联系方式）；
  - 不把 CubeRouter 用户协议当作 Cuby 正文；
  - 正文不包含 `Memmy`、`memmy`、`记忆张量`、`MemTensor` 等旧品牌/主体字符串（MIT 版权声明在仓库 `LICENSE` 中保留，不写进协议正文）。
- Modal 组件测试：
  - 打开/关闭、Esc、遮罩关闭；
  - 语言切换后正文切换；
  - 登录页打开协议再关闭，表单输入仍在（或由现有架构保证不卸载）。
- 更新现有断言：
  - `welcome-page-legal-link.test.ts`、`settings-page.test.tsx`、`app-frame.test.tsx`、`prototype-modals.test.ts` 不再断言 `getLegalLinkUrl`，改为断言打开本地文档的 action。
  - `vite-config.test.ts` 删除 legal 环境校验相关用例。
- 运行桌面端完整 `npm test` 与 `npm run typecheck`。

## 正文大纲

### 《Cuby 服务协议》 / Cuby Terms of Service

1. 协议范围与接受
2. 定义（Cuby、CubeRouter、平台账号、模型服务、记忆采集/注入、改进计划、用户内容）
3. 服务内容（桌面客户端、跨 Agent 记忆、工具与消息通道、模型访问）
4. 账号与登录（CubeRouter 提供；用户名/密码/可选邮箱验证；账号安全；不得批量注册或共享）
5. 费用、额度与计费（经 CubeRouter 使用模型服务时适用；按 CubeRouter 公示规则计费；额度/余额以 CubeRouter 展示为准；欠费或额度耗尽的处理；价格调整；退款按 CubeRouter 规则）
6. 模型服务与第三方（模型供应商、第三方 Agent、第三方消息渠道；我们委托的云服务提供商——分析、更新检查、语音转写）
7. 记忆采集与注入（仅授权后启用；本地存储；可随时关闭/删除；用户保证对采集与注入对象有合法权限）
8. 自动化执行与风险（工具调用、文件/命令操作、生成内容的局限、备份建议）
9. 改进计划（可选、默认关闭、可撤回；开启后可能使用对话、提示词、Agent 操作记录、记忆数据、功能使用行为、崩溃与错误信息，用于改进产品和训练模型）
10. 数据与隐私（引用《Cuby 数据协议》，冲突时以数据协议为准）
11. 知识产权（客户端依 MIT 许可证，保留版权声明；Cuby 名称/标识/文档归我们或相应权利人；用户内容归用户）
12. 用户行为规范
13. 服务变更、中断与终止
14. 未成年人保护
15. 免责声明与责任限制
16. 法律适用与争议解决（中华人民共和国大陆法律；上海算丰信息有限公司所在地法院）
17. 协议更新、语言版本与联系方式（中文版本为准；info@isuanova.com）

### 《Cuby 数据协议》 / Cuby Data Agreement

1. 概述与原则（本地优先、最小必要、用户控制）
2. 数据存储在哪里（对话/记忆/配置/API Key 默认本地；CubeRouter 账号数据在 CubeRouter；云服务提供商只承载分析、更新检查与账号模式语音转写；说明可能随版本演进）
3. 我们收集的信息（CubeRouter 账号信息、设备与日志、本机保存的 API Key、记忆数据、语音输入音频、基础运行分析事件；改进计划开启后的对话/提示词/操作记录/记忆数据）
4. 数据何时离开设备（登录注册、记忆提炼、模型请求经 CubeRouter 路由、语音转写、分析事件、更新检查；选择香港线路时可能在香港处理）
5. CubeRouter、云服务提供商与第三方模型供应商（说明账号/模型服务、云基础设施、语音转写服务商；适用相关方的隐私政策；不引用任何 Memmy 政策）
6. 共享、转让与公开披露（不出售；服务商；法律要求）
7. 你的权利与选择（关闭改进计划、管理记忆、删除本地数据、访问/更正、退出/注销）
8. 数据安全（合理措施；本地设备与账号凭证由用户保管）
9. 数据保留（本地数据保留至用户删除；云端数据在实现目的所需最短期限内保留，法律另有规定除外）
10. 未成年人
11. 政策更新、语言版本与联系方式（中文版本为准；info@isuanova.com；生效日期）

## 已确认的决定

1. **不出现任何 Memmy 政策或品牌**：正文不写 Memmy / 记忆张量 / MemTensor，也不链接其政策；当前仍在使用 `api.memmy.cn` 的能力以“我们委托的云服务提供商”类别披露。若后续要求连该类别也不披露，需先迁移 `CUBY_CLOUD_SERVICE`，不属于本次范围。
2. **改进计划按产品设想写**：开启后可能使用并存储对话、提示词、Agent 操作记录、记忆数据、使用行为、崩溃与错误信息，用于改进产品与训练模型；默认关闭、可随时撤回。发布前由产品/法务确认实现与正文一致。
3. **CubeRouter 就是上海算丰**：正文用“我们”指代上海算丰和 CubeRouter，不写关联方/第三方。
4. **英文主体**：`Suanova Technology Ltd`（与官网一致）。
5. **香港线路**：只在数据协议中披露可能在香港处理，不增加选线时的跨境同意 UI。
6. **联系方式**：只留 `info@isuanova.com`，不写地址。
7. **收费**：Cuby 客户端不单独收费；仅 CubeRouter 模型服务按平台规则计费。
8. **保留期限**：使用“实现目的所需最短期限 + 法律要求”的通用表述；本地数据保留至用户删除。
9. **账号注销**：引导用户通过 CubeRouter 平台或 `info@isuanova.com` 申请，不新增应用内注销流程。
10. **语言版本**：中文版本为准，英文版本为方便阅读的翻译，并在英文文档中注明。
11. **BYOK 暂不写入协议**：产品计划后续禁用；正文不描述 BYOK / 自定义模型模式。第三方模型供应商仍会在账号模式的模型请求中出现，正文保留通用的“模型供应商/第三方服务”条款，但不展开 BYOK。

## 已确定的实现取舍

- 采用本地 Markdown + 应用内 Modal；不保留 `file://` 外部打开方案。
- 外部链接在 Modal 内通过 `openExternalUrl` 打开，不在 Electron renderer 内直接导航。
- 移除桌面端 `CUBY_LEGAL_*` 构建依赖；后端 bootstrap `legal` 与 memmy-cloud 相关代码保持不动。
- 知识产权条款保留 MIT 版权声明，不主张对 MIT 代码的所有权；Cuby 名称/标识/文档写“归我们或相应权利人所有”。
- 生效日期建议 2026-11-23，可由法务在发布前调整。

## 风险

- 协议正文属于法律文件，本设计只保证产品事实与结构一致，最终需法务审核。
- 本地打包意味着更新协议必须发版；后续可加远程覆盖，但需要重新设计缓存与失败回落。
- 当前分析、更新检查与账号模式语音转写实际由 `api.memmy.cn` 承载，正文只写“我们委托的云服务提供商”。若法务要求点名具体接收方，需要补充第三方清单或先完成服务迁移。
- 改进计划正文按产品设想描述内容上传；当前代码未发现对应实现，发布前必须由产品确认实现，否则正文失实。
- **BYOK 当前仍可用，但正文不写**：如果禁用没有随协议发布版本上线，用户仍可把请求直连第三方供应商；届时需要至少补一条通用的第三方直连披露，或先禁用再发布协议。
- 构建是一个通用安装包，用户可在登录页选择香港线路；正文已披露香港处理，未增加单独同意 UI。若法务要求单独同意，需要追加选线提示。
