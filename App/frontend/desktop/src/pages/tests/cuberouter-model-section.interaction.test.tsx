// @vitest-environment happy-dom

/** Cuberouter model section tests. */
import type { CuberouterModelChoicesView } from "@memmy/local-api-contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/i18n-provider.js";
import { createModelWorkspace } from "../../state/model-workspace.js";
import { CuberouterModelSection } from "../cuberouter-model-section.js";

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

  async function renderSection(input: {
    choices?: () => Promise<CuberouterModelChoicesView>;
    reveal?: (tokenId: number) => Promise<{ key: string }>;
    save?: (payload: unknown) => Promise<{ catalog: unknown; configRevision: string }>;
  } = {}) {
    const accountClient = {
      getModelChoices: vi.fn(input.choices ?? (async () => CHOICES)),
      revealPersonalKey: vi.fn(input.reveal ?? (async () => ({ key: "sk-personal" })))
    };
    const configClient = {
      getModelConfig: vi.fn(async () => ({ catalog: createModelWorkspace(null).catalog, configRevision: "rev-1" })),
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
});
