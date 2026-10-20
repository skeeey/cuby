/** Cuberouter account service tests. */
import { describe, expect, it, vi } from "vitest";
import type { CuberouterClient } from "../../adapters/outbound/cuberouter-client/index.js";
import { createCuberouterAccountService, toDesktopTokenName } from "../cuberouter-account-service.js";

function fakeClient(overrides: Partial<CuberouterClient> = {}): CuberouterClient {
  return {
    register: vi.fn(async () => undefined),
    login: vi.fn(async () => ({
      accessToken: "jwt-1",
      userId: "7",
      username: "alice",
      displayName: "Alice",
      accessExpiresAt: 4102444800,
      refreshToken: "rt-1"
    })),
    refreshSession: vi.fn(async () => ({
      accessToken: "jwt-1",
      accessExpiresAt: 4102444800,
      refreshToken: "rt-1"
    })),
    getRegistrationRequirements: vi.fn(async () => ({
      emailVerificationRequired: false,
      turnstileRequired: false,
      serverAddress: "http://127.0.0.1:3000"
    })),
    sendEmailVerificationCode: vi.fn(async () => undefined),
    listOrganizations: vi.fn(async () => [{ id: "7", name: "yeebo" }]),
    // Echoes the name asked for: the service provisions the per-account token it looked up.
    listOrganizationTokens: vi.fn(async (_token: string, _organizationId: string, tokenName: string) => [
      { id: 11, name: tokenName, key: "sk-org" }
    ]),
    createOrganizationToken: vi.fn(async (_token: string, _organizationId: string, input: { name: string }) => ({
      id: 12,
      name: input.name,
      key: "sk-org-created"
    })),
    searchPersonalTokens: vi.fn(async () => []),
    createPersonalToken: vi.fn(async () => undefined),
    getPersonalTokenKey: vi.fn(async () => "sk-personal"),
    getSelf: vi.fn(async () => ({ quota: 100, usedQuota: 0 })),
    getUserModels: vi.fn(async () => ["deepseek-v4.1-flash", "gpt-oss-120b"]),
    listPersonalTokens: vi.fn(async () => [{ id: 41, name: "cuby-desktop-alice", status: 1 }]),
    listMyOrganizationTokens: vi.fn(async () => [
      { id: 11, name: "cuby-desktop-alice", key: "sk-org", status: 1, responsibleUserId: 7 }
    ]),
    ...overrides
  };
}

function fakeRepository() {
  const upsert = vi.fn((input: any) => ({
    authenticated: true,
    isNewUser: input.isNewUser ?? false,
    profile: { ...input.profile, registeredAt: null }
  }));
  return {
    repository: { upsert, clear: vi.fn(), setCuberouterCredential: vi.fn() } as any,
    upsert
  };
}

/** A repository whose active session is the cuberouter account the login produced. */
function authenticatedRepository(credential: any = null) {
  const view = {
    authenticated: true,
    isNewUser: false,
    profile: { userId: "7", username: "alice", displayName: "Alice", identityProvider: "cuberouter", organizationName: null }
  };
  return {
    get: vi.fn(() => view),
    getCloudUuid: vi.fn(() => "jwt-1"),
    getAuthChannel: vi.fn(() => "cuberouter"),
    getCuberouterCredential: vi.fn(() => credential),
    setCuberouterCredential: vi.fn(),
    clearCuberouterCredential: vi.fn(),
    upsert: vi.fn(() => view),
    clear: vi.fn()
  } as any;
}

/** A credential the instance would have rejected long ago, kept for the renewal tests. */
const EXPIRED_CREDENTIAL = { accessToken: "jwt-stale", accessExpiresAt: 1, refreshToken: "rt-1" };
/** One that outlives the test by decades, so no renewal is due. */
const LIVE_CREDENTIAL = { accessToken: "jwt-live", accessExpiresAt: 4102444800, refreshToken: "rt-1" };

/** A create that answers the way the instance does: the key it was asked for, freshly made. */
function createdKey(key = "sk-org-created") {
  return vi.fn(async (_token: string, _organizationId: string, input: { name: string }) => ({
    id: 12,
    name: input.name,
    key
  }));
}

const TWO_NODES = [
  { id: "cn", url: "https://cn.example" },
  { id: "hk", url: "https://hk.example" }
];

/** The shape every pre-node-table test assumes: one line, one client, one repository. */
function singleNodeService(client: CuberouterClient, repository: any) {
  return createTestService({
    nodes: [{ id: "default", url: "http://127.0.0.1:3000" }],
    client,
    repository
  });
}

