import { describe, expect, it } from "vitest";
import { isTextChatModelId } from "./model-kinds.js";

describe("isTextChatModelId", () => {
  it("keeps ordinary chat model ids", () => {
    expect(isTextChatModelId("deepseek-v4.1-flash")).toBe(true);
    expect(isTextChatModelId("gpt-5.6-terra")).toBe(true);
    expect(isTextChatModelId("claude-opus-5")).toBe(true);
    expect(isTextChatModelId("kimi-k3")).toBe(true);
  });

  it("rejects ids that name non-chat modalities", () => {
    expect(isTextChatModelId("qwen3-embedding-8b")).toBe(false);
    expect(isTextChatModelId("qwen3-reranker-8b")).toBe(false);
    expect(isTextChatModelId("gpt-image-2-m")).toBe(false);
    expect(isTextChatModelId("wan3.0-video")).toBe(false);
    expect(isTextChatModelId("doubao-seedance-2-5-260628")).toBe(false);
    expect(isTextChatModelId("viduq3-pro")).toBe(false);
    expect(isTextChatModelId("moworld-t2v")).toBe(false);
  });

  it("treats a blank id as non-text", () => {
    expect(isTextChatModelId("   ")).toBe(false);
  });
});
