# 登录去掉密码格式预检 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 登录路径不再在前端和本地契约层做密码格式校验，只阻止空提交；注册校验完全不变。

**Architecture:** 在 `@memmy/local-api-contracts` 中新增登录专用 Zod schema；后端登录路由与桌面 `account-client` 改用它。前端 hook 对登录使用新的 `validateLogin`（仅非空 + username trim），注册继续走现有 `validateCredentials`。

**Tech Stack:** TypeScript, Zod 4, Fastify, React hooks, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-20-login-credential-validation-design.md`

## Global Constraints

- 注册路径必须完全不变：`CuberouterAuthInputSchema`、`validateCredentials`、confirmPassword、邮箱/验证码规则原样保留。
- 登录密码不 trim，原样发送；username 仍 trim 到 1-50。
- 登录契约：password `min(1).max(128)`；128 只是防御上限，不是业务规则。
- 不自动提交（除非用户明确要求）。

## Review Focus

1. 空密码登录 → 本地提示 `account.error.password`，请求不发出。
2. 空/纯空白用户名 → 本地提示 `account.error.username`，请求不发出。
3. 不符合注册规则的密码（短、纯小写、超过 20 位）→ 登录请求照常发出，由实例裁决。
4. 密码两端有空格 → 原样发送，不 trim。
5. 注册回归：弱密码、确认不一致、实例要求邮箱/验证码时仍在前端拦截（既有用例保持通过）。

---

### Task 1: 登录专用契约与后端路由

**Files:**
- Modify: `App/backend/local-api-contracts/src/index.ts:1238-1249`
- Modify: `App/backend/src/adapters/inbound/local-api/routes/account.ts:50-58`
- Test: `App/backend/src/adapters/inbound/local-api/tests/account-routes.test.ts:284-293`

**Interfaces:**
- Produces: `CuberouterLoginInputSchema` — Zod object `{ username: string; password: string; nodeId?: string }`；类型 `CuberouterLoginInput`。
- Consumes: `CuberouterAccountService.login(input: { username: string; password: string; nodeId?: string })`（签名不变）。

- [ ] **Step 1: 写失败测试**

把 `account-routes.test.ts` 里现有的 `"rejects credentials that violate the shared schema"`（`:284-293`）替换为：

```ts
it("forwards a login whose password breaks the registration rules to the instance", async () => {
  const calls: Array<{ username: string; password: string }> = [];
  app = createServer({
    cuberouterAccount: {
      async login(input: { username: string; password: string }) {
        calls.push(input);
        return {
          session: {
            authenticated: true,
            isNewUser: false,
            profile: {
              userId: "7",
              email: null,
              phoneNumber: null,
              nickname: "Alice",
              avatarUrl: null,
              planType: null,
              hasFinishedGuide: null,
              region: null,
              registeredAt: null,
              identityProvider: "cuberouter"
            }
          },
          provisioning: {
            apiKey: "sk-plain",
            apiBase: "http://127.0.0.1:3000/v1",
            model: "deepseek-flash"
          }
        };
      }
    }
  });

  const response = await injectJson("POST", "/api/account/login", {
    username: "alice",
    password: "short"
  });

  expect(response.statusCode).toBe(200);
  expect(calls).toEqual([{ username: "alice", password: "short" }]);
});

