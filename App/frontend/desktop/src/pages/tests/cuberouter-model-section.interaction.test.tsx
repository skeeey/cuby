// @vitest-environment happy-dom

/** Cuberouter model section tests. */
import type { CuberouterModelChoicesView, ModelConfigInput, ModelConfigView } from "@memmy/local-api-contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/i18n-provider.js";
import { ApiRequestError } from "../../api/http.js";
import { CUBEROUTER_KEY_SELECTION_STORAGE_KEY } from "../../state/cuberouter-key-selection.js";
import { applyCuberouterSelection, createModelWorkspace, maskApiKey } from "../../state/model-workspace.js";
import { CuberouterModelSection, toggleAgentModel } from "../cuberouter-model-section.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CHOICES: CuberouterModelChoicesView = {
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

/** The stored catalog the login flow leaves behind: the line's endpoint and key, nothing assigned. */
function storedConfigWithEndpoint(): { catalog: ModelConfigView; configRevision: string } {
  const seeded = applyCuberouterSelection(createModelWorkspace(null), {
    apiBase: CHOICES.apiBase,
    protocol: "openai-chat-completions",
    apiKey: "sk-stored",
    selection: { agent: { models: [] }, memorySummary: "", memoryEvolution: "" }
  });
  return { catalog: seeded.catalog, configRevision: "rev-1" };
}

/** Mirrors the catalog the local API answers a write with: what it stored, with keys masked. */
function catalogFromSave(input: ModelConfigInput, previous: ModelConfigView): ModelConfigView {
  const base = createModelWorkspace(null).catalog;
  const providers = input.providers.map((provider) => {
    const previousProvider = previous.providers.find((item) => item.provider === provider.provider);
    const endpoints = provider.endpoints.map((endpoint) => {
      // A write without a plaintext key keeps the stored one, so the mask carries over.
      const plaintext = endpoint.apiKey?.trim() ?? "";
      const previousEndpoint = previousProvider?.endpoints
        .find((item) => item.endpointId === endpoint.endpointId);
      const apiKeyMasked = plaintext ? maskApiKey(plaintext) : previousEndpoint?.apiKeyMasked ?? "";
      return {
        endpointId: endpoint.endpointId,
        apiBase: endpoint.apiBase,
        protocol: endpoint.protocol,
        hasApiKey: Boolean(plaintext || apiKeyMasked),
        apiKeyMasked,
        apiKey: ""
      };
    });
    const providerApiKeyMasked = provider.apiKey ? maskApiKey(provider.apiKey) : "";
    return {
      provider: provider.provider,
      configured: endpoints.some((endpoint) => endpoint.hasApiKey),
      hasApiKey: Boolean(providerApiKeyMasked) || endpoints.some((endpoint) => endpoint.hasApiKey),
      apiKeyMasked: providerApiKeyMasked,
      apiKey: "",
      endpoints,
      accountManaged: false,
      editable: true,
      models: provider.models.map((model) => ({
        presetId: model.presetId ?? "",
        provider: provider.provider,
        endpointId: model.endpointId,
        protocol: endpoints.find((item) => item.endpointId === model.endpointId)?.protocol
          ?? "openai-chat-completions",
        model: model.model,
        source: model.source,
        capabilities: [...model.capabilities],
        available: true
      }))
    };
  });
  const presets = providers.flatMap((provider) => provider.models);
  const effective = (ids: string[]) => presets.filter((preset) => ids.includes(preset.presetId));
  return {
    ...base,
    configRevision: "rev-2",
    providers,
    modelAssignments: structuredClone(input.modelAssignments),
    effectiveCandidates: {
      byok: effective(input.modelAssignments.byok.agent.candidates),
      account: effective(input.modelAssignments.account.agent.candidates)
    },
    configured: input.modelAssignments.byok.agent.candidates.length > 0
  };
}

