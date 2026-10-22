// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Select } from "../Select.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Select", () => {
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
    const trigger = document.querySelector<HTMLButtonElement>('[role="combobox"]');
    if (!trigger) throw new Error("Missing select trigger");
    return trigger;
  }

  function typeSearch(value: string): HTMLInputElement {
    const input = document.querySelector<HTMLInputElement>('input[placeholder="搜索模型"]');
    if (!input) throw new Error("Missing select search input");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return input;
  }

  function optionLabels(): string[] {
    return Array.from(document.querySelectorAll('[role="option"]')).map((option) => option.textContent ?? "");
  }

  it("renders an accessible upward-opening list and selects an option", () => {
    const onValueChange = vi.fn();
    act(() => root.render(
      <Select
        ariaLabel="选择模型"
        value="fast"
        options={[
          { value: "fast", label: "openai / gpt-5.4" },
          { value: "deep", label: "anthropic / claude-sonnet" }
        ]}
        placement="top"
        onValueChange={onValueChange}
      />
    ));

    const trigger = getTrigger();
    expect(trigger.getAttribute("aria-label")).toBe("选择模型");
    expect(trigger.closest(".select-control")?.classList.contains("select-control--placement-top")).toBe(true);

    act(() => trigger.click());
    const options = document.querySelectorAll<HTMLButtonElement>('[role="option"]');
    expect(options).toHaveLength(2);
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");

    act(() => options[1]?.click());
    expect(onValueChange).toHaveBeenCalledWith("deep");
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it("filters options by label when searchable and selects a filtered result", () => {
    const onValueChange = vi.fn();
    act(() => root.render(
      <Select
        ariaLabel="选择模型"
        value=""
        searchable
        searchPlaceholder="搜索模型"
        options={[
          { value: "deepseek", label: "deepseek-v4.1-flash" },
          { value: "gpt", label: "gpt-5.6-terra" },
          { value: "kimi", label: "kimi-k3" }
        ]}
        onValueChange={onValueChange}
      />
    ));

    act(() => getTrigger().click());
    typeSearch("KIMI");

    expect(optionLabels()).toEqual(["kimi-k3"]);
    act(() => document.querySelector<HTMLButtonElement>('[role="option"]')?.click());

    expect(onValueChange).toHaveBeenCalledWith("kimi");
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it("pins the search row above the scrolling options", () => {
    act(() => root.render(
      <Select
        ariaLabel="选择模型"
        value=""
        searchable
        searchPlaceholder="搜索模型"
        options={[
          { value: "deepseek", label: "deepseek-v4.1-flash" },
          { value: "gpt", label: "gpt-5.6-terra" }
        ]}
        onValueChange={() => undefined}
      />
    ));

    act(() => getTrigger().click());

    const menu = document.querySelector(".select-control__menu--searchable");
    expect(menu).not.toBeNull();
    expect(menu?.querySelector(".select-control__search input")).not.toBeNull();
    expect(menu?.querySelector(".select-control__options [role='option']")).not.toBeNull();
  });

  it("selects the active filtered option with Enter", () => {
    const onValueChange = vi.fn();
    act(() => root.render(
      <Select
        ariaLabel="选择模型"
        value=""
        searchable
        searchPlaceholder="搜索模型"
        options={[
          { value: "deepseek", label: "deepseek-v4.1-flash" },
          { value: "gpt", label: "gpt-5.6-terra" }
        ]}
        onValueChange={onValueChange}
      />
    ));

    act(() => getTrigger().click());
    const input = typeSearch("gpt");
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));

    expect(onValueChange).toHaveBeenCalledWith("gpt");
  });

  it("resets the search after Escape so the next open shows every option", () => {
    act(() => root.render(
      <Select
        ariaLabel="选择模型"
        value=""
        searchable
        searchPlaceholder="搜索模型"
        options={[
          { value: "deepseek", label: "deepseek-v4.1-flash" },
          { value: "gpt", label: "gpt-5.6-terra" }
        ]}
        onValueChange={() => undefined}
      />
    ));

    act(() => getTrigger().click());
    const input = typeSearch("gpt");
    expect(optionLabels()).toEqual(["gpt-5.6-terra"]);

    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="listbox"]')).toBeNull();

    act(() => getTrigger().click());
    expect(optionLabels()).toEqual(["deepseek-v4.1-flash", "gpt-5.6-terra"]);
  });
});
