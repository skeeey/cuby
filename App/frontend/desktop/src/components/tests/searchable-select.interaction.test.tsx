// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchableSelect } from "../searchable-select.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPTIONS = [
  { value: "deepseek-v4.1-flash", label: "deepseek-v4.1-flash" },
  { value: "gpt-oss-120b", label: "gpt-oss-120b" },
  { value: "qwen3-235b", label: "qwen3-235b" }
];

describe("SearchableSelect", () => {
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

  function getTrigger(): HTMLButtonElement {
    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]');
    if (!trigger) throw new Error("Missing searchable select trigger");
    return trigger;
  }

  function getOptionLabels(): string[] {
    return Array.from(container.querySelectorAll('[role="option"]')).map((option) => option.textContent ?? "");
  }

  function typeSearch(value: string): HTMLInputElement {
    const input = container.querySelector<HTMLInputElement>('input[placeholder="搜索模型"]');
    if (!input) throw new Error("Missing searchable select filter");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return input;
  }

  it("filters by substring and reports the chosen value", () => {
    const onValueChange = vi.fn();
    act(() => root.render(
      <SearchableSelect
        label="记忆摘要"
        value=""
        options={OPTIONS}
        onValueChange={onValueChange}
        placeholder="未配置"
        searchPlaceholder="搜索模型"
      />
    ));

    const trigger = getTrigger();
    expect(trigger.getAttribute("aria-label")).toBe("记忆摘要");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.textContent).toContain("未配置");

    act(() => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(container.querySelector('[role="listbox"]')?.id);
    typeSearch("oss");

    expect(container.textContent).not.toContain("qwen3-235b");
    expect(getOptionLabels()).toEqual(["gpt-oss-120b"]);

    const match = container.querySelector<HTMLButtonElement>('[role="option"]');
    act(() => match?.click());

    expect(onValueChange).toHaveBeenCalledWith("gpt-oss-120b");
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it("keeps a configured value visible in the closed trigger even when filtered out", () => {
    act(() => root.render(
      <SearchableSelect
        label="记忆摘要"
        value="qwen3-235b"
        options={OPTIONS}
        onValueChange={() => undefined}
        searchPlaceholder="搜索模型"
      />
    ));

    expect(getTrigger().textContent).toContain("qwen3-235b");

    act(() => getTrigger().click());
    const input = typeSearch("oss");
    expect(getOptionLabels()).toEqual(["gpt-oss-120b"]);

    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(getTrigger().textContent).toContain("qwen3-235b");

    // Escape closed the menu without a choice: the filter is reset too, or reopening would look
    // like the list had vanished behind the stale query.
    act(() => getTrigger().click());
    expect(getOptionLabels()).toEqual(["deepseek-v4.1-flash", "gpt-oss-120b", "qwen3-235b"]);

    // The outside-mousedown path closes the same way and resets the same way.
    typeSearch("oss");
    expect(getOptionLabels()).toEqual(["gpt-oss-120b"]);
    act(() => document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    act(() => getTrigger().click());
    expect(getOptionLabels()).toEqual(["deepseek-v4.1-flash", "gpt-oss-120b", "qwen3-235b"]);
  });
});