/**
 * Builds the service against a fake node world: one client per URL (each recording its own
 * calls through the `on*` hooks), an in-memory line memory, and a stubbed router that never
 * touches the network.
 */
function createTestService(input: {
  nodes: Array<{ id: string; url: string }>;
  client?: CuberouterClient;
  clientsByUrl?: Record<string, CuberouterClient>;
  repository?: any;
  rememberedNodeId?: string | null;
  preferredNodeId?: string | null;
  probeDefaultNodeId?: string | null;
  onRegister?: (url: string) => void;
  onLogin?: (url: string) => void;
  onRequirements?: (url: string) => void;
  onRemember?: (username: string, nodeId: string) => void;
  onProbe?: () => void;
  log?: (message: string) => void;
  onOrganizationTokenLookup?: (tokenName: string, organizationId: string) => void;
  organizations?: Array<{ id: string; name: string }>;
  onOrganizationList?: () => void;
}) {
  const remembered = new Map<string, string>();
  if (input.rememberedNodeId) remembered.set("alice", input.rememberedNodeId);
  let preferred = input.preferredNodeId ?? null;
  let probeCalls = 0;
  const { repository } = input.repository
    ? { repository: input.repository }
    : fakeRepository();
  const clientFor = (url: string): CuberouterClient =>
    input.clientsByUrl?.[url]
    ?? ({
      register: async () => {
        input.onRegister?.(url);
      },
      login: async () => {
        input.onLogin?.(url);
        return {
          accessToken: `jwt-${url}`,
          userId: "7",
          username: "alice",
          displayName: "Alice",
          accessExpiresAt: 4102444800,
          refreshToken: "rt-1"
        };
      },
      refreshSession: async () => ({ accessToken: `jwt-refreshed`, accessExpiresAt: 4102444800, refreshToken: "rt-2" }),
      getRegistrationRequirements: async () => {
        input.onRequirements?.(url);
        return { emailVerificationRequired: false, turnstileRequired: false, serverAddress: url };
      },
      sendEmailVerificationCode: async () => undefined,
      listOrganizations: async () => {
        input.onOrganizationList?.();
        return input.organizations ?? [{ id: "7", name: "yeebo" }];
      },
      listOrganizationTokens: async (_token: string, organizationId: string, tokenName: string) => {
        input.onOrganizationTokenLookup?.(tokenName, organizationId);
        return [{ id: 11, name: tokenName, key: "sk-org" }];
      },
      createOrganizationToken: async (_token: string, _organizationId: string, createInput: { name: string }) => ({
        id: 12,
        name: createInput.name,
        key: "sk-org-created"
      }),
      searchPersonalTokens: async () => [],
      createPersonalToken: async () => undefined,
      getPersonalTokenKey: async () => "sk-personal",
      getSelf: async () => ({ quota: 0, usedQuota: 0 }),
      getUserModels: async () => [],
      listPersonalTokens: async () => [],
      listMyOrganizationTokens: async () => []
    } satisfies CuberouterClient);

  const service = createCuberouterAccountService({
    clientFor: (url) => input.client ?? clientFor(url),
    accountSessionRepository: repository,
    accountNodes: {
      get: (username: string) => remembered.get(username.trim()) ?? null,
      set: (username: string, nodeId: string) => {
        remembered.set(username.trim(), nodeId);
        input.onRemember?.(username, nodeId);
      }
    },
    nodeRouter: {
      probe: async () => {
        probeCalls += 1;
        input.onProbe?.();
        return { entries: [], defaultNodeId: input.probeDefaultNodeId ?? null };
      },
      listNodes: () => input.nodes,
      getNodeUrl: (nodeId: string) => input.nodes.find((node) => node.id === nodeId)?.url ?? null,
      getPreferredNodeId: async () => preferred,
      setPreferredNodeId: async (nodeId: string) => {
        preferred = nodeId;
      }
    },
    model: "deepseek-flash",
    log: input.log ?? (() => undefined)
  });
  return Object.assign(service, { repository });
}

