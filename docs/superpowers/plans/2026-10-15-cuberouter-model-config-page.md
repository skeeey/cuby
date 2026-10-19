# cuberouter 模型配置页（选 key / 选模型 / 余额）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cuberouter 身份下，把模型配置页换成专用面板：选 key（每行带计费主体与余额）、选模型（用途分配即选模型）、并把用户选的 key 在后续登录中保留下来。

**Architecture:** 存储与写入形态不变——仍是一条 provider `openai` 的 BYOK 连接（`userMode` 仍 `"byok"`），差异只挂在身份层（`identityProvider === "cuberouter"`）。后端新增一次 `model-choices` 读接口（余额/模型/我名下的 key）与一个个人 key 明文接口，桌面端新增 `CuberouterModelSection` 面板并复用从 `ModelWorkspaceSection` 抽出的「模型分配」子组件。

**Tech Stack:** TypeScript / Node（后端 Fastify 本地 API + zod 契约）/ React + useReducer（桌面）/ vitest（两端都离线可跑，fetch 打桩）。

**Spec:** `docs/superpowers/specs/2026-10-15-cuberouter-model-config-design.md`（本计划实现该 spec；§4.6 的 `applyCuberouterModelConfig` 在本计划里落成 workspace 层的纯函数 `applyCuberouterSelection` + 复用的保存通路，行为不变）

## Global Constraints

- **不改 `userMode`**：仍是 `"byok"`；不加第三个 mode / space / provider id（连接仍复用 provider `openai`，`EndpointProtocol` 用 `openai-chat-completions`）。
- **key 名前缀**固定字面量 `cuby-desktop`（登录 find-or-create 现有行为，本计划不改）。
- **embedding** 固定 `BUILTIN_LOCAL_EMBEDDING_ASSIGNMENT_ID`；**asr / image 不提供** cuberouter 模型。
- **余额原样数值**，不做单位换算；个人余额取 `GET /api/user/self` 的 `quota`，组织余额 = `quota − used_quota`。
- **个人 key 明文只在选中时取一次**（`POST /api/token/:id/key`），不预取、不缓存到配置。
- i18n 文案中文写在 zh 块、英文写在 en 块，两处同键（`messages.ts` 有键集一致性测试）。
- 后端测试在 `App/backend` 下跑、桌面测试在 `App/frontend/desktop` 下跑；全部离线（fetch 全部打桩）。
- 后端与桌面的 `tsconfig` 都 **exclude 测试文件**：改 `CuberouterClient` 等接口不会让编译抓出旧测试桩，必须手动同步测试文件里的 fake。

## Review Focus

按 spec 隐含但容易漏的失败模式，逐条钉到 owning task 的测试里：

1. **choices 数据部分失败**：组织 key 列表 / 个人 key 列表 / 可选模型任一失败必须让面板进错误态并给重试，不能被当成「没有 key」而静默展示空列表（Task 2）。
2. **登录复核三种边界**：记录失效 → 回落 find-or-create；choices 拉不到 → 现有配置一动不动；首次登录（无配置）→ 照旧 provisioning（Task 13）。
3. **保存冲突**：面板「高级」加连接与 key/分配写入共用一份 workspace，`model_config_changed` / `config_write_busy` 要重读重试且不丢刚做的改动（Task 8、Task 12）。
4. **模型名边界**：实例模型名去重、空名丢弃；非 chat 模型被选为对话模型只透传实例错误，不猜能力（Task 1、Task 11）。
5. **长列表**：模型列表上百条时，分配下拉必须能搜索过滤（Task 7、Task 11）。

---

### Task 1: 后端 client：余额 / 可选模型 / 个人 key 全量 / 组织 key 按责任人

**Files:**
- Modify: `App/backend/src/adapters/outbound/cuberouter-client/types.ts`
- Modify: `App/backend/src/adapters/outbound/cuberouter-client/http-cuberouter-client.ts`
- Test: `App/backend/src/adapters/outbound/cuberouter-client/tests/model-choices.test.ts`（新建）

**Interfaces:**
- Consumes: 现有 `request()` / `toPersonalTokens()` / `readCount()` / `readString()`（同文件）。
- Produces（Task 2 依赖）：
  - `CuberouterSelfSummary { quota: number; usedQuota: number }`
  - `CuberouterOrganization { id: string; name: string; quota?: number; usedQuota?: number }`（可选字段：实例不报就不出现，避免破坏既有 `toEqual` 断言）
  - `CuberouterOrganizationToken { id: number; name: string; key: string; status?: number; responsibleUserId?: number }`
  - `CuberouterClient.getSelf(accessToken): Promise<CuberouterSelfSummary>`
  - `CuberouterClient.getUserModels(accessToken): Promise<string[]>`
  - `CuberouterClient.listPersonalTokens(accessToken): Promise<CuberouterPersonalToken[]>`
  - `CuberouterClient.listMyOrganizationTokens(accessToken, organizationId, responsibleUserId): Promise<CuberouterOrganizationToken[]>`

- [ ] **Step 1: 写失败测试**

新建 `tests/model-choices.test.ts`：

```ts
/** Cuberouter model-choice reads (balance, models, my keys). */
import { describe, expect, it, vi } from "vitest";
import { createHttpCuberouterClient } from "../index.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function clientWith(fetchImpl: typeof fetch) {
  return createHttpCuberouterClient({ baseUrl: "http://127.0.0.1:3000", timeoutMs: 1000, fetchImpl });
}

describe("cuberouter self and models", () => {
  it("reads the member's own quota and used quota", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, message: "", data: { quota: 1234567, used_quota: 4200 } })
    );

    await expect(
      clientWith(fetchImpl as unknown as typeof fetch).getSelf("jwt-1")
    ).resolves.toEqual({ quota: 1234567, usedQuota: 4200 });

    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/api/user/self");
  });

  it("reads a flat deduped model name list, dropping blank and non-string rows", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, message: "", data: ["deepseek-v4.1-flash", "  ", 7, "gpt-oss-120b"] })
    );

    await expect(
      clientWith(fetchImpl as unknown as typeof fetch).getUserModels("jwt-1")
    ).resolves.toEqual(["deepseek-v4.1-flash", "gpt-oss-120b"]);
  });
});

describe("cuberouter my tokens", () => {
  it("lists every personal token page row, masked, with its status", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: true,
        message: "",
        data: {
          items: [
            { id: 41, name: "cuby-desktop-alice", key: "sk-****wxyz", status: 1 },
            { id: 42, name: "my-old-key", status: 2 }
          ],
          total: 2
        }
      })
    );

    await expect(
      clientWith(fetchImpl as unknown as typeof fetch).listPersonalTokens("jwt-1")
    ).resolves.toEqual([
      { id: 41, name: "cuby-desktop-alice", status: 1 },
      { id: 42, name: "my-old-key", status: 2 }
    ]);

    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/api/token/?page_size=100");
  });

  it("asks for the organization tokens of one member, with all statuses", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: true,
        message: "",
        data: {
          items: [
            { id: 11, name: "cuby-desktop-alice", key: "sk-org", status: 1, responsible_user_id: 7 },
            { id: 12, name: "admin-gifted", key: "sk-gift", status: 2, responsible_user_id: 7 }
          ],
          total: 2
        }
      })
    );

    await expect(
      clientWith(fetchImpl as unknown as typeof fetch).listMyOrganizationTokens("jwt-1", "5", 7)
    ).resolves.toEqual([
      { id: 11, name: "cuby-desktop-alice", key: "sk-org", status: 1, responsibleUserId: 7 },
      { id: 12, name: "admin-gifted", key: "sk-gift", status: 2, responsibleUserId: 7 }
    ]);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/api/organizations/5/tokens?responsible_user_id=7&page_size=100");
    expect(init.headers).toMatchObject({
      "X-Account-Context-Type": "organization",
      "X-Account-Context-Id": "5"
    });
  });
});

describe("cuberouter organizations", () => {
  it("carries the organization pool the row reports, and omits it when absent", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: true,
        message: "",
        data: [
          { id: 5, name: "yeebo", quota: 100000, used_quota: 2500 },
          { id: 3, name: "Research" }
        ]
      })
    );

    await expect(
      clientWith(fetchImpl as unknown as typeof fetch).listOrganizations("jwt-1")
    ).resolves.toEqual([
      { id: "5", name: "yeebo", quota: 100000, usedQuota: 2500 },
      { id: "3", name: "Research" }
    ]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd App/backend && npx vitest run src/adapters/outbound/cuberouter-client/tests/model-choices.test.ts`
Expected: FAIL — `getSelf is not a function`（以及 `listMyOrganizationTokens` 不存在）。

- [ ] **Step 3: 加类型**

`types.ts`：在 `CuberouterOrganization` 上加两个可选字段，新增 `CuberouterSelfSummary`，给 `CuberouterOrganizationToken` 加两个可选字段，并在 `CuberouterClient` 接口里追加四个方法：

```ts
/** An organization the signed-in member belongs to, as that instance numbers it. */
export interface CuberouterOrganization {
  id: string;
  name: string;
  /** The organization's pool (`quota`) and how much of it is spent, when the instance reports them. */
  quota?: number;
  usedQuota?: number;
}

/** The signed-in member's own quota, as `GET /api/user/self` reports it. */
export interface CuberouterSelfSummary {
  /** Remaining quota, the number the instance spends from. */
  quota: number;
  /** Quota already consumed; display only. */
  usedQuota: number;
}

/** One organization token, with the plaintext key the instance returns to permitted members. */
export interface CuberouterOrganizationToken {
  id: number;
  name: string;
  key: string;
  /** The instance's token state (1 enabled, 2 disabled, 3 expired, 4 exhausted). */
  status?: number;
  /** The member this key is held by; the picker keeps only the caller's own rows. */
  responsibleUserId?: number;
}
```

`CuberouterClient` 接口追加（放在 `getPersonalTokenKey` 之后）：

```ts
  /** The member's own quota, for the model page's balance annotation. */
  getSelf(accessToken: string): Promise<CuberouterSelfSummary>;
  /** The model names the member's groups may call. No capability metadata: names only. */
  getUserModels(accessToken: string): Promise<string[]>;
  /** Every personal token of the member (masked), newest first, one page. */
  listPersonalTokens(accessToken: string): Promise<CuberouterPersonalToken[]>;
  /**
   * The organization tokens held by one member — the picker's "my keys". A plain member is
   * scoped to their own tokens by the instance anyway; naming the member makes a manager's call
   * mean the same thing instead of listing the whole organization.
   */
  listMyOrganizationTokens(
    accessToken: string,
    organizationId: string,
    responsibleUserId: number
  ): Promise<CuberouterOrganizationToken[]>;
```

- [ ] **Step 4: 实现 client 方法**

`http-cuberouter-client.ts` 的返回对象里（`getPersonalTokenKey` 之后）追加：

```ts
    async getSelf(accessToken) {
      const data = await request<Record<string, unknown>>(fetchImpl, baseUrl, options.timeoutMs, "/api/user/self", {
        method: "GET",
        accessToken
      });
      // Missing or unusable fields read as 0: the panel shows "剩余 0" rather than throwing on a
      // balance that only decorates the key row.
      return { quota: readCount(data.quota) ?? 0, usedQuota: readCount(data.used_quota) ?? 0 };
    },

    async getUserModels(accessToken) {
      const data = await request<unknown>(fetchImpl, baseUrl, options.timeoutMs, "/api/user/models", {
        method: "GET",
        accessToken
      });
      // A flat array of names, already deduped across the member's groups by the instance.
      return Array.isArray(data)
        ? data.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []))
        : [];
    },

    async listPersonalTokens(accessToken) {
      const query = new URLSearchParams({ page_size: "100" }).toString();
      const response = await request<Record<string, unknown>>(
        fetchImpl,
        baseUrl,
        options.timeoutMs,
        `/api/token/?${query}`,
        { method: "GET", accessToken }
      );
      return toPersonalTokens(Array.isArray(response.items) ? response.items : []);
    },

    async listMyOrganizationTokens(accessToken, organizationId, responsibleUserId) {
      const query = new URLSearchParams({
        responsible_user_id: String(responsibleUserId),
        page_size: "100"
      }).toString();
      const response = await request<Record<string, unknown>>(
        fetchImpl,
        baseUrl,
        options.timeoutMs,
        `/api/organizations/${encodeURIComponent(organizationId)}/tokens?${query}`,
        { method: "GET", accessToken, headers: organizationContextHeaders(organizationId) }
      );
      return toOrganizationTokens(Array.isArray(response.items) ? response.items : []);
    },
```

同时改两个映射器（只补可选字段，保持既有断言不变）：

```ts
/** Maps the organization list onto id/name pairs, dropping rows missing either. */
function toOrganizations(items: unknown[]): CuberouterOrganization[] {
  return items.flatMap((item) => {
    const row = asRecord(item);
    const id = readString(row.id);
    const name = readString(row.name);
    if (!id || !name) return [];
    const quota = readCount(row.quota);
    const usedQuota = readCount(row.used_quota);
    return [{
      id,
      name,
      ...(quota === null ? {} : { quota }),
      ...(usedQuota === null ? {} : { usedQuota })
    }];
  });
}

/** Maps one organization token page onto id/name/key triples, dropping rows missing any of them. */
function toOrganizationTokens(items: unknown[]): CuberouterOrganizationToken[] {
  return items.flatMap((item) => {
    const row = asRecord(item);
    const id = readCount(row.id);
    const name = readString(row.name);
    const key = readString(row.key);
    if (id === null || !name || !key) return [];
    const status = readCount(row.status);
    const responsibleUserId = readCount(row.responsible_user_id);
    return [{
      id,
      name,
      key,
      ...(status === null ? {} : { status }),
      ...(responsibleUserId === null ? {} : { responsibleUserId })
    }];
  });
}
```

- [ ] **Step 5: 跑测试确认通过，并跑既有 client 测试**