it("rejects an empty login password before it reaches the instance", async () => {
  app = createServer();

  const response = await injectJson("POST", "/api/account/login", {
    username: "alice",
    password: ""
  });

  expect(response.statusCode).toBe(400);
  expect(response.json().error.code).toBe("invalid_argument");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test -w @memmy/backend -- src/adapters/inbound/local-api/tests/account-routes.test.ts`
Expected: `forwards a login whose password breaks...` FAIL（当前共享 schema 使 `short` 返回 400）；`rejects an empty login password...` PASS。

- [ ] **Step 3: 实现 schema 与路由**

在 `App/backend/local-api-contracts/src/index.ts` 的 `CuberouterAuthInputSchema` 之后新增（`CuberouterAuthInputSchema` 本身不动）：

```ts
/** 定义 cuberouter 登录入参：password 只要求非空，正确性由实例判定。 */
export const CuberouterLoginInputSchema = z.object({
    username: z.string().trim().min(1).max(50),
    password: z.string().min(1).max(128),
    nodeId: z.string().trim().min(1).max(32).optional()
});
export type CuberouterLoginInput = z.infer<typeof CuberouterLoginInputSchema>;
```

在 `routes/account.ts` 的 import 中加入 `CuberouterLoginInputSchema`，并把 `/api/account/login` 里的 `CuberouterAuthInputSchema.parse(request.body)` 改为 `CuberouterLoginInputSchema.parse(request.body)`（注册路由保持原样）。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test -w @memmy/backend -- src/adapters/inbound/local-api/tests/account-routes.test.ts`
Expected: 全部 PASS。

---

### Task 2: 桌面 account-client 使用登录契约

**Files:**
- Modify: `App/frontend/desktop/src/api/account-client.ts:1-30,41-42,78-85`
- Test: `App/frontend/desktop/src/api/tests/account-client.test.ts`（在 `:93` 之后新增）

**Interfaces:**
- Consumes: `CuberouterLoginInputSchema` / `CuberouterLoginInput`（Task 1）。
- Produces: `AccountClient.login(input: CuberouterLoginInput)`。

- [ ] **Step 1: 写失败测试**

在 `account-client.test.ts` 的 `"通过本地路由修改 cuberouter 密码"` 之后新增：

```ts
it("登录发送不符合注册规则的密码，由实例裁决", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(input.toString()).toBe("http://127.0.0.1:18100/api/account/login");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ username: "grace", password: "short" });
    return jsonResponse({
      session: {
        authenticated: true,
        isNewUser: false,
        profile: profilePayload({ nickname: "Grace" })
      },
      provisioning: provisioningPayload()
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  await expect(createHttpAccountClient(config).login({ username: "grace", password: "short" }))
    .resolves.toMatchObject({ session: { authenticated: true } });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test -w @memmy/frontend-desktop -- src/api/tests/account-client.test.ts`
Expected: 新用例 FAIL，抛出 Zod 错误（`String must contain at least 8 character(s)`），fetch 未被调用。

- [ ] **Step 3: 实现**

`account-client.ts`：

- import 中加入 `CuberouterLoginInputSchema` 与 `type CuberouterLoginInput`。
- `AccountClient` 接口中 `login(input: CuberouterLoginInput): Promise<CuberouterAuthResult>;`（register 仍用 `CuberouterAuthInput`）。
- login 实现的 `body` 改为 `CuberouterLoginInputSchema.parse(input)`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test -w @memmy/frontend-desktop -- src/api/tests/account-client.test.ts`
Expected: 全部 PASS。

---

### Task 3: 前端 hook 与面板的登录校验

**Files:**
- Modify: `App/frontend/desktop/src/components/use-account-auth.ts:38-80,186-219`
- Test: `App/frontend/desktop/src/components/tests/use-account-auth.test.ts`（在 `:115` 之后新增）
- Test: `App/frontend/desktop/src/components/tests/account-auth-panel.test.tsx`（在 `:579` 之后新增）

**Interfaces:**
- Produces: `validateLogin(input: CredentialsInput): CredentialsValidationResult` — 成功结果只含 `username` / `password` / 可选 `nodeId`。
- Consumes: `validateCredentials`（保持不变）、`useAccountAuth.login`。

- [ ] **Step 1: 写失败测试**

`use-account-auth.test.ts`：import 加入 `validateLogin`，在 `describe("validateCredentials")` 之后新增：

```ts
describe("validateLogin", () => {
  it("accepts passwords the registration rules reject", () => {
    const long = `Pa0${"x".repeat(20)}`;

    expect(validateLogin({ username: "alice", password: "short" })).toEqual({
      ok: true,
      username: "alice",
      password: "short"
    });
    expect(validateLogin({ username: "alice", password: "alllowercase" })).toEqual({
      ok: true,
      username: "alice",
      password: "alllowercase"
    });
    expect(validateLogin({ username: "alice", password: long })).toEqual({
      ok: true,
      username: "alice",
      password: long
    });
  });

  it("trims the username but passes the password through untouched", () => {
    expect(validateLogin({ username: " alice ", password: " Passw0rd1 " })).toEqual({
      ok: true,
      username: "alice",
      password: " Passw0rd1 "
    });
  });

  it("rejects an empty username or password", () => {
    expect(validateLogin({ username: "   ", password: "short" })).toEqual({
      ok: false,
      reason: "username"
    });
    expect(validateLogin({ username: "alice", password: "" })).toEqual({
      ok: false,
      reason: "password"
    });
  });

  it("ignores registration-only fields", () => {
    expect(
      validateLogin({
        username: "alice",
        password: "short",
        confirmPassword: "different",
        email: "alice@example.com",
        verificationCode: "123456",
        emailVerificationRequired: true
      })
    ).toEqual({ ok: true, username: "alice", password: "short" });
  });

  it("carries the picked line through", () => {
    expect(validateLogin({ username: "alice", password: "short", nodeId: "cn" })).toEqual({
      ok: true,
      username: "alice",
      password: "short",
      nodeId: "cn"
    });
  });
});
```

`account-auth-panel.test.tsx`：在 `"logs in without email fields..."` 之后新增：

```ts
it("submits a login password the registration rules would reject", async () => {
  const login = vi.fn(async () => authResult({ isNewUser: false }));
  renderPanel({ login });

  await setInput("account.usernamePlaceholder", "alice");
  await setInput("account.passwordPlaceholder", "short");
  await clickButton("account.login");

  await vi.waitFor(() => expect(login).toHaveBeenCalledWith({ username: "alice", password: "short" }));
});

it("keeps blocking an empty login password", async () => {
  const login = vi.fn(async () => authResult({ isNewUser: false }));
  renderPanel({ login });

  await setInput("account.usernamePlaceholder", "alice");
  await clickButton("account.login");

  await vi.waitFor(() => expect(alertText()).toBe("account.error.password"));
  expect(login).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm run test -w @memmy/frontend-desktop -- src/components/tests/use-account-auth.test.ts src/components/tests/account-auth-panel.test.tsx`
Expected: `validateLogin` 不存在导致导入失败/用例 FAIL；面板的短密码用例 FAIL（当前提示 `account.error.password` 且不调用 login）。

- [ ] **Step 3: 实现**

`use-account-auth.ts` 新增（放在 `validateCredentials` 之后）：

```ts
/**
 * Login only rejects an empty form: the instance is the authority on whether the
 * password is right, so registration rules must not block an older or externally
 * created account here. The password is passed through untrimmed.
 */
export function validateLogin(input: CredentialsInput): CredentialsValidationResult {
  const username = input.username.trim();
  if (!username || username.length > 50) {
    return { ok: false, reason: "username" };
  }
  if (!input.password) {
    return { ok: false, reason: "password" };
  }
  return {
    ok: true,
    username,
    password: input.password,
    ...(input.nodeId ? { nodeId: input.nodeId } : {})
  };
}
```

`authenticate` 里的校验选择改为：

```ts
const validation = mode === "login" ? validateLogin(input) : validateCredentials(input);
```

其余逻辑（pending/feedback、credentials 组装、register/login 分支）不动——`validateLogin` 成功结果不含 email/验证码/confirm，所以登录请求体天然只有 `username` / `password` / `nodeId`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run test -w @memmy/frontend-desktop -- src/components/tests/use-account-auth.test.ts src/components/tests/account-auth-panel.test.tsx`
Expected: 全部 PASS，包括既有注册用例。

---

### Task 4: 类型检查与整体验证

- [ ] **Step 1: 构建契约包（供类型检查读取）**

Run: `npm run build -w @memmy/local-api-contracts`
Expected: 退出码 0。

- [ ] **Step 2: 后端类型检查**

Run: `npm run typecheck -w @memmy/backend`
Expected: 退出码 0。

- [ ] **Step 3: 桌面类型检查**

Run: `npm run typecheck -w @memmy/frontend-desktop`
Expected: 退出码 0。

- [ ] **Step 4: 跑全部相关测试**

Run:
```bash
npm run test -w @memmy/backend -- src/adapters/inbound/local-api/tests/account-routes.test.ts
npm run test -w @memmy/frontend-desktop -- src/api/tests/account-client.test.ts src/components/tests/use-account-auth.test.ts src/components/tests/account-auth-panel.test.tsx
```
Expected: 两组全部 PASS。
