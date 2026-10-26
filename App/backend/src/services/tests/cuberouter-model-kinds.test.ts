import { describe, expect, it } from "vitest";
import {
  imageGenerationModelIds,
  isImageGenerationModel,
  isTextChatModel,
  textChatModelIds
} from "../cuberouter-model-kinds.js";

describe("cuberouter model kinds", () => {
  it("keeps models that advertise a text endpoint", () => {
    expect(isTextChatModel({
      id: "deepseek-v4.1-flash",
      supportedEndpointTypes: ["openai", "openai-response", "anthropic"]
    })).toBe(true);
    expect(isTextChatModel({
      id: "gemini-3.1-pro-preview",
      supportedEndpointTypes: ["gemini", "openai"]
    })).toBe(true);
  });

  it("drops models that also advertise a non-text endpoint", () => {
    expect(isTextChatModel({
      id: "qwen3-embedding-8b",
      supportedEndpointTypes: ["openai", "embeddings"]
    })).toBe(false);
    expect(isTextChatModel({
      id: "gpt-image-2.5-flare",
      supportedEndpointTypes: ["openai", "openai-response", "image-generation"]
    })).toBe(false);
    expect(isTextChatModel({
      id: "doubao-seedance-2-5-260628",
      supportedEndpointTypes: ["ark-video"]
    })).toBe(false);
  });

  it("drops non-chat ids that the relay only labels as plain openai", () => {
    expect(isTextChatModel({ id: "viduq3-pro", supportedEndpointTypes: ["openai"] })).toBe(false);
    expect(isTextChatModel({ id: "moworld-t2v", supportedEndpointTypes: ["openai"] })).toBe(false);
    expect(isTextChatModel({ id: "kimi-k3-fn", supportedEndpointTypes: ["openai"] })).toBe(true);
  });

  it("falls back to the model id when the relay omits endpoint types", () => {
    expect(isTextChatModel({ id: "gpt-4o", supportedEndpointTypes: [] })).toBe(true);
    expect(isTextChatModel({ id: "viduq3-pro", supportedEndpointTypes: [] })).toBe(false);
  });

  it("returns only text ids from a mixed list", () => {
    expect(textChatModelIds([
      { id: "deepseek-v4.1-flash", supportedEndpointTypes: ["openai"] },
      { id: "qwen3-embedding-8b", supportedEndpointTypes: ["openai", "embeddings"] },
      { id: "kimi-k3", supportedEndpointTypes: ["openai", "anthropic"] }
    ])).toEqual(["deepseek-v4.1-flash", "kimi-k3"]);
  });

  it("keeps rows that advertise image generation", () => {
    expect(isImageGenerationModel({
      id: "moss-image",
      supportedEndpointTypes: ["image-generation", "openai"]
    })).toBe(true);
    expect(isImageGenerationModel({
      id: "gpt-image-2.5-flare",
      supportedEndpointTypes: ["openai", "openai-response", "image-generation"]
    })).toBe(true);
    expect(isImageGenerationModel({
      id: "gpt-6-astra",
      supportedEndpointTypes: ["openai", "anthropic"]
    })).toBe(false);
  });

  it("does not guess image models from ids when the relay omits endpoint types", () => {
    expect(isImageGenerationModel({ id: "gpt-image-2.5-flare", supportedEndpointTypes: [] })).toBe(false);
    expect(isImageGenerationModel({ id: "moss-image", supportedEndpointTypes: [] })).toBe(false);
  });

  it("returns only image ids from a mixed list", () => {
    expect(imageGenerationModelIds([
      { id: "moss-image", supportedEndpointTypes: ["image-generation", "openai"] },
      { id: "deepseek-v4.1-flash", supportedEndpointTypes: ["openai"] },
      { id: "qwen-image-2.1-turbo", supportedEndpointTypes: ["image-generation"] },
      { id: "qwen-image-in-name-only", supportedEndpointTypes: [] }
    ])).toEqual(["moss-image", "qwen-image-2.1-turbo"]);
  });
});