Run: `cd App/backend && npx vitest run src/adapters/outbound/cuberouter-client/tests`
Expected: 新旧测试全 PASS（既有 org/personal token 断言因可选字段为 `undefined` 而保持相等）。

- [ ] **Step 6: Commit**

```bash
git add App/backend/src/adapters/outbound/cuberouter-client
git commit -m "feat(cuberouter): read balance, selectable models and my keys from the instance"
```

---

### Task 2: 后端 service：`readModelChoices` + `getPersonalKey`

**Files:**
- Modify: `App/backend/src/services/cuberouter-account-service.ts`
- Test: `App/backend/src/services/tests/cuberouter-account-service.test.ts`（追加用例；同步 `fakeClient`）

**Interfaces:**
- Consumes: Task 1 的四个 client 方法；现有 `currentOrProbedNodeId()` / `clientForNode()` / `options.accountSessionRepository` / `options.nodeRouter`。
- Produces（Task 3 依赖）：

```ts
export interface CuberouterModelChoices {
  account: { username: string; organizationName: string | null };
  /** The current line's OpenAI-compatible base (`<线路>/v1`) the panel reads and writes against. */
  apiBase: string;
  keys: Array<{
    scope: "organization" | "personal";
    id: number;
    name: string;
    secret?: string;
    status?: number;
    usable: boolean;
    billing:
      | { kind: "personal"; remainingQuota: number | null }
      | { kind: "organization"; organizationName: string; remainingQuota: number | null };
  }>;
  models: string[];
}
```

`CuberouterAccountService` 追加两个方法：`readModelChoices(): Promise<CuberouterModelChoices>`、`getPersonalKey(tokenId: number): Promise<{ key: string }>`。

- [ ] **Step 1: 同步既有 fake，写失败测试**

`tests/cuberouter-account-service.test.ts`：把 `fakeClient` 里的 `getSelf` 换成新形状并补三个新方法（其余用例不受影响）：

```ts
    getSelf: vi.fn(async () => ({ quota: 100, usedQuota: 0 })),
    getUserModels: vi.fn(async () => ["deepseek-v4.1-flash", "gpt-oss-120b"]),
    listPersonalTokens: vi.fn(async () => [{ id: 41, name: "cuby-desktop-alice", status: 1 }]),
    listMyOrganizationTokens: vi.fn(async () => [
      { id: 11, name: "cuby-desktop-alice", key: "sk-org", status: 1, responsibleUserId: 7 }
    ]),
```

同文件新增 describe：

```ts
describe("cuberouter model choices", () => {
  it("reports the organization key with the organization pool as its billing", async () => {
    const client = fakeClient({
      listOrganizations: vi.fn(async () => [{ id: "5", name: "yeebo", quota: 100000, usedQuota: 2500 }])
    });
    const { repository } = fakeRepository();
    const service = singleNodeService(client, authenticatedRepository());

    const choices = await service.readModelChoices();

    expect(choices.account).toEqual({ username: "alice", organizationName: "yeebo" });
    expect(choices.apiBase).toBe("http://127.0.0.1:3000/v1");
    expect(choices.keys).toEqual([
      {
        scope: "organization",
        id: 11,
        name: "cuby-desktop-alice",
        secret: "sk-org",
        status: 1,
        usable: true,
        billing: { kind: "organization", organizationName: "yeebo", remainingQuota: 97500 }
      },
      {
        scope: "personal",
        id: 41,
        name: "cuby-desktop-alice",
        status: 1,
        usable: true,
        billing: { kind: "personal", remainingQuota: 100 }
      }
    ]);
    expect(choices.models).toEqual(["deepseek-v4.1-flash", "gpt-oss-120b"]);
  });

  it("keeps only the member's own organization rows and drops disabled personal keys' usability", async () => {
    const client = fakeClient({
      listMyOrganizationTokens: vi.fn(async () => [
        { id: 11, name: "mine", key: "sk-mine", status: 1, responsibleUserId: 7 },
        { id: 12, name: "someone-else", key: "sk-other", status: 1, responsibleUserId: 99 }
      ]),
      listPersonalTokens: vi.fn(async () => [
        { id: 41, name: "disabled", status: 2 },
        { id: 42, name: "no-status-reported" }
      ])
    });
    const service = singleNodeService(client, authenticatedRepository());

    const choices = await service.readModelChoices();

    expect(choices.keys.map((key) => key.name)).toEqual(["mine", "disabled", "no-status-reported"]);
    expect(choices.keys.map((key) => key.usable)).toEqual([true, false, true]);
  });

  it("leaves the balance null when the instance will not report it, and still lists the key", async () => {
    const client = fakeClient({
      getSelf: vi.fn(async () => { throw new Error("self boom"); }),
      listPersonalTokens: vi.fn(async () => [{ id: 41, name: "cuby-desktop-alice", status: 1 }])
    });
    const service = singleNodeService(client, authenticatedRepository());

    const choices = await service.readModelChoices();

    expect(choices.keys[0]?.billing).toEqual({ kind: "personal", remainingQuota: null });
  });

  it("propagates a core list failure instead of reporting an empty key list", async () => {
    const client = fakeClient({
      listPersonalTokens: vi.fn(async () => { throw new Error("token list boom"); })
    });
    const service = singleNodeService(client, authenticatedRepository());

    await expect(service.readModelChoices()).rejects.toThrow("token list boom");
  });

  it("reads one personal key's plaintext on demand", async () => {
    const client = fakeClient({ getPersonalTokenKey: vi.fn(async () => "sk-plain") });
    const service = singleNodeService(client, authenticatedRepository());

    await expect(service.getPersonalKey(41)).resolves.toEqual({ key: "sk-plain" });
  });
});
```

> 说明：`authenticatedRepository()` 是本任务新增的小工具——`fakeRepository()` 造出的 `get()` 恒返回「未登录」，而 `readModelChoices()` 要求已登录会话。它复刻 `fakeRepository` 的 upsert 结果并在 `get()` / `getCloudUuid()` 上返回该结果：

```ts
/** A repository whose active session is the cuberouter account the login produced. */
function authenticatedRepository() {
  const view = {
    authenticated: true,
    isNewUser: false,
    profile: { userId: "7", username: "alice", displayName: "Alice", identityProvider: "cuberouter", organizationName: null }
  };
  return {
    get: vi.fn(() => view),
    getCloudUuid: vi.fn(() => "jwt-1"),
    getAuthChannel: vi.fn(() => "cuberouter"),
    upsert: vi.fn(() => view),
    clear: vi.fn()
  } as any;
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd App/backend && npx vitest run src/services/tests/cuberouter-account-service.test.ts`
Expected: FAIL — `service.readModelChoices is not a function`。

- [ ] **Step 3: 实现 service 方法**

`cuberouter-account-service.ts`：接口上加两个方法声明（含上面的 `CuberouterModelChoices` 类型与注释），实现里加（放在 `loginOnNode` 附近）：

```ts
  /** The desktop's model page data: my keys with their billing, the selectable models, balance. */
  async function readModelChoices(): Promise<CuberouterModelChoices> {
    const session = options.accountSessionRepository.get();
    const accessToken = options.accountSessionRepository.getCloudUuid();
    if (!session.authenticated || !accessToken) {
      throw Object.assign(new Error("尚未登录 cuberouter 账号"), { code: "rejected" as const });
    }
    const { client, url } = clientForNode(await currentOrProbedNodeId());

    // Core reads propagate: the panel must show its retry state, not an empty key list that looks
    // like "the account has no keys". Only the balance degrades, because it is decoration.
    const organizations = await client.listOrganizations(accessToken);
    const organization = organizations[0] ?? null;
    const organizationTokens = organization
      ? await client.listMyOrganizationTokens(accessToken, organization.id, Number(session.profile.userId))
      : [];
    const personalTokens = await client.listPersonalTokens(accessToken);
    const models = await client.getUserModels(accessToken);
    const self = await client.getSelf(accessToken).catch((error) => {
      log(`[cuberouter] reading self quota failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });

    const personalQuota = self?.quota ?? null;
    const organizationQuota = organization && organization.quota !== undefined && organization.usedQuota !== undefined
      ? organization.quota - organization.usedQuota
      : null;

    return {
      account: { username: session.profile.username ?? "", organizationName: organization?.name ?? null },
      apiBase: `${url}/v1`,
      keys: [
        ...organizationTokens
          // A plain member's list includes the organization's public keys, held by other people.
          .filter((token) => token.responsibleUserId === undefined || token.responsibleUserId === Number(session.profile.userId))
          .map((token) => ({
            scope: "organization" as const,
            id: token.id,
            name: token.name,
            secret: token.key,
            ...(token.status === undefined ? {} : { status: token.status }),
            usable: token.status === undefined || token.status === 1,
            billing: {
              kind: "organization" as const,
              organizationName: organization?.name ?? "",
              remainingQuota: organizationQuota
            }
          })),
        ...personalTokens.map((token) => ({
          scope: "personal" as const,
          id: token.id,
          name: token.name,
          ...(token.status === undefined ? {} : { status: token.status }),
          usable: token.status === undefined || token.status === 1,
          billing: { kind: "personal" as const, remainingQuota: personalQuota }
        }))
      ],
      models
    };
  }

  /** One personal key's plaintext, read at the moment the user selects it. */
  async function getPersonalKey(tokenId: number): Promise<{ key: string }> {
    const accessToken = options.accountSessionRepository.getCloudUuid();
    if (!options.accountSessionRepository.get().authenticated || !accessToken) {
      throw Object.assign(new Error("尚未登录 cuberouter 账号"), { code: "rejected" as const });
    }
    const { client } = clientForNode(await currentOrProbedNodeId());
    return { key: await client.getPersonalTokenKey(accessToken, tokenId) };
  }
```

返回对象里加上 `readModelChoices,` 与 `getPersonalKey,`。

> `session.profile.username` 的可用性：v2 已把 `username` 放进 profile（`App/backend/local-api-contracts` 的 `AccountProfileView`）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd App/backend && npx vitest run src/services/tests/cuberouter-account-service.test.ts`
Expected: PASS（全部新用例 + 既有用例）。

- [ ] **Step 5: Commit**

```bash
git add App/backend/src/services/cuberouter-account-service.ts App/backend/src/services/tests/cuberouter-account-service.test.ts
git commit -m "feat(cuberouter): compose the model page's key, model and balance view"
```

---

### Task 3: 契约与本地路由

**Files:**
- Modify: `App/backend/local-api-contracts/src/index.ts`
- Modify: `App/backend/src/adapters/inbound/local-api/routes/account.ts`
- Test: `App/backend/src/adapters/inbound/local-api/tests/account-routes.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `readModelChoices()` / `getPersonalKey(id)`。
- Produces（Task 4 依赖）：`CuberouterModelChoicesViewSchema`、`CuberouterPersonalKeyViewSchema`，路由 `GET /api/account/cuberouter/model-choices`、`POST /api/account/cuberouter/personal-keys/:id/key`。

- [ ] **Step 1: 写失败测试**

`tests/account-routes.test.ts` 追加（照既有 `createServer({ cuberouterAccount: {...} })` 的覆盖方式）：

```ts
  it("serves the cuberouter model choices view", async () => {
    app = createServer({
      cuberouterAccount: {
        ...unusedCuberouterAccount(),
        async readModelChoices() {
          return {
            account: { username: "alice@a.com", organizationName: "yeebo" },
            apiBase: "https://cn.example/v1",
            keys: [{
              scope: "organization",
              id: 11,
              name: "cuby-desktop-alice",
              secret: "sk-org",
              usable: true,
              billing: { kind: "organization", organizationName: "yeebo", remainingQuota: 97500 }
            }],
            models: ["deepseek-v4.1-flash"]
          };
        }
      }
    });

    const response = await injectJson("GET", "/api/account/cuberouter/model-choices", undefined);

    expect(response.statusCode).toBe(200);
    expect(response.json().keys[0].billing.remainingQuota).toBe(97500);
    expect(response.json().models).toEqual(["deepseek-v4.1-flash"]);
  });

  it("reveals one personal key by id", async () => {
    const asked: number[] = [];
    app = createServer({
      cuberouterAccount: {
        ...unusedCuberouterAccount(),
        async getPersonalKey(tokenId: number) {
          asked.push(tokenId);
          return { key: "sk-plain" };
        }
      }
    });

    const response = await injectJson("POST", "/api/account/cuberouter/personal-keys/41/key", {});

    expect(response.statusCode).toBe(200);
    expect(response.json().key).toBe("sk-plain");
    expect(asked).toEqual([41]);
  });
```

`unusedCuberouterAccount()` = 把 `createServer` 里现有的 `cuberouterAccount` 默认桩提成一个函数（`readModelChoices` / `getPersonalKey` 抛 "not used"），供这些用例展开覆盖。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd App/backend && npx vitest run src/adapters/inbound/local-api/tests/account-routes.test.ts`
Expected: FAIL — 404（路由不存在）。

- [ ] **Step 3: 加契约**

`local-api-contracts/src/index.ts`（放在 `CuberouterNodesViewSchema` 一带）：

```ts
/** One selectable cuberouter key, with the pool its spend lands on. */
export const CuberouterKeyOptionSchema = z.object({
    scope: z.enum(["organization", "personal"]),
    id: z.number().int(),
    name: z.string(),
    /** Organization keys carry the plaintext the instance returns; personal keys never do. */
    secret: z.string().optional(),
    status: z.number().int().optional(),
    usable: z.boolean(),
    billing: z.union([
        z.object({ kind: z.literal("personal"), remainingQuota: z.number().nullable() }),
        z.object({
            kind: z.literal("organization"),
            organizationName: z.string(),
            remainingQuota: z.number().nullable()
        })
    ])
});
export type CuberouterKeyOption = z.infer<typeof CuberouterKeyOptionSchema>;

/** The model page's data: my keys with billing, the selectable models. */
export const CuberouterModelChoicesViewSchema = z.object({
    account: z.object({ username: z.string(), organizationName: z.string().nullable() }),
    apiBase: z.string(),
    keys: z.array(CuberouterKeyOptionSchema),
    models: z.array(z.string())
});
export type CuberouterModelChoicesView = z.infer<typeof CuberouterModelChoicesViewSchema>;

export const CuberouterPersonalKeyViewSchema = z.object({ key: z.string() });
export type CuberouterPersonalKeyView = z.infer<typeof CuberouterPersonalKeyViewSchema>;
```

