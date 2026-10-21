// @vitest-environment happy-dom

/** Settings page line display tests. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountClient } from "../../api/account-client.js";
import { I18nProvider } from "../../i18n/i18n-provider.js";
import { appActions } from "../../state/app-actions.js";
import { appReducer, createInitialAppState } from "../../state/app-reducer.js";
import { SettingsPageView } from "../settings-page.js";
import { mockBootstrap } from "./fixtures/bootstrap.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SettingsPage account card", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createMemoryStorage()
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  it("shows the line the account is on", async () => {
    render({ getNodes: vi.fn(async () => ({ nodes: ["cn", "hk"], currentNodeId: "cn" })) });

    await vi.waitFor(() => expect(container.textContent).toContain("当前线路"));
    expect(container.textContent).toContain("大陆");
  });

  it("shows the signed-in cuberouter account instead of 'not signed in'", async () => {
    // The card used to decide the name from userMode alone: a cuberouter identity runs in byok
    // mode, so the heading said "not signed in" right next to a sign-out button.
    render({ getNodes: vi.fn(async () => ({ nodes: ["cn", "hk"], currentNodeId: "cn" })) }, { signedIn: true });

    await vi.waitFor(() => expect(container.textContent).toContain("当前线路"));
    expect(container.textContent).toContain("alice");
    expect(container.textContent).not.toContain("未登录");
    expect(container.textContent).not.toContain("当前使用自定义大模型 API Key");
  });

  it("appends the organization after the account name", async () => {
    render(
      { getNodes: vi.fn(async () => ({ nodes: ["cn", "hk"], currentNodeId: "cn" })) },
      { signedIn: true, organizationName: "yeebo" }
    );

    await vi.waitFor(() => expect(container.textContent).toContain("当前线路"));
    expect(container.textContent).toContain("alice (yeebo)");
  });

  it("changes the password from the account card", async () => {
    const changePassword = vi.fn(async () => ({ ok: true }));
    render(
      {
        getNodes: vi.fn(async () => ({ nodes: ["cn", "hk"], currentNodeId: "cn" })),
        changePassword
      },
      { signedIn: true }
    );

    await vi.waitFor(() => expect(container.textContent).toContain("当前线路"));
    await clickButton("修改密码");
    await fillInput("当前密码", "Passw0rd1");
    await fillInput("新密码", "Passw0rd2");
    await fillInput("确认新密码", "Passw0rd2");
    await clickSubmit();

    await vi.waitFor(() =>
      expect(changePassword).toHaveBeenCalledWith({
        originalPassword: "Passw0rd1",
        newPassword: "Passw0rd2"
      })
    );
    await vi.waitFor(() => expect(container.textContent).toContain("密码已修改"));
    expect(container.querySelector('input[aria-label="当前密码"]')).toBeNull();
  });

  it("does not offer a password change to a signed-out BYOK machine", async () => {
    render({ getNodes: vi.fn(async () => ({ nodes: [], currentNodeId: null })) });

    await act(async () => await Promise.resolve());
    expect(container.textContent).not.toContain("修改密码");
  });

  it("does not offer a password change to a memmy cloud account", async () => {
    render(
      {
        getNodes: vi.fn(async () => ({ nodes: [], currentNodeId: null })),
        changePassword: vi.fn(async () => ({ ok: true }))
      },
      { signedIn: true, identityProvider: "memmy_cloud" }
    );

    await act(async () => await Promise.resolve());
    expect(container.textContent).not.toContain("修改密码");
  });

  it("shows nothing when no line is configured", async () => {
    render({ getNodes: vi.fn(async () => ({ nodes: [], currentNodeId: null })) });

    await act(async () => await Promise.resolve());
    expect(container.textContent).not.toContain("当前线路");
  });

  async function fillInput(label: string, value: string) {
    const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    if (!input) {
      throw new Error(`input not found: ${label}`);
    }
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function clickButton(label: string) {
    const button = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === label
    );
    if (!button) {
      throw new Error(`button not found: ${label}`);
    }
    await act(async () => button.click());
  }

  async function clickSubmit() {
    const button = container.querySelector<HTMLButtonElement>('section[role="dialog"] button[type="submit"]');
    if (!button) {
      throw new Error("dialog submit button not found");
    }
    await act(async () => button.click());
  }

  function render(
    accountClient: Partial<AccountClient>,
    options: {
      signedIn?: boolean;
      organizationName?: string | null;
      identityProvider?: "cuberouter" | "memmy_cloud";
    } = {}
  ) {
    const bootstrap = {
      ...mockBootstrap,
      app: { ...mockBootstrap.app, userMode: "byok" as const, language: "zh-CN" as const }
    };
    const state = options.signedIn
      ? appReducer(
          appReducer(createInitialAppState(), appActions.bootstrapLoaded(bootstrap, "/settings")),
          appActions.accountUpdated({
            userId: "10113",
            email: "",
            phoneNumber: null,
            nickname: "alice",
            registeredAt: null,
            identityProvider: options.identityProvider ?? ("cuberouter" as const),
            organizationName: options.organizationName ?? null
          })
        )
      : appReducer(createInitialAppState(), appActions.bootstrapLoaded(bootstrap, "/settings"));
    act(() => {
      root.render(
        <I18nProvider language="zh-CN">
          <SettingsPageView
            state={state}
            dispatch={vi.fn()}
            platform="win32"
            accountClient={accountClient as AccountClient}
            update={{
              appVersion: "2.1.0",
              phase: "idle",
              preparedUpdatePath: null,
              downloadProgress: null,
              feedback: null,
              requestInlineAction: vi.fn(async () => undefined),
              requestPrimaryAction: vi.fn(async () => undefined)
            }}
          />
        </I18nProvider>
      );
    });
  }
});

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    }
  };
}