describe("cuberouter account service", () => {
  it("registers then logs in and provisions the organization's key", async () => {
    const client = fakeClient();
    const { repository, upsert } = fakeRepository();
    const service = singleNodeService(client, repository);

    const result = await service.register({ username: "alice", password: "Passw0rd1" });

    expect(client.register).toHaveBeenCalledWith({ username: "alice", password: "Passw0rd1" });
    expect(client.listOrganizationTokens).toHaveBeenCalledWith("jwt-1", "7", "cuby-desktop-alice");
    expect(result.provisioning).toEqual({
      apiKey: "sk-org",
      apiBase: "http://127.0.0.1:3000/v1",
      model: "deepseek-flash"
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        uuid: "cuberouter:7",
        cloudUuid: "jwt-1",
        authChannel: "cuberouter",
        profile: expect.objectContaining({ identityProvider: "cuberouter", nickname: "Alice" })
      })
    );
  });

  it("forwards the email verification fields the instance asked for", async () => {
    const client = fakeClient();
    const { repository } = fakeRepository();
    const service = singleNodeService(client, repository);

    await service.register({
      username: "alice",
      password: "Passw0rd1",
      email: "alice@example.com",
      verificationCode: "123456"
    });

    expect(client.register).toHaveBeenCalledWith({
      username: "alice",
      password: "Passw0rd1",
      email: "alice@example.com",
      verificationCode: "123456"
    });
  });

  it("returns the registration requirements the instance advertises", async () => {
    const client = fakeClient({
      getRegistrationRequirements: vi.fn(async () => ({
        emailVerificationRequired: true,
        turnstileRequired: false
      }))
    });
    const { repository } = fakeRepository();
    const service = singleNodeService(client, repository);

    await expect(service.getRegistrationRequirements()).resolves.toEqual({
      emailVerificationRequired: true,
      turnstileRequired: false
    });
  });

  it("reports an unreachable instance when the requirements probe fails", async () => {
    // The desktop treats a failed probe as "assume no extra inputs", so the code has to
    // stay distinguishable from a schema error rather than collapsing to internal.
    const client = fakeClient({
      getRegistrationRequirements: vi.fn(async () => {
        throw Object.assign(new Error("无法连接 cuberouter 服务，请检查服务地址与网络"), {
          code: "service_unavailable" as const
        });
      })
    });
    const { repository } = fakeRepository();
    const service = singleNodeService(client, repository);

    await expect(service.getRegistrationRequirements()).rejects.toMatchObject({
      code: "cuberouter_unavailable"
    });
  });

  it("keeps the retry-shaped message when the code send is throttled", async () => {
    const client = fakeClient({
      sendEmailVerificationCode: vi.fn(async () => {
        throw Object.assign(new Error("发送过于频繁，请等待 28 秒后再试"), {
          code: "email_code_throttled" as const
        });
      })
    });
    const { repository } = fakeRepository();
    const service = singleNodeService(client, repository);

    await expect(service.sendEmailVerificationCode("alice@example.com")).rejects.toMatchObject({
      code: "rate_limited",
      message: "发送过于频繁，请等待 28 秒后再试"
    });
  });

  it("maps cuberouter failures onto the local API error contract", async () => {
    const client = fakeClient({
      login: vi.fn(async () => {
        throw Object.assign(new Error("用户名或密码不正确"), { code: "rejected" });
      })
    });
    const { repository } = fakeRepository();
    const service = singleNodeService(client, repository);

    await expect(service.login({ username: "alice", password: "Passw0rd1" })).rejects.toMatchObject({
      code: "invalid_argument",
      message: "用户名或密码不正确"
    });
  });

  it("maps transport failures to a code the desktop renders while keeping the message", async () => {
    const client = fakeClient({
      login: vi.fn(async () => {
        throw Object.assign(new Error("无法连接 cuberouter 服务"), { code: "service_unavailable" });
      })
    });
    const { repository } = fakeRepository();
    const service = singleNodeService(client, repository);

    await expect(service.login({ username: "alice", password: "Passw0rd1" })).rejects.toMatchObject({
      code: "cuberouter_unavailable",
      message: "无法连接 cuberouter 服务"
    });
  });

  it("clears the local session on logout without calling cuberouter", async () => {
    const client = fakeClient();
    const { repository } = fakeRepository();
    const service = singleNodeService(client, repository);

    await expect(service.logout()).resolves.toEqual({ ok: true });
    expect(repository.clear).toHaveBeenCalled();
  });

  it("registers on the node the caller picked, and remembers it", async () => {
    const registeredOn: string[] = [];
    const remembered: Array<[string, string]> = [];
    const service = createTestService({
      nodes: TWO_NODES,
      onRegister: (url) => registeredOn.push(url),
      onRemember: (username, nodeId) => remembered.push([username, nodeId])
    });

    await service.register({ username: "alice", password: "Passw0rd1", nodeId: "hk" });

    expect(registeredOn).toEqual(["https://hk.example"]);
    expect(remembered).toEqual([["alice", "hk"]]);
  });

  it("rejects a node id that is not in the table", async () => {
    const service = createTestService({ nodes: [{ id: "cn", url: "https://cn.example" }] });

    await expect(service.register({ username: "alice", password: "Passw0rd1", nodeId: "mars" }))
      .rejects.toMatchObject({ code: "invalid_argument" });
  });

  it("logs in on the remembered node first, and falls back to the other one", async () => {
    const attempts: string[] = [];
    const service = createTestService({
      nodes: TWO_NODES,
      rememberedNodeId: "cn",
      onLogin: (url) => {
        attempts.push(url);
        if (url === "https://cn.example") {
          throw Object.assign(new Error("无法连接"), { code: "service_unavailable" as const });
        }
      }
    });

    const result = await service.login({ username: "alice", password: "Passw0rd1" });

    expect(attempts).toEqual(["https://cn.example", "https://hk.example"]);
    expect(result.session.authenticated).toBe(true);
    expect(result.provisioning.apiBase).toBe("https://hk.example/v1");
  });

  it("tries the line the caller picked first, and still falls back", async () => {
    // The picker is on the login form too: an account lives on one line, and the visitor knows
    // which. The fallback stays, because a wrong pick and a wrong password look identical.
    const attempts: string[] = [];
    const service = createTestService({
      nodes: TWO_NODES,
      rememberedNodeId: "cn",
      onLogin: (url) => {
        attempts.push(url);
        if (url === "https://hk.example") {
          throw Object.assign(new Error("用户名或密码错误"), { code: "rejected" as const });
        }
      }
    });

    await service.login({ username: "alice", password: "Passw0rd1", nodeId: "hk" });

    expect(attempts).toEqual(["https://hk.example", "https://cn.example"]);
  });

  it("ignores a picked line that is not in the table", async () => {
    const attempts: string[] = [];
    const service = createTestService({
      nodes: TWO_NODES,
      rememberedNodeId: "cn",
      onLogin: (url) => attempts.push(url)
    });

    await service.login({ username: "alice", password: "Passw0rd1", nodeId: "mars" });

    expect(attempts).toEqual(["https://cn.example"]);
  });

  it("stops after two attempts even when a third line exists", async () => {
    const attempts: string[] = [];
    const service = createTestService({
      nodes: [
        { id: "cn", url: "https://cn.example" },
        { id: "hk", url: "https://hk.example" },
        { id: "jp", url: "https://jp.example" }
      ],
      rememberedNodeId: "cn",
      preferredNodeId: "hk",
      probeDefaultNodeId: "jp",
      onLogin: (url) => {
        attempts.push(url);
        throw Object.assign(new Error("用户名或密码错误"), { code: "rejected" as const });
      }
    });

    await expect(service.login({ username: "alice", password: "Passw0rd1" })).rejects.toBeDefined();

    // Remembered, then the current line — the probed default is never dialed.
    expect(attempts).toEqual(["https://cn.example", "https://hk.example"]);
  });

  it("surfaces the last failure when neither node accepts the credentials", async () => {
    const service = createTestService({
      nodes: TWO_NODES,
      onLogin: () => {
        throw Object.assign(new Error("用户名或密码错误"), { code: "rejected" as const });
      }
    });

    await expect(service.login({ username: "alice", password: "Passw0rd1" }))
      .rejects.toMatchObject({ code: "invalid_argument", message: "用户名或密码错误" });
  });

  it("keeps a provisioning failure instead of the rejection the other line answers with", async () => {
    // The lines hold separate accounts, so the line this account is not on answers with a
    // rejection every time. Reporting that one would tell a visitor who typed the right password
    // that it is wrong, and bury the failure they can actually act on.
    const service = createTestService({
      nodes: TWO_NODES,
      rememberedNodeId: "hk",
      clientsByUrl: {
        // The account is here: it signs in fine and only fails to get its key made.
        "https://hk.example": fakeClient({
          listOrganizationTokens: vi.fn(async () => []),
          createOrganizationToken: vi.fn(async () => {
            throw Object.assign(new Error("permission denied"), { code: "rejected" });
          })
        }),
        // The account is not, which the instance reports the only way it can: bad credentials.
        "https://cn.example": fakeClient({
          login: vi.fn(async () => {
            throw Object.assign(new Error("Username or password is incorrect, or user has been banned"), {
              code: "rejected"
            });
          })
        })
      } as never
    });

    await expect(service.login({ username: "alice", password: "Passw0rd1" })).rejects.toMatchObject({
      code: "cuberouter_key_unavailable",
      message: "创建组织 API Key（cuby-desktop-alice）失败：permission denied"
    });
  });

  it("ignores a remembered or current line that is no longer in the table", async () => {
    const attempts: string[] = [];
    const service = createTestService({
      nodes: [{ id: "hk", url: "https://hk.example" }],
      // Both were persisted when the table still had a mainland node.
      rememberedNodeId: "cn",
      preferredNodeId: "cn",
      onLogin: (url) => attempts.push(url)
    });

    await service.login({ username: "alice", password: "Passw0rd1" });

    expect(attempts).toEqual(["https://hk.example"]);
  });

  it("reads the registration requirements from the line the caller is looking at", async () => {
    const asked: string[] = [];
    const service = createTestService({
      nodes: TWO_NODES,
      onRequirements: (url) => asked.push(url)
    });

    await expect(service.getRegistrationRequirements("hk")).resolves.toMatchObject({
      serverAddress: "https://hk.example"
    });
    expect(asked).toEqual(["https://hk.example"]);
  });

  it("sends the verification code through the line the account will be created on", async () => {
    // The code is instance-local: asking the current line for it while the user registers on
    // the other one produces a code that line cannot validate, so registration can never finish.
    const asked: string[] = [];
    const clientsByUrl = Object.fromEntries(TWO_NODES.map((node) => [node.url, {
      register: async () => undefined,
      login: async () => ({ accessToken: "jwt", userId: "7", username: "alice", displayName: "Alice" }),
      getRegistrationRequirements: async () => ({
        emailVerificationRequired: true,
        turnstileRequired: false,
        serverAddress: node.url
      }),
      sendEmailVerificationCode: async () => {
        asked.push(node.url);
      },
      listOrganizationTokens: async () => [{ id: 11, name: "cuby-desktop", key: "sk-org" }],
      getSelf: async () => ({ quota: 0, usedQuota: 0 }),
      getUserModels: async () => [],
      listPersonalTokens: async () => [],
      listMyOrganizationTokens: async () => []
    }])) as never;
    // The machine's current line is cn; the user picks hk for the new account.
    const service = createTestService({ nodes: TWO_NODES, clientsByUrl, preferredNodeId: "cn" });

    await service.sendEmailVerificationCode("alice@example.com", "hk");

    expect(asked).toEqual(["https://hk.example"]);
  });

  it("reports both lines and the one in effect", async () => {
    const service = createTestService({ nodes: TWO_NODES, preferredNodeId: "hk" });

    await expect(service.getNodes()).resolves.toEqual({ nodes: ["cn", "hk"], currentNodeId: "hk" });
  });

  it("preselects the build's default line when the probe reached nothing", async () => {
    const service = createTestService({ nodes: TWO_NODES, probeDefaultNodeId: null });

    await expect(service.probeNodes()).resolves.toMatchObject({ nodes: ["cn", "hk"], defaultNodeId: "hk" });
  });

  it("never names a line the table does not have, and says so plainly when there is none", async () => {
    // Defensive: the wiring always supplies at least the resolved default line, so an empty
    // table means a caller passed one. Report it as "no line", never as a phantom id.
    const service = createTestService({ nodes: [] });

    await expect(service.probeNodes()).resolves.toMatchObject({ nodes: [], defaultNodeId: null });
    await expect(service.register({ username: "alice", password: "Passw0rd1" }))
      .rejects.toMatchObject({ code: "invalid_argument", message: "没有可用的 cuberouter 线路" });
  });

  it("does not measure the lines when the account already has one", async () => {
    // A probe costs up to four status calls, and with a two-node table it cannot change the
    // order once the first slot is decided: the second slot is the other node either way.
    const attempts: string[] = [];
    const probes: number[] = [];
    const service = createTestService({
      nodes: TWO_NODES,
      rememberedNodeId: "cn",
      onLogin: (url) => attempts.push(url),
      onProbe: () => probes.push(1)
    });

    await service.login({ username: "alice", password: "Passw0rd1" });

    expect(attempts).toEqual(["https://cn.example"]);
    expect(probes).toEqual([]);
  });

  it("only calls an account new the first time this machine sees the username", async () => {
    // The account row's uuid is not a stable identity to ask: a row written under a different
    // spelling re-appears as new, and "new" resets the guidance. The line memory is per machine
    // and survives a logout, which is exactly the question being asked.
    const first = createTestService({ nodes: [{ id: "default", url: "http://127.0.0.1:3000" }] });
    await first.login({ username: "alice", password: "Passw0rd1" });
    const firstUpsert = first.repository.upsert.mock.calls[0]![0] as { isNewUser?: boolean };

    const returning = createTestService({
      nodes: [{ id: "default", url: "http://127.0.0.1:3000" }],
      rememberedNodeId: "default"
    });
    await returning.login({ username: "alice", password: "Passw0rd1" });
    const returningUpsert = returning.repository.upsert.mock.calls[0]![0] as { isNewUser?: boolean };

    expect(firstUpsert.isNewUser).toBe(true);
    expect(returningUpsert.isNewUser).toBe(false);
  });

  it("names the account's key with the shipped cuby-desktop prefix", async () => {
    const looked: string[] = [];
    const service = createTestService({
      nodes: [{ id: "default", url: "http://127.0.0.1:3000" }],
      onOrganizationTokenLookup: (name) => looked.push(name)
    });

    await service.login({ username: "alice", password: "Passw0rd1" });

    expect(looked).toEqual(["cuby-desktop-alice"]);
  });

  it("names the token after the account the instance reports, not the string that was typed", async () => {
    // The administrator creates the key from the instance's own user list, so the name has to
    // follow what the instance stores. Signing in by an alias must not look for a key named
    // after the alias.
    const looked: string[] = [];
    const service = createTestService({
      nodes: [{ id: "default", url: "http://127.0.0.1:3000" }],
      clientsByUrl: {
        "http://127.0.0.1:3000": {
          register: async () => undefined,
          login: async () => ({ accessToken: "jwt", userId: "7", username: "liangyt", displayName: "L" }),
          getRegistrationRequirements: async () => ({
            emailVerificationRequired: false,
            turnstileRequired: false,
            serverAddress: "http://127.0.0.1:3000"
          }),
          sendEmailVerificationCode: async () => undefined,
          listOrganizations: async () => [{ id: "7", name: "yeebo" }],
          listOrganizationTokens: async (_token: string, _organizationId: string, tokenName: string) => {
            looked.push(tokenName);
            return [{ id: 11, name: tokenName, key: "sk-org" }];
          }
        } as never
      }
    });

    await service.login({ username: "LiangYT@yeebo.com.cn", password: "Passw0rd1" });

    expect(looked).toEqual(["cuby-desktop-liangyt"]);
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
      searchPersonalTokens: vi.fn(async () => [{ id: 41, name: "cuby-desktop-alice", status: 1 }]),
      getPersonalTokenKey: vi.fn(async () => "sk-personal")
    });
    const service = singleNodeService(client, fakeRepository().repository);

    const result = await service.login({ username: "alice", password: "Passw0rd1" });

    expect(client.createPersonalToken).not.toHaveBeenCalled();
    expect(result.provisioning.apiKey).toBe("sk-personal");
  });

  it("does not reuse a personal key the instance reports as disabled", async () => {
    // The organization path filters by status on the server; the personal search cannot, so the
    // state travels with the row and the reuse rule lives here. Reusing a disabled key would
    // write it into the model config and pin every request to a failure with no way back.
    let created = false;
    const client = fakeClient({
      listOrganizations: vi.fn(async () => []),
      createPersonalToken: vi.fn(async () => {
        created = true;
      }),
      searchPersonalTokens: vi.fn(async (_token: string, name: string) =>
        created ? [{ id: 42, name, status: 1 }] : [{ id: 41, name, status: 2 }]
      ),
      getPersonalTokenKey: vi.fn(async (_token: string, id: number) => `sk-${id}`)
    });
    const service = singleNodeService(client, fakeRepository().repository);

    const result = await service.login({ username: "alice", password: "Passw0rd1" });

    expect(client.createPersonalToken).toHaveBeenCalledWith("jwt-1", { name: "cuby-desktop-alice" });
    expect(client.getPersonalTokenKey).toHaveBeenCalledWith("jwt-1", 42);
    expect(result.provisioning.apiKey).toBe("sk-42");
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

  it("says what it was doing when the instance refuses to create the key", async () => {
    // The same refusal means different things at login and at creation, so the instance's own
    // message is kept and the key's name is added: it is what an operator would have to look at.
    const client = fakeClient({
      listOrganizationTokens: vi.fn(async () => [{ id: 3, name: "someone-elses-key", key: "sk-other" }]),
      createOrganizationToken: vi.fn(async () => {
        throw Object.assign(new Error("permission denied"), { code: "rejected" });
      })
    });
    const { repository } = fakeRepository();
    const service = singleNodeService(client, repository);

    await expect(service.login({ username: "alice", password: "Passw0rd1" })).rejects.toMatchObject({
      code: "cuberouter_key_unavailable",
      message: "创建组织 API Key（cuby-desktop-alice）失败：permission denied"
    });
  });

  it("creates this account's key when the organization has none yet", async () => {
    // Self-service: a registered member with no pre-provisioned key gets one made for them and
    // held by their own account, in the shape the console's own create form defaults to.
    const createOrganizationToken = createdKey();
    const client = fakeClient({
      listOrganizationTokens: vi.fn(async () => []),
      createOrganizationToken
    });
    const { repository } = fakeRepository();
    const service = singleNodeService(client, repository);

    const result = await service.login({ username: "alice", password: "Passw0rd1" });

    expect(createOrganizationToken).toHaveBeenCalledWith("jwt-1", "7", {
      name: "cuby-desktop-alice",
      unlimitedQuota: true
    });
    expect(result.provisioning).toEqual({
      apiKey: "sk-org-created",
      apiBase: "http://127.0.0.1:3000/v1",
      model: "deepseek-flash"
    });
  });

  it("keeps a name that merely starts with this account's out of the lookup", async () => {
    // The server's keyword filter is a substring match: a longer name that only starts with
    // this account's is not this account's key, and must not be handed to the desktop.
    const createOrganizationToken = createdKey();
    const client = fakeClient({
      listOrganizationTokens: vi.fn(async () => [
        { id: 3, name: "cuby-desktop-alice-2", key: "sk-almost" }
      ]),
      createOrganizationToken
    });
    const { repository } = fakeRepository();
    const service = singleNodeService(client, repository);

    const result = await service.login({ username: "alice", password: "Passw0rd1" });

    expect(createOrganizationToken).toHaveBeenCalledTimes(1);
    expect(result.provisioning.apiKey).toBe("sk-org-created");
  });

  it("reuses the key it finds instead of creating a second one", async () => {
    const client = fakeClient();
    const { repository } = fakeRepository();
    const service = singleNodeService(client, repository);

    const result = await service.login({ username: "alice", password: "Passw0rd1" });

    expect(client.createOrganizationToken).not.toHaveBeenCalled();
    expect(result.provisioning.apiKey).toBe("sk-org");
  });

  it("still measures the lines when nothing is known about the account", async () => {
    const probes: number[] = [];
    const service = createTestService({
      nodes: TWO_NODES,
      probeDefaultNodeId: "cn",
      onProbe: () => probes.push(1)
    });

    await service.login({ username: "alice", password: "Passw0rd1" });

    expect(probes).toHaveLength(1);
  });
});