- [ ] **Step 4: 加路由**

`routes/account.ts` 的 import 里加三个 schema，`registerAccountRoutes` 末尾追加：

```ts
  app.get(
    "/api/account/cuberouter/model-choices",
    { preHandler: options.authenticateRuntimeToken },
    withErrorEnvelope(async (_request, reply) => {
      const response = CuberouterModelChoicesViewSchema.parse(
        await options.cuberouterAccount.readModelChoices()
      );
      return reply.send(response);
    })
  );

  app.post(
    "/api/account/cuberouter/personal-keys/:id/key",
    { preHandler: options.authenticateRuntimeToken },
    withErrorEnvelope(async (request, reply) => {
      const { id } = request.params as { id: string };
      const response = CuberouterPersonalKeyViewSchema.parse(
        await options.cuberouterAccount.getPersonalKey(Number.parseInt(id, 10))
      );
      return reply.send(response);
    })
  );
```

- [ ] **Step 5: 构建契约 + 跑测试**

Run: `cd App/backend && npm run build -w @memmy/local-api-contracts && npx vitest run src/adapters/inbound/local-api/tests/account-routes.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add App/backend/local-api-contracts/src/index.ts App/backend/src/adapters/inbound/local-api
git commit -m "feat(cuberouter): expose model choices and personal key reveal on the local api"
```

---

### Task 4: 桌面 account client

**Files:**
- Modify: `App/frontend/desktop/src/api/account-client.ts`
- Test: `App/frontend/desktop/src/api/tests/account-client.test.ts`

**Interfaces:**
- Consumes: Task 3 的契约类型；现有 `requestJson`。
- Produces（Task 10 依赖）：`AccountClient.getModelChoices(): Promise<CuberouterModelChoicesView>`、`AccountClient.revealPersonalKey(tokenId: number): Promise<CuberouterPersonalKeyView>`。

- [ ] **Step 1: 写失败测试**

`api/tests/account-client.test.ts` 追加（沿用该文件的 `fetch` 打桩方式）：

```ts
  it("reads the cuberouter model choices and reveals one personal key", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/api/account/cuberouter/model-choices")) {
        return jsonResponse({ account: { username: "alice@a.com", organizationName: "yeebo" }, apiBase: "https://cn.example/v1", keys: [], models: ["m1"] });
      }
      return jsonResponse({ key: "sk-plain" });
    });
    const client = createHttpAccountClient(runtimeConfigWith(fetchImpl));

    await expect(client.getModelChoices()).resolves.toEqual({
      account: { username: "alice@a.com", organizationName: "yeebo" },
      apiBase: "https://cn.example/v1",
      keys: [],
      models: ["m1"]
    });
    await expect(client.revealPersonalKey(41)).resolves.toEqual({ key: "sk-plain" });
    expect(calls[1]).toContain("/api/account/cuberouter/personal-keys/41/key");
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd App/frontend/desktop && npx vitest run src/api/tests/account-client.test.ts`
Expected: FAIL — `client.getModelChoices is not a function`。

- [ ] **Step 3: 实现**

`account-client.ts`：import 两个 schema/类型，接口与实现各加两项：

```ts
  /** The model page data: my keys with their billing, and the selectable models. */
  getModelChoices(): Promise<CuberouterModelChoicesView>;
  /** Reads one personal key's plaintext, at the moment the user selects it. */
  revealPersonalKey(tokenId: number): Promise<CuberouterPersonalKeyView>;
```

```ts
    async getModelChoices() {
      return requestJson({
        config,
        path: "/api/account/cuberouter/model-choices",
        schema: CuberouterModelChoicesViewSchema,
        init: { method: "GET" }
      });
    },

    async revealPersonalKey(tokenId) {
      return requestJson({
        config,
        path: `/api/account/cuberouter/personal-keys/${encodeURIComponent(String(tokenId))}/key`,
        schema: CuberouterPersonalKeyViewSchema,
        init: { method: "POST" },
        body: {}
      });
    },
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd App/frontend/desktop && npx vitest run src/api/tests/account-client.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add App/frontend/desktop/src/api/account-client.ts App/frontend/desktop/src/api/tests/account-client.test.ts
git commit -m "feat(desktop): call the cuberouter model choices endpoints"
```

---

### Task 5: 重构：抽出 `ModelAssignmentSection`（行为不变）

**Files:**
- Create: `App/frontend/desktop/src/pages/model-assignment-section.tsx`
- Modify: `App/frontend/desktop/src/pages/model-workspace-section.tsx`

**Interfaces:**
- Produces（Task 11 依赖）：

```ts
export interface AssignmentCandidate { id: string; label: string; detail?: string }
export interface AssignmentCandidateGroup { key: string; title: string; icon?: ReactNode; candidates: AssignmentCandidate[] }
export interface ModelAssignmentRowSpec {
  kind: ModelAssignmentKind;
  label: string;
  description: string;
  tip?: string;
  badge?: string;
  value: string | undefined;
  options: SelectOption[];
  preserveUnassigned?: boolean;
  /** Renders a searchable dropdown instead of the plain Select (long model lists). */
  searchable?: boolean;
}
export interface ModelAssignmentSectionProps {
  conversationGroups: AssignmentCandidateGroup[];
  selectedCandidateIds: string[];
  defaultCandidateId?: string | null;
  onToggleCandidate(candidateId: string): void;
  onChooseDefaultCandidate(candidateId: string): void;
  rows: ModelAssignmentRowSpec[];
  onRowChange(kind: ModelAssignmentKind, value: string): void;
}
export function ModelAssignmentSection(props: ModelAssignmentSectionProps): ReactNode;
```

- [ ] **Step 1: 把 render body 搬过去**

新建 `model-assignment-section.tsx`：把 `model-workspace-section.tsx` 里 `<section className={saveError ? undefined : "mt-8"}>`（「模型分配」`bindingTitle` 那一节）整段 JSX 原样搬入（含对话模型多选块与 5 个 `AssignmentRow` 调用），把 `AssignmentRow` 子组件（原 `model-workspace-section.tsx:1313`）一并搬入并保持私有；`Wrench` / `Check` / `ChevronDown` / `ChevronUp` / `Info` / `ModelProviderLogo` / `KeyRound` / `Select` / `Tooltip` / `useTranslation` 的 import 跟着搬。

与旧代码的三处差异（其余逐字保留）：

1. 对话模型多选块里的 `textCandidates` → 由 props 的 `conversationGroups` 渲染；分组标题/图标来自 group（旧代码按 `source` 分组、标题写死 `platformModels` / `byokConnections`；新组件直接渲染调用方给的分组，空分组跳过，行为与旧的 `if (candidates.length === 0) return null` 一致）。
2. 选中判定 `taskCandidates.some(...)` / `space.defaultTaskCandidateId` → `props.selectedCandidateIds` / `props.defaultCandidateId`；「至少留一个」的禁用逻辑与文字沿用 `settings.modelWorkspace.taskAtLeastOne`。
3. `<section className={saveError ? undefined : "mt-8"}>` → 固定 `mt-8`（保存错误由容器渲染在别处）。

`AssignmentRow` 本任务保持原样（不含搜索）；`searchable` 字段与 `SearchableSelect` 分支由 Task 11 添加。

- [ ] **Step 2: 容器改用新组件**

`model-workspace-section.tsx`：删掉搬走的 JSX 与 `AssignmentRow`，在原来的位置渲染：

```tsx
      <ModelAssignmentSection
        conversationGroups={[
          ...(textCandidates.some((candidate) => candidate.source === "platform")
            ? [{
                key: "platform",
                title: t("settings.modelWorkspace.platformModels"),
                icon: <ModelProviderLogo provider="memmy" size={14} />,
                candidates: textCandidates.filter((candidate) => candidate.source === "platform")
                  .map((candidate) => ({ id: candidate.id, label: candidate.model, detail: t("settings.modelWorkspace.platformName") }))
              }]
            : []),
          ...(textCandidates.some((candidate) => candidate.source === "byok")
            ? [{
                key: "byok",
                title: t("settings.modelWorkspace.byokConnections"),
                icon: <KeyRound size={12} aria-hidden="true" />,
                candidates: textCandidates.filter((candidate) => candidate.source === "byok")
                  .map((candidate) => ({ id: candidate.id, label: candidate.model, detail: connectionProtocolLabel(candidate.provider, t) }))
              }]
            : [])
        ]}
        selectedCandidateIds={taskCandidates.map((candidate) => candidate.id)}
        defaultCandidateId={space.defaultTaskCandidateId}
        onToggleCandidate={toggleTaskCandidate}
        onChooseDefaultCandidate={chooseDefaultTaskCandidate}
        rows={[
          { kind: "memorySummary", label: t("settings.model.memorySummary"), description: t("settings.model.memoryDesc"), tip: t("apiKey.modelPage.memoryHint"), value: space.assignments.memorySummary, options: memorySummaryOptions },
          { kind: "memoryEvolution", label: t("settings.model.skillEvolution"), description: t("settings.model.skillDesc"), value: space.assignments.memoryEvolution, options: memoryEvolutionOptions },
          { kind: "embedding", label: t("settings.model.embeddingSearch"), description: t("settings.model.embeddingDesc"), value: embeddingAssignment, options: embeddingOptions, preserveUnassigned: props.mode === "account" },
          { kind: "asr", label: t("settings.model.asr"), description: t("settings.model.asrDesc"), badge: t("settings.modelWorkspace.optional"), value: space.assignments.asr, options: asrOptions },
          { kind: "image", label: t("settings.model.imageGen"), description: t("settings.model.imageGenDesc"), badge: t("settings.modelWorkspace.optional"), value: space.assignments.image, options: imageOptions }
        ]}
        onRowChange={updateAssignment}
      />
```

`candidateOption()`（原 `model-workspace-section.tsx:1428`）与 `connectionProtocolLabel()` 留在 `model-workspace-section.tsx`（只有容器与行 options 用到）。

- [ ] **Step 3: 跑既有测试确认行为不变**

Run: `cd App/frontend/desktop && npx vitest run src/pages/tests/settings-page.test.tsx src/pages/tests/model-workspace-long-model-name.interaction.test.tsx`
Expected: PASS（未改任何断言）。

- [ ] **Step 4: 类型检查**

Run: `cd App/frontend/desktop && npm run typecheck`
Expected: 无错误。

- [ ] **Step 5: Commit**

```bash
git add App/frontend/desktop/src/pages/model-assignment-section.tsx App/frontend/desktop/src/pages/model-workspace-section.tsx
git commit -m "refactor(desktop): extract the model assignment section for reuse"
```

---

### Task 6: 重构：抽出 `ModelLibrarySection`（行为不变）

**Files:**
- Create: `App/frontend/desktop/src/pages/model-library-section.tsx`
- Modify: `App/frontend/desktop/src/pages/model-workspace-section.tsx`

**Interfaces:**
- Produces（Task 12 依赖）：

```ts
export interface ModelLibrarySectionProps {
  mode: ModelWorkspaceMode;
  workspace: ModelWorkspace;
  space: ModelWorkspaceSpace;
  commitWorkspace(next: ModelWorkspace, onSaved?: (saved: ModelWorkspace) => void): boolean;
  savePending: boolean;
  saveError: string | null;
  testStates: Record<string, StoredConnectionTestState>;
  setTestStates: Dispatch<SetStateAction<Record<string, StoredConnectionTestState>>>;
  /** Deep-link/hash flow that opens the add-connection editor (moves with the editor). */
  autoOpenAddConnection?: boolean;
  onFinishSetup?: () => void;
  onReturnToMain?: () => void;
}
export function ModelLibrarySection(props: ModelLibrarySectionProps): ReactNode;
```

- [ ] **Step 1: 搬移**

新建 `model-library-section.tsx`，从 `model-workspace-section.tsx` 搬入（逐字保留）：

- 「模型库」section 的 JSX（`libraryTitle` 标题 + 添加按钮 + 折叠 + 平台卡 + 连接卡片列表）。
- 编辑器 `Modal`、删除 `ConfirmDialog`，以及它们依赖的子组件 `ProviderModelList`、`ConnectionStatus`、`connectionTestState`、`connectionTestMessage`、`modelConnectionTestStorage`、`ModelCapabilityPicker`、`modelKindOptions` / `modelKindMessageKey` / `modelCapabilityMessageKey`。
- 状态：`modelsExpanded`、`editor`、`editorTest`、`showEditorApiKey`、`deleteTarget`、`formError`。
- 处理函数：`openAddConnection`、`closeEditor`、`openEditConnection`、`resolveEditorModels`、`saveConnection`、`saveEditorModel`、`editEditorModel`、`cancelEditorModel`、`removeEditorModel`、`confirmDeleteConnection`、`testEditorConnection`。
- 两个 effect：`testStates` 恢复 effect、自动打开编辑器 effect（`SETTINGS_ADD_MODEL_EVENT` / `shouldOpenAddModelFromHash` / `props.autoOpenAddConnection` / `SETTINGS_ADD_MODEL_RETURN_STORAGE_KEY`）。
- 这些被搬走的函数用到的纯工具：`connectionTestSignature`、`readConnectionTestStates`、`removeConnectionTestState`、`writeConnectionTestState`、`protocolFromConnection`、`protocolForEditor`、`editorProtocolForCapabilities`、`editorCapabilitiesForProtocol`、`modelKindForCapabilities`、`fromCatalogCapability`、`toCatalogCapabilityForEditor`、`testCapability`、`testSecretTarget`、`modelCapabilitiesForKind`、`normalizeEditorCapabilities`、`mutateErrorText`、`DEFAULT_ENDPOINTS`、`DEFAULT_MODEL_IDS`、`PROTOCOL_OPTIONS`、`fromProtocol` —— 一并搬进新文件（其中 `protocolFromConnection`、`editorProtocolForCapabilities`、`availableConnectionProtocols`、`modelCapabilitiesForKind`、`normalizeEditorCapabilities` 已被 `model-workspace-section.tsx` 的测试/其它模块 import，**保留在 `model-workspace-section.tsx` 并 re-export**，或改从新文件导出并更新 import 处——选前者，改动最小）。

