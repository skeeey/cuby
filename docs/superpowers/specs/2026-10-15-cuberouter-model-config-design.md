# cuberouter 定制客户端：模型配置页（选 key / 选模型 / 余额）— 设计

- 日期：2026-10-15
- 状态：待评审
- 涉及仓库：`memmy-agent`（本仓库）、`cuberouter`（外部依赖，设计核对到 `d3ed1a4`）
- 前置文档：`docs/superpowers/specs/2026-09-16-cuberouter-login-design.md`（登录/注册 v1）、`docs/superpowers/plans/2026-10-14-login-register-flow-v2.md`（v2：组织自动解析、`cuby-desktop` 前缀、无组织走个人 key）

## 1. 背景

v1/v2 已落地的现状：cuberouter 登录成功后，桌面端把一把 key 写成一条 BYOK 模型配置（provider `openai`、endpoint `<线路>/v1`、模型固定 `cuberouter.model`，`App/frontend/desktop/src/state/model-provisioning.ts:38`），`userMode` 固定 `"byok"`（设计 v1 D10）；模型配置 tab 仍渲染通用的 `ModelWorkspaceSection`。

定制客户端要在模型配置页做三件事：**用户选 key、用户选模型、显示用户余额**（余额是用户个人的，要显示清楚）。

已核对的 cuberouter 接口（全部走登录会话 `UserAuth`，不需要额外权限）：

| 数据 | 接口 | 备注 |
| :--- | :--- | :--- |
| 个人余额 | `GET /api/user/self` → `quota` / `used_quota` | `controller/user.go:553-611`；`quota` 即剩余 |
| 组织余额 | `GET /api/organizations` 返回 `organizations.*`，含 `quota` / `used_quota` | 组织**剩余 = quota − used_quota**（`service/organization_billing.go:81-85`）；桌面端取成员关系已经在调这个接口 |
| 可选模型 | `GET /api/user/models` | 用户所属 group 启用的模型，仅模型名，无能力信息（`controller/user.go:703-735`） |
| 我的组织 key | `GET /api/organizations/:id/tokens?responsible_user_id=<me>` | 行内带明文 key 与责任人（`controller/organization_token.go:62-86`）；普通成员服务端自动收敛到本人 + public（`service/organization_token.go:112-117`） |
| 我的个人 key | `GET /api/token/`（分页、掩码、每行 `status`） | `controller/token.go:130-142`；明文 `POST /api/token/:id/key`（`router/api-router.go:302`） |

计费归属（决定"余额显示谁"）：组织 key 的消耗落**组织账本**（组织 `used_quota` + token `remain_quota`，`service/organization_billing.go` 头部注释、`:65-89`）；个人 key 落**个人额度**。

## 2. 目标与非目标

### 目标

1. cuberouter 身份下，模型配置 tab 展示专用面板：账号/组织行、key 选择（带计费标注与余额）、用途分配（对话模型多选 + 记忆摘要/技能进化单选）。
2. 用户选的 key 与模型直接写入现有 BYOK 目录（单连接），**不引入新模式**。
3. 已选 key 在后续登录中被尊重，不被 `find-or-create` 的默认 key 覆盖；只有它已不在用户名下或不可用时才回落。
4. 面板数据（keys / models / 余额）全部来自会话，用户不需要手工抄 key。

### 非目标

1. **余额不参与运行时**（记忆预算、任务拦截、低额提醒都不接）。余额只做展示。
2. 不新增 `userMode`、不加第三个 space、不加新 provider id（仍复用 `openai`）。
3. 不做 cuberouter 侧的 key 管理（创建/删除/禁用）：面板不改实例侧数据；默认 key 仍由登录时的 find-or-create 负责。
4. 不给 asr / image 提供 cuberouter 模型（实例模型列表不带能力信息，不猜）；embedding 保持 memmy 内建本地模型。
5. 不做多账号切换（沿用 v1 非目标）。
6. 个人 key 明文不预取、不缓存：只在选中的那一刻取一次。

## 3. 关键决策

