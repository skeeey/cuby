# 登录/注册流程 v2（组织自动解析 + cuby-desktop key + 无组织个人 key + 角标显示）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 桌面端注册/登录后不再依赖构建期组织配置：按用户成员关系取组织（假设只有一个），key 前缀改为 `cuby-desktop`，无组织用户走个人 token，侧栏角标对 cuberouter 身份显示「用户名(组织名) + 账号模式」。

**Architecture:** 三层改动：cuberouter 客户端新增个人 token 三方法（search/create/读明文）；账号服务把「按名字解析组织」换成「取 `GET /api/organizations` 第一个」，组织为空时走个人 key 路径；`username`/`organizationName` 通过 account profile 契约（raw_profile_json 持久化）透到前端，侧栏按身份渲染。配置侧删除 `MEMMY_CUBEROUTER_ORG` 与 `MEMMY_CUBEROUTER_ORG_TOKEN_NAME`。

**Tech Stack:** TypeScript / Node（node:sqlite）/ vitest / zod（`@memmy/local-api-contracts`）/ React + useReducer（desktop）。

**Spec:** `/home/skeeey/workspace/cuberouter-issues/memmy-login-register-flow-v2.md`（含 2026-10-14 决议与个人 token 接口核对；cuberouter 基线 `d3ed1a4`）。背景现状见同目录 `memmy-login-register-flow.md`。

## Global Constraints

- key 名前缀固定为字面量 `cuby-desktop`；token 名 = `cuby-desktop-<username 第一个 @ 之前那段>`，大小写与标点原样保留（实例的 username 大小写敏感）。
- 个人 key 创建 body 必须显式含 `expired_time: -1`——实例原样落库，存成 0 会被判为已过期（cuberouter `model/token.go:333`）。
- 组织来源 = `GET /api/organizations` 返回列表的第一个（接口按 id 降序）；多于一个记日志并用第一个；一个都没有 → 个人 key 路径（不再报错）。
- 不动 analytics 里的 `memmy-desktop` 常量（`App/backend/src/analytics/memory-add-analytics.ts:19` 等 entrypoint/source 文案，与 key 前缀无关）。
- 纯 BYOK（identityProvider = `memmy_cloud`）角标显示不变。
- 不修改 `/home/skeeey/workspace/cuberouter` 仓库。
- 开工前：工作区已有一次未提交改动（cn 默认线路 `test.cuberouter.cn` → `cuberouter.cn`，含 `App/backend/src/config/cuberouter-nodes.ts`、`.env.example`、`scripts/run-win-local.cmd`、`cuberouter-nodes.test.ts`），先单独提交它再开始 Task 1。
- 后端测试命令在 `App/backend` 下运行，桌面端在 `App/frontend/desktop` 下运行；全部离线可跑。

## Review Focus

- **多组织（>1）**：账号属于两个组织时登录照常，用第一个并记日志——Task 3 的 "uses the first organization…" 测试钉住。
- **零组织**：不再抛「未找到组织」，而是走个人 key 并成功返回——Task 3 的 "provisions a personal key…" 测试钉住。
- **登录复用个人 key**：已存在的 `cuby-desktop-<name>` 不重建、直接取回明文——Task 3 的 "reuses an existing personal key…" 测试钉住。
- **注册直建（0 组织）**：注册路径跳过首次查找、只做创建后那一次查找——Task 3 的 "creates the personal key on registration…" 测试钉住。
- **重启后角标数据仍在**：`username`/`organizationName` 经 raw_profile_json 往返——Task 2 的 repo 测试钉住。
- **无组织角标不带空括号**：`alice@a.com` 而不是 `alice@a.com ()`——Task 5 的测试钉住。

---

### Task 1: cuberouter 客户端：个人 token 三方法

**Files:**
- Modify: `App/backend/src/adapters/outbound/cuberouter-client/types.ts`
- Modify: `App/backend/src/adapters/outbound/cuberouter-client/http-cuberouter-client.ts`
- Test: `App/backend/src/adapters/outbound/cuberouter-client/tests/personal-tokens.test.ts`（新建）
- Modify: `App/backend/src/services/tests/cuberouter-account-service.test.ts`（两个 fixture 补桩，保持 typecheck 通过）

**Interfaces:**
- Consumes: 现有 `request` helper、`cuberouterError`、`asRecord`/`readString`/`readCount`（`http-cuberouter-client.ts`）。
- Produces: `CuberouterPersonalToken { id: number; name: string }`；`CuberouterClient.searchPersonalTokens(accessToken, tokenName): Promise<CuberouterPersonalToken[]>`、`createPersonalToken(accessToken, { name }): Promise<void>`、`getPersonalTokenKey(accessToken, tokenId: number): Promise<string>`（Task 3 使用）。

- [ ] **Step 1: 写失败测试**（新建 `tests/personal-tokens.test.ts`，整个文件如下）