容器保留：workspace 状态与 `commitWorkspace`（含乐观保存/冲突重读）、`savePending`/`saveError`、`testStates` 的 state 本体、`hasMutatedRef` 水合 effect、`onFinishSetup` 顶部提示条、`updateAssignment` / `toggleTaskCandidate` / `chooseDefaultTaskCandidate`、以及渲染 `<ModelLibrarySection …/>` + `<ModelAssignmentSection …/>` 的布局（`model-workspace-layout` 外层 div 不变）。

- [ ] **Step 2: 跑既有测试**

Run: `cd App/frontend/desktop && npx vitest run src/pages/tests/`
Expected: PASS（`settings-page.test.tsx` 覆盖了库卡片渲染、添加/编辑/删除、自动打开编辑器等路径）。

- [ ] **Step 3: 类型检查**

Run: `cd App/frontend/desktop && npm run typecheck`
Expected: 无错误。

- [ ] **Step 4: Commit**

```bash
git add App/frontend/desktop/src/pages/model-library-section.tsx App/frontend/desktop/src/pages/model-workspace-section.tsx
git commit -m "refactor(desktop): extract the model library section for reuse"
```

---

### Task 7: `SearchableSelect` 组件

**Files:**
- Create: `App/frontend/desktop/src/components/searchable-select.tsx`
- Test: `App/frontend/desktop/src/components/tests/searchable-select.interaction.test.tsx`（新建；照 `components/tests/` 现有交互测试的 render 用法）

**Interfaces:**
- Consumes: `SelectOption`（`components/Select.tsx`）、`Modal` 不需要；自己实现浮层。
- Produces（Task 11 依赖）：`SearchableSelect(props: SearchableSelectProps): ReactNode`。

```ts
export interface SearchableSelectProps {
  label: string;
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder: string;
  disabled?: boolean;
  className?: string;
  menuClassName?: string;
}
```

- [ ] **Step 1: 写失败测试**

```tsx
/** Searchable select interaction tests. */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SearchableSelect } from "../searchable-select.js";

const OPTIONS = [
  { value: "deepseek-v4.1-flash", label: "deepseek-v4.1-flash" },
  { value: "gpt-oss-120b", label: "gpt-oss-120b" },
  { value: "qwen3-235b", label: "qwen3-235b" }
];

describe("SearchableSelect", () => {
  it("filters by substring and reports the chosen value", async () => {
    const onValueChange = vi.fn();
    render(
      <SearchableSelect
        label="记忆摘要"
        value=""
        options={OPTIONS}
        onValueChange={onValueChange}
        placeholder="未配置"
        searchPlaceholder="搜索模型"
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /记忆摘要/ }));
    await userEvent.type(screen.getByPlaceholderText("搜索模型"), "oss");

    expect(screen.queryByText("qwen3-235b")).toBeNull();
    await userEvent.click(screen.getByRole("option", { name: "gpt-oss-120b" }));

    expect(onValueChange).toHaveBeenCalledWith("gpt-oss-120b");
  });

  it("keeps a configured value visible in the closed trigger even when filtered out", () => {
    render(
      <SearchableSelect
        label="记忆摘要"
        value="qwen3-235b"
        options={OPTIONS}
        onValueChange={() => undefined}
        searchPlaceholder="搜索模型"
      />
    );

    expect(screen.getByRole("button", { name: /记忆摘要/ })).toHaveTextContent("qwen3-235b");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd App/frontend/desktop && npx vitest run src/components/tests/searchable-select.interaction.test.tsx`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现组件**

```tsx
/** Searchable select module: the long-list variant of Select for model pickers. */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import type { SelectOption } from "./Select.js";

export interface SearchableSelectProps {
  label: string;
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder: string;
  disabled?: boolean;
  className?: string;
  menuClassName?: string;
}

/** A dropdown with a filter box, for lists too long to scroll (one instance's model list). */
export function SearchableSelect(props: SearchableSelectProps) {
  const listboxId = `${useId()}-listbox`;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeValue, setActiveValue] = useState(props.value);

  const selected = props.options.find((option) => option.value === props.value);
  const enabled = useMemo(() => props.options.filter((option) => !option.disabled), [props.options]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? enabled.filter((option) => option.label.toLowerCase().includes(needle)) : enabled;
  }, [enabled, query]);

  useEffect(() => {
    if (!open) return;
    setActiveValue(props.value || enabled[0]?.value || "");
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open, props.value, enabled]);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open) return;
    const index = filtered.findIndex((option) => option.value === activeValue);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveValue(filtered[Math.min(index + 1, filtered.length - 1)]?.value ?? activeValue);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveValue(filtered[Math.max(index - 1, 0)]?.value ?? activeValue);
    } else if (event.key === "Enter" && activeValue) {
      event.preventDefault();
      choose(activeValue);
    }
  }

  function choose(value: string) {
    props.onValueChange(value);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={rootRef} className={props.className} onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-label={props.label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        disabled={props.disabled}
        onClick={() => setOpen((current) => !current)}
        className="select-trigger-custom flex w-full items-center justify-between gap-2"
      >
        <span className="truncate">{selected?.selectedLabel ?? selected?.label ?? props.placeholder ?? ""}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className={props.menuClassName} role="presentation">
          <div className="flex items-center gap-2 px-2 py-1.5">
            <Search size={12} aria-hidden="true" />
            <input
              autoFocus
              value={query}
              placeholder={props.searchPlaceholder}
              aria-label={props.searchPlaceholder}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full bg-transparent text-xs outline-none"
            />
          </div>
          <ul id={listboxId} role="listbox" aria-label={props.label}>
            {filtered.map((option) => (
              <li key={option.value} role="option" aria-selected={option.value === props.value}>
                <button
                  type="button"
                  onClick={() => choose(option.value)}
                  onMouseEnter={() => setActiveValue(option.value)}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs"
                >
                  <span className="w-3">{option.value === props.value ? <Check size={11} aria-hidden="true" /> : null}</span>
                  <span className="truncate">{option.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

> 类名以仓库现有 CSS 工具类为准（`select-control--compact` 等由 `Select` 使用）；这里用最小可用样式，实现时对齐 `Select` 的类名与尺寸（`select-control--compact select-control--subtle model-assignment-select`）。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd App/frontend/desktop && npx vitest run src/components/tests/searchable-select.interaction.test.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add App/frontend/desktop/src/components/searchable-select.tsx App/frontend/desktop/src/components/tests/searchable-select.interaction.test.tsx
git commit -m "feat(desktop): add a searchable select for long model lists"
```

---

### Task 8: workspace 选择写入：`readCuberouterSelection` + `applyCuberouterSelection` + `saveCatalogMutation`

**Files:**
- Modify: `App/frontend/desktop/src/state/model-workspace.ts`
- Modify: `App/frontend/desktop/src/state/model-provisioning.ts`
- Test: `App/frontend/desktop/src/state/tests/model-workspace.test.ts`、`App/frontend/desktop/src/state/tests/model-provisioning.test.ts`

**Interfaces:**
- Produces（Task 10/11/13 依赖）：

```ts
/** The cuberouter-managed selection, in model names (what the panel edits). */
export interface CuberouterSelection {
  agent: { models: string[]; default?: string };
  memorySummary: string;
  memoryEvolution: string;
}

export interface CuberouterSelectionInput {
  apiBase: string;
  protocol: ModelEndpointProtocol;
  /** Plaintext only when the key changed; omitted keeps the stored secret. */
  apiKey?: string;
  selection: CuberouterSelection;
}

/** Reads the current selection back out of a stored catalog (empty strings when unset). */
export function readCuberouterSelection(catalog: ModelConfigView, apiBase: string): CuberouterSelection;
/** Materializes the selection as byok presets + assignments at one endpoint. */
export function applyCuberouterSelection(workspace: ModelWorkspace, input: CuberouterSelectionInput): ModelWorkspace;
```

```ts
/** Reads the latest catalog, applies a pure mutation, saves; retries once on catalog conflicts. */
export function saveCatalogMutation(input: {
  configClient: ConfigClient;
  mutate: (workspace: ModelWorkspace) => ModelWorkspace;
}): Promise<ModelProviderConfig>;
```

- [ ] **Step 1: 写失败测试（workspace）**

`state/tests/model-workspace.test.ts` 追加：

```ts
describe("cuberouter selection", () => {
  const API_BASE = "https://cn.example/v1";

  it("materializes per-model presets with the capability of each slot they serve", () => {
    const workspace = createModelWorkspace(null);

    const next = applyCuberouterSelection(workspace, {
      apiBase: API_BASE,
      protocol: "openai-chat-completions",
      apiKey: "sk-1",
      selection: {
        agent: { models: ["a", "b"], default: "a" },
        memorySummary: "b",
        memoryEvolution: "c"
      }
    });

    const provider = next.catalog.providers.find((item) => item.provider === "openai");
    expect(provider?.endpoints[0]?.apiBase).toBe(API_BASE);
    const byModel = Object.fromEntries(
      (provider?.models ?? []).map((preset) => [preset.model, [...preset.capabilities].sort()])
    );
    expect(byModel).toEqual({
      a: ["agent"],
      b: ["agent", "memory_summary"],
      c: ["memory_evolution"]
    });
    const assignment = next.catalog.modelAssignments.byok;
    expect(assignment.agent.candidates).toHaveLength(2);
    expect(assignment.memorySummary).toBe(
      provider?.models.find((preset) => preset.model === "b")?.presetId
    );
  });

  it("keeps the stored secret when no plaintext is given, and prunes dropped models", () => {
    const first = applyCuberouterSelection(createModelWorkspace(null), {
      apiBase: API_BASE,
      protocol: "openai-chat-completions",
      apiKey: "sk-1",
      selection: { agent: { models: ["a", "b"] }, memorySummary: "a", memoryEvolution: "b" }
    });

    const second = applyCuberouterSelection(first, {
      apiBase: API_BASE,
      protocol: "openai-chat-completions",
      selection: { agent: { models: ["a"] }, memorySummary: "a", memoryEvolution: "a" }
    });

    const provider = second.catalog.providers.find((item) => item.provider === "openai");
    expect(provider?.models.map((preset) => preset.model)).toEqual(["a"]);
    expect(second.catalog.modelAssignments.byok.agent.candidates).toHaveLength(1);
  });

  it("reads the selection back out of the stored catalog", () => {
    const workspace = applyCuberouterSelection(createModelWorkspace(null), {
      apiBase: API_BASE,
      protocol: "openai-chat-completions",
      apiKey: "sk-1",
      selection: { agent: { models: ["a", "b"], default: "b" }, memorySummary: "a", memoryEvolution: "b" }
    });

    expect(readCuberouterSelection(workspace.catalog, API_BASE)).toEqual({
      agent: { models: ["a", "b"], default: "b" },
      memorySummary: "a",
      memoryEvolution: "b"
    });
    expect(readCuberouterSelection(workspace.catalog, "https://other.example/v1")).toEqual({
      agent: { models: [], default: undefined },
      memorySummary: "",
      memoryEvolution: ""
    });
  });
});
```

- [ ] **Step 2: 写失败测试（saving 通路）**

`state/tests/model-provisioning.test.ts` 追加：

```ts
describe("saveCatalogMutation", () => {
  it("re-reads and retries once when the catalog changed under it", async () => {
    const saved: any[] = [];
    const client = {
      getModelConfig: vi.fn(async () => ({ catalog: createModelWorkspace(null).catalog, configRevision: "rev-1" })),
      saveModelCatalog: vi.fn(async (input: any) => {
        saved.push(input);
        if (saved.length === 1) throw Object.assign(new Error("changed"), { code: "model_config_changed" });
        return { catalog: createModelWorkspace(null).catalog, configRevision: "rev-2" };
      })
    };

    await saveCatalogMutation({
      configClient: client as any,
      mutate: (workspace) => applyCuberouterSelection(workspace, {
        apiBase: "https://cn.example/v1",
        protocol: "openai-chat-completions",
        apiKey: "sk-1",
        selection: { agent: { models: ["a"] }, memorySummary: "a", memoryEvolution: "a" }
      })
    });

    expect(client.saveModelCatalog).toHaveBeenCalledTimes(2);
    expect(client.getModelConfig).toHaveBeenCalledTimes(2);
  });
});
```

（`getModelConfig` 两次：每次尝试各读一次最新目录。）

- [ ] **Step 3: 跑测试确认失败**

Run: `cd App/frontend/desktop && npx vitest run src/state/tests/model-workspace.test.ts src/state/tests/model-provisioning.test.ts`
Expected: FAIL — `applyCuberouterSelection is not a function`。

- [ ] **Step 4: 实现 workspace 函数**

`state/model-workspace.ts` 追加（放在 `upsertByokPreset` 附近；`newClientPresetId`、`pruneInvalidAssignmentReferences`、`refreshEffectiveCandidates`、`toCatalogCapability`、`visiblePresets` 都是本文件已有私有工具）：

