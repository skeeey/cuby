import { describe, expect, it } from "vitest";
import { modelBrandLogoUrl, modelProviderLogoUrl } from "../model-provider-logo.js";

describe("modelBrandLogoUrl", () => {
  it.each([
    ["deepseek-v4.1-flash", "deepseek"],
    ["doubao-seed-2-1-pro-h", "doubao"],
    ["glm-5.3", "zhipu"],
    ["gpt-5.6-terra", "openai"],
    ["qwen3.7-max", "qwen"],
    ["MiniMax-M2", "minimax"],
    ["kimi-k2.5", "moonshot"],
    ["gemini-3.1-pro-preview", "gemini"],
    ["google/gemma-3-27b", "gemini"],
    ["claude-opus-4-8", "anthropic"]
  ])("maps %s to the %s brand icon", (model, brand) => {
    expect(modelBrandLogoUrl(model, "openai")).toBe(modelProviderLogoUrl(brand));
  });

  it("falls back to the provider when the model id names no known brand", () => {
    expect(modelBrandLogoUrl("o3-mini", "openai")).toBe(modelProviderLogoUrl("openai"));
    expect(modelBrandLogoUrl("unknown-model", "deepseek")).toBe(modelProviderLogoUrl("deepseek"));
  });
});
