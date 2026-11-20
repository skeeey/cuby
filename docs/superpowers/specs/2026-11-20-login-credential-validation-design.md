# 登录不再做密码格式预检（前端 + 本地契约）— 设计

- 日期：2026-11-20
- 状态：待评审
- 范围：登录（注册完全不变）

## 1. 背景与意图

现状有两层登录格式校验，且都复用注册规则：

- 前端：`useAccountAuth.authenticate` 对注册和登录都调用 `validateCredentials`（`App/frontend/desktop/src/components/use-account-auth.ts:39`），登录被 8-20 位、大小写 + 数字的注册规则拦住。
- 契约：`/api/account/login` 与注册共用 `CuberouterAuthInputSchema`（`App/backend/src/adapters/inbound/local-api/routes/account.ts:54`、`App/backend/local-api-contracts/src/index.ts:1239`），password 同样限 8-20。

问题：

1. 登录语义只需要"和实例保存的密码对上"。若账号密码是在 cuberouter 网页端、旧版本或其他渠道创建，或实例规则变化，客户端会永远登不上，而服务端其实可能认。
2. 登录输错密码时，用户看到"密码需 8-20 位…"，而不是实例返回的"用户名或密码不正确"。
3. 同一套注册规则在前端、契约、实例三处重复维护。

意图：登录只阻止空提交，密码对错完全交给 cuberouter 实例判定；注册校验保持不变。

## 2. 目标与非目标

### 目标

1. 登录时前端只校验 username 非空 / ≤50、password 非空。
2. 登录接口拆出专用契约，password 只要求非空（附防御性上限 128，不代表业务规则）。
3. 登录失败文案来自实例，沿用现有 `toFeedbackText` 的业务消息透传。

### 非目标

- 注册流程与规则不变（`CuberouterAuthInputSchema`、confirmPassword、邮箱 / 验证码判断保持原样）。
- 不改 cuberouter 登录接口、会话与续期、线路探测与重试逻辑。
- 不改 2FA 处理。

### 反目标

- 不能把空用户名 / 空密码发到后端（会变成 Zod 英文原文直接展示给用户）。
- 不放宽 username 上限，也不把登录规则反向搬到注册。

## 3. 方案

考虑过两种：

1. **只放宽前端，契约不动** — 否决：后端仍按 8-20 拦截，且提示退化为 Zod 英文原文（`App/backend/src/services/error-envelope.ts:89-94`），只是把拦截点后移、体验更差。
2. **前端 + 契约一起拆（采纳）** — 登录路径整体只做非空校验，服务端成为密码正确性的唯一权威。

## 4. 设计

### 契约（`App/backend/local-api-contracts/src/index.ts`）

新增 `CuberouterLoginInputSchema`：

- `username`: `z.string().trim().min(1).max(50)`
- `password`: `z.string().min(1).max(128)`（128 为防御性上限）
- `nodeId`: `z.string().trim().min(1).max(32).optional()`

导出 `CuberouterLoginInput` 类型。`CuberouterAuthInputSchema` 原样保留，仅注册使用。

### 后端

- `routes/account.ts` 的 `/api/account/login` 改用 `CuberouterLoginInputSchema.parse`。
- `CuberouterAccountService.login` 签名已是 `{ username; password; nodeId? }`，不变。

### 前端

- `api/account-client.ts`：`login(input: CuberouterLoginInput)`，parse 用登录 schema；`register` 不变。
- `components/use-account-auth.ts`：
  - 现有 `validateCredentials` 保留为注册校验；
  - 新增 `validateLogin(input)`：username trim 后非空且 ≤50，password 非空（不 trim、不查格式）；结果只含 `username` / `password` / `nodeId`，不携带 email / verificationCode / confirmPassword；
  - `authenticate` 按 mode 分流：login 走 `validateLogin`，register 走现有校验。
- 表单与面板不改：`auth-credentials-form.tsx` / `account-auth-panel.tsx` 已经只在注册模式传 confirmPassword / email / 验证码。

### 测试

- `use-account-auth.test.ts`：保留注册校验用例；新增登录用例——短密码 / 纯小写 / 超过 20 位均可提交，空密码 / 空用户名分别报 `password` / `username`，登录结果不携带邮箱与验证码。
- `account-routes.test.ts:284`："rejects credentials that violate the shared schema" 改为：短密码登录会被转给服务层（mock 捕获入参），空密码仍返回 400。
- `account-client.test.ts`：补一条短密码可发送的用例（现有登录请求体断言不变）。

## 5. 留给实现者

- 是否把 `validateCredentials` 更名（如 `validateRegistration`），以调用点可读性为准。
- 128 上限常量的存放位置（建议与 schema 同处）。
- 测试用例的具体组织。
