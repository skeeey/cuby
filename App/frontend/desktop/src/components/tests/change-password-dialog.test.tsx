// @vitest-environment happy-dom

/** Change password dialog tests. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/i18n-provider.js";
import { ChangePasswordDialog } from "../change-password-dialog.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ChangePasswordDialog", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  it("submits the current and new passwords", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const onSuccess = vi.fn();
    render({ onSubmit, onSuccess });

    await fill("当前密码", "Passw0rd1");
    await fill("新密码", "Passw0rd2");
    await fill("确认新密码", "Passw0rd2");
    await clickButton("修改密码");

    await vi.waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        originalPassword: "Passw0rd1",
        newPassword: "Passw0rd2"
      })
    );
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
  });

  it("refuses a mismatched confirmation before submitting", async () => {
    const onSubmit = vi.fn(async () => undefined);
    render({ onSubmit });

    await fill("当前密码", "Passw0rd1");
    await fill("新密码", "Passw0rd2");
    await fill("确认新密码", "Passw0rd3");
    await clickButton("修改密码");

    expect(container.textContent).toContain("两次输入的新密码不一致");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects a new password that breaks the strength rule", async () => {
    const onSubmit = vi.fn(async () => undefined);
    render({ onSubmit });

    await fill("当前密码", "Passw0rd1");
    await fill("新密码", "password");
    await fill("确认新密码", "password");
    await clickButton("修改密码");

    expect(container.textContent).toContain("新密码需同时包含大写字母、小写字母和数字");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the server's rejection in the dialog", async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error("原密码不正确");
    });
    const onSuccess = vi.fn();
    render({ onSubmit, onSuccess });

    await fill("当前密码", "Passw0rd1");
    await fill("新密码", "Passw0rd2");
    await fill("确认新密码", "Passw0rd2");
    await clickButton("修改密码");

    await vi.waitFor(() => expect(container.textContent).toContain("原密码不正确"));
    expect(onSuccess).not.toHaveBeenCalled();
  });

  function render(props: {
    onSubmit: (input: { originalPassword: string; newPassword: string }) => Promise<void>;
    onSuccess?: () => void;
  }) {
    act(() => {
      root.render(
        <I18nProvider language="zh-CN">
          <ChangePasswordDialog
            open
            onClose={vi.fn()}
            onSubmit={props.onSubmit}
            onSuccess={props.onSuccess ?? vi.fn()}
          />
        </I18nProvider>
      );
    });
  }

  async function fill(label: string, value: string) {
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
});
