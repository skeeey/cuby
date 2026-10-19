// @vitest-environment happy-dom

/** Auth flow tests. */
import type {
  CuberouterAuthResult,
  CuberouterModelChoicesView,
  ModelConfigInput,
  ModelConfigTestResult,
  ModelConfigView
} from "@memmy/local-api-contracts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppClients } from "../../api/client-types.js";
import type { ModelProviderConfig } from "../../api/config-client.js";
import { AccountAuthPanel } from "../../components/account-auth-panel.js";
import { appActions } from "../../state/app-actions.js";
import { createInitialAppState, type AppState } from "../../state/app-reducer.js";
import { applyCuberouterSelection, createModelWorkspace } from "../../state/model-workspace.js";

const mocks = vi.hoisted(() => ({
  clients: null as AppClients | null,
  state: null as AppState | null,
  dispatch: vi.fn()
}));

vi.mock("../../app/providers.js", () => ({
  useApiClients: () => ({ clients: mocks.clients, setClients: vi.fn() })
}));

vi.mock("../../state/app-state.js", () => ({
  useAppState: () => ({ state: mocks.state, dispatch: mocks.dispatch })
}));

vi.mock("../../i18n/use-translation.js", () => ({
  useTranslation: () => ({ t: (key: string) => key, language: "zh-CN" })
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("auth flow", () => {
  let container: HTMLDivElement;
  let root: Root;
  let order: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    localStorage.clear();
    order = [];
    mocks.state = createInitialAppState();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    mocks.clients = null;
    mocks.state = null;
    vi.restoreAllMocks();
  });

  it("提交用户名密码后写入模型配置、选择 byok 模式并跳转", async () => {
    const server = createAuthServer(order);
    mocks.clients = server.client;
    await renderPanel();
    await fillCredentials();
    await clickButton("account.register");

    await vi.waitFor(() => expect(mocks.dispatch).toHaveBeenCalledWith(appActions.navigate("/onboarding")));
    expect(order[0]).toBe("account.register");
    expect(order.indexOf("saveModelCatalog")).toBeLessThan(order.indexOf("updateSettings"));
    expect(order.indexOf("updateSettings")).toBeLessThan(order.indexOf("updateOnboarding"));
    expect(mocks.dispatch).toHaveBeenLastCalledWith(appActions.navigate("/onboarding"));
  });

  it("把面板写入的 provider/endpoint/preset 指向注册拿到的 cuberouter 端点", async () => {
    const server = createAuthServer(order);
    mocks.clients = server.client;
    await renderPanel();
    await fillCredentials();
    await clickButton("account.register");

    await vi.waitFor(() => expect(server.savedInput()).not.toBeNull());
    const saved = server.savedInput()!;
    expect(saved.providers).toHaveLength(1);
    const provider = saved.providers[0]!;
    expect(provider.provider).toBe("openai");
    expect(provider.endpoints).toHaveLength(1);
    expect(provider.endpoints[0]!.apiBase).toBe("http://127.0.0.1:3100/v1");
    expect(provider.endpoints[0]!.apiKey).toBe("sk-cuberouter");
    expect(provider.models[0]!.model).toBe("deepseek-flash");
    expect(provider.models[0]!.capabilities).toEqual(
      expect.arrayContaining(["agent", "memory_summary", "memory_evolution"])
    );
    const presetId = provider.models[0]!.presetId;
    expect(presetId).toBeTruthy();
    expect(saved.modelAssignments.byok.agent.default).toBe(presetId);
    expect(saved.modelAssignments.byok.agent.candidates).toContain(presetId);
    expect(saved.modelAssignments.byok.memorySummary).toBe(presetId);
    expect(saved.modelAssignments.byok.memoryEvolution).toBe(presetId);
    expect(saved.modelAssignments.byok.embedding).toBeNull();
  });

  it("登录模式走 login 桩，不在注册接口上重试", async () => {
    const server = createAuthServer(order);
    mocks.clients = server.client;
    await renderPanel("login");
    await fillCredentials();
    await clickButton("account.login");

    await vi.waitFor(() => expect(mocks.dispatch).toHaveBeenCalledWith(appActions.navigate("/onboarding")));
    expect(order[0]).toBe("account.login");
    expect(order).not.toContain("account.register");
  });

  it("模型自检失败只提示告警，仍然继续跳转", async () => {
    const server = createAuthServer(order, {
      testResult: { ok: false, message: "quota exhausted", checkedAt: "2026-09-16T00:00:00.000Z" }
    });
    mocks.clients = server.client;
    await renderPanel();
    await fillCredentials();
    await clickButton("account.register");

    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toBe("account.warning.modelUnavailable"));
    expect(mocks.dispatch).toHaveBeenCalledWith(appActions.navigate("/onboarding"));
    expect(server.savedInput()!.modelAssignments.byok.agent.default).not.toBeNull();
  });

  it("选模式失败后重试只重跑续接，不重新注册", async () => {
    const server = createAuthServer(order, { failFirstModePersist: true });
    mocks.clients = server.client;
    await renderPanel();
    await fillCredentials();
    await clickButton("account.register");

    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toBe("login.error.modePersistenceFailed"));
    expect(mocks.dispatch).not.toHaveBeenCalledWith(appActions.navigate("/onboarding"));

    await clickButton("account.register");

    await vi.waitFor(() => expect(mocks.dispatch).toHaveBeenCalledWith(appActions.navigate("/onboarding")));
    expect(order.filter((entry) => entry === "account.register")).toHaveLength(1);
    expect(order.filter((entry) => entry === "updateSettings")).toHaveLength(2);
  });

  it("续接失败后改动用户名会重新认证新账号，而不是续接上一个账号", async () => {
    const server = createAuthServer(order, { failFirstModePersist: true });
    mocks.clients = server.client;
    await renderPanel();
    await fillCredentials();
    await clickButton("account.register");

    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toBe("login.error.modePersistenceFailed"));

    // Retyping the username abandons the stored result: the second submit must authenticate
    // the new credentials rather than provisioning the first account again.
    await fillInput(0, "bob");
    await clickButton("account.register");

    await vi.waitFor(() => expect(mocks.dispatch).toHaveBeenCalledWith(appActions.navigate("/onboarding")));
    expect(server.registerUsernames()).toEqual(["alice", "bob"]);
  });

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
    expect(server.client.account.revealPersonalKey).toHaveBeenCalledWith(41);
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
    // The remembered key is gone: the record goes with it, so the panel stops naming it selected.
    expect(localStorage.getItem("memmy.cuberouterKeySelection.v1")).toBeNull();
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

  async function renderPanel(mode: "login" | "register" = "register") {
    await act(async () => root.render(createElement(AccountAuthPanel)));
    // The card opens on login; the register flow has to ask for its form first.
    if (mode === "register") {
      await clickButton("account.switchToRegister");
    }
  }

  async function fillCredentials() {
    await fillInput(0, "alice");
    await fillInput(1, "Passw0rd1");
    if (container.querySelectorAll("input").length > 2) {
      await fillInput(2, "Passw0rd1");
    }
  }

  async function fillInput(index: number, value: string) {
    const input = [...container.querySelectorAll("input")][index];
    if (!(input instanceof HTMLInputElement)) {
      throw new Error(`input not found: ${index}`);
    }
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function clickButton(label: string) {
    const target = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
    if (!(target instanceof HTMLButtonElement)) {
      throw new Error(`button not found: ${label}`);
    }
    await act(async () => target.click());
  }
});