describe("desktop token name", () => {
  it("names the organization token after the account, dropping the email domain", () => {
    expect(toDesktopTokenName("liangyt@yeebo.com.cn")).toBe("cuby-desktop-liangyt");
  });

  it("takes the whole username when it carries no domain", () => {
    expect(toDesktopTokenName("liangyt")).toBe("cuby-desktop-liangyt");
  });

  it("keeps the case and punctuation the instance stores", () => {
    // cuberouter usernames are case-sensitive, so folding case would name a key the
    // administrator cannot find in their console.
    expect(toDesktopTokenName("Liang.YT@yeebo.com.cn")).toBe("cuby-desktop-Liang.YT");
  });

  it("takes the build's prefix in place of the shipped one", () => {
    expect(toDesktopTokenName("liangyt@yeebo.com.cn", "team-desktop")).toBe("team-desktop-liangyt");
  });

  it("never leaves the prefix bare when there is nothing before the separator", () => {
    expect(toDesktopTokenName("@yeebo.com.cn")).toBe("cuby-desktop-@yeebo.com.cn");
  });

  it("ignores surrounding whitespace", () => {
    expect(toDesktopTokenName("  liangyt@yeebo.com.cn  ")).toBe("cuby-desktop-liangyt");
  });
});

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
      // No organization: the key under test is the personal one, which is keys[0] only then.
      listOrganizations: vi.fn(async () => []),
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