```ts
/** The cuberouter-managed selection, in model names (what the panel edits). */
export interface CuberouterSelection {
  agent: { models: string[]; default?: string };
  memorySummary: string;
  memoryEvolution: string;
}

export interface CuberouterSelectionInput {
  apiBase: string;
  protocol: ModelEndpointProtocol;
  /** Plaintext only when the key changed; omitted keeps the stored secret. */
  apiKey?: string;
  selection: CuberouterSelection;
}

/** Reads the current selection back out of a stored catalog (empty when unset). */
export function readCuberouterSelection(catalog: ModelConfigView, apiBase: string): CuberouterSelection {
  const normalized = apiBase.trim().replace(/\/+$/, "");
  const provider = catalog.providers.find((item) => !item.accountManaged);
  const endpoint = provider?.endpoints.find((item) => item.apiBase.replace(/\/+$/, "") === normalized);
  // Presets carry endpointId, not apiBase: the endpoint lookup is what pins them to this line.
  const presets = (provider?.models ?? []).filter((preset) => (
    preset.source === "byok" && endpoint !== undefined && preset.endpointId === endpoint.endpointId
  ));
  const modelOf = (presetId: string | undefined) => presets.find((preset) => preset.presetId === presetId)?.model ?? "";
  const assignment = catalog.modelAssignments.byok;
  const agentModels = assignment.agent.candidates
    .map((presetId) => modelOf(presetId))
    .filter(Boolean);
  const agentDefault = modelOf(assignment.agent.default ?? undefined);
  return {
    agent: { models: agentModels, ...(agentDefault ? { default: agentDefault } : {}) },
    memorySummary: modelOf(assignment.memorySummary ?? undefined),
    memoryEvolution: modelOf(assignment.memoryEvolution ?? undefined)
  };
}
```

```ts
/**
 * Materializes one cuberouter selection at one endpoint: a byok preset per distinct model (its
 * capabilities are the slots it serves), the assignments pointing at them, and a prune of the
 * endpoint's presets the selection no longer uses.
 */
export function applyCuberouterSelection(workspace: ModelWorkspace, input: CuberouterSelectionInput): ModelWorkspace {
  const providerId = normalizeProvider("openai")!;
  const apiBase = input.apiBase.trim().replace(/\/+$/, "");
  if (!isHttpUrl(apiBase)) throw new Error("invalid cuberouter endpoint");
  const selection = input.selection;
  const slots: Array<{ capability: "agent" | "memory_summary" | "memory_evolution"; models: string[] }> = [
    { capability: "agent", models: unique(selection.agent.models.map((model) => model.trim()).filter(Boolean)) },
    { capability: "memory_summary", models: selection.memorySummary.trim() ? [selection.memorySummary.trim()] : [] },
    { capability: "memory_evolution", models: selection.memoryEvolution.trim() ? [selection.memoryEvolution.trim()] : [] }
  ];

  const next = cloneCatalog(workspace.catalog);
  let provider = next.providers.find((item) => item.provider === providerId && !item.accountManaged);
  if (!provider) {
    if (!input.apiKey) throw new Error("cuberouter endpoint has no credential yet");
    provider = {
      provider: providerId,
      configured: true,
      hasApiKey: true,
      apiKeyMasked: maskApiKey(input.apiKey),
      apiKey: "",
      endpoints: [],
      accountManaged: false,
      editable: true,
      models: []
    };
    next.providers.push(provider);
  }
  let endpoint = provider.endpoints.find((item) => item.apiBase.replace(/\/+$/, "") === apiBase);
  if (!endpoint) {
    if (!input.apiKey) throw new Error("cuberouter endpoint has no credential yet");
    endpoint = {
      endpointId: newId("endpoint"),
      apiBase,
      protocol: input.protocol,
      hasApiKey: true,
      apiKeyMasked: maskApiKey(input.apiKey),
      apiKey: input.apiKey
    };
    provider.endpoints.push(endpoint);
  } else if (input.apiKey) {
    endpoint.apiKey = input.apiKey;
    endpoint.apiKeyMasked = maskApiKey(input.apiKey);
    endpoint.hasApiKey = true;
  }

  // One preset per model, carrying every slot it serves.
  const capabilitiesByModel = new Map<string, Set<CatalogCapability>>();
  for (const slot of slots) {
    for (const model of slot.models) {
      const set = capabilitiesByModel.get(model) ?? new Set<CatalogCapability>();
      set.add(slot.capability);
      capabilitiesByModel.set(model, set);
    }
  }
  const keepPresetIds = new Set<string>();
  const presetIdByModel = new Map<string, string>();
  for (const [model, capabilities] of capabilitiesByModel) {
    const existing = provider.models.find((item) => item.source === "byok" && item.model === model);
    const presetId = existing?.presetId ?? newClientPresetId();
    const preset = {
      presetId,
      provider: providerId,
      endpointId: endpoint.endpointId,
      protocol: input.protocol,
      model,
      source: "byok" as const,
      capabilities: [...capabilities].sort() as CatalogCapability[],
      available: true
    };
    if (existing) Object.assign(existing, preset);
    else provider.models.push(preset);
    keepPresetIds.add(presetId);
    presetIdByModel.set(model, presetId);
  }
  provider.models = provider.models.filter((item) => (
    item.endpointId !== endpoint!.endpointId
    || item.source !== "byok"
    || keepPresetIds.has(item.presetId)
  ));

  const assignment = next.modelAssignments.byok;
  const agentIds = slots[0]!.models.flatMap((model) => presetIdByModel.get(model) ?? []);
  assignment.agent.candidates = agentIds;
  const defaultModel = selection.agent.default?.trim();
  assignment.agent.default = defaultModel && presetIdByModel.has(defaultModel)
    ? presetIdByModel.get(defaultModel)!
    : agentIds[0] ?? null;
  assignment.memorySummary = presetIdByModel.get(selection.memorySummary.trim()) ?? null;
  assignment.memoryEvolution = presetIdByModel.get(selection.memoryEvolution.trim()) ?? null;
  pruneInvalidAssignmentReferences(assignment, keepPresetIds);
  refreshEffectiveCandidates(next);
  return createModelWorkspace(next);
}
```

- [ ] **Step 5: 实现 `saveCatalogMutation`**

`state/model-provisioning.ts` 追加导出（**不动 `provisionByokModel`**——它在 Task 13 被 `provisionCuberouterKey` 整体取代，此处重构它是白费力气）：

```ts
/** Reads the latest catalog, applies a pure mutation, saves; retries once on catalog conflicts. */
export async function saveCatalogMutation(input: {
  configClient: ConfigClient;
  mutate: (workspace: ModelWorkspace) => ModelWorkspace;
}): Promise<ModelProviderConfig> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const latest = await input.configClient.getModelConfig();
    const next = input.mutate(createModelWorkspace(latest));
    try {
      return await input.configClient.saveModelCatalog(modelConfigInput(next));
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : undefined;
      if (code !== "model_config_changed" && code !== "config_write_busy") throw error;
      lastError = error;
    }
  }
  throw lastError ?? new Error("unreachable: saveCatalogMutation retried without resolving");
}
```

- [ ] **Step 6: 跑测试**

Run: `cd App/frontend/desktop && npx vitest run src/state/tests/model-workspace.test.ts src/state/tests/model-provisioning.test.ts`
Expected: 新用例 PASS，既有 `provisionByokModel` 用例不受影响。

- [ ] **Step 7: Commit**

```bash
git add App/frontend/desktop/src/state/model-workspace.ts App/frontend/desktop/src/state/model-provisioning.ts App/frontend/desktop/src/state/tests
git commit -m "feat(desktop): write a cuberouter key and model selection into the byok catalog"
```

---

### Task 9: 选择记录 `cuberouter-key-selection`

**Files:**
- Create: `App/frontend/desktop/src/state/cuberouter-key-selection.ts`
- Test: `App/frontend/desktop/src/state/tests/cuberouter-key-selection.test.ts`（新建）

**Interfaces:**
- Produces（Task 10/13 依赖）：

```ts
export const CUBEROUTER_KEY_SELECTION_STORAGE_KEY = "memmy.cuberouterKeySelection.v1";
export interface CuberouterKeySelection {
  username: string;
  scope: "organization" | "personal";
  id: number;
  name: string;
}
export function readCuberouterKeySelection(username: string, storage?: Pick<Storage, "getItem">): CuberouterKeySelection | null;
export function writeCuberouterKeySelection(selection: CuberouterKeySelection, storage?: Pick<Storage, "getItem" | "setItem">): void;
export function clearCuberouterKeySelection(username: string, storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">): void;
/** The renderer's localStorage, or undefined when unavailable (tests, private windows). */
export function cuberouterKeySelectionStorage(): Storage | undefined;
```

- [ ] **Step 1: 写失败测试**

```ts
/** Cuberouter key selection record tests. */
import { describe, expect, it } from "vitest";
import {
  CUBEROUTER_KEY_SELECTION_STORAGE_KEY,
  clearCuberouterKeySelection,
  readCuberouterKeySelection,
  writeCuberouterKeySelection
} from "../cuberouter-key-selection.js";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    raw: map
  };
}

describe("cuberouter key selection", () => {
  it("round-trips one selection per username", () => {
    const storage = memoryStorage();
    writeCuberouterKeySelection({ username: "alice@a.com", scope: "personal", id: 41, name: "my-key" }, storage);
    writeCuberouterKeySelection({ username: "bob@a.com", scope: "organization", id: 11, name: "cuby-desktop-bob" }, storage);

    expect(readCuberouterKeySelection("alice@a.com", storage)).toEqual({
      username: "alice@a.com",
      scope: "personal",
      id: 41,
      name: "my-key"
    });
    expect(readCuberouterKeySelection("bob@a.com", storage)).toEqual({
      username: "bob@a.com",
      scope: "organization",
      id: 11,
      name: "cuby-desktop-bob"
    });
    expect(readCuberouterKeySelection("carol@a.com", storage)).toBeNull();
  });

  it("ignores a corrupted record instead of throwing", () => {
    const storage = memoryStorage();
    storage.raw.set(CUBEROUTER_KEY_SELECTION_STORAGE_KEY, "{not json");

    expect(readCuberouterKeySelection("alice@a.com", storage)).toBeNull();
  });

  it("clears only the named username", () => {
    const storage = memoryStorage();
    writeCuberouterKeySelection({ username: "alice@a.com", scope: "personal", id: 41, name: "my-key" }, storage);
    writeCuberouterKeySelection({ username: "bob@a.com", scope: "personal", id: 42, name: "bobs-key" }, storage);

    clearCuberouterKeySelection("alice@a.com", storage);

    expect(readCuberouterKeySelection("alice@a.com", storage)).toBeNull();
    expect(readCuberouterKeySelection("bob@a.com", storage)?.name).toBe("bobs-key");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd App/frontend/desktop && npx vitest run src/state/tests/cuberouter-key-selection.test.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**（照 `pages/model-workspace-connection-test-state.ts` 的写法：容错读、吞掉写失败）

```ts
/**
 * Which cuberouter key this machine last selected for its model config, per username. The model
 * config itself only holds the secret; this record is what lets the panel name the selected key
 * and the login flow keep it instead of re-provisioning over it.
 */

export const CUBEROUTER_KEY_SELECTION_STORAGE_KEY = "memmy.cuberouterKeySelection.v1";

export interface CuberouterKeySelection {
  username: string;
  scope: "organization" | "personal";
  id: number;
  name: string;
}

type StoredSelections = Record<string, CuberouterKeySelection>;

export function readCuberouterKeySelection(
  username: string,
  storage?: Pick<Storage, "getItem">
): CuberouterKeySelection | null {
  return readSelections(storage)[username.trim()] ?? null;
}

export function writeCuberouterKeySelection(
  selection: CuberouterKeySelection,
  storage?: Pick<Storage, "getItem" | "setItem">
): void {
  if (!storage) return;
  const selections = readSelections(storage);
  selections[selection.username.trim()] = { ...selection, username: selection.username.trim() };
  try {
    storage.setItem(CUBEROUTER_KEY_SELECTION_STORAGE_KEY, JSON.stringify(selections));
  } catch {
    // Losing the record costs a re-provision at the next login; it must never block a save.
  }
}

export function clearCuberouterKeySelection(
  username: string,
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">
): void {
  if (!storage) return;
  const selections = readSelections(storage);
  if (!(username.trim() in selections)) return;
  delete selections[username.trim()];
  try {
    if (Object.keys(selections).length > 0) {
      storage.setItem(CUBEROUTER_KEY_SELECTION_STORAGE_KEY, JSON.stringify(selections));
    } else {
      storage.removeItem(CUBEROUTER_KEY_SELECTION_STORAGE_KEY);
    }
  } catch {
    // Same as above: the record is an optimization, not state the app depends on.
  }
}

/** The renderer's localStorage, or undefined when unavailable (tests, private windows). */
export function cuberouterKeySelectionStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function readSelections(storage?: Pick<Storage, "getItem">): StoredSelections {
  try {
    const raw = storage?.getItem(CUBEROUTER_KEY_SELECTION_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([username, value]) => (
      isSelection(value) ? [[username, value as CuberouterKeySelection]] : []
    )));
  } catch {
    return {};
  }
}