```ts
/** Cuberouter personal token tests. */
import { describe, expect, it, vi } from "vitest";
import { createHttpCuberouterClient } from "../index.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function clientWith(fetchImpl: typeof fetch) {
  return createHttpCuberouterClient({
    baseUrl: "http://127.0.0.1:3000",
    timeoutMs: 1000,
    fetchImpl
  });
}

describe("cuberouter personal tokens", () => {
  it("searches by exact name and maps id/name, never the masked key", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: true,
        message: "",
        data: {
          items: [{ id: 41, name: "cuby-desktop-alice", key: "sk-abcd**********wxyz" }],
          total: 1,
          page_size: 100
        }
      })
    );

    await expect(
      clientWith(fetchImpl as unknown as typeof fetch).searchPersonalTokens("jwt-1", "cuby-desktop-alice")
    ).resolves.toEqual([{ id: 41, name: "cuby-desktop-alice" }]);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/api/token/search?keyword=cuby-desktop-alice&page_size=100");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer jwt-1");
  });

  it("drops rows the search returned without a usable id or name", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: true,
        message: "",
        data: { items: [{ id: 1 }, { name: "no-id" }, { id: 2, name: "kept" }], total: 3 }
      })
    );

    await expect(
      clientWith(fetchImpl as unknown as typeof fetch).searchPersonalTokens("jwt-1", "kept")
    ).resolves.toEqual([{ id: 2, name: "kept" }]);
  });

  it("creates with unlimited quota and never-expiring, because a stored 0 would be expired", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, message: "", data: {} }));

    await clientWith(fetchImpl as unknown as typeof fetch).createPersonalToken("jwt-1", {
      name: "cuby-desktop-alice"
    });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/api/token/");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      name: "cuby-desktop-alice",
      unlimited_quota: true,
      expired_time: -1
    });
  });

  it("reads the plaintext key of one personal token", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, message: "", data: { key: "sk-personal-secret" } })
    );

    await expect(
      clientWith(fetchImpl as unknown as typeof fetch).getPersonalTokenKey("jwt-1", 41)
    ).resolves.toBe("sk-personal-secret");

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/api/token/41/key");
    expect(init.method).toBe("POST");
  });

  it("refuses a key read that came back without a secret", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, message: "", data: {} }));

    await expect(
      clientWith(fetchImpl as unknown as typeof fetch).getPersonalTokenKey("jwt-1", 41)
    ).rejects.toMatchObject({ code: "rejected", message: "cuberouter 未返回个人密钥的明文" });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd App/backend && npx vitest run src/adapters/outbound/cuberouter-client/tests/personal-tokens.test.ts`
Expected: FAIL — `searchPersonalTokens is not a function`

- [ ] **Step 3: 实现 types.ts**

在 `types.ts` 的 `CuberouterOrganizationToken` 之后加：

```ts
/** One of the member's own (personal) tokens. The list masks the key, so only id/name are usable. */
export interface CuberouterPersonalToken {
  id: number;
  name: string;
}
```

在 `CuberouterClient` 接口的 `createOrganizationToken(...)` 之后加：

```ts
  /**
   * Lists the member's personal tokens whose name matches. The instance's keyword filter is an
   * exact full match unless it contains `%`, and it is a LIKE pattern either way — the caller
   * still compares the returned names exactly.
   */
  searchPersonalTokens(accessToken: string, tokenName: string): Promise<CuberouterPersonalToken[]>;
  /**
   * Creates a personal token. The instance answers a create with `{success:true}` and nothing
   * else, so the caller finds the new row through `searchPersonalTokens`.
   */
  createPersonalToken(accessToken: string, input: { name: string }): Promise<void>;
  /** Reads one personal token's plaintext key, which the list endpoint never returns. */
  getPersonalTokenKey(accessToken: string, tokenId: number): Promise<string>;
```

- [ ] **Step 4: 实现 http-cuberouter-client.ts**

import 处把 `CuberouterPersonalToken` 加进 type import。在返回对象的 `createOrganizationToken` 之后插入：

```ts
    async searchPersonalTokens(accessToken, tokenName) {
      const query = new URLSearchParams({ keyword: tokenName, page_size: "100" }).toString();
      const response = await request<Record<string, unknown>>(
        fetchImpl,
        baseUrl,
        options.timeoutMs,
        `/api/token/search?${query}`,
        { method: "GET", accessToken }
      );
      return toPersonalTokens(Array.isArray(response.items) ? response.items : []);
    },

    async createPersonalToken(accessToken, input) {
      await request(fetchImpl, baseUrl, options.timeoutMs, "/api/token/", {
        method: "POST",
        accessToken,
        body: {
          name: input.name,
          unlimited_quota: true,
          // Explicit -1: the instance stores this field verbatim, and only -1 counts as "never
          // expires" — a stored 0 is an already-expired key (cuberouter model/token.go:333).
          expired_time: -1
        }
      });
    },

    async getPersonalTokenKey(accessToken, tokenId) {
      const data = await request<Record<string, unknown>>(
        fetchImpl,
        baseUrl,
        options.timeoutMs,
        `/api/token/${encodeURIComponent(String(tokenId))}/key`,
        { method: "POST", accessToken }
      );
      const key = readString(data.key);
      if (!key) {
        throw cuberouterError("rejected", "cuberouter 未返回个人密钥的明文");
      }
      return key;
    },
```

在 `toOrganizations` 附近加 mapper：

```ts
/** Maps a personal-token page onto id/name pairs; the masked key is not part of the contract. */
function toPersonalTokens(items: unknown[]): CuberouterPersonalToken[] {
  return items.flatMap((item) => {
    const row = asRecord(item);
    const id = readCount(row.id);
    const name = readString(row.name);
    return id === null || !name ? [] : [{ id, name }];
  });
}
```

- [ ] **Step 5: 给服务测试的两个 fixture 补桩**（接口新增了必选成员，typecheck 需要）

在 `App/backend/src/services/tests/cuberouter-account-service.test.ts`：
- `fakeClient()` 返回对象里（`createOrganizationToken` 之后）加：

```ts
    searchPersonalTokens: vi.fn(async () => []),
    createPersonalToken: vi.fn(async () => undefined),
    getPersonalTokenKey: vi.fn(async () => "sk-personal"),
```

- `createTestService()` 的默认 client 对象里（`createOrganizationToken` 之后）加同样的三个 async 桩：

```ts
      searchPersonalTokens: async () => [],
      createPersonalToken: async () => undefined,
      getPersonalTokenKey: async () => "sk-personal",
```

- [ ] **Step 6: 跑测试 + typecheck**

