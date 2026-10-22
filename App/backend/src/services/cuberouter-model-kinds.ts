/** Cuberouter model-kind rules: which relay rows can serve text chat. */
import { isTextChatModelId } from "@memmy/local-api-contracts";
import type { CuberouterModelInfo } from "../adapters/outbound/cuberouter-client/types.js";

/** Endpoint kinds that mean the model can answer a chat completion. */
const TEXT_ENDPOINT_TYPES = new Set(["openai", "openai-response", "anthropic", "gemini"]);

/** Endpoint kinds that rule a model out even when it also advertises a text kind. */
const NON_TEXT_ENDPOINT_TYPES = new Set([
  "embeddings",
  "jina-rerank",
  "image-generation",
  "ark-video",
  "video-generation"
]);

/** Whether a relay row can serve text chat. */
export function isTextChatModel(model: CuberouterModelInfo): boolean {
  const types = model.supportedEndpointTypes.map((type) => type.trim().toLowerCase()).filter(Boolean);
  // An instance that predates `supported_endpoint_types` is judged by the id alone, the same
  // rule the account-level name list uses; rejecting every row would empty the model picker.
  if (!types.length) return isTextChatModelId(model.id);
  return types.some((type) => TEXT_ENDPOINT_TYPES.has(type))
    && !types.some((type) => NON_TEXT_ENDPOINT_TYPES.has(type))
    && isTextChatModelId(model.id);
}

/** The ids of the text-chat rows in a relay list. */
export function textChatModelIds(models: CuberouterModelInfo[]): string[] {
  return models.filter(isTextChatModel).map((model) => model.id);
}