function isSelection(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<CuberouterKeySelection>;
  return typeof candidate.username === "string"
    && (candidate.scope === "organization" || candidate.scope === "personal")
    && typeof candidate.id === "number"
    && typeof candidate.name === "string";
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd App/frontend/desktop && npx vitest run src/state/tests/cuberouter-key-selection.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add App/frontend/desktop/src/state/cuberouter-key-selection.ts App/frontend/desktop/src/state/tests/cuberouter-key-selection.test.ts
git commit -m "feat(desktop): remember which cuberouter key this machine selected"
```

---

### Task 10: `CuberouterModelSection`：骨架 + key 卡 + 设置页接线

**Files:**
- Create: `App/frontend/desktop/src/pages/cuberouter-model-section.tsx`
- Modify: `App/frontend/desktop/src/pages/settings-page.tsx`（接线）
- Modify: `App/frontend/desktop/src/i18n/messages.ts`（zh + en）
- Test: `App/frontend/desktop/src/pages/tests/cuberouter-model-section.interaction.test.tsx`（新建）、`App/frontend/desktop/src/pages/tests/settings-page.test.tsx`（追加一条）

**Interfaces:**
- Consumes: Task 4（`accountClient.getModelChoices` / `revealPersonalKey`）、Task 8（`applyCuberouterSelection` / `readCuberouterSelection` / `saveCatalogMutation`）、Task 9（记录）。
- Produces（Task 11/12 依赖）：

```ts
export interface CuberouterModelSectionProps {
  username: string | null;
  organizationName: string | null;
  seedConfig?: ModelProviderConfig | null;
  configClient?: Pick<ConfigClient, "getModelConfig" | "saveModelCatalog" | "testModelConfig">;
  accountClient?: Pick<AccountClient, "getModelChoices" | "revealPersonalKey">;
  onConfigSaved?: (config: ModelProviderConfig) => void;
}
export function CuberouterModelSection(props: CuberouterModelSectionProps): ReactNode;
```

- [ ] **Step 1: 加 i18n 键（zh 块与 en 块同键）**

zh（`settings.modelWorkspace.*` 一带）：

```ts
  "settings.cuberouterModel.keysTitle": "API Key",
  "settings.cuberouterModel.keysHint": "选择用于模型调用的 key；每行标注计费主体与剩余额度。",
  "settings.cuberouterModel.billingPersonal": "计费：个人",
  "settings.cuberouterModel.billingOrganization": "计费：组织 {name}",
  "settings.cuberouterModel.remaining": "剩余 {amount}",
  "settings.cuberouterModel.balanceUnknown": "余额不可用",
  "settings.cuberouterModel.statusDisabled": "已停用",
  "settings.cuberouterModel.statusExpired": "已过期",
  "settings.cuberouterModel.statusExhausted": "额度耗尽",
  "settings.cuberouterModel.keyMissing": "原 key 已失效，请重新选择。",
  "settings.cuberouterModel.refreshKeys": "重新获取 key",
  "settings.cuberouterModel.loadFailed": "模型配置数据加载失败，请重试。",
  "settings.cuberouterModel.retry": "重试",
  "settings.cuberouterModel.advanced": "高级",
  "settings.cuberouterModel.modelsGroup": "cuberouter 模型",
  "settings.cuberouterModel.searchModels": "搜索模型",
  "settings.cuberouterModel.embeddingBuiltin": "本地向量模型（内建）",
  "settings.cuberouterModel.noModels": "实例未返回可选模型。",
```

en 块对应英文（`"settings.cuberouterModel.keysTitle": "API key"` 等）。

- [ ] **Step 2: 写失败测试（面板）**

```tsx
/** Cuberouter model section tests. */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createModelWorkspace } from "../../state/model-workspace.js";
import { CuberouterModelSection } from "../cuberouter-model-section.js";

const CHOICES = {
  account: { username: "alice@a.com", organizationName: "yeebo" },
  apiBase: "https://cn.example/v1",
  keys: [
    {
      scope: "organization",
      id: 11,
      name: "cuby-desktop-alice",
      secret: "sk-org",
      status: 1,
      usable: true,
      billing: { kind: "organization", organizationName: "yeebo", remainingQuota: 97500 }
    },
    {
      scope: "personal",
      id: 41,
      name: "my-own-key",
      status: 2,
      usable: false,
      billing: { kind: "personal", remainingQuota: 100 }
    }
  ],
  models: ["deepseek-v4.1-flash", "gpt-oss-120b"]
};

function renderSection(input: {
  choices?: () => Promise<typeof CHOICES>;
  reveal?: (tokenId: number) => Promise<{ key: string }>;
  save?: (payload: unknown) => Promise<{ catalog: unknown; configRevision: string }>;
} = {}) {
  const accountClient = {
    getModelChoices: vi.fn(input.choices ?? (async () => CHOICES)),
    revealPersonalKey: vi.fn(input.reveal ?? (async () => ({ key: "sk-personal" })))
  };
  const configClient = {
    getModelConfig: vi.fn(async () => ({ catalog: createModelWorkspace(null).catalog, configRevision: "rev-1" })),
    saveModelCatalog: vi.fn(input.save ?? (async () => ({
      catalog: createModelWorkspace(null).catalog,
      configRevision: "rev-2"
    }))),
    testModelConfig: vi.fn(async () => ({ ok: true, message: "" }))
  };
  render(
    <CuberouterModelSection
      username="alice@a.com"
      organizationName="yeebo"
      configClient={configClient as never}
      accountClient={accountClient as never}
    />
  );
  return { accountClient, configClient };
}