| # | 决策 | 理由 |
| :--- | :--- | :--- |
| D1 | **不加模式，仍是 `userMode: "byok"`** | 余额只做展示（无运行时语义）；"是不是 cuberouter 身份"由 `identityProvider === "cuberouter"` 回答。加第三模式要动 `AppSettingsDto.userMode` 契约、`modelAssignments` 的 space、runtime 解析与投影，成本远超收益 |
| D2 | cuberouter 身份下模型配置 tab 渲染新组件 `CuberouterModelSection`，其它身份零改动 | `model-workspace-section.tsx` 已 1607 行、带编辑器/测试/乐观保存的状态机；定制面独立成型，避免继续增条件分支 |
| D3 | **不要独立的"选模型"步骤**：用途分配的下拉就是选模型 | 用户判断；分配即选模型；配置里只沉淀被分配用到的模型 |
| D4 | key 候选 = **我名下全部 key**（组织按 `responsible_user_id`，个人全量，含自动建的 `cuby-desktop-<name>`） | 管理员预置的、控制台自建的 key 都能选 |
| D5 | 余额**挂在 key 行**：`计费：个人 · 剩余 x` / `计费：组织 yeebo · 剩余 z`；不做独立余额卡片 | 余额与"选中的 key"永远一致，不会出现卡片对不上 key 的情况 |
| D6 | 个人 key 明文只在选中时取（`POST /api/token/:id/key`） | 减少请求与暴露面；组织 key 的列表自带明文 |
| D7 | 登录复核：已记录的 key 仍在且可用 → 保留；否则回落 find-or-create 并更新记录 | 否则用户在面板里选的 key 下次登录被冲掉 |
| D8 | 通用连接库收进「高级」折叠 | 保留第三方 endpoint 的逃生门，默认不打断 cuberouter 体验 |
| D9 | embedding 固定 `BUILTIN_LOCAL_EMBEDDING_ASSIGNMENT_ID`（只读展示）；asr/image 不提供 | 与 v1 非目标一致（不把 embedding 指到 cuberouter）；模型列表无能力信息，不猜 |
| D10 | 存储形态不变：一条 provider `openai` 的 byok 连接（endpoint `<线路>/v1`、`apiKey` = 所选 key、`models` = 被分配用到的模型），分配指向对应 preset | 复用唯一被支持的写入通路与乐观锁 |

## 4. 架构与组件

### 4.1 后端：出站客户端与编排服务

客户端（`App/backend/src/adapters/outbound/cuberouter-client/`）新增/扩展：

- 新增 `getUserSelf(accessToken): Promise<{ quota: number; usedQuota: number }>`（`GET /api/user/self`）。
- 新增 `getUserModels(accessToken): Promise<string[]>`（`GET /api/user/models`）。
- 新增 `listPersonalTokens(accessToken): Promise<CuberouterPersonalToken[]>`（`GET /api/token/`，分页按 `page_size` 拉取；沿用现有 `searchPersonalTokens` 的行映射）。
- 扩展 `listOrganizations` 的返回类型：带上 `quota` / `usedQuota`。
- 扩展 `listOrganizationTokens`：支持 `responsibleUserId` 与"不过滤 status"（现状固定 `keyword` + `status=1`，`http-cuberouter-client.ts:103-110`）；行里映射出责任人（`hydrateOrganizationTokenUserNames` 已给出）。
- 个人 key 明文沿用 `getPersonalTokenKey`。

编排服务（`App/backend/src/services/cuberouter-account-service.ts`）新增 `readModelChoices()`，组装 4.2 的响应：

- 组织取列表第一个（与 `loginOnNode` 同规则，`cuberouter-account-service.ts:189-193`）；组织 key 只收 **我名下**的行（服务端已按普通成员收敛，客户端再按责任人字段确认一次）。
- 个人 key 全量；`usable = status === 1 或实例未报告 status`（沿用 `findPersonalToken` 的判定，`cuberouter-account-service.ts:311-326`）。
- 每个 key 带计费标注：组织 → `{ kind: "organization", name, remainingQuota: quota − usedQuota }`；个人 → `{ kind: "personal", remainingQuota: self.quota }`。
- 降级与传播：`self` 拉取失败 → 所有 `remainingQuota` 为 `null`（面板只显示计费主体）；组织 key / 个人 key / 可选模型**任一失败即传播**（面板据此进错误态 + 重试，绝不把失败显示成「没有 key」）。

