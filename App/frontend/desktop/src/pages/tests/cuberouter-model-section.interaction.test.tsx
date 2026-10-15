// @vitest-environment happy-dom

/** Cuberouter model section tests. */
import type { CuberouterModelChoicesView, ModelConfigInput, ModelConfigView } from "@memmy/local-api-contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/i18n-provider.js";
import { CUBEROUTER_KEY_SELECTION_STORAGE_KEY } from "../../state/cuberouter-key-selection.js";
import { applyCuberouterSelection, createModelWorkspace } from "../../state/model-workspace.js";
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
      save: () => new Promise((resolve) => {
        releaseSave = () => resolve({ catalog: createModelWorkspace(null).catalog, configRevision: "rev-2" });
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

  type SectionConfigClient = Awaited<ReturnType<typeof renderSection>>["configClient"];

  async function renderSection(input: {
    choices?: () => Promise<CuberouterModelChoicesView>;
    reveal?: (tokenId: number) => Promise<{ key: string }>;
    save?: (payload: unknown) => Promise<{ catalog: unknown; configRevision: string }>;
    storedConfig?: { catalog: ModelConfigView; configRevision: string };
  } = {}) {
    const accountClient = {
      getModelChoices: vi.fn(input.choices ?? (async () => CHOICES)),
      revealPersonalKey: vi.fn(input.reveal ?? (async () => ({ key: "sk-personal" })))
    };
    const configClient = {
      getModelConfig: vi.fn(async () => input.storedConfig ?? ({
        catalog: createModelWorkspace(null).catalog,
        configRevision: "rev-1"
      })),
      saveModelCatalog: vi.fn(input.save ?? (async (_payload: unknown) => ({
        catalog: createModelWorkspace(null).catalog,
        configRevision: "rev-2"
      }))),
      testModelConfig: vi.fn(async () => ({ ok: true, message: "" }))
    };
    await act(async () => {
      root.render(
        <I18nProvider language="zh-CN">
          <CuberouterModelSection
            username="alice@a.com"
            organizationName="yeebo"
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
