// @vitest-environment happy-dom

/** Display language resolution tests. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveDisplayLanguage } from "../providers.js";

describe("resolveDisplayLanguage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("lets an explicit choice win", () => {
    expect(resolveDisplayLanguage("en-US")).toBe("en-US");
    expect(resolveDisplayLanguage("zh-CN")).toBe("zh-CN");
  });

  it("follows the system for a Chinese locale", () => {
    // The setting is called "system": a Chinese Windows must get a Chinese UI.
    vi.stubGlobal("navigator", { language: "zh-CN" });
    expect(resolveDisplayLanguage("system")).toBe("zh-CN");

    vi.stubGlobal("navigator", { language: "zh-TW" });
    expect(resolveDisplayLanguage("system")).toBe("zh-CN");
  });

  it("defaults every non-Chinese locale to English", () => {
    vi.stubGlobal("navigator", { language: "en-GB" });
    expect(resolveDisplayLanguage("system")).toBe("en-US");

    vi.stubGlobal("navigator", { language: "fr-FR" });
    expect(resolveDisplayLanguage("system")).toBe("en-US");
  });
});