describe("auth flow pages", () => {
  it.each([
    ["welcome-page.tsx"],
    ["login-page.tsx"]
  ])("%s 渲染共用的 cuberouter 面板，不再引用验证码表单", (fileName) => {
    const source = readPageSource(fileName);

    expect(source).toContain("<AccountAuthPanel />");
    expect(source).not.toContain("AuthCodeForm");
    expect(source).not.toContain("useVerificationCodeAuth");
  });

  it("面板按 提交 → 复核 key → 供给模型 → 选 byok 模式 → 跳转 的顺序续接", () => {
    const panel = readFileSync(resolve(__dirname, "../../components/account-auth-panel.tsx"), "utf8");
    const loginIndex = panel.indexOf("await auth.login(");
    const resolveIndex = panel.indexOf("await resolveCuberouterLoginKey({");
    const provisionIndex = panel.indexOf("await provisionCuberouterKey({");
    const modeIndex = panel.indexOf("await persistLoginModeSelection({");
    const navigateIndex = panel.indexOf("dispatch(appActions.navigate(");

    expect(panel).toContain("if (!result || !result.session.authenticated) return;");
    expect(loginIndex).toBeGreaterThanOrEqual(0);
    expect(resolveIndex).toBeGreaterThan(loginIndex);
    expect(provisionIndex).toBeGreaterThan(resolveIndex);
    expect(modeIndex).toBeGreaterThan(provisionIndex);
    expect(navigateIndex).toBeGreaterThan(modeIndex);
    expect(panel).toContain("userMode: \"byok\"");
  });
});