### 4.2 契约与本地路由

- `local-api-contracts` 新增 `CuberouterModelChoicesViewSchema`：

```ts
{
  account: { username: string; organizationName: string | null },
  keys: Array<{
    scope: "organization" | "personal";
    id: number;
    name: string;
    /** 组织 key：实例列表自带明文。个人 key 永远不带（选中时另取）。 */
    secret?: string;
    /** 个人 key 的实例状态（1 enabled / 2 disabled / 3 expired / 4 exhausted）。 */
    status?: number;
    usable: boolean;
    billing:
      | { kind: "personal"; remainingQuota: number | null }
      | { kind: "organization"; organizationName: string; remainingQuota: number | null };
  }>,
  models: string[];
}
```

- 路由（`routes/account.ts`，与现有 `/api/account/*` 同组、同一 `authenticateRuntimeToken` 预处理器）：
  - `GET /api/account/cuberouter/model-choices` → 上述视图。
  - `POST /api/account/cuberouter/personal-keys/:id/key` → `{ key }`（只转调 `getPersonalTokenKey`，仅本人可用）。

### 4.3 桌面：组件拆分（纯重构，行为不变）

把 `pages/model-workspace-section.tsx`（1607 行）拆成两个可复用组件，`ModelWorkspaceSection` 变为二者的组合：

- `ModelLibrarySection`：模型库卡片列表 + 添加/编辑连接弹窗 + 连接测试 + 删除确认。
- `ModelAssignmentSection`：对话模型多选（含默认模型）+ `AssignmentRow` 行集合（`AssignmentRow` 已是独立子组件，`model-workspace-section.tsx:1313`；行集合可配置，用于隐藏 embedding/asr/image）。候选由调用方传入，不再隐含来自 workspace 连接。

既有测试（`settings-page.test.tsx`、`model-workspace-long-model-name.interaction.test.tsx` 等）作为这次重构的回归网，必须保持绿。

### 4.4 桌面：新面板 `CuberouterModelSection`

新文件 `pages/cuberouter-model-section.tsx`，设置页在 `state.account.identityProvider === "cuberouter"` 时渲染它（`settings-page.tsx:1616-1617` 的接线处加分支；`workspaceMode` 逻辑不变）。

- ① **账号行**：`state.account.username` / `organizationName`（已有数据，不新增请求）。
- ② **key 卡**：radio 列表，每行 = key 名 + 计费标注（`计费：个人 · 剩余 x` / `计费：组织 yeebo · 剩余 z`）+ 个人 key 的状态徽标；不可用行置灰不可选；底部「重新获取 key」= 走一次 find-or-create 并选中它（实例侧 key 全被删时的复位路径）。
- ③ **用途分配**（复用 `ModelAssignmentSection`）：
  - 候选 = `choices.models` ∪ 「高级」里自加连接里的模型（去重）；
  - 只显示三行：对话模型（多选 + 默认）、记忆摘要、技能进化；embedding 以只读一行展示「本地向量模型（内建）」；asr/image 不显示；
  - 默认值：已配置 → 显示配置值；未配置 → 留空（构建期默认模型只在登录 provisioning 时播种）；配置里的模型已不在实例可选列表 → 该行仍显示该模型名（不显示「未配置」）、对话区可把该模型取消勾选，并在分配区下方提示「有模型已不在实例可选列表中，请重新选择。」。
  - 下拉需要搜索过滤：新增一个带搜索的分配下拉组件，不改通用 `Select`（`components/Select.tsx` 目前无搜索，且被 20+ 处使用，不动它的菜单行为）。
- ④ **「高级」折叠**：内嵌 `ModelLibrarySection`（通用连接管理）。

数据：挂载时 `GET model-choices`（一次请求拿到 keys + models + 余额）；「刷新」按钮重拉。选择状态由 4.5 的记录 + 配置共同决定。

### 4.5 选择记录与登录复核

新增桌面侧记录 `state/cuberouter-key-selection.ts`（照 `model-workspace-connection-test-state.ts`：localStorage + 注入 storage 以便测试）：

