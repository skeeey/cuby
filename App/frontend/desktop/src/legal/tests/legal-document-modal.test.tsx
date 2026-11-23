// @vitest-environment happy-dom

import { act } from "react";
import { renderToString } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/i18n-provider.js";
import { LegalDocumentModal, LegalMarkdown } from "../LegalDocumentModal.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("LegalDocumentModal", () => {
  it("renders the Chinese terms title and content", () => {
    const html = renderToString(
      <I18nProvider language="zh-CN">
        <LegalDocumentModal kind="terms" onClose={() => undefined} />
      </I18nProvider>
    );
    expect(html).toContain("服务协议");
    expect(html).toContain("Cuby 服务协议");
    expect(html).toContain("返回");
  });

  it("renders the English data title and content", () => {
    const html = renderToString(
      <I18nProvider language="en-US">
        <LegalDocumentModal kind="data" onClose={() => undefined} />
      </I18nProvider>
    );
    expect(html).toContain("Data Agreement");
    expect(html).toContain("Cuby Data Agreement");
  });

  it("renders nothing when closed", () => {
    const html = renderToString(
      <I18nProvider language="zh-CN">
        <LegalDocumentModal kind={null} onClose={() => undefined} />
      </I18nProvider>
    );
    expect(html).not.toContain("modal-backdrop");
  });
});

describe("LegalMarkdown external links", () => {
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
    Reflect.deleteProperty(window, "memmy");
  });

  it("opens links through the desktop bridge instead of navigating", async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "memmy", { configurable: true, value: { openExternal } });

    await act(async () => {
      root.render(<I18nProvider language="zh-CN"><LegalMarkdown markdown="[规则](https://cuberouter.cn)" /></I18nProvider>);
    });

    const anchor = container.querySelector<HTMLAnchorElement>("a")!;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    let dispatched = true;
    await act(async () => {
      dispatched = anchor.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(dispatched).toBe(false);
    expect(openExternal).toHaveBeenCalledWith("https://cuberouter.cn");
  });

  it("closes from the back button and Escape", async () => {
    const onClose = vi.fn();
    await act(async () => {
      root.render(<I18nProvider language="zh-CN"><LegalDocumentModal kind="terms" onClose={onClose} /></I18nProvider>);
    });

    const back = container.querySelector<HTMLButtonElement>('button[aria-label="返回"]')!;
    await act(async () => back.click());
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