describe("cuberouter key reprovision", () => {
  it("re-runs the instance-side find-or-create for the signed-in account", async () => {
    const client = fakeClient();
    const service = singleNodeService(client, authenticatedRepository());

    await expect(service.reprovisionKey()).resolves.toEqual({
      apiKey: "sk-org",
      apiBase: "http://127.0.0.1:3000/v1",
      model: "deepseek-flash"
    });
    expect(client.listOrganizationTokens).toHaveBeenCalledWith("jwt-1", "7", "cuby-desktop-alice");
  });

  it("reuses the personal key it finds instead of creating a second one", async () => {
    // 「重新获取 key」 is a refresh, not a provisioning: an existing key — an operator's included —
    // is handed back rather than a second one created under the same name.
    const client = fakeClient({
      listOrganizations: vi.fn(async () => []),
      searchPersonalTokens: vi.fn(async () => [{ id: 41, name: "cuby-desktop-alice", status: 1 }]),
      getPersonalTokenKey: vi.fn(async () => "sk-personal")
    });
    const service = singleNodeService(client, authenticatedRepository());

    await expect(service.reprovisionKey()).resolves.toMatchObject({ apiKey: "sk-personal" });
    expect(client.createPersonalToken).not.toHaveBeenCalled();
  });

  it("refuses to re-provision without a session, on the local contract's code", async () => {
    const service = singleNodeService(fakeClient(), {
      get: () => ({ authenticated: false, profile: {} }),
      getCloudUuid: () => null,
      upsert: vi.fn(),
      clear: vi.fn()
    });

    // Mapped out of cuberouter's own "rejected": that code is not on the local contract, so
    // the envelope used to fold it into a 500 "internal" the desktop could say nothing about.
    await expect(service.reprovisionKey()).rejects.toMatchObject({
      code: "invalid_argument",
      message: "尚未登录 cuberouter 账号"
    });
  });
});