Run: `cd App/backend && npx vitest run src/adapters/outbound/cuberouter-client/tests/personal-tokens.test.ts src/services/tests/cuberouter-account-service.test.ts`
Expected: 两个文件全 PASS。
Run: `cd App/backend && npm run typecheck`
Expected: 无错误。

- [ ] **Step 7: Commit**

```bash
git add App/backend/src/adapters/outbound/cuberouter-client/ App/backend/src/services/tests/cuberouter-account-service.test.ts
git commit -m "feat(cuberouter): add personal-token client methods

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: 契约与账号仓储：username / organizationName 透出

**Files:**
- Modify: `App/backend/local-api-contracts/src/index.ts:1230-1241`
- Modify: `App/backend/src/infrastructure/app-state-store/repositories/account-session-repo.ts`（`upsert` 返回、`toProfileView`）
- Test: `App/backend/src/infrastructure/app-state-store/tests/account-session-repo.test.ts`

**Interfaces:**
- Produces: `AccountProfileViewSchema` 增加可选字段 `username?: string | null`、`organizationName?: string | null`；cuberouter 行写入 profile 后，`get()`/`upsert()` 返回的 profile 都带这两个字段（Task 3 写入、Task 5 消费）。

- [ ] **Step 1: 写失败测试**（在 `account-session-repo.test.ts` 的 describe 内新增）

```ts
  it("keeps the cuberouter username and organization across reads", () => {
    tempDir = mkdtempSync(join(tmpdir(), "memmy-account-session-"));
    const store = createAppStateStore({ databasePath: join(tempDir, "app.sqlite") });

    store.repositories.accountSession.upsert({
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
        identityProvider: "cuberouter",
        username: "alice@yeebo.com.cn",
        organizationName: "yeebo",
        rawProfile: {
          username: "alice@yeebo.com.cn",
          displayName: "Alice",
          organizationName: "yeebo"
        }
      },
      uuid: "cuberouter:7",
      cloudUuid: "jwt-1",
      authChannel: "cuberouter"
    });

    const session = store.repositories.accountSession.get();
    store.close();

    expect(session).toMatchObject({
      authenticated: true,
      profile: {
        identityProvider: "cuberouter",
        username: "alice@yeebo.com.cn",
        organizationName: "yeebo"
      }
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd App/backend && npx vitest run src/infrastructure/app-state-store/tests/account-session-repo.test.ts`
Expected: FAIL — zod 默认丢弃未知键（不报错），读回的 `organizationName` 是 undefined，`toMatchObject` 断言失败。

- [ ] **Step 3: 契约加两个可选字段**

`App/backend/local-api-contracts/src/index.ts` 的 `AccountProfileViewSchema`（1240 行 `identityProvider` 之后）：

```ts
    identityProvider: z.enum(["memmy_cloud", "cuberouter"]).default("memmy_cloud"),
    /** cuberouter 登录用户名（这两个实例上就是邮箱）；其它身份为 null。 */
    username: z.string().nullable().optional(),
    /** 用户所属组织名（单组织假设）；无组织或非 cuberouter 为 null。 */
    organizationName: z.string().nullable().optional()
```

- [ ] **Step 4: 仓储读写**

`account-session-repo.ts`：

`upsert` 的返回（216-227 行的 `AccountProfileViewSchema.parse({...})`）里，`identityProvider` 之后加：

```ts
          identityProvider: input.profile.identityProvider,
          username: input.profile.username ?? null,
          organizationName: input.profile.organizationName ?? null
```

`toProfileView`（451 行）改为：

```ts
function toProfileView(row: AccountSessionRow): AccountProfileView {
  const isCuberouter = resolveAccountAuthChannel(row) === "cuberouter";
  // The cuberouter identity's login name and organization live next to its auth channel in the
  // raw profile; they are what the sidebar renders after a restart.
  const rawProfile = isCuberouter && row.raw_profile_json ? parseRawProfile(row.raw_profile_json) : null;
  return AccountProfileViewSchema.parse({
    userId: row.user_id,
    email: row.email,
    phoneNumber: row.phone,
    nickname: row.nickname,
    avatarUrl: row.avatar,
    planType: row.plan_type,
    hasFinishedGuide: row.has_finished_guide === null ? null : row.has_finished_guide === 1,
    region: row.region,
    registeredAt: row.registered_at,
    identityProvider: isCuberouter ? "cuberouter" : "memmy_cloud",
    username: rawProfile ? readRawProfileString(rawProfile.username) : null,
    organizationName: rawProfile ? readRawProfileString(rawProfile.organizationName) : null
  });
}
```

前 8 行赋值与原实现逐字一致（列名 `row.phone`、`row.avatar` 等不变），只把 `identityProvider` 一行改写成上面两分支形式、并在末尾新增两行。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd App/backend && npx vitest run src/infrastructure/app-state-store/tests/account-session-repo.test.ts`
Expected: PASS。
Run: `cd App/backend && npm run typecheck`
Expected: 无错误（可选字段不破坏现有调用点）。

- [ ] **Step 6: Commit**

```bash
git add App/backend/local-api-contracts/src/index.ts App/backend/src/infrastructure/app-state-store/
git commit -m "feat(account): expose cuberouter username and organization on the profile

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: 账号服务：组织按成员关系取、个人 key 兜底、前缀 cuby-desktop

**Files:**
- Modify: `App/backend/src/adapters/outbound/cuberouter-client/types.ts:44`（常量）
- Modify: `App/backend/src/services/cuberouter-account-service.ts`
- Modify: `App/backend/src/services/index.ts:246-247`
- Modify: `App/backend/src/services/tests/cuberouter-account-service.test.ts`
- Modify: `App/backend/src/tests/index.test.ts`（mock 服务端 + token 名断言）

**Interfaces:**
- Consumes: Task 1 的三个个人 token 方法；Task 2 的 profile 字段。
- Produces: `CreateCuberouterAccountServiceOptions` 不再有 `organizationId`/`organizationTokenNamePrefix`；`DESKTOP_TOKEN_NAME = "cuby-desktop"`。

- [ ] **Step 1: 先改常量**

`types.ts:44`：`export const DESKTOP_TOKEN_NAME = "memmy-desktop";` → `export const DESKTOP_TOKEN_NAME = "cuby-desktop";`

- [ ] **Step 2: 改服务（`cuberouter-account-service.ts`）**

(a) import：`CuberouterOrganization`、`CuberouterPersonalToken` 加进 type import（`CuberouterPersonalToken` 来自 types.js）。

(b) `CreateCuberouterAccountServiceOptions` 删除这两行及注释：

```ts
  /** Organization whose token supplies the API key; null when unconfigured. */
  organizationId: string | null;
  /** Prefix of the per-account token name; null means the built-in default. */
  organizationTokenNamePrefix: string | null;
```

(c) 整个删除 `resolveOrganizationId` 函数（185-202 行，按名字匹配 + 纯数字短路）。

(d) `ensureOrganizationKey` 改为接收组织 id 与名字，不再读 options：

```ts
  /**
   * The account's key inside one organization, read back when it exists and created when it
   * does not. The name is the account's (see `toDesktopTokenName`), so an administrator's
   * hand-provisioned key and this account's own key are the same key.
   */
  async function ensureOrganizationKey(
    client: CuberouterClient,
    accessToken: string,
    organizationId: string,
    tokenName: string
  ): Promise<string> {
    const tokens = await client.listOrganizationTokens(accessToken, organizationId, tokenName);
    // Exact match after the server's name filter: the filter is a substring match, so a longer
    // name that merely starts with this account's (a second key, say) is not ours.
    const provisioned = tokens.find((token) => token.name === tokenName);
    if (provisioned) {
      return provisioned.key;
    }

    try {
      const created = await client.createOrganizationToken(accessToken, organizationId, {
        name: tokenName,
        unlimitedQuota: true
      });
      log(`[cuberouter] created organization key ${tokenName}`);
      return created.key;
    } catch (error) {
      // Say what the desktop was doing, and keep the instance's own sentence: the same refusal
      // ("permission denied") means something different at login than at creation, and the
      // reason — not a membership, a name too long, the key limit reached — lives in that text.
      const message = error instanceof Error ? error.message : String(error);
      throw Object.assign(new Error(`创建组织 API Key（${tokenName}）失败：${message}`), {
        code: "organization_token_unavailable" as const
      });
    }
  }
```

(e) 新增个人 key 路径（放在 `ensureOrganizationKey` 之后）：

```ts
  /**
   * The account's personal key, for a member of no organization. The list endpoint masks keys,
   * so the plaintext is read per row; a create answers without an id, so the row is found by
   * name afterwards either way.
   */
  async function ensurePersonalKey(
    client: CuberouterClient,
    accessToken: string,
    tokenName: string,
    createDirectly: boolean
  ): Promise<string> {
    try {
      // A fresh registration cannot have a key yet, so it skips the first look; a returning
      // account looks first and reuses whatever it — or an operator — left behind.
      let provisioned = createDirectly ? null : await findPersonalToken(client, accessToken, tokenName);
      if (!provisioned) {
        await client.createPersonalToken(accessToken, { name: tokenName });
        log(`[cuberouter] created personal key ${tokenName}`);
        provisioned = await findPersonalToken(client, accessToken, tokenName);
      }
      if (!provisioned) {
        throw new Error("创建后未能按名字找到这把密钥");
      }
      return await client.getPersonalTokenKey(accessToken, provisioned.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw Object.assign(new Error(`创建个人 API Key（${tokenName}）失败：${message}`), {
        code: "organization_token_unavailable" as const
      });
    }
  }

  /** Finds one personal token by exact name; the server's filter is a LIKE pattern, so compare again. */
  async function findPersonalToken(
    client: CuberouterClient,
    accessToken: string,
    tokenName: string
  ): Promise<CuberouterPersonalToken | null> {
    const tokens = await client.searchPersonalTokens(accessToken, tokenName);
    return tokens.find((token) => token.name === tokenName) ?? null;
  }
```

(f) `loginOnNode` 改为：

```ts
  /** Runs one login against one node and records it as the account's line. */
  async function loginOnNode(
    nodeId: string,
    username: string,
    password: string,
    createDirectly: boolean
  ): Promise<CuberouterAuthResult> {
    const { client, url } = clientForNode(nodeId);
    const session = await client.login({ username, password });
    // The organization comes from the membership list, never from a build setting: the same
    // organization has a different id on each deployment, and the list is already per instance.
    const organizations = await client.listOrganizations(session.accessToken);
    if (organizations.length > 1) {
      log(`[cuberouter] ${session.username} belongs to ${organizations.length} organizations, using ${organizations[0]!.name}`);
    }
    const organization = organizations[0] ?? null;
    // The name comes from what the instance reports, never from the typed string: an alias would
    // name a key nobody created.
    const tokenName = toDesktopTokenName(session.username);
    const apiKey = organization
      ? await ensureOrganizationKey(client, session.accessToken, organization.id, tokenName)
      : await ensurePersonalKey(client, session.accessToken, tokenName, createDirectly);
    const seenBefore = options.accountNodes.get(username) !== null;
    const projection = options.accountSessionRepository.upsert({
      uuid: toCuberouterAccountUuid(session.userId),
      cloudUuid: session.accessToken,
      isNewUser: !seenBefore,
      authChannel: "cuberouter",
      profile: {
        userId: session.userId,
        email: null,
        phoneNumber: null,
        nickname: session.displayName,
        avatarUrl: null,
        planType: null,
        hasFinishedGuide: null,
        region: null,
        registeredAt: null,
        identityProvider: "cuberouter",
        // What the sidebar renders for this identity, and what survives restarts in the raw
        // profile below.
        username: session.username,
        organizationName: organization?.name ?? null,
        rawProfile: {
          username: session.username,
          displayName: session.displayName,
          ...(organization ? { organizationName: organization.name } : {})
        }
      }
    });
    options.accountNodes.set(username, nodeId);
    await options.nodeRouter.setPreferredNodeId(nodeId);
    log(`[cuberouter] ${username} is on ${nodeId} (${url})`);

    return {
      session: projection,
      provisioning: { apiKey, apiBase: `${url}/v1`, model: options.model }
    };
  }
```

(g) `register` 里调用改为 `loginOnNode(nodeId, input.username, input.password, true)`；`login` 循环里改为 `loginOnNode(nodeId, input.username, input.password, false)`。

(h) `ensureOrganizationKey` 旧实现的注释块（"The account's API key inside the organization..." 那段 doc 与 `if (!options.organizationId)` 报「未配置组织（MEMMY_CUBEROUTER_ORG）」的分支）整体随 (d) 删除。

- [ ] **Step 3: 接线删除两个选项**（`App/backend/src/services/index.ts:246-247`）

```ts
      model: options.cuberouterConfig.model,
      organizationId: options.cuberouterConfig.organizationId,
      organizationTokenNamePrefix: options.cuberouterConfig.organizationTokenNamePrefix,
      log: (message) => console.info(message)
```
→ 删除中间两行，只留 `model` 与 `log`。

- [ ] **Step 4: 更新服务测试**

`App/backend/src/services/tests/cuberouter-account-service.test.ts`：

(a) `createTestService`：删除 `organizationId`、`organizationTokenNamePrefix` 两个入参声明（88-89 行）与把它们传进 `createCuberouterAccountService` 的对应行；另加 `log?: (message: string) => void` 入参，构造时 `log: input.log ?? (() => undefined)`。

(b) `createTestService` 默认 client 的 `listOrganizations` 改为默认返回一个组织：

```ts
      listOrganizations: async () => {
        input.onOrganizationList?.();
        return input.organizations ?? [{ id: "7", name: "yeebo" }];
      },
```

(c) `fakeClient()` 补上：

```ts
    listOrganizations: vi.fn(async () => [{ id: "7", name: "yeebo" }]),
```

(d) 字面量更新（含混用测试意图不变）：
- `174` 行 `toHaveBeenCalledWith("jwt-1", "7", "memmy-desktop-alice")` → `"cuby-desktop-alice"`
- `438`、`661` 行 `创建组织 API Key（memmy-desktop-alice）` → `（cuby-desktop-alice）`
- `485` 行 fixture 名 `"memmy-desktop"` → `"cuby-desktop"`
- `679` 行 `name: "memmy-desktop-alice"` → `"cuby-desktop-alice"`
- `695` 行 `"memmy-desktop-alice-2"` → `"cuby-desktop-alice-2"`
- `752/756/762/770/774` 行 `toDesktopTokenName` 断言 → `cuby-desktop-...`（`766` 行显式传参的 `team-desktop` 测试保留不动——函数本身仍接受自定义前缀）

(e) 删除三个过时测试：`"names the account's token from the build's prefix, and from the shipped one otherwise"`（555-571）、`"treats an all-digit organization setting as that instance's id"`（604-617）、`"resolves an organization name to whatever id the instance gives it"`（619-632）、`"names the organization when this line does not have it"`（634-645）、`"names the missing build setting when no organization is configured"`（719-734）。

(f) 新增测试：

```ts
  it("names the account's key with the shipped cuby-desktop prefix", async () => {
    const looked: string[] = [];
    const service = createTestService({
      nodes: [{ id: "default", url: "http://127.0.0.1:3000" }],
      onOrganizationTokenLookup: (name) => looked.push(name)
    });

    await service.login({ username: "alice", password: "Passw0rd1" });

    expect(looked).toEqual(["cuby-desktop-alice"]);
  });

  it("reads the member's own organization from the instance, with no configured name", async () => {
    const looked: string[] = [];
    let listed = 0;
    const service = createTestService({
      nodes: [{ id: "default", url: "http://127.0.0.1:3000" }],
      organizations: [{ id: "42", name: "yeebo" }],
      onOrganizationTokenLookup: (_name, organizationId) => looked.push(organizationId),
      onOrganizationList: () => (listed += 1)
    });

    await service.login({ username: "alice", password: "Passw0rd1" });

    expect(listed).toBe(1);
    expect(looked).toEqual(["42"]);
  });

  it("uses the first organization the instance lists when the account is in several", async () => {
    const seen: string[] = [];
    const service = createTestService({
      nodes: [{ id: "default", url: "http://127.0.0.1:3000" }],
      organizations: [{ id: "9", name: "newer" }, { id: "3", name: "older" }],
      log: (message) => seen.push(message),
      onOrganizationTokenLookup: (_name, organizationId) => seen.push(organizationId)
    });

    await service.login({ username: "alice", password: "Passw0rd1" });

    expect(seen[0]).toContain("2 organizations");
    expect(seen[1]).toBe("9");
  });

  it("reports the instance's username and the organization on the session profile", async () => {
    const service = singleNodeService(fakeClient(), fakeRepository().repository);

    const result = await service.login({ username: "alice", password: "Passw0rd1" });

    expect(result.session.profile).toMatchObject({ username: "alice", organizationName: "yeebo" });
  });

  it("provisions a personal key when the account belongs to no organization", async () => {
    let created = false;
    const client = fakeClient({
      listOrganizations: vi.fn(async () => []),
      createPersonalToken: vi.fn(async () => {
        created = true;
      }),
      searchPersonalTokens: vi.fn(async (_token: string, name: string) =>
        created ? [{ id: 41, name }] : []
      ),
      getPersonalTokenKey: vi.fn(async () => "sk-personal")
    });
    const service = singleNodeService(client, fakeRepository().repository);

    const result = await service.login({ username: "alice", password: "Passw0rd1" });

    expect(client.createPersonalToken).toHaveBeenCalledWith("jwt-1", { name: "cuby-desktop-alice" });
    expect(client.getPersonalTokenKey).toHaveBeenCalledWith("jwt-1", 41);
    expect(result.provisioning).toEqual({
      apiKey: "sk-personal",
      apiBase: "http://127.0.0.1:3000/v1",
      model: "deepseek-flash"
    });
  });

  it("reuses an existing personal key on login instead of creating a second", async () => {
    const client = fakeClient({
      listOrganizations: vi.fn(async () => []),
      searchPersonalTokens: vi.fn(async () => [{ id: 41, name: "cuby-desktop-alice" }]),
      getPersonalTokenKey: vi.fn(async () => "sk-personal")
    });
    const service = singleNodeService(client, fakeRepository().repository);

    const result = await service.login({ username: "alice", password: "Passw0rd1" });

    expect(client.createPersonalToken).not.toHaveBeenCalled();
    expect(result.provisioning.apiKey).toBe("sk-personal");
  });

  it("creates the personal key on registration without looking for one first", async () => {
    const client = fakeClient({
      listOrganizations: vi.fn(async () => []),
      searchPersonalTokens: vi.fn(async (_token: string, name: string) => [{ id: 41, name }]),
      getPersonalTokenKey: vi.fn(async () => "sk-personal")
    });
    const service = singleNodeService(client, fakeRepository().repository);

    await service.register({ username: "alice", password: "Passw0rd1" });

    expect(client.createPersonalToken).toHaveBeenCalledWith("jwt-1", { name: "cuby-desktop-alice" });
    // Only the look that finds the row the create just made.
    expect(client.searchPersonalTokens).toHaveBeenCalledTimes(1);
  });

  it("says what it was doing when the instance refuses the personal key", async () => {
    const client = fakeClient({
      listOrganizations: vi.fn(async () => []),
      searchPersonalTokens: vi.fn(async () => []),
      createPersonalToken: vi.fn(async () => {
        throw Object.assign(new Error("已达到最大令牌数量限制 (10)"), { code: "rejected" });
      })
    });
    const service = singleNodeService(client, fakeRepository().repository);

    await expect(service.login({ username: "alice", password: "Passw0rd1" })).rejects.toMatchObject({
      code: "cuberouter_key_unavailable",
      message: "创建个人 API Key（cuby-desktop-alice）失败：已达到最大令牌数量限制 (10)"
    });
  });
```

- [ ] **Step 5: 更新集成测试的 mock 服务端**（`App/backend/src/tests/index.test.ts`）

在 `startMockCuberouterServer` 的 login 分支之后加：

```ts
    if (request.method === "GET" && request.url === "/api/organizations") {
      // The member's memberships, newest first; the desktop provisions from the first one.
      sendJson(response, {
        success: true,
        message: "ok",
        data: [{ id: 7, name: "yeebo", role: "member" }]
      });
      return;
    }
```

把 tokens 分支的 URL 与 payload 里的名字改为新前缀：

```ts
      && request.url === "/api/organizations/7/tokens?keyword=cuby-desktop-alice&status=1&page_size=100"
```
```ts
        data: { items: [{ id: 11, name: "cuby-desktop-alice", key: "sk-cuberouter" }], total: 1, page_size: 100 }
```

（`MEMMY_CUBEROUTER_ORG` 的 env 设置行先留着，Task 4 删。）

- [ ] **Step 6: 跑测试**

Run: `cd App/backend && npx vitest run src/services/tests/cuberouter-account-service.test.ts src/adapters/outbound/cuberouter-client/tests/`
Expected: 全 PASS，含新增的 8 条。
Run: `cd App/backend && npx vitest run src/tests/index.test.ts`
Expected: PASS。
Run: `cd App/backend && npm run typecheck`
Expected: 无错误。

- [ ] **Step 7: Commit**

```bash
git add App/backend/src/adapters/outbound/cuberouter-client/types.ts App/backend/src/services/ App/backend/src/tests/index.test.ts
git commit -m "feat(cuberouter): resolve the organization from membership and fall back to a personal key

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: 配置清理：删 MEMMY_CUBEROUTER_ORG / MEMMY_CUBEROUTER_ORG_TOKEN_NAME

**Files:**
- Modify: `App/backend/src/config/service-urls.ts:20-48`
- Modify: `App/backend/src/config/tests/service-urls.test.ts:46-86`
- Modify: `App/backend/src/tests/index.test.ts:20-35, 1243-1246`
- Modify: `.env.example:28-35`

**Interfaces:**
- Produces: `CuberouterClientConfig` = `{ model: string; timeoutMs: number }`（Task 3 之后服务已不再消费组织字段）。

- [ ] **Step 1: 改 service-urls.ts**

`CuberouterClientConfig` 删掉 `organizationId`、`organizationTokenNamePrefix` 两个成员与注释；删除 `DEFAULT_CUBEROUTER_ORG` 常量及其 doc 注释；`resolveCuberouterClientConfig` 的返回只留：

```ts
  return {
    model: env.MEMMY_CUBEROUTER_MODEL?.trim() || settings.model?.trim() || "deepseek-v4.1-flash",
    timeoutMs: Number.parseInt(env.MEMMY_CUBEROUTER_TIMEOUT_MS ?? "", 10) || settings.timeoutMs || 10_000
  };
```

- [ ] **Step 2: 改 service-urls.test.ts**

- 第一个测试的 `toMatchObject`（47-53 行）删掉 `organizationId`、`organizationTokenNamePrefix` 两行。
- 删除 `"reads the organization token name prefix the build asked for"`（72-77）与 `"reads the organization whose token supplies the API key"`（79-85）两个测试。

- [ ] **Step 3: 清理 index.test.ts 的 env 痕迹**

- 删声明 `let previousCuberouterOrg: string | undefined;`（21 行）
- 删 afterEach 里的 `restoreOptionalEnv("MEMMY_CUBEROUTER_ORG", previousCuberouterOrg);`（33 行）
- 删 `previousCuberouterOrg = process.env.MEMMY_CUBEROUTER_ORG;` 与 `process.env.MEMMY_CUBEROUTER_ORG = "7";`（1245-1246 行）

- [ ] **Step 4: 改 .env.example**

删除 28-35 行的整块（组织与 token 名前缀变量及其注释），`MEMMY_CUBEROUTER_MODEL` / `MEMMY_CUBEROUTER_TIMEOUT_MS` 保留。在线路表注释（20-25 行）末尾补一句：

```
# key 名固定为 cuby-desktop-<用户名 @ 前那段>；所属组织由登录后按成员关系自动取。
```

- [ ] **Step 5: 验证没有残留**

Run: `grep -rn "MEMMY_CUBEROUTER_ORG\|DEFAULT_CUBEROUTER_ORG" --include="*.ts" --include="*.tsx" --include="*.example" . | grep -v node_modules | grep -v "/dist/" | grep -v "docs/superpowers/plans"`
Expected: 无输出。
Run: `cd App/backend && npx vitest run src/config/tests/service-urls.test.ts src/tests/index.test.ts`
Expected: 全 PASS。

- [ ] **Step 6: Commit**

```bash
git add App/backend/src/config/ App/backend/src/tests/index.test.ts .env.example
git commit -m "refactor(cuberouter): drop the build-time organization settings

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: 桌面端：角标显示「用户名(组织) + 账号模式」

**Files:**
- Modify: `App/frontend/desktop/src/state/app-reducer.ts:39-48, 135-142, 339-362`
- Modify: `App/frontend/desktop/src/state/app-actions.ts:103-111`
- Modify: `App/frontend/desktop/src/app.tsx:275-283`
- Modify: `App/frontend/desktop/src/components/account-auth-panel.tsx:183-190`
- Modify: `App/frontend/desktop/src/pages/app-frame.tsx:167-174, 313-320, 3015-3041`
- Modify: `App/frontend/desktop/src/i18n/messages.ts`（zh ~95 行、en ~1893 行）
- Test: `App/frontend/desktop/src/pages/tests/app-frame.test.tsx`

**Interfaces:**
- Consumes: Task 2 的 profile 可选字段 `username`/`organizationName`（经 `account-client` 的 zod parse 原样透传）。
- Produces: `AccountState.username: string | null`、`AccountState.organizationName: string | null`；`SidebarAccountLabels.accountModeLabel: string`。

- [ ] **Step 1: 写失败测试**（`app-frame.test.tsx`，describe 内新增；`sidebarLabels()` 同步加 `accountModeLabel: "账号模式"`）

```ts
  it("shows the cuberouter username and organization in place of the API key label", () => {
    const state = appReducer(
      appReducer(
        createInitialAppState(),
        appActions.bootstrapLoaded(
          { ...mockBootstrap, app: { ...mockBootstrap.app, userMode: "byok" } },
          "/settings"
        )
      ),
      appActions.accountUpdated({
        nickname: "Alice",
        identityProvider: "cuberouter",
        username: "alice@yeebo.com.cn",
        organizationName: "yeebo"
      })
    );

    expect(resolveSidebarAccountSummary(state, sidebarLabels())).toEqual({
      name: "alice@yeebo.com.cn (yeebo)",
      meta: "账号模式"
    });
  });

  it("shows just the cuberouter username when the account belongs to no organization", () => {
    const state = appReducer(
      appReducer(
        createInitialAppState(),
        appActions.bootstrapLoaded(
          { ...mockBootstrap, app: { ...mockBootstrap.app, userMode: "byok" } },
          "/settings"
        )
      ),
      appActions.accountUpdated({
        nickname: "Alice",
        identityProvider: "cuberouter",
        username: "alice@yeebo.com.cn",
        organizationName: null
      })
    );

    expect(resolveSidebarAccountSummary(state, sidebarLabels())).toEqual({
      name: "alice@yeebo.com.cn",
      meta: "账号模式"
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd App/frontend/desktop && npx vitest run src/pages/tests/app-frame.test.tsx`
Expected: FAIL（resolver 仍返回 nickname + "API Key 模式"；`accountModeLabel` 类型报错会被 esbuild 忽略、运行时是 undefined）。

- [ ] **Step 3: 状态层**

`app-reducer.ts`：
- `AccountState`（39-48 行）加：

```ts
  /** cuberouter 登录用户名（完整邮箱）；非 cuberouter 为 null。 */
  username: string | null;
  /** 所属组织名（单组织假设）；无组织为 null。 */
  organizationName: string | null;
```

- `createInitialAppState` 的 account 块（135-142 行）加 `username: null, organizationName: null,`。
- `account/updated`（339-350 行）加两行（沿用 hasOwnProperty 模式）：

```ts
          username: Object.prototype.hasOwnProperty.call(action, "username") ? (action.username ?? null) : state.account.username,
          organizationName: Object.prototype.hasOwnProperty.call(action, "organizationName") ? (action.organizationName ?? null) : state.account.organizationName,
```

- `account/cleared`（351-362 行）加 `username: null, organizationName: null,`。

`app-actions.ts`（103-111 行）的 `account/updated` 加：

```ts
      username?: string | null;
      organizationName?: string | null;
```

- [ ] **Step 4: 录入映射**

`app.tsx`（276-283 行的 `accountUpdated({...})`）加：

```ts
            userId: accountSession.profile.userId,
            ...
            identityProvider: accountSession.profile.identityProvider,
            username: accountSession.profile.username ?? null,
            organizationName: accountSession.profile.organizationName ?? null
```

`account-auth-panel.tsx`（185-190 行）同样处理，把变量名换成它那边的 `session.profile`：

```ts
      identityProvider: session.profile.identityProvider,
      username: session.profile.username ?? null,
      organizationName: session.profile.organizationName ?? null
```

- [ ] **Step 5: 侧栏渲染**

`app-frame.tsx`：
- `SidebarAccountLabels`（167-174 行）加 `accountModeLabel: string;`
- labels 构造（313-320 行）加 `accountModeLabel: t("appFrame.accountMode")`
- `resolveSidebarAccountSummary` 的 byok 分支（3018-3025 行）改为：

```ts
  if (userMode === "byok") {
    // A cuberouter identity signs in with an account, so the corner names the account, not the
    // key: username (organization). Pure-BYOK machines keep the key-mode label; a session that
    // has not learned its username yet falls back to the old rendering below.
    if (state.account.identityProvider === "cuberouter" && state.account.username) {
      const organizationName = state.account.organizationName;
      return {
        name: organizationName
          ? `${state.account.username} (${organizationName})`
          : state.account.username,
        meta: labels.accountModeLabel
      };
    }
    // The BYOK-set name is persisted in local localStorage ... (原注释保留)
    return {
      name: state.account.nickname || labels.brandName,
      meta: labels.byokLabel
    };
  }
```

`messages.ts`：zh 区块（~95 行 `appFrame.unsetName` 附近）加 `"appFrame.accountMode": "账号模式",`；en 区块（~1893 行）加 `"appFrame.accountMode": "Account mode",`。

- [ ] **Step 6: 跑测试 + typecheck**

Run: `cd App/frontend/desktop && npx vitest run src/pages/tests/app-frame.test.tsx`
Expected: 全 PASS（新增 2 条 + 既有 BYOK 不变的两条仍在）。
Run: `cd App/frontend/desktop && npm run typecheck`
Expected: 无错误。

- [ ] **Step 7: Commit**

```bash
git add App/frontend/desktop/src/
git commit -m "feat(desktop): name the cuberouter account and its organization in the sidebar

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: 文档收尾

**Files:**
- Modify: `/home/skeeey/workspace/cuberouter-issues/memmy-login-register-flow.md`（v1 现状说明）
- Modify: `/home/skeeey/workspace/cuberouter-issues/memmy-login-register-flow-v2.md`（加实现指针）

- [ ] **Step 1: 刷新 v1**

- 文档状态表「修订」行追加：`；同日 v2 落地：组织按成员关系取（假设一个）、key 前缀 cuby-desktop、无组织走个人 key，详见 memmy-login-register-flow-v2.md`
- §一：把「组织和模型都是构建期固定的」改为「模型构建期固定；组织登录后按成员关系取（列表第一个），无组织走个人 key」。
- §二.4 表格：步 1 改为「`GET /api/organizations` 取列表第一个（id 降序；>1 记日志）」；key 名改为 `<前缀>-<...>` 前缀固定 `cuby-desktop`；「前缀占 14 → local part 超过 36」改为「前缀占 13 → local part 超过 37」。
- §三末段：把「没配规则 → 报『未找到组织』」改为「没配规则 → 无组织 → 走个人 key（费用归个人，不再报错）」。
- §六失败表：删「未配置组织」「未找到组织」两行；「创建组织 API Key」行补「（无组织时是『创建个人 API Key』）」。
- 附表：删「组织」行；「key 名前缀」行改为 `固定 cuby-desktop（无变量）`。

- [ ] **Step 2: v2 文件加实现指针**

顶部日期行下加一行：

```
> 实现计划：memmy-agent `docs/superpowers/plans/2026-10-14-login-register-flow-v2.md`（2026-10-14）
```

- [ ] **Step 3: 全仓确认无残留**

Run: `grep -rn "memmy-desktop-alice\|MEMMY_CUBEROUTER_ORG_TOKEN_NAME" . | grep -v node_modules | grep -v "/dist/" | grep -v "docs/superpowers/plans" | grep -v "cuberouter-issues"`
Expected: 无输出。

- [ ] **Step 4: 全量回归**

Run: `cd App/backend && npm test`
Expected: 全 PASS。
Run: `cd App/frontend/desktop && npm test`
Expected: 全 PASS。

- [ ] **Step 5: Commit**（若 v1/v2 在两个仓库之外则不提交 memmy-agent；此处只应在 memmy-agent 有改动时提交）

```bash
git status --short
```
若 memmy-agent 无剩余改动，跳过提交；否则 `git add -A && git commit -m "docs: record the login/register v2 flow

Co-Authored-By: Claude Code <noreply@anthropic.com>"`

---

## 自查记录

- **Spec 覆盖**：v2 需求 1（Task 3+4）、2（Task 3）、3（Task 5）、4（Task 1+3）全部有对应任务；决议 1-5 分别落在 Task 3 的「取第一个+日志」、Task 3/4 的「删 ORG_TOKEN_NAME」、Task 3 的「不做存量兼容」、Task 5 的显示口径、以及 Global Constraints 的「无组织先不管余额」。
- **类型一致性**：`ensureOrganizationKey(client, accessToken, organizationId, tokenName)` / `ensurePersonalKey(client, accessToken, tokenName, createDirectly)` / `findPersonalToken` 在任务内自洽；Task 1 的 `CuberouterPersonalToken` 被 Task 3 直接消费。
- **Review Focus 各行均有测试**（见 Review Focus 段内引用）。