```ts
{ [username: string]: { scope: "organization" | "personal"; id: number; name: string } }
```

写入时机：**面板换 key 保存成功后**（保存被拒或失败时不写，记录不允许领先于配置）；登录复核判定「复用」成功后回写一次；「重新获取 key」成功后清除记录（新 key 尚无列表身份，等用户下次选择）。失效记录在 provision 分支清除。

登录复核（`components/account-auth-panel.tsx` 的 `continueAfterAuth`，判定函数为 `state/model-provisioning.ts` 的 `resolveCuberouterLoginKey`）：

1. 记录里的 key 仍在 `model-choices` 列表且 `usable` → **reuse**：组织 key 直接用列表里的明文、个人 key 调一次 reveal，只刷新 `apiKey`；
2. 记录缺失或失效 → **provision**：走一次 find-or-create（与登录同一路径，`POST /api/account/cuberouter/provision-key` 也复用它），并清除失效记录；
3. `model-choices` 拉取失败且配置里已有可用连接（apiBase = 当前线路 `/v1` 且有密钥）→ **keep**：什么都不写（瞬时故障不得覆盖用户选的 key），不阻断登录；
4. **模型选择与 key 决策解耦**：三条路径都保留目录里已有的模型选择（三个槽位任一非空都算已有选择，只配了记忆模型的机器也一样）——「改了模型但没点过 key」的机器，登出再登录也不会被重置。选择为空时才播种，且只种一个模型：目录契约不允许写入没有模型的连接（`TextModelProviderInputSchema.models` 至少 1 个），所以构建期默认模型（环境变量 `MEMMY_CUBEROUTER_MODEL`，即 provision 结果的 `model`）只是**首选默认**——实例清单（`availableModels`，随 provision 决策一起带回）里有它就种它，不在就退用清单第一个，清单未知（choices 拉取失败，`availableModels` 为 `null`）时用构建期默认。「重新获取 key」同此规则。

### 4.6 写入通路

`state/model-workspace.ts` 新增纯函数 `applyCuberouterSelection(workspace, { apiBase, protocol, apiKey?, selection })`（`selection` = `{ agent: { models: string[]; default?: string }; memorySummary: string; memoryEvolution: string }`），配合 `state/model-provisioning.ts` 的 `saveCatalogMutation({ configClient, mutate })`（每轮读一次最新目录；`model_config_changed` / `config_write_busy` 重试一次）落盘：

- preset 查找**限定在该 endpoint**（不跨 endpoint 认领同名模型）；未被本次选择引用的**本 endpoint** byok preset 删除（其它 endpoint 与 account preset 不动）；
- 分配引用按「目录中残留的全部 preset id」清理，对话候选保留其它连接中仍具 `agent` 能力的 preset 并追加本次选择的 id（其它连接上的 asr / image / 自定义 embedding 分配不受影响）；
- 复用同 apiBase 的 endpoint（沿用 `endpointId`），换 key 只改 `apiKey`；未给明文时保留已存密钥；embedding 不写（保持 memmy 内建本地缺省）；
- 一次 `saveModelCatalog(modelConfigInput(workspace))`，冲突沿用现有重读重试。

## 5. 数据流

- **打开面板**：mount → `GET model-choices` → 渲染 key 列表（计费/余额/状态）+ 模型候选；草稿由 `readCuberouterSelection(目录, apiBase)` 初始化。
- **换 key**：点选 → 个人 key 先 `POST personal-keys/:id/key` 取明文 → `applyCuberouterSelection`（只改 `apiKey`）→ 保存成功后才写选择记录。
- **改分配**：改下拉 → `applyCuberouterSelection`（preset upsert/删除 + 分配指向）→ 保存成功后按新目录重播草稿。
- **登录**：见 4.5。
- **余额刷新**：面板挂载时拉一次；「刷新」按钮重拉（余额只随使用变化，保存动作不触发重拉）。

## 6. 错误与边界