describe("cuberouter model section", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  it("lists my keys with their billing and balance, disabling unusable rows", async () => {
    await renderSection();

    await vi.waitFor(() => expect(container.textContent).toContain("cuby-desktop-alice"));
    expect(container.textContent).toContain("计费：组织 yeebo");
    expect(container.textContent).toContain("剩余 97500");
    expect(radio("cuby-desktop-alice").disabled).toBe(false);
    expect(radio("my-own-key").disabled).toBe(true);
  });

  it("reveals a personal key on selection and writes it into the model config", async () => {
    const { accountClient, configClient } = await renderSection({
      choices: async () => ({
        ...CHOICES,
        keys: [{ ...CHOICES.keys[1]!, status: 1, usable: true }]
      })
    });

    await vi.waitFor(() => expect(radio("my-own-key").disabled).toBe(false));
    await act(async () => radio("my-own-key").click());

    expect(accountClient.revealPersonalKey).toHaveBeenCalledWith(41);
    expect(configClient.saveModelCatalog).toHaveBeenCalled();
    const written = configClient.saveModelCatalog.mock.calls[0]![0];
    expect(JSON.stringify(written)).toContain("sk-personal");
    expect(radio("my-own-key").checked).toBe(true);
    expect(window.localStorage.getItem(CUBEROUTER_KEY_SELECTION_STORAGE_KEY)).toContain("my-own-key");
  });

  it("shows the save error and leaves the selection record unwritten when the save fails", async () => {
    await renderSection({
      choices: async () => ({
        ...CHOICES,
        keys: [{ ...CHOICES.keys[1]!, status: 1, usable: true }]
      }),
      save: async () => {
        throw Object.assign(new Error("boom"), { code: "internal" });
      }
    });

    await vi.waitFor(() => expect(radio("my-own-key").disabled).toBe(false));
    await act(async () => radio("my-own-key").click());

    expect(container.textContent).toContain("模型配置保存失败，请重试；如仍失败，请重启应用后再试。");
    expect(window.localStorage.getItem(CUBEROUTER_KEY_SELECTION_STORAGE_KEY)).toBeNull();
  });

  it("re-runs the provisioning behind 「重新获取 key」 and reloads the key list", async () => {
    // The record names a key the list no longer has: the panel offers the refresh entry.
    window.localStorage.setItem(CUBEROUTER_KEY_SELECTION_STORAGE_KEY, JSON.stringify({
      "alice@a.com": { username: "alice@a.com", scope: "personal", id: 99, name: "gone" }
    }));
    const { accountClient, configClient } = await renderSection({ storedConfig: storedConfigWithEndpoint() });

    await vi.waitFor(() => expect(refreshKeysButton()).toBeInstanceOf(HTMLButtonElement));
    await act(async () => refreshKeysButton().click());

    await vi.waitFor(() => expect(configClient.saveModelCatalog).toHaveBeenCalledTimes(1));
    expect(accountClient.reprovisionKey).toHaveBeenCalledTimes(1);
    const written = configClient.saveModelCatalog.mock.calls[0]![0] as ModelConfigInput;
    expect(JSON.stringify(written)).toContain("sk-fresh");
    const preset = written.providers[0]!.models[0]!;
    expect(preset.model).toBe("deepseek-v4.1-flash");
    expect(written.modelAssignments.byok.agent.candidates).toEqual([preset.presetId]);
    expect(written.modelAssignments.byok.agent.default).toBe(preset.presetId);
    expect(written.modelAssignments.byok.memorySummary).toBe(preset.presetId);
    expect(written.modelAssignments.byok.memoryEvolution).toBe(preset.presetId);
    // The key just written has no list identity yet: the record goes and the list is re-read.
    await vi.waitFor(() => expect(window.localStorage.getItem(CUBEROUTER_KEY_SELECTION_STORAGE_KEY)).toBeNull());
    await vi.waitFor(() => expect(accountClient.getModelChoices).toHaveBeenCalledTimes(2));
  });

  it("refreshes with the first listed model when the instance does not list the provisioned model", async () => {
    // The re-provisioned model is one this instance does not offer: seeding the three slots with
    // it would hand the account a model it cannot call, so the first listed model takes its place
    // — the connection cannot be written without one. The fresh key lands with that model.
    window.localStorage.setItem(CUBEROUTER_KEY_SELECTION_STORAGE_KEY, JSON.stringify({
      "alice@a.com": { username: "alice@a.com", scope: "personal", id: 99, name: "gone" }
    }));
    const { accountClient, configClient } = await renderSection({
      storedConfig: storedConfigWithEndpoint(),
      reprovision: async () => ({
        apiKey: "sk-fresh",
        apiBase: CHOICES.apiBase,
        model: "unlisted-model"
      })
    });

    await vi.waitFor(() => expect(refreshKeysButton()).toBeInstanceOf(HTMLButtonElement));
    await act(async () => refreshKeysButton().click());

    await vi.waitFor(() => expect(configClient.saveModelCatalog).toHaveBeenCalledTimes(1));
    const written = configClient.saveModelCatalog.mock.calls[0]![0] as ModelConfigInput;
    expect(JSON.stringify(written)).toContain("sk-fresh");
    // The contract's floor: a provider must carry at least one model.
    expect(written.providers[0]!.models.length).toBeGreaterThan(0);
    expect(written.providers[0]!.models.map((preset) => preset.model)).toEqual(["deepseek-v4.1-flash"]);
    const presetId = written.providers[0]!.models[0]!.presetId;
    expect(written.modelAssignments.byok.agent.candidates).toEqual([presetId]);
    expect(written.modelAssignments.byok.agent.default).toBe(presetId);
    expect(written.modelAssignments.byok.memorySummary).toBe(presetId);
    expect(written.modelAssignments.byok.memoryEvolution).toBe(presetId);
    expect(JSON.stringify(written)).not.toContain("unlisted-model");
    // The key just written has no list identity yet: the record goes and the list is re-read.
    await vi.waitFor(() => expect(window.localStorage.getItem(CUBEROUTER_KEY_SELECTION_STORAGE_KEY)).toBeNull());
    await vi.waitFor(() => expect(accountClient.getModelChoices).toHaveBeenCalledTimes(2));
  });

  it("keeps the record and the retry entry when the refresh save fails", async () => {
    // A refused save writes nothing, so nothing may be claimed: the record has to survive, or
    // the entry's own gate (`record && !selectedKey`) removes the only way to try again.
    window.localStorage.setItem(CUBEROUTER_KEY_SELECTION_STORAGE_KEY, JSON.stringify({
      "alice@a.com": { username: "alice@a.com", scope: "personal", id: 99, name: "gone" }
    }));
    const { accountClient, configClient } = await renderSection({
      storedConfig: storedConfigWithEndpoint(),
      save: async () => {
        throw Object.assign(new Error("boom"), { code: "internal" });
      }
    });

    await vi.waitFor(() => expect(refreshKeysButton()).toBeInstanceOf(HTMLButtonElement));
    await act(async () => refreshKeysButton().click());
    await vi.waitFor(() => expect(configClient.saveModelCatalog).toHaveBeenCalledTimes(1));

    await vi.waitFor(() => expect(
      window.localStorage.getItem(CUBEROUTER_KEY_SELECTION_STORAGE_KEY)
    ).toContain("gone"));
    expect(refreshKeysButton()).toBeInstanceOf(HTMLButtonElement);
    // The list is not re-read either: the catalog never took the new key.
    expect(accountClient.getModelChoices).toHaveBeenCalledTimes(1);
  });

  it("shows a retry state when the choices request fails", async () => {
    const { accountClient } = await renderSection({
      choices: async () => {
        throw new Error("boom");
      }
    });

    await vi.waitFor(() => expect(container.textContent).toContain("模型配置数据加载失败，请重试。"));
    const retry = [...container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === "重试");
    expect(retry).toBeInstanceOf(HTMLButtonElement);

    await act(async () => retry!.click());

    expect(accountClient.getModelChoices).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("模型配置数据加载失败，请重试。");
  });

  it("reports an expired session instead of a retry it cannot honour", async () => {
    await renderSection({
      choices: async () => {
        throw new ApiRequestError("登录已过期，请重新登录", 401, "unauthorized");
      }
    });

    await vi.waitFor(() => expect(container.textContent).toContain("cuberouter 登录已过期。"));
    // Retrying would resend the same dead token, so the button must not be offered, and the
    // panel has to say where to fix it instead of leaving the user at a dead end.
    expect([...container.querySelectorAll("button")].some((candidate) => candidate.textContent === "重试")).toBe(false);
    expect(container.textContent).toContain("退出登录");
  });

  it("assigns instance models per slot and writes one preset per used model", async () => {
    const { configClient } = await renderSection({ storedConfig: storedConfigWithEndpoint() });

    await vi.waitFor(() => expect(radio("cuby-desktop-alice").disabled).toBe(false));
    await act(async () => radio("cuby-desktop-alice").click());
    await awaitSave(configClient, 1);

    act(() => pickerToggle().click());
    act(() => candidateCheckbox("gpt-oss-120b").click());
    await awaitSave(configClient, 2);

    await chooseRowModel(configClient, "记忆摘要", "deepseek-v4.1-flash", 3);
    await chooseRowModel(configClient, "技能进化", "deepseek-v4.1-flash", 4);

    const written = configClient.saveModelCatalog.mock.calls.at(-1)![0] as ModelConfigInput;
    const presets = written.providers[0]!.models;
    // One preset per used model, not per slot: the shared model serves both memory slots.
    expect(presets.map((preset) => preset.model).sort()).toEqual(["deepseek-v4.1-flash", "gpt-oss-120b"]);
    expect(presets.find((preset) => preset.model === "gpt-oss-120b")!.capabilities).toEqual(["agent"]);
    expect(presets.find((preset) => preset.model === "deepseek-v4.1-flash")!.capabilities)
      .toEqual(["memory_evolution", "memory_summary"]);
    const presetIdOf = (model: string) => presets.find((preset) => preset.model === model)!.presetId;
    expect(written.modelAssignments.byok.agent.candidates).toEqual([presetIdOf("gpt-oss-120b")]);
    expect(written.modelAssignments.byok.memorySummary).toBe(presetIdOf("deepseek-v4.1-flash"));
    expect(written.modelAssignments.byok.memoryEvolution).toBe(presetIdOf("deepseek-v4.1-flash"));
  });

  it("disables the assignment controls while a save is in flight", async () => {
    let releaseSave: () => void = () => {};
    const { configClient } = await renderSection({
      storedConfig: storedConfigWithEndpoint(),
      save: (payload, previous) => new Promise((resolve) => {
        releaseSave = () => resolve({ catalog: catalogFromSave(payload, previous), configRevision: "rev-2" });
      })
    });

    await vi.waitFor(() => expect(radio("cuby-desktop-alice").disabled).toBe(false));
    await act(async () => radio("cuby-desktop-alice").click());
    await vi.waitFor(() => expect(configClient.saveModelCatalog).toHaveBeenCalledTimes(1));

    expect(pickerToggle().disabled).toBe(true);
    expect(assignmentCombobox("记忆摘要").disabled).toBe(true);

    await act(async () => releaseSave());
    await awaitIdle();
    expect(pickerToggle().disabled).toBe(false);
  });

  it("keeps the assignment rows and the fold closed while a key reveal is still in flight", async () => {
    let revealKey: () => void = () => {};
    const { configClient } = await renderSection({
      choices: async () => ({
        ...CHOICES,
        keys: [{ ...CHOICES.keys[1]!, status: 1, usable: true }]
      }),
      reveal: () => new Promise((resolve) => {
        revealKey = () => resolve({ key: "sk-personal" });
      })
    });

    await vi.waitFor(() => expect(radio("my-own-key").disabled).toBe(false));
    await act(async () => advancedToggle().click());
    act(() => radio("my-own-key").click());

    // The key's save has not started yet — its plaintext is still being revealed — but every
    // other control waits for the whole key action, so no second save can slip into that window.
    expect(configClient.saveModelCatalog).not.toHaveBeenCalled();
    expect(assignmentCombobox("记忆摘要").disabled).toBe(true);
    expect(assignmentCombobox("技能进化").disabled).toBe(true);
    expect(pickerToggle().disabled).toBe(true);
    expect(addConnectionButton()!.disabled).toBe(true);

    await act(async () => revealKey());

    await vi.waitFor(() => expect(configClient.saveModelCatalog).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(
      window.localStorage.getItem(CUBEROUTER_KEY_SELECTION_STORAGE_KEY)
    ).toContain("my-own-key"));
    await awaitIdle();
    expect(assignmentCombobox("记忆摘要").disabled).toBe(false);
  });

  it("shows the built-in local embedding row without offering other choices", async () => {
    await renderSection();

    await vi.waitFor(() => expect(container.textContent).toContain("本地向量模型（内建）"));
    expect(container.textContent).toContain("Embedding 检索");
    expect([...container.querySelectorAll(".model-assignment-label")].map((node) => node.textContent))
      .toEqual(["记忆摘要", "技能进化"]);
    expect(container.querySelectorAll('[role="combobox"]')).toHaveLength(2);
    expect(container.querySelector('button[aria-label*="ASR"]')).toBeNull();
    expect(container.querySelector('button[aria-label*="生图"]')).toBeNull();
  });

  it("shows the instance message and disables the assignment controls when it offers no models", async () => {
    await renderSection({ choices: async () => ({ ...CHOICES, models: [] }) });

    await vi.waitFor(() => expect(container.textContent).toContain("实例未返回可选模型。"));
    expect(pickerToggle().disabled).toBe(true);
    expect(assignmentCombobox("记忆摘要").disabled).toBe(true);
    expect(assignmentCombobox("技能进化").disabled).toBe(true);
  });

  it("surfaces models that left the instance list so they stay visible and re-choosable", async () => {
    // The stored draft names two models the instance no longer lists: the memory row must show
    // the real name instead of the 未配置 placeholder, the conversation picker must still offer
    // the agent model (so it can be unchecked), and one hint must say the list changed.
    const seeded = applyCuberouterSelection(createModelWorkspace(null), {
      apiBase: CHOICES.apiBase,
      protocol: "openai-chat-completions",
      apiKey: "sk-stored",
      selection: {
        agent: { models: ["gpt-oss-120b", "retired-agent"], default: "gpt-oss-120b" },
        memorySummary: "retired-summary",
        memoryEvolution: "gpt-oss-120b"
      }
    });

    await renderSection({
      choices: async () => ({ ...CHOICES, models: ["deepseek-v4.1-flash", "gpt-oss-120b"] }),
      seedConfig: { catalog: seeded.catalog, configRevision: "rev-1" }
    });

    await vi.waitFor(() => expect(assignmentCombobox("记忆摘要").textContent).toContain("retired-summary"));
    expect(assignmentCombobox("记忆摘要").textContent).not.toContain("未配置");
    // The row still pointing at a listed model is untouched.
    expect(assignmentCombobox("技能进化").textContent).toContain("gpt-oss-120b");

    act(() => pickerToggle().click());
    expect(candidateCheckbox("retired-agent")).toBeInstanceOf(HTMLButtonElement);
    expect(candidateCheckbox("gpt-oss-120b")).toBeInstanceOf(HTMLButtonElement);

    expect(container.textContent).toContain("有模型已不在实例可选列表中，请重新选择。");
  });

  it("keeps one agent model selected and repairs a default that left the list", () => {
    expect(toggleAgentModel({ models: ["gpt-oss-120b"] }, "gpt-oss-120b"))
      .toEqual({ models: ["gpt-oss-120b"] });
    expect(toggleAgentModel({ models: ["a", "b"], default: "a" }, "b"))
      .toEqual({ models: ["a"], default: "a" });
    expect(toggleAgentModel({ models: ["a", "b"], default: "b" }, "b"))
      .toEqual({ models: ["a"], default: "a" });
    expect(toggleAgentModel({ models: ["a"], default: "a" }, "b"))
      .toEqual({ models: ["a", "b"], default: "a" });
  });

  it("keeps the generic library behind an advanced fold, sharing the same save path", async () => {
    const { configClient } = await renderSection();

    await vi.waitFor(() => expect(advancedToggle()).toBeInstanceOf(HTMLButtonElement));
    expect(advancedToggle().getAttribute("aria-expanded")).toBe("false");
    expect(addConnectionButton()).toBeNull();

    await act(async () => advancedToggle().click());

    expect(advancedToggle().getAttribute("aria-expanded")).toBe("true");
    expect(addConnectionButton()).toBeInstanceOf(HTMLButtonElement);
    // 「高级」里的连接编辑与 key/分配共用同一份 workspace：一次保存带上整份目录。
    await act(async () => addConnectionButton()!.click());
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.textContent).toContain("API 地址");
    expect(configClient.saveModelCatalog).not.toHaveBeenCalled();

    // The fold hands its own client down: 测试连接 must reach the real one, not a simulated pass.
    const apiKeyField = dialog!.querySelector<HTMLInputElement>('input[type="password"]');
    expect(apiKeyField).toBeInstanceOf(HTMLInputElement);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
        .call(apiKeyField, "sk-advanced");
      apiKeyField!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => testConnectionButton(dialog!).click());
    expect(configClient.testModelConfig).toHaveBeenCalledTimes(1);
  });

  it("retries once when the catalog changed under a save", async () => {
    let attempts = 0;
    const { configClient } = await renderSection({
      save: async (payload, previous) => {
        attempts += 1;
        if (attempts === 1) {
          throw Object.assign(new Error("changed"), { code: "model_config_changed" });
        }
        return { catalog: catalogFromSave(payload, previous), configRevision: "rev-2" };
      }
    });

    await vi.waitFor(() => expect(radio("cuby-desktop-alice").disabled).toBe(false));
    await act(async () => radio("cuby-desktop-alice").click());

    await vi.waitFor(() => expect(configClient.saveModelCatalog).toHaveBeenCalledTimes(2));
    expect(attempts).toBe(2);
    await awaitIdle();
    expect(container.textContent)
      .not.toContain("模型配置保存失败，请重试；如仍失败，请重启应用后再试。");
  });

  it("replays the draft from storage when a save fails, leaving nothing ahead of the catalog", async () => {
    let refuseSave = false;
    const { configClient } = await renderSection({
      storedConfig: storedConfigWithEndpoint(),
      save: async (payload, previous) => {
        if (refuseSave) {
          throw Object.assign(new Error("boom"), { code: "internal" });
        }
        return { catalog: catalogFromSave(payload, previous), configRevision: "rev-2" };
      }
    });

    await vi.waitFor(() => expect(radio("cuby-desktop-alice").disabled).toBe(false));
    await act(async () => radio("cuby-desktop-alice").click());
    await awaitSave(configClient, 1);
    await chooseRowModel(configClient, "记忆摘要", "deepseek-v4.1-flash", 2);
    expect(assignmentCombobox("记忆摘要").textContent).toContain("deepseek-v4.1-flash");

    refuseSave = true;
    await chooseRowModel(configClient, "技能进化", "gpt-oss-120b", 3);

    expect(container.textContent).toContain("模型配置保存失败，请重试；如仍失败，请重启应用后再试。");
    // The refused pick is gone: the row is back on what the catalog still holds.
    expect(assignmentCombobox("技能进化").textContent).toContain("未配置");
    expect(assignmentCombobox("记忆摘要").textContent).toContain("deepseek-v4.1-flash");
  });

  it("saves an advanced connection edit through the panel and replays the draft from the new catalog", async () => {
    const { configClient } = await renderSection({ storedConfig: storedConfigWithEndpoint() });

    await vi.waitFor(() => expect(radio("cuby-desktop-alice").disabled).toBe(false));
    await act(async () => radio("cuby-desktop-alice").click());
    await awaitSave(configClient, 1);
    await chooseRowModel(configClient, "记忆摘要", "deepseek-v4.1-flash", 2);
    expect(assignmentCombobox("记忆摘要").textContent).toContain("deepseek-v4.1-flash");

    await act(async () => advancedToggle().click());
    await act(async () => editConnectionButton().click());
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const endpointField = [...dialog!.querySelectorAll<HTMLInputElement>("input")]
      .find((input) => input.value === CHOICES.apiBase);
    expect(endpointField).toBeInstanceOf(HTMLInputElement);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
        .call(endpointField, "https://other.example/v1");
      endpointField!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => dialog!.querySelector<HTMLButtonElement>('button[aria-label="保存"]')!.click());
    await awaitSave(configClient, 3);

    // One save carried the whole catalog; the line moved, so the draft follows storage again.
    const written = configClient.saveModelCatalog.mock.calls.at(-1)![0] as ModelConfigInput;
    expect(written.providers[0]!.endpoints[0]!.apiBase).toBe("https://other.example/v1");
    expect(assignmentCombobox("记忆摘要").textContent).toContain("未配置");
  });

  type SectionConfigClient = Awaited<ReturnType<typeof renderSection>>["configClient"];

  async function renderSection(input: {
    choices?: () => Promise<CuberouterModelChoicesView>;
    reveal?: (tokenId: number) => Promise<{ key: string }>;
    reprovision?: () => Promise<{ apiKey: string; apiBase: string; model: string }>;
    save?: (payload: ModelConfigInput, previous: ModelConfigView) => Promise<{ catalog: ModelConfigView; configRevision: string }>;
    storedConfig?: { catalog: ModelConfigView; configRevision: string };
    /** The catalog the host seeds the panel's draft with, as `state.modelConfig` does. */
    seedConfig?: { catalog: ModelConfigView; configRevision: string };
  } = {}) {
    // The local API answers a write with the catalog it stored, and the panel reads that answer
    // back into its workspace: the fake has to keep what it was handed.
    let stored = input.storedConfig?.catalog ?? createModelWorkspace(null).catalog;
    const accountClient = {
      getModelChoices: vi.fn(input.choices ?? (async () => CHOICES)),
      revealPersonalKey: vi.fn(input.reveal ?? (async () => ({ key: "sk-personal" }))),
      reprovisionKey: vi.fn(input.reprovision ?? (async () => ({
        apiKey: "sk-fresh",
        apiBase: CHOICES.apiBase,
        model: "deepseek-v4.1-flash"
      })))
    };
    const configClient = {
      getModelConfig: vi.fn(async () => ({ catalog: stored, configRevision: "rev-1" })),
      saveModelCatalog: vi.fn(async (payload: ModelConfigInput) => {
        // Only a resolved save is written back: a refused one leaves storage alone.
        const answer = input.save
          ? await input.save(payload, stored)
          : { catalog: catalogFromSave(payload, stored), configRevision: "rev-2" };
        stored = answer.catalog;
        return answer;
      }),
      testModelConfig: vi.fn(async () => ({ ok: true, message: "" }))
    };
    await act(async () => {
      root.render(
        <I18nProvider language="zh-CN">
          <CuberouterModelSection
            username="alice@a.com"
            organizationName="yeebo"
            seedConfig={input.seedConfig as never}
            configClient={configClient as never}
            accountClient={accountClient as never}
          />
        </I18nProvider>
      );
    });
    return { accountClient, configClient };
  }

  function radio(name: string): HTMLInputElement {
    const target = container.querySelector<HTMLInputElement>(`input[type="radio"][aria-label="${name}"]`);
    if (!target) {
      throw new Error(`radio not found: ${name}`);
    }
    return target;
  }

  /** The key card's 「重新获取 key」 entry, offered when the remembered key left the list. */
  function refreshKeysButton(): HTMLButtonElement {
    const target = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((candidate) => candidate.textContent?.includes("重新获取 key"));
    if (!target) {
      throw new Error("refresh keys button not found");
    }
    return target;
  }

  /** The panel's 「高级」 fold, which hides the generic connection library. */
  function advancedToggle(): HTMLButtonElement {
    const target = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((candidate) => candidate.textContent?.trim() === "高级");
    if (!target) {
      throw new Error("advanced fold toggle not found");
    }
    return target;
  }

  /** The library's add-connection button; null while the fold keeps the library unmounted. */
  function addConnectionButton(): HTMLButtonElement | null {
    return [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((candidate) => candidate.getAttribute("aria-label") === "添加配置") ?? null;
  }

  /** The library's per-connection edit button inside an open fold. */
  function editConnectionButton(): HTMLButtonElement {
    const target = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((candidate) => /^编辑 .+ 配置$/.test(candidate.getAttribute("aria-label") ?? ""));
    if (!target) {
      throw new Error("edit connection button not found");
    }
    return target;
  }

  /** The connection editor's 测试连接 button. */
  function testConnectionButton(dialog: HTMLElement): HTMLButtonElement {
    const target = [...dialog.querySelectorAll<HTMLButtonElement>("button")]
      .find((candidate) => candidate.textContent?.trim() === "测试");
    if (!target) {
      throw new Error("connection test button not found");
    }
    return target;
  }

  function pickerToggle(): HTMLButtonElement {
    const target = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((candidate) => candidate.textContent?.includes("个已选"));
    if (!target) {
      throw new Error("conversation picker toggle not found");
    }
    return target;
  }

  function candidateCheckbox(model: string): HTMLButtonElement {
    const target = [...container.querySelectorAll<HTMLButtonElement>('button[role="checkbox"]')]
      .find((candidate) => candidate.textContent?.includes(model));
    if (!target) {
      throw new Error(`candidate checkbox not found: ${model}`);
    }
    return target;
  }

  function assignmentCombobox(label: string): HTMLButtonElement {
    const labelNode = [...container.querySelectorAll<HTMLElement>(".model-assignment-label")]
      .find((node) => node.textContent === label);
    const target = labelNode?.closest("div.flex.items-center.justify-between")
      ?.querySelector<HTMLButtonElement>('[role="combobox"]');
    if (!target) {
      throw new Error(`assignment combobox not found: ${label}`);
    }
    return target;
  }

  function option(label: string): HTMLButtonElement | null {
    return [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find((candidate) => candidate.textContent?.trim() === label) ?? null;
  }

  /** Types into an open searchable dropdown's filter box. */
  function typeSearch(placeholderText: string, value: string): void {
    const input = container.querySelector<HTMLInputElement>(`input[placeholder="${placeholderText}"]`);
    if (!input) {
      throw new Error(`search field not found: ${placeholderText}`);
    }
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  /** Waits until the panel has no save in flight (it flags `aria-busy` while one runs). */
  async function awaitIdle(): Promise<void> {
    await vi.waitFor(() => expect(
      container.querySelector(".model-workspace-layout")!.getAttribute("aria-busy")
    ).toBe("false"));
  }

  /** Awaits the `count`-th save round-trip, so the next interaction cannot race it. */
  async function awaitSave(client: SectionConfigClient, count: number): Promise<void> {
    await vi.waitFor(() => expect(client.saveModelCatalog).toHaveBeenCalledTimes(count));
    await awaitIdle();
  }

  /** Picks one model in one assignment row through its searchable dropdown. */
  async function chooseRowModel(
    client: SectionConfigClient,
    row: string,
    model: string,
    count: number
  ): Promise<void> {
    act(() => assignmentCombobox(row).click());
    typeSearch("搜索模型", model);
    const target = option(model);
    expect(target).not.toBeNull();
    act(() => target!.click());
    await awaitSave(client, count);
  }
});