describe("cuberouter model section", () => {
  it("lists my keys with their billing and balance, disabling unusable rows", async () => {
    renderSection();

    expect(await screen.findByText("cuby-desktop-alice")).toBeInTheDocument();
    expect(screen.getByText(/计费：组织 yeebo/)).toBeInTheDocument();
    expect(screen.getByText(/剩余 97500/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /my-own-key/ })).toBeDisabled();
  });

  it("reveals a personal key on selection and writes it into the model config", async () => {
    const { accountClient, configClient } = renderSection({
      choices: async () => ({
        ...CHOICES,
        keys: [{ ...CHOICES.keys[1]!, status: 1, usable: true }]
      })
    });

    await userEvent.click(await screen.findByRole("radio", { name: /my-own-key/ }));

    expect(accountClient.revealPersonalKey).toHaveBeenCalledWith(41);
    expect(configClient.saveModelCatalog).toHaveBeenCalled();
    const written = configClient.saveModelCatalog.mock.calls[0]![0];
    expect(JSON.stringify(written)).toContain("sk-personal");
  });

  it("shows a retry state when the choices request fails", async () => {
    renderSection({ choices: async () => { throw new Error("boom"); } });

    expect(await screen.findByText(/加载失败/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重试/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd App/frontend/desktop && npx vitest run src/pages/tests/cuberouter-model-section.interaction.test.tsx`
Expected: FAIL — 模块不存在。

- [ ] **Step 4: 实现面板骨架与 key 卡**

`pages/cuberouter-model-section.tsx`：

```tsx
/** cuberouter model configuration section module. */
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { CuberouterKeyOption, CuberouterModelChoicesView } from "@memmy/local-api-contracts";
import type { AccountClient } from "../api/account-client.js";
import type { ConfigClient, ModelProviderConfig } from "../api/config-client.js";
import { Button } from "../components/button.js";
import type { MessageKey } from "../i18n/messages.js";
import { useTranslation } from "../i18n/use-translation.js";
import {
  applyCuberouterSelection,
  createModelWorkspace,
  readCuberouterSelection,
  type CuberouterSelection,
  type ModelWorkspace
} from "../state/model-workspace.js";
import { saveCatalogMutation } from "../state/model-provisioning.js";
import {
  cuberouterKeySelectionStorage,
  readCuberouterKeySelection,
  writeCuberouterKeySelection
} from "../state/cuberouter-key-selection.js";

const PROTOCOL = "openai-chat-completions" as const;

export interface CuberouterModelSectionProps {
  username: string | null;
  organizationName: string | null;
  seedConfig?: ModelProviderConfig | null;
  configClient?: Pick<ConfigClient, "getModelConfig" | "saveModelCatalog" | "testModelConfig">;
  accountClient?: Pick<AccountClient, "getModelChoices" | "revealPersonalKey">;
  onConfigSaved?: (config: ModelProviderConfig) => void;
}

export function CuberouterModelSection(props: CuberouterModelSectionProps) {
  const { t } = useTranslation();
  const [choices, setChoices] = useState<CuberouterModelChoicesView | null>(null);
  const [choicesFailed, setChoicesFailed] = useState(false);
  const [workspace, setWorkspace] = useState<ModelWorkspace>(() => createModelWorkspace(props.seedConfig));
  /** The draft the panel edits; seeded from the stored catalog once the line's apiBase is known. */
  const [selection, setSelection] = useState<CuberouterSelection | null>(null);
  const [pendingKeyId, setPendingKeyId] = useState<string | null>(null);
  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadChoices = useCallback(() => {
    setChoices(null);
    setChoicesFailed(false);
    if (!props.accountClient) return;
    void props.accountClient.getModelChoices().then(setChoices).catch(() => setChoicesFailed(true));
  }, [props.accountClient]);

  useEffect(() => { loadChoices(); }, [loadChoices]);
  useEffect(() => { setWorkspace(createModelWorkspace(props.seedConfig)); }, [props.seedConfig]);
  useEffect(() => {
    if (!choices || selection !== null) return;
    setSelection(readCuberouterSelection(createModelWorkspace(props.seedConfig).catalog, choices.apiBase));
  }, [choices, selection, props.seedConfig]);

  const record = props.username ? readCuberouterKeySelection(props.username, cuberouterKeySelectionStorage()) : null;
  const selectedKey = record && choices
    ? choices.keys.find((key) => key.scope === record.scope && key.id === record.id && key.usable) ?? null
    : null;

  /** Saves one mutation built from the current draft, refreshing the workspace on success. */
  async function commit(mutate: (current: ModelWorkspace, apiBase: string) => ModelWorkspace): Promise<void> {
    if (!props.configClient || !choices) return;
    setSavePending(true);
    setSaveError(null);
    try {
      const saved = await saveCatalogMutation({
        configClient: props.configClient,
        mutate: (current) => mutate(current, choices.apiBase)
      });
      setWorkspace(createModelWorkspace(saved));
      props.onConfigSaved?.(saved);
    } catch {
      setSaveError(t("settings.modelWorkspace.saveFailed"));
    } finally {
      setSavePending(false);
    }
  }

  /** Applies one key: personal keys are revealed on demand, organization ones ship their secret. */
  async function selectKey(key: CuberouterKeyOption): Promise<void> {
    if (!props.username || !selection) return;
    const id = `${key.scope}:${key.id}`;
    setPendingKeyId(id);
    try {
      const plaintext = key.secret ?? (await props.accountClient!.revealPersonalKey(key.id)).key;
      await commit((current, apiBase) => applyCuberouterSelection(current, {
        apiBase,
        protocol: PROTOCOL,
        apiKey: plaintext,
        selection
      }));
      writeCuberouterKeySelection(
        { username: props.username!, scope: key.scope, id: key.id, name: key.name },
        cuberouterKeySelectionStorage()
      );
    } catch {
      setSaveError(t("settings.modelWorkspace.saveFailed"));
    } finally {
      setPendingKeyId(null);
    }
  }

  /** Task 13 接线：重新走一次登录时的 find-or-create（`provisionCuberouterKey({ …, keepSelection: false })`）。 */
  function onRefreshKeys(): void {
    // 见 Task 13。
  }

  if (choicesFailed) {
    return (
      <div className="model-workspace-layout">
        <p className="text-xs text-text-ink/60">{t("settings.cuberouterModel.loadFailed")}</p>
        <Button type="button" size="sm" variant="secondary" onClick={loadChoices}>
          {t("settings.cuberouterModel.retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="model-workspace-layout" aria-busy={savePending || !choices}>
      <p className="text-sm text-text-ink/80">
        {props.username}{props.organizationName ? ` (${props.organizationName})` : ""}
      </p>

      <section className="mt-6">
        <h3 className="text-sm font-semibold text-text-ink">{t("settings.cuberouterModel.keysTitle")}</h3>
        <p className="mt-1 text-xs leading-relaxed text-text-ink/45">
          {t("settings.cuberouterModel.keysHint")}
        </p>
        <div className="mt-3 space-y-2">
          {(choices?.keys ?? []).map((key) => (
            <div key={`${key.scope}:${key.id}`} className="flex items-center gap-3">
              <input
                type="radio"
                name="cuberouter-key"
                aria-label={key.name}
                checked={selectedKey?.scope === key.scope && selectedKey.id === key.id}
                disabled={!key.usable || pendingKeyId !== null || savePending}
                onChange={() => void selectKey(key)}
              />
              <span className="min-w-0 flex-1 truncate text-sm text-text-ink/80">{key.name}</span>
              <span className="shrink-0 text-xs text-text-ink/50">
                {key.billing.kind === "personal"
                  ? t("settings.cuberouterModel.billingPersonal")
                  : t("settings.cuberouterModel.billingOrganization", { name: key.billing.organizationName })}
                {" · "}
                {key.billing.remainingQuota === null
                  ? t("settings.cuberouterModel.balanceUnknown")
                  : t("settings.cuberouterModel.remaining", { amount: String(key.billing.remainingQuota) })}
              </span>
              {key.status !== undefined && key.status !== 1 && (
                <span className="shrink-0 rounded-tag bg-canvas-oat px-2 py-0.5 text-[10px] text-text-ink/50">
                  {t(statusMessageKey(key.status))}
                </span>
              )}
            </div>
          ))}
        </div>
        {choices && record && !selectedKey && (
          <div className="mt-3 flex items-center gap-3">
            <p className="text-xs text-text-ink/60">{t("settings.cuberouterModel.keyMissing")}</p>
            <Button type="button" size="sm" variant="secondary" onClick={onRefreshKeys}>
              <RefreshCw size={13} aria-hidden="true" />
              {t("settings.cuberouterModel.refreshKeys")}
            </Button>
          </div>
        )}
      </section>

      {saveError && <p className="mt-3 text-xs text-text-ink/60">{saveError}</p>}
      {/* Task 11 在其后渲染 <ModelAssignmentSection …/>；Task 12 再加「高级」折叠。 */}
    </div>
  );
}

/** The status badge message for one instance token state. */
function statusMessageKey(status: number): MessageKey {
  if (status === 2) return "settings.cuberouterModel.statusDisabled";
  if (status === 3) return "settings.cuberouterModel.statusExpired";
  return "settings.cuberouterModel.statusExhausted";
}
```

要点（与本任务测试对应）：

- 挂载即拉 choices；失败 → 错误态 + 「重试」走同一函数。
- 选中行 = 记录命中且该 key `usable`；`usable === false` 的 radio 禁用、状态徽标按 `status` 文案。
- 换 key 走 `selectKey` → 取明文（personal 才 reveal）→ `commit`（`saveCatalogMutation` + `applyCuberouterSelection`）→ 写记录；「高级」（Task 12）与分配（Task 11）复用同一个 `commit`。
- 「重新获取 key」按钮在本任务渲染、在 Task 13 接线。

- [ ] **Step 5: 设置页接线**

`settings-page.tsx`：在 `state.account.identityProvider === "cuberouter"` 时渲染新面板，否则维持现状：

```tsx
        <div id="model-config">
          {state.account.identityProvider === "cuberouter" ? (
            <CuberouterModelSection
              username={state.account.username}
              organizationName={state.account.organizationName}
              seedConfig={state.modelConfig}
              configClient={configClient}
              accountClient={clients?.account}
              onConfigSaved={(saved) => dispatch(appActions.modelConfigUpdated(saved))}
            />
          ) : (
            <ModelWorkspaceSection …（现有 props 原样） />
          )}
        </div>
```

- [ ] **Step 6: 跑测试**

Run: `cd App/frontend/desktop && npx vitest run src/pages/tests/cuberouter-model-section.interaction.test.tsx src/pages/tests/settings-page.test.tsx`
Expected: PASS（settings-page 追加用例：cuberouter 身份渲染 key 卡、非 cuberouter 身份仍渲染模型库）。

- [ ] **Step 7: Commit**

```bash
git add App/frontend/desktop/src/pages/cuberouter-model-section.tsx App/frontend/desktop/src/pages/settings-page.tsx App/frontend/desktop/src/i18n/messages.ts App/frontend/desktop/src/pages/tests
git commit -m "feat(desktop): give cuberouter identities their own model section with key picking"
```

---

### Task 11: `CuberouterModelSection`：模型分配（复用 + 可搜索下拉）

**Files:**
- Modify: `App/frontend/desktop/src/pages/cuberouter-model-section.tsx`
- Modify: `App/frontend/desktop/src/pages/model-assignment-section.tsx`（加 `searchable`）
- Test: `App/frontend/desktop/src/pages/tests/cuberouter-model-section.interaction.test.tsx`（追加）

**Interfaces:**
- Consumes: Task 5（`ModelAssignmentSection`）、Task 7（`SearchableSelect`）、Task 8（`readCuberouterSelection` / `applyCuberouterSelection`）。
- Produces: `ModelAssignmentRowSpec.searchable?: boolean`（Task 5 的类型上新增字段 + `AssignmentRow` 分支）。

- [ ] **Step 1: 写失败测试**

```tsx
  it("assigns instance models per slot and writes presets for each used model", async () => {
    const { configClient } = renderSection();

    await userEvent.click(await screen.findByRole("radio", { name: /cuby-desktop-alice/ }));
    await userEvent.click(screen.getByRole("button", { name: /Agent 任务模型/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /gpt-oss-120b/ }));
    await userEvent.click(screen.getByRole("button", { name: /记忆摘要/ }));
    await userEvent.type(screen.getByPlaceholderText("搜索模型"), "deepseek");
    await userEvent.click(screen.getByRole("option", { name: "deepseek-v4.1-flash" }));

    const written = configClient.saveModelCatalog.mock.calls.at(-1)![0];
    const models = written.providers[0].models.map((preset: any) => preset.model).sort();
    expect(models).toEqual(["deepseek-v4.1-flash", "gpt-oss-120b"]);
  });

  it("shows the built-in local embedding row without offering other choices", async () => {
    renderSection();

    expect(await screen.findByText("本地向量模型（内建）")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ASR/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /生图/ })).toBeNull();
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd App/frontend/desktop && npx vitest run src/pages/tests/cuberouter-model-section.interaction.test.tsx`
Expected: FAIL — 分配区未渲染。

- [ ] **Step 3: `AssignmentRow` 支持 `searchable`**

`model-assignment-section.tsx`：`ModelAssignmentRowSpec` 加 `searchable?: boolean`；`AssignmentRow` 的下拉渲染改为：

```tsx
      {props.searchable ? (
        <SearchableSelect
          label={t("settings.modelWorkspace.chooseFor", { feature: props.label })}
          value={value}
          placeholder={t("settings.modelWorkspace.notConfigured")}
          searchPlaceholder={t("settings.cuberouterModel.searchModels")}
          options={props.options}
          onValueChange={(next) => props.onChange(props.kind, next)}
          disabled={props.options.length === 0}
          className="select-control--compact select-control--subtle model-assignment-select"
          menuClassName="model-assignment-select__menu"
        />
      ) : (
        <Select …（原样） />
      )}
```

- [ ] **Step 4: 面板渲染分配区**

`cuberouter-model-section.tsx`：把 Task 10 的占位 `div#cuberouter-assignments` 换成：

```tsx
      <ModelAssignmentSection
        conversationGroups={models.length > 0 ? [{
          key: "cuberouter",
          title: t("settings.cuberouterModel.modelsGroup"),
          icon: <ModelProviderLogo provider="openai" size={14} />,
          candidates: models.map((model) => ({ id: model, label: model, detail: t("settings.cuberouterModel.modelsGroup") }))
        }] : []}
        selectedCandidateIds={selection.agent.models}
        defaultCandidateId={selection.agent.default ?? null}
        onToggleCandidate={(model) => updateSelection({ agent: toggleAgentModel(selection.agent, model) })}
        onChooseDefaultCandidate={(model) => updateSelection({ agent: { ...selection.agent, default: model } })}
        rows={[
          { kind: "memorySummary", label: t("settings.model.memorySummary"), description: t("settings.model.memoryDesc"), tip: t("apiKey.modelPage.memoryHint"), value: selection.memorySummary, options: modelOptions, searchable: true, preserveUnassigned: true },
          { kind: "memoryEvolution", label: t("settings.model.skillEvolution"), description: t("settings.model.skillDesc"), value: selection.memoryEvolution, options: modelOptions, searchable: true, preserveUnassigned: true }
        ]}
        onRowChange={(kind, value) => updateSelection(kind === "memorySummary" ? { memorySummary: value } : { memoryEvolution: value })}
      />
      {/* 只读一行：本地向量模型（内建） */}
```

配套的手（`cuberouter-model-section.tsx` 内，`toggleAgentModel` 导出以便单测）：

```tsx
  /** Applies one assignment change: draft first, then the panel's shared save path. */
  function updateSelection(patch: Partial<CuberouterSelection>): void {
    if (!selection) return;
    const next = { ...selection, ...patch };
    setSelection(next);
    void commit((current, apiBase) => applyCuberouterSelection(current, {
      apiBase,
      protocol: PROTOCOL,
      selection: next
    }));
  }

  const models = choices?.models ?? [];
  const modelOptions = models.map((model) => ({ value: model, label: model }));

/** Toggles one conversation model, keeping at least one selected (the picker's own rule). */
export function toggleAgentModel(
  agent: CuberouterSelection["agent"],
  model: string
): CuberouterSelection["agent"] {
  const models = agent.models.includes(model)
    ? agent.models.filter((item) => item !== model)
    : [...agent.models, model];
  const next: CuberouterSelection["agent"] = {
    models: models.length > 0 ? models : agent.models,
    ...(agent.default ? { default: agent.default } : {})
  };
  if (next.default && !next.models.includes(next.default)) {
    next.default = next.models[0];
  }
  return next;
}
```

「实例未返回可选模型」时对话区显示 `settings.cuberouterModel.noModels`、记忆两行 `disabled`（`options` 为空即禁用）。**只读 embedding 行不走 `AssignmentRow`**（它的下拉在没有选项时会显示「未配置」），直接渲染一行文本：

```tsx
      <div className="flex items-center justify-between gap-4 px-3.5 py-2.5">
        <span className="text-sm text-text-ink/80">{t("settings.model.embeddingSearch")}</span>
        <span className="text-xs text-text-ink/50">{t("settings.cuberouterModel.embeddingBuiltin")}</span>
      </div>
```

写入时 `applyCuberouterSelection` 不碰 `modelAssignments.byok.embedding`，保持 memmy 现有的内建本地缺省（`BUILTIN_LOCAL_EMBEDDING_ASSIGNMENT_ID`）。

- [ ] **Step 5: 跑测试**

Run: `cd App/frontend/desktop && npx vitest run src/pages/tests/cuberouter-model-section.interaction.test.tsx src/pages/tests/settings-page.test.tsx src/components/tests/searchable-select.interaction.test.tsx`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add App/frontend/desktop/src/pages/cuberouter-model-section.tsx App/frontend/desktop/src/pages/model-assignment-section.tsx App/frontend/desktop/src/pages/tests
git commit -m "feat(desktop): pick cuberouter models through the assignment rows"
```

---

### Task 12: `CuberouterModelSection`：「高级」折叠（通用连接库）与共用保存

**Files:**
- Modify: `App/frontend/desktop/src/pages/cuberouter-model-section.tsx`
- Test: `App/frontend/desktop/src/pages/tests/cuberouter-model-section.interaction.test.tsx`（追加）

**Interfaces:**
- Consumes: Task 6（`ModelLibrarySection`）。
- Produces: 无新接口。

- [ ] **Step 1: 写失败测试**

```tsx
  it("keeps the generic library behind an advanced fold, sharing the same save path", async () => {
    const { configClient } = renderSection();

    const advanced = await screen.findByRole("button", { name: /高级/ });
    expect(screen.queryByRole("button", { name: /添加连接/ })).toBeNull();

    await userEvent.click(advanced);

    expect(screen.getByRole("button", { name: /添加连接/ })).toBeInTheDocument();
    // 「高级」里的连接编辑与 key/分配共用同一份 workspace：一次保存带上整份目录。
    await userEvent.click(screen.getByRole("button", { name: /添加连接/ }));
    expect(await screen.findByText(/配置自定义/)).toBeInTheDocument();
    expect(configClient.saveModelCatalog).not.toHaveBeenCalled();
  });

  it("retries once when the catalog changed under a save", async () => {
    let attempts = 0;
    const { configClient } = renderSection({
      saveModelCatalog: vi.fn(async (input: any) => {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error("changed"), { code: "model_config_changed" });
        return { catalog: createModelWorkspace(null).catalog, configRevision: "rev-2" };
      })
    });

    await userEvent.click(await screen.findByRole("radio", { name: /cuby-desktop-alice/ }));

    expect(configClient.saveModelCatalog).toHaveBeenCalledTimes(2);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd App/frontend/desktop && npx vitest run src/pages/tests/cuberouter-model-section.interaction.test.tsx`
Expected: FAIL — 高级折叠不存在。

- [ ] **Step 3: 实现**

面板底部加：

```tsx
      <section className="mt-8">
        <button
          type="button"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((open) => !open)}
          className="inline-flex items-center gap-1 text-xs text-text-ink/50"
        >
          {t("settings.cuberouterModel.advanced")}
          {advancedOpen ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
        </button>
        {advancedOpen && (
          <ModelLibrarySection
            mode="byok"
            workspace={workspace}
            space={workspace.spaces.byok}
            commitWorkspace={commitWorkspace}
            savePending={savePending}
            saveError={saveError}
            testStates={testStates}
            setTestStates={setTestStates}
          />
        )}
      </section>
```

同时把 Task 10/11 直接调 `saveCatalogMutation` 的地方收敛成面板内部的 `commitWorkspace(next)` 等价物（一次保存、共用 `savePending`/`saveError`/冲突重试），让「高级」与 key/分配走同一条路。

- [ ] **Step 4: 跑测试**

Run: `cd App/frontend/desktop && npx vitest run src/pages/tests/cuberouter-model-section.interaction.test.tsx`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add App/frontend/desktop/src/pages/cuberouter-model-section.tsx App/frontend/desktop/src/pages/tests/cuberouter-model-section.interaction.test.tsx
git commit -m "feat(desktop): tuck the generic connection library behind the cuberouter advanced fold"
```

---

### Task 13: 登录复核：已选 key 不再被覆盖

**Files:**
- Modify: `App/frontend/desktop/src/state/model-provisioning.ts`（新增 `provisionCuberouterKey`）
- Modify: `App/frontend/desktop/src/components/account-auth-panel.tsx`（`continueAfterAuth` 复核）
- Modify: `App/frontend/desktop/src/pages/cuberouter-model-section.tsx`（「重新获取 key」接线）
- Test: `App/frontend/desktop/src/pages/tests/auth-flow.test.ts`、`App/frontend/desktop/src/state/tests/model-provisioning.test.ts`

**Interfaces:**
- Consumes: Task 9 记录、Task 4 `getModelChoices`、Task 8 `saveCatalogMutation`。
- Produces（Task 10 的按钮依赖）：`provisionCuberouterKey(input)`。

```ts
/**
 * Applies one cuberouter key by its plaintext, assigning the build's default model when the
 * catalog has no selection yet. Returns the saved catalog.
 */
export function provisionCuberouterKey(input: {
  configClient: ConfigClient;
  endpoint: { apiBase: string; protocol: ModelEndpointProtocol; apiKey: string };
  defaultModel: string;
  /** Keeps the catalog's current selection when true (re-login), else seeds the default model. */
  keepSelection: boolean;
}): Promise<ModelProviderConfig>;
```

- [ ] **Step 1: 扩脚手架，写失败测试**

`pages/tests/auth-flow.test.ts` 三处改动：

1. `authResult()` 的 profile 补 `username: "alice@a.com"`（真实服务会写它；记录以 username 为键）。
2. `createAuthServer(order, options)`：options 扩为 `{ testResult?; failFirstModePersist?; modelChoices?: CuberouterModelChoicesView; revealedKey?: string; catalog?: ModelConfigView; choicesFailure?: boolean }`，初始目录改成 `let catalog: ModelConfigView = options.catalog ?? createModelWorkspace(null).catalog;`，`client.account` 补两个桩：

```ts
        getModelChoices: vi.fn(async () => {
          order.push("getModelChoices");
          if (options.choicesFailure) throw new Error("instance offline");
          return options.modelChoices ?? {
            account: { username: "alice@a.com", organizationName: null },
            apiBase: "http://127.0.0.1:3100/v1",
            keys: [],
            models: ["deepseek-flash"]
          };
        }),
        revealPersonalKey: vi.fn(async () => ({ key: options.revealedKey ?? "sk-revealed" }))
```

3. 三个用例：

```ts
  it("登录时保留机器上已选的 key（记录有效且仍可用）", async () => {
    localStorage.setItem("memmy.cuberouterKeySelection.v1", JSON.stringify({
      "alice@a.com": { username: "alice@a.com", scope: "personal", id: 41, name: "my-own-key" }
    }));
    const server = createAuthServer(order, {
      modelChoices: {
        account: { username: "alice@a.com", organizationName: null },
        apiBase: "http://127.0.0.1:3100/v1",
        keys: [{
          scope: "personal",
          id: 41,
          name: "my-own-key",
          status: 1,
          usable: true,
          billing: { kind: "personal", remainingQuota: 100 }
        }],
        models: ["deepseek-flash"]
      },
      revealedKey: "sk-personal-revealed"
    });
    mocks.clients = server.client;
    await renderPanel();
    await fillCredentials();
    await clickButton("account.register");

    await vi.waitFor(() => expect(server.savedInput()).not.toBeNull());
    expect(server.savedInput()!.providers[0]!.endpoints[0]!.apiKey).toBe("sk-personal-revealed");
  });

  it("记录里的 key 已不在列表时回落到登录 provision 的 key", async () => {
    localStorage.setItem("memmy.cuberouterKeySelection.v1", JSON.stringify({
      "alice@a.com": { username: "alice@a.com", scope: "personal", id: 41, name: "my-own-key" }
    }));
    const server = createAuthServer(order, {
      modelChoices: {
        account: { username: "alice@a.com", organizationName: null },
        apiBase: "http://127.0.0.1:3100/v1",
        keys: [],
        models: ["deepseek-flash"]
      }
    });
    mocks.clients = server.client;
    await renderPanel();
    await fillCredentials();
    await clickButton("account.register");

    await vi.waitFor(() => expect(server.savedInput()).not.toBeNull());
    expect(server.savedInput()!.providers[0]!.endpoints[0]!.apiKey).toBe("sk-cuberouter");
  });

  it("choices 拉不到时不动已有配置", async () => {
    const seeded = applyCuberouterSelection(createModelWorkspace(null), {
      apiBase: "http://127.0.0.1:3100/v1",
      protocol: "openai-chat-completions",
      apiKey: "sk-already-chosen",
      selection: {
        agent: { models: ["deepseek-flash"], default: "deepseek-flash" },
        memorySummary: "deepseek-flash",
        memoryEvolution: "deepseek-flash"
      }
    });
    localStorage.setItem("memmy.cuberouterKeySelection.v1", JSON.stringify({
      "alice@a.com": { username: "alice@a.com", scope: "personal", id: 41, name: "my-own-key" }
    }));
    const server = createAuthServer(order, { choicesFailure: true, catalog: seeded.catalog });
    mocks.clients = server.client;
    await renderPanel();
    await fillCredentials();
    await clickButton("account.register");

    await vi.waitFor(() => expect(mocks.dispatch).toHaveBeenCalledWith(appActions.navigate("/onboarding")));
    expect(server.savedInput()).toBeNull();
  });
```

（文件顶部 import 补 `applyCuberouterSelection`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd App/frontend/desktop && npx vitest run src/pages/tests/auth-flow.test.ts`
Expected: FAIL — 现有实现无条件 `provisionByokModel` 覆盖（第一条断言失败）。

- [ ] **Step 3: 实现复核**

`state/model-provisioning.ts`：新增两个导出，并**删掉 `provisionByokModel`**（唯一调用方就是 `account-auth-panel`；既有 `state/tests/model-provisioning.test.ts` 里它的用例改名到 `provisionCuberouterKey`，断言不变：写入 provider `openai`、endpoint apiBase、三个槽位指向同一 preset）。

```ts
/** What a login should do about the model key. */
export type CuberouterLoginKeyDecision =
  | { action: "reuse"; apiKey: string; record: CuberouterKeySelection }
  | { action: "provision" }
  | { action: "keep" };

/**
 * Decides whether a login keeps the key this machine remembered. `reuse` needs the record to be
 * listed and usable (a personal key's plaintext is revealed on the spot); `keep` covers the one
 * case where nothing may be written — the instance could not be asked and a cuberouter
 * connection already exists — because a transient outage must not overwrite the user's key.
 */
export async function resolveCuberouterLoginKey(input: {
  apiBase: string;
  catalog: ModelConfigView;
  record: CuberouterKeySelection | null;
  getModelChoices: () => Promise<CuberouterModelChoicesView>;
  revealPersonalKey: (tokenId: number) => Promise<{ key: string }>;
}): Promise<CuberouterLoginKeyDecision> {
  try {
    const choices = await input.getModelChoices();
    const remembered = input.record
      ? choices.keys.find((key) => key.scope === input.record!.scope && key.id === input.record!.id && key.usable)
      : undefined;
    if (!input.record || !remembered) return { action: "provision" };
    const apiKey = remembered.secret ?? (await input.revealPersonalKey(remembered.id)).key;
    return { action: "reuse", apiKey, record: input.record };
  } catch {
    return connectionHasCredential(input.catalog, input.apiBase) ? { action: "keep" } : { action: "provision" };
  }
}

/** Whether the stored catalog already carries a usable connection at this line's base. */
function connectionHasCredential(catalog: ModelConfigView, apiBase: string): boolean {
  const normalized = apiBase.trim().replace(/\/+$/, "");
  return catalog.providers.some((provider) => (
    !provider.accountManaged
    && provider.endpoints.some((endpoint) => (
      endpoint.apiBase.replace(/\/+$/, "") === normalized && (endpoint.hasApiKey || Boolean(endpoint.apiKeyMasked))
    ))
  ));
}

/**
 * Writes one cuberouter key (and, when there is no selection yet, the build's default model).
 * `keepSelection: true` is the re-login path: the catalog's current model selection stays.
 */
export async function provisionCuberouterKey(input: {
  configClient: ConfigClient;
  endpoint: { apiBase: string; protocol: ModelEndpointProtocol; apiKey: string };
  defaultModel: string;
  keepSelection: boolean;
}): Promise<ModelProviderConfig> {
  return saveCatalogMutation({
    configClient: input.configClient,
    mutate: (workspace) => {
      const current = readCuberouterSelection(workspace.catalog, input.endpoint.apiBase);
      const selection = input.keepSelection && current.agent.models.length > 0
        ? current
        : {
            agent: { models: [input.defaultModel], default: input.defaultModel },
            memorySummary: input.defaultModel,
            memoryEvolution: input.defaultModel
          };
      return applyCuberouterSelection(workspace, {
        apiBase: input.endpoint.apiBase,
        protocol: input.endpoint.protocol,
        apiKey: input.endpoint.apiKey,
        selection
      });
    }
  });
}
```

`components/account-auth-panel.tsx` 的 `continueAfterAuth`：把原来的 `provisionByokModel(...)` 整段换成：

```ts
      const username = session.profile.username ?? "";
      const decision = await resolveCuberouterLoginKey({
        apiBase: result.provisioning.apiBase,
        catalog: createModelWorkspace(state.modelConfig).catalog,
        record: username ? readCuberouterKeySelection(username, cuberouterKeySelectionStorage()) : null,
        getModelChoices: () => clients.account.getModelChoices(),
        revealPersonalKey: (tokenId) => clients.account.revealPersonalKey(tokenId)
      });

      let saved: ModelProviderConfig;
      if (decision.action === "keep") {
        // The instance could not be asked and a cuberouter connection already exists: read it and
        // write nothing.
        saved = await clients.config.getModelConfig();
      } else {
        saved = await provisionCuberouterKey({
          configClient: clients.config,
          endpoint: {
            apiBase: result.provisioning.apiBase,
            protocol: "openai-chat-completions",
            apiKey: decision.action === "reuse" ? decision.apiKey : result.provisioning.apiKey
          },
          defaultModel: result.provisioning.model,
          keepSelection: decision.action === "reuse"
        });
        const storage = cuberouterKeySelectionStorage();
        if (decision.action === "reuse") {
          writeCuberouterKeySelection(decision.record, storage);
        } else if (username) {
          // The remembered key is gone: drop the record so the panel stops calling it selected.
          // find-or-create is name-based, so the key it just wrote shows up in the panel's list.
          clearCuberouterKeySelection(username, storage);
        }
      }
      dispatch(appActions.modelConfigUpdated(saved));
```

- [ ] **Step 4: 后端复位入口（「重新获取 key」的数据来源）**

「重新获取 key」需要一把 key 的明文，而它只由登录/注册响应给出（`CuberouterAuthResult.provisioning`）。补一个复位入口，让面板不重新登录也能再走一次同样的 find-or-create：

1. `cuberouter-account-service.ts`：把 `loginOnNode` 里「取组织 → `ensureOrganizationKey` / `ensurePersonalKey`」抽成服务内的 `provisionKey()`（返回 `{ apiKey, apiBase, model }`），`loginOnNode` 改成调用它；对外新增 `reprovisionKey(): Promise<{ apiKey: string; apiBase: string; model: string }>`（未登录会话时抛 `rejected`）。既有登录/注册用例必须保持绿。
2. `routes/account.ts`：

```ts
  app.post(
    "/api/account/cuberouter/provision-key",
    { preHandler: options.authenticateRuntimeToken },
    withErrorEnvelope(async (_request, reply) => {
      const response = CuberouterProvisioningSchema.parse(
        await options.cuberouterAccount.reprovisionKey()
      );
      return reply.send(response);
    })
  );
```

3. `api/account-client.ts`（桌面）：`reprovisionKey(): Promise<CuberouterProvisioning>` → `POST /api/account/cuberouter/provision-key`，schema `CuberouterProvisioningSchema`。
4. 测试：service 用例（复用 `provisionKey` 后登录返回的 provisioning 不变 + `reprovisionKey` 未登录时抛错）、路由用例（`POST …/provision-key` 返回 provisioning）、桌面 client 用例各一条。

- [ ] **Step 5: 面板与登录接线**

`pages/cuberouter-model-section.tsx` 的「重新获取 key」：

```tsx
  /** Re-runs the instance-side find-or-create, then re-reads the key list. */
  async function onRefreshKeys(): Promise<void> {
    if (!props.configClient || !props.accountClient || !props.username) return;
    setSaveError(null);
    setSavePending(true);
    try {
      const provisioning = await props.accountClient.reprovisionKey();
      const fresh: CuberouterSelection = {
        agent: { models: [provisioning.model], default: provisioning.model },
        memorySummary: provisioning.model,
        memoryEvolution: provisioning.model
      };
      setSelection(fresh);
      await commit((current) => applyCuberouterSelection(current, {
        apiBase: provisioning.apiBase,
        protocol: PROTOCOL,
        apiKey: provisioning.apiKey,
        selection: fresh
      }));
      // 刚写进去的这把 key 没有列表身份，记录清掉；面板重新拉列表后用户可再选。
      clearCuberouterKeySelection(props.username, cuberouterKeySelectionStorage());
      loadChoices();
    } catch {
      setSaveError(t("settings.modelWorkspace.saveFailed"));
    } finally {
      setSavePending(false);
    }
  }
```

（`commit` 的 `mutate` 第二参数是列表里的 `apiBase`，这里显式改用 `provisioning.apiBase`，两者同线路时相同。）

面板 props 的 `accountClient` Pick 同步加上 `reprovisionKey`；`continueAfterAuth` 所在文件补 import：`createModelWorkspace`、`readCuberouterKeySelection` / `writeCuberouterKeySelection` / `clearCuberouterKeySelection` / `cuberouterKeySelectionStorage`、`resolveCuberouterLoginKey` / `provisionCuberouterKey`。

- [ ] **Step 6: 跑测试**

Run: `cd App/frontend/desktop && npx vitest run src/pages/tests/auth-flow.test.ts src/state/tests/model-provisioning.test.ts src/pages/tests/cuberouter-model-section.interaction.test.tsx`
Expected: PASS（含既有 auth-flow 用例）。

- [ ] **Step 7: 全量回归 + 类型检查（两端）**

Run:
```bash
cd App/backend && npm test
cd App/frontend/desktop && npm test
cd App/backend && npm run typecheck
cd App/frontend/desktop && npm run typecheck
```
Expected: 全绿；typecheck 无错误。

- [ ] **Step 8: Commit**

```bash
git add App/backend/src/services/cuberouter-account-service.ts App/backend/src/services/tests/cuberouter-account-service.test.ts App/backend/src/adapters/inbound/local-api/routes/account.ts App/backend/src/adapters/inbound/local-api/tests/account-routes.test.ts App/frontend/desktop/src/api/account-client.ts App/frontend/desktop/src/api/tests/account-client.test.ts
git commit -m "feat(cuberouter): let the desktop re-run the key provisioning without a login"

git add App/frontend/desktop/src/state/model-provisioning.ts App/frontend/desktop/src/components/account-auth-panel.tsx App/frontend/desktop/src/pages/cuberouter-model-section.tsx App/frontend/desktop/src/pages/tests App/frontend/desktop/src/state/tests
git commit -m "feat(desktop): keep the cuberouter key the user picked across logins"
```

---

## 收尾检查（执行者）

- [ ] 手动冒烟（WSL 起后端 + `vite`，或 Windows 包）：cuberouter 身份进设置 → 模型配置 → 看到「账号行 + API Key 卡 + 模型分配 + 高级」；换一把个人 key 后重启应用仍是这一把；登出再登录不被戳回默认 key。
- [ ] `docs/superpowers/specs/2026-10-15-cuberouter-model-config-design.md` 若与实现有出入（例如 `applyCuberouterSelection` 的落点），在收尾时用一次小 commit 更新 spec 的 §4.6 / §9。
- [ ] 若接入实例验证了「余额单位换算」的真实规则，另开任务，不在本计划内。