| 场景 | 行为 |
| :--- | :--- |
| `model-choices` 拉取失败 | 面板显示错误 + 重试按钮；不渲染选择器；已有配置不受影响 |
| 无组织 | key 列表只有个人组；标注 `计费：个人` |
| 个人 key 明文取失败（权限/被禁用） | 该行不可选 + 显示原因；其它行不受影响 |
| 记录里的 key 已从实例消失/不可用 | 面板提示「原 key 已失效，请重新选择」，并给「重新获取 key」入口 |
| 模型列表为空 / 默认模型不在列表 | 分配行显示空态提示；不自动猜测；对话行未选时聊天不可用（与现有 byok 未配置一致） |
| 组织余额字段缺失 | 只显示 `计费：组织 <名>`，不显示数字 |
| 保存冲突 | 沿用重读 + 重试 |
| 模型被误选为非 chat 模型 | 实例报错原样透传（不猜能力） |

## 7. 测试

- **后端**：`http-cuberouter-client` 新方法的打桩单测（self/models/个人列表/responsible_user_id 过滤）；`cuberouter-account-service.readModelChoices` 单测（有组织/无组织、多组织取第一个并记日志、个人 key 状态判定、余额缺失降级）；路由测试照 `adapters/inbound/local-api/tests/account-routes.test.ts` 风格。
- **桌面重构**：拆分后既有测试全绿（回归网）。
- **新面板**：交互测试照 `byok-setup-save-feedback.interaction.test.tsx`：换 key 写 `apiKey`、改分配增删 preset、默认值/失效回退、长列表搜索、计费标注渲染。
- **登录复核**：`pages/tests/auth-flow.test.ts` 增用例：记录有效 → 不覆盖；记录失效 → find-or-create；choices 失败 → 配置不动。
- **写入通路**：`state/tests/model-provisioning.test.ts` 按新函数签名调整并补用例（preset 增删、复用 endpoint）。

## 8. 实施顺序

1. 后端 client 方法 + 单测。
2. `readModelChoices` + 契约 + 路由 + 路由测试。
3. 桌面组件拆分（纯重构，既有测试保持绿）。
4. `CuberouterModelSection`（key 卡 / 分配 / 高级折叠）+ `applyCuberouterSelection` / `saveCatalogMutation` + 交互测试。
5. 选择记录 + 登录复核 + `auth-flow` 用例。
6. 设置页接线 + 真机手测（WSL 起客户端或 Windows 包）。

## 9. 改动文件清单（预估）

**后端**

- `App/backend/src/adapters/outbound/cuberouter-client/types.ts`、`http-cuberouter-client.ts`（+ tests）
- `App/backend/src/services/cuberouter-account-service.ts`（+ tests）
- `App/backend/src/adapters/inbound/local-api/routes/account.ts`（+ tests）
- `App/backend/local-api-contracts/src/index.ts`

**桌面**

- `App/frontend/desktop/src/pages/model-workspace-section.tsx`（拆分）
- `App/frontend/desktop/src/pages/cuberouter-model-section.tsx`（新）
- `App/frontend/desktop/src/state/model-provisioning.ts`
- `App/frontend/desktop/src/state/cuberouter-key-selection.ts`（新）
- `App/frontend/desktop/src/components/account-auth-panel.tsx`（登录复核）
- `App/frontend/desktop/src/pages/settings-page.tsx`（接线）
- `App/frontend/desktop/src/components/Select.tsx`（搜索，或新增下拉组件）
- `App/frontend/desktop/src/i18n/messages.ts`
- 相关 tests

## 10. 风险与遗留

- 模型列表只有名字、没有能力信息：误选非 chat 模型只能在请求时报错；不猜能力是刻意的取舍。
- 个人 key 明文接口有 `CriticalRateLimit`：只在选中时调用一次，不做预取。
- 普通成员的组织 key 列表会带出他人的 public key（`service/organization_token.go:112-117`）：客户端按责任人字段过滤/标注。
- 余额数值不做单位换算（原样 quota + 文案），换算规则（`QuotaPerUnit` 等）本次不定。
- **遗留（明确不在本次）**：额度参与运行时（记忆预算、低额提醒、任务拦截）；多组织用户的正式处理（仍取第一个）；组织侧 key 的创建/禁用/删除管理；cuberouter 用量明细面板。