/** Reads read page source. */
function readPageSource(fileName: string): string {
  return readFileSync(resolve(__dirname, "..", fileName), "utf8");
}

function createAuthServer(
  order: string[],
  options: {
    testResult?: ModelConfigTestResult;
    failFirstModePersist?: boolean;
    modelChoices?: CuberouterModelChoicesView;
    revealedKey?: string;
    catalog?: ModelConfigView;
    choicesFailure?: boolean;
  } = {}
) {
  let catalog: ModelConfigView = options.catalog ?? createModelWorkspace(null).catalog;
  let written: ModelConfigInput | null = null;
  let modePersistAttempts = 0;
  const registerUsernames: string[] = [];
  return {
    client: {
      account: {
        getRegistrationRequirements: vi.fn(async () => ({
          emailVerificationRequired: false,
          turnstileRequired: false
        })),
        register: vi.fn(async (input: { username: string }) => {
          order.push("account.register");
          registerUsernames.push(input.username);
          return authResult();
        }),
        login: vi.fn(async () => {
          order.push("account.login");
          return authResult();
        }),
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
      },
      config: {
        getModelConfig: vi.fn(async () => {
          order.push("getModelConfig");
          return providerConfig(catalog);
        }),
        saveModelCatalog: vi.fn(async (input: ModelConfigInput) => {
          order.push("saveModelCatalog");
          written = structuredClone(input);
          catalog = catalogFromSave(input);
          return providerConfig(catalog);
        }),
        testModelConfig: vi.fn(async () => {
          order.push("testModelConfig");
          return options.testResult ?? { ok: true, message: "ok", checkedAt: "2026-09-16T00:00:00.000Z" };
        }),
        updateSettings: vi.fn(async (settings) => {
          order.push("updateSettings");
          if (options.failFirstModePersist && modePersistAttempts++ === 0) {
            throw new Error("settings offline");
          }
          return settings;
        }),
        updateOnboarding: vi.fn(async (onboarding) => {
          order.push("updateOnboarding");
          return onboarding;
        })
      }
    } as unknown as AppClients,
    savedInput: () => written && structuredClone(written),
    registerUsernames: () => [...registerUsernames]
  };
}

function authResult(): CuberouterAuthResult {
  return {
    session: {
      authenticated: true,
      isNewUser: true,
      profile: {
        userId: "cuberouter-user-1",
        email: "alice@example.com",
        phoneNumber: null,
        nickname: "alice",
        registeredAt: "2026-09-16T00:00:00.000Z",
        // The cuberouter service always writes null here: it has no memmy cloud guide state.
        hasFinishedGuide: null,
        // The machine's key record is per username, so the profile has to carry the real one.
        username: "alice@a.com"
      }
    },
    provisioning: {
      apiKey: "sk-cuberouter",
      apiBase: "http://127.0.0.1:3100/v1",
      model: "deepseek-flash"
    }
  } as unknown as CuberouterAuthResult;
}

function providerConfig(catalog: ModelConfigView): ModelProviderConfig {
  return {
    catalog,
    configRevision: catalog.configRevision,
    provider: "openai",
    endpoint: "",
    model: "",
    apiKey: "",
    apiKeyMasked: "",
    configured: false
  };
}

/** Mirrors what the local API returns after a catalog write, for the panel's post-save read. */
function catalogFromSave(input: ModelConfigInput): ModelConfigView {
  const base = createModelWorkspace(null).catalog;
  return {
    ...base,
    configRevision: "rev-2",
    providers: input.providers.map((provider) => ({
      provider: provider.provider,
      configured: true,
      hasApiKey: true,
      apiKeyMasked: "",
      apiKey: "",
      accountManaged: false,
      editable: true,
      endpoints: provider.endpoints.map((endpoint) => ({
        endpointId: endpoint.endpointId,
        apiBase: endpoint.apiBase,
        protocol: endpoint.protocol,
        hasApiKey: Boolean(endpoint.apiKey),
        apiKeyMasked: "",
        apiKey: ""
      })),
      models: provider.models.map((model) => ({
        presetId: model.presetId ?? "",
        provider: provider.provider,
        endpointId: model.endpointId,
        protocol: provider.endpoints.find((endpoint) => endpoint.endpointId === model.endpointId)?.protocol
          ?? "openai-chat-completions",
        model: model.model,
        source: model.source,
        capabilities: [...model.capabilities],
        available: true
      }))
    })),
    modelAssignments: structuredClone(input.modelAssignments),
    configured: true
  };
}
