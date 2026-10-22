// @vitest-environment happy-dom

/** Agent model selector tests. */
import type { ModelConfigView } from "@memmy/local-api-contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelProviderConfig } from "../../api/config-client.js";
import { AgentModelSelector } from "../agent-model-selector.js";
import { modelProviderLogoUrl } from "../model-provider-logo.js";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn()
}));

vi.mock("../../state/app-state.js", () => ({
  useAppState: () => ({
    state: {
      agent: {
        committedModelSelectionByScope: {},
        pendingPresetByScope: {}
      }
    },
    dispatch: mocks.dispatch
  })
}));

vi.mock("../../i18n/use-translation.js", () => ({
  useTranslation: () => ({ t: (key: string) => key, language: "zh-CN" })
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function catalogView(): ModelConfigView {
  const accountAgent = {
    presetId: "account-agent",
    provider: "memmy_account" as const,
    endpointId: "account",
    protocol: "memmy-account" as const,
    model: "agent_chat",
    source: "account" as const,
    ownerAccountId: "owner-a",
    capabilities: ["agent" as const],
    available: true
  };
  const byokAgent = {
    presetId: "byok-agent",
    provider: "openai" as const,
    endpointId: "chat",
    protocol: "openai-chat-completions" as const,
    model: "gpt-4o",
    source: "byok" as const,
    capabilities: ["agent" as const],
    available: true
  };
  const byokMini = {
    presetId: "byok-mini",
    provider: "openai" as const,
    endpointId: "chat",
    protocol: "openai-chat-completions" as const,
    model: "gpt-4o-mini",
    source: "byok" as const,
    capabilities: ["agent" as const],
    available: true
  };
  const byokDeepseek = {
    presetId: "byok-deepseek",
    provider: "openai" as const,
    endpointId: "chat",
    protocol: "openai-chat-completions" as const,
    model: "deepseek-v4.1-flash",
    source: "byok" as const,
    capabilities: ["agent" as const],
    available: true
  };
  const byokSeedance = {
    presetId: "byok-seedance",
    provider: "openai" as const,
    endpointId: "chat",
    protocol: "openai-chat-completions" as const,
    model: "doubao-seedance-2-5-260628",
    source: "byok" as const,
    capabilities: ["agent" as const],
    available: true
  };
  const byokEmbedding = {
    presetId: "byok-embedding",
    provider: "openai" as const,
    endpointId: "embedding",
    protocol: "openai-embeddings" as const,
    model: "text-embedding-3-small",
    source: "byok" as const,
    capabilities: ["embedding" as const],
    available: true
  };
  return {
    configRevision: "revision-1",
    providers: [
      {
        provider: "memmy_account",
        configured: true,
        hasApiKey: false,
        apiKeyMasked: "",
        apiKey: "",
        ownerAccountId: "owner-a",
        endpoints: [{
          endpointId: "account",
          apiBase: "https://account.memmy.ai/v1",
          protocol: "memmy-account",
          hasApiKey: false,
          apiKeyMasked: "",
          apiKey: ""
        }],
        accountManaged: true,
        editable: false,
        models: [accountAgent]
      },
      {
        provider: "openai",
        configured: true,
        hasApiKey: true,
        apiKeyMasked: "sk••••test",
        apiKey: "",
        endpoints: [
          {
            endpointId: "chat",
            apiBase: "https://api.openai.com/v1",
            protocol: "openai-chat-completions",
            hasApiKey: true,
            apiKeyMasked: "sk••••test",
            apiKey: ""
          },
          {
            endpointId: "embedding",
            apiBase: "https://api.openai.com/v1",
            protocol: "openai-embeddings",
            hasApiKey: true,
            apiKeyMasked: "sk••••test",
            apiKey: ""
          }
        ],
        accountManaged: false,
        editable: true,
        models: [byokAgent, byokMini, byokDeepseek, byokSeedance, byokEmbedding]
      }
    ],
    modelAssignments: {
      byok: {
        agent: { candidates: ["byok-agent"], default: "byok-agent" },
        memorySummary: null,
        memoryEvolution: null,
        embedding: "byok-embedding",
        asr: null,
        imageGeneration: null
      },
      account: {
        ownerAccountId: "owner-a",
        agent: { candidates: ["account-agent"], default: "account-agent" },
        memorySummary: "account-agent",
        memoryEvolution: "account-agent",
        embedding: "byok-embedding",
        asr: null,
        imageGeneration: null
      }
    },
    effectiveCandidates: {
      byok: [byokAgent],
      account: [accountAgent]
    },
    configured: true,
    updatedAt: "2026-10-21T00:00:00.000Z"
  };
}

function seedConfig(): ModelProviderConfig {
  return { catalog: catalogView() } as ModelProviderConfig;
}

describe("AgentModelSelector", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  function renderSelector(onDefaultModelSelected = vi.fn()) {
    act(() => root.render(
      <AgentModelSelector
        mode="account"
        scopeKey="scope-1"
        disabled={false}
        seedConfig={seedConfig()}
        onDefaultModelSelected={onDefaultModelSelected}
      />
    ));
    return onDefaultModelSelected;
  }

  function openMenu() {
    const trigger = document.querySelector<HTMLButtonElement>('[role="combobox"]');
    act(() => trigger?.click());
    return document.querySelectorAll<HTMLButtonElement>('[role="option"]');
  }

  function typeSearch(value: string): HTMLInputElement {
    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="home.modelSelector.searchPlaceholder"]'
    );
    if (!input) throw new Error("Missing model search input");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return input;
  }

  it("lists every text chat catalog model and hides relay models of other modalities", () => {
    renderSelector();
    const options = openMenu();

    expect([...options].map((option) => option.textContent)).toEqual([
      "home.modelSelector.platformAgent",
      "gpt-4o",
      "gpt-4o-mini",
      "deepseek-v4.1-flash"
    ]);
    expect(document.body.textContent).not.toContain("text-embedding-3-small");
    expect(document.body.textContent).not.toContain("doubao-seedance-2-5-260628");
  });

  it("filters the model list with the search box", () => {
    renderSelector();
    openMenu();

    typeSearch("deep");

    expect([...document.querySelectorAll('[role="option"]')].map((option) => option.textContent))
      .toEqual(["deepseek-v4.1-flash"]);
  });

  it("picks the brand icon from the model id instead of the provider", () => {
    renderSelector();
    openMenu();

    const deepseek = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find((option) => option.textContent === "deepseek-v4.1-flash");

    expect(deepseek?.querySelector("img")?.getAttribute("src")).toBe(modelProviderLogoUrl("deepseek"));
  });

  it("keeps a stored non-text model visible as a disabled selection", () => {
    const config = seedConfig();
    config.catalog!.modelAssignments.byok.agent.default = "byok-seedance";

    act(() => root.render(
      <AgentModelSelector
        mode="byok"
        scopeKey="scope-1"
        disabled={false}
        seedConfig={config}
      />
    ));
    openMenu();

    const seedance = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find((option) => option.textContent === "doubao-seedance-2-5-260628");
    expect(seedance?.getAttribute("aria-selected")).toBe("true");
    expect(seedance?.disabled).toBe(true);
  });

  it("renders a flat list without custom-model wording or a settings footer", () => {
    renderSelector();
    openMenu();

    expect(document.body.textContent).not.toContain("home.modelSelector.platformGroup");
    expect(document.body.textContent).not.toContain("home.modelSelector.byokGroup");
    expect(document.body.textContent).not.toContain("home.modelSelector.configureCustom");
    expect(document.querySelector(".agent-model-selector__configure")).toBeNull();
  });

  it("selects any listed model directly and reports it as the new default", () => {
    const onDefaultModelSelected = renderSelector();
    const options = openMenu();

    act(() => options[2]?.click());

    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: "agent/pendingModelPresetUpdated",
      scopeKey: "scope-1",
      preset: "byok-mini"
    });
    expect(onDefaultModelSelected).toHaveBeenCalledWith("byok-mini");
  });
});
