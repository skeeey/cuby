import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LlmProviderLogo, llmProviderLogoUrl } from "../llm-provider-logo.js";

describe("llmProviderLogoUrl", () => {
  it("maps only desktop-supported providers and their frontend aliases", () => {
    for (const provider of [
      "openai",
      "anthropic",
      "gemini",
      "deepseek",
      "zhipu",
      "qwen",
      "moonshot",
      "minimax",
      "baidu",
      "doubao",
      "stepfun",
      "xiaomi"
    ]) {
      expect(llmProviderLogoUrl(provider)).toMatch(/^data:image\/svg\+xml/);
    }

    expect(llmProviderLogoUrl("memmy_account")).toMatch(/cuby-account\.png$/);
    expect(llmProviderLogoUrl("google")).toBe(llmProviderLogoUrl("gemini"));
    expect(llmProviderLogoUrl("kimi")).toBe(llmProviderLogoUrl("moonshot"));
    expect(llmProviderLogoUrl("xiaomi_mimo")).toBe(llmProviderLogoUrl("xiaomi"));
    expect(llmProviderLogoUrl("openrouter")).toBeNull();
  });

  it("ships a purpose-built account logo, and is readable when it is not", () => {
    const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)));

    // Compare digests, never the buffers: `expect(Buffer).toEqual(Buffer)` on a mismatch makes
    // vitest render a diff of the whole file, and at a few hundred KB that never finishes — the
    // suite hangs instead of failing. That is what this assertion used to do.
    const digest = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
    const accountLogo = read("../../assets/llm-provider-logo/cuby-account.png");
    const desktopIcon = read("../../../../../shell/desktop/build/icon.png");

    // These were the same file while the account mark was a copy of the app icon. They are
    // deliberately different now: the app icon is an opaque gradient square for the OS to mask,
    // and this is the bare head, so it sits with the other provider marks in the list.
    expect(digest(accountLogo)).not.toBe(digest(desktopIcon));

    // PNG magic and IHDR, so a truncated or swapped file fails here rather than as a blank
    // image in the model list.
    expect(accountLogo.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect([accountLogo.readUInt32BE(16), accountLogo.readUInt32BE(20)]).toEqual([512, 512]);
  });

  it("marks provider images so account-mode transparent padding can be normalized", () => {
    expect(renderToString(<LlmProviderLogo provider=" Memmy_Account " />)).toContain('data-provider="memmy_account"');
  });
});