describe("cuberouter credential renewal", () => {
  it("stores the renewable credential the login handed back, after the account row exists", async () => {
    const client = fakeClient({
      login: vi.fn(async () => ({
        accessToken: "jwt-1",
        userId: "7",
        username: "alice",
        displayName: "Alice",
        accessExpiresAt: 1790456789,
        refreshToken: "rt-1"
      }))
    });
    // The credential is keyed to the active account, and on a first login the row that becomes
    // active is the one the upsert creates — so the order is the invariant, not just the call.
    const order: string[] = [];
    const { repository, upsert } = fakeRepository();
    repository.upsert = upsert;
    const service = singleNodeService(client, {
      ...repository,
      upsert: vi.fn((input: any) => {
        order.push("upsert");
        return (upsert as any)(input);
      }),
      setCuberouterCredential: vi.fn(() => {
        order.push("setCuberouterCredential");
      })
    });

    await service.login({ username: "alice", password: "Passw0rd1" });

    expect(order).toEqual(["upsert", "setCuberouterCredential"]);
  });

  it("renews an expired access token before reading the model choices", async () => {
    const listOrganizations = vi.fn(async () => [{ id: "7", name: "yeebo" }]);
    const client = fakeClient({
      listOrganizations,
      refreshSession: vi.fn(async () => ({
        accessToken: "jwt-renewed",
        accessExpiresAt: 4102444800,
        refreshToken: "rt-2"
      }))
    });
    const repository = authenticatedRepository(EXPIRED_CREDENTIAL);

    await singleNodeService(client, repository).readModelChoices();

    expect(client.refreshSession).toHaveBeenCalledWith("rt-1");
    expect(listOrganizations).toHaveBeenCalledWith("jwt-renewed");
    expect(repository.setCuberouterCredential).toHaveBeenCalledWith({
      accessToken: "jwt-renewed",
      accessExpiresAt: 4102444800,
      refreshToken: "rt-2"
    });
  });

  it("uses a live access token without renewing it", async () => {
    const listOrganizations = vi.fn(async () => [{ id: "7", name: "yeebo" }]);
    const client = fakeClient({ listOrganizations, refreshSession: vi.fn() });
    const repository = authenticatedRepository(LIVE_CREDENTIAL);

    await singleNodeService(client, repository).readModelChoices();

    expect(client.refreshSession).not.toHaveBeenCalled();
    expect(listOrganizations).toHaveBeenCalledWith("jwt-live");
  });

  it("falls back to the cloud uuid for a session that predates the stored credential", async () => {
    const listOrganizations = vi.fn(async () => [{ id: "7", name: "yeebo" }]);
    const client = fakeClient({ listOrganizations, refreshSession: vi.fn() });

    await singleNodeService(client, authenticatedRepository()).readModelChoices();

    expect(client.refreshSession).not.toHaveBeenCalled();
    expect(listOrganizations).toHaveBeenCalledWith("jwt-1");
  });

  it("reports an expired session it cannot renew instead of sending a dead token", async () => {
    const client = fakeClient({ refreshSession: vi.fn() });
    const repository = authenticatedRepository({ ...EXPIRED_CREDENTIAL, refreshToken: null });

    await expect(singleNodeService(client, repository).readModelChoices()).rejects.toMatchObject({
      code: "unauthorized"
    });
  });

  it("reports a rejected renewal as an expired session, not a crash", async () => {
    const client = fakeClient({
      refreshSession: vi.fn(async () => {
        throw Object.assign(new Error("登录已过期，请重新登录"), { code: "session_expired" });
      })
    });
    const repository = authenticatedRepository(EXPIRED_CREDENTIAL);

    await expect(singleNodeService(client, repository).readModelChoices()).rejects.toMatchObject({
      code: "unauthorized",
      message: "登录已过期，请重新登录"
    });
  });
});
