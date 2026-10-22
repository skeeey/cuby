/**
 * Model-id tokens that name a non-chat modality on the relay. Endpoint metadata is the primary
 * signal; this list only catches relays that advertise a video/image model as plain `openai`.
 */
const NON_TEXT_MODEL_ID_TOKENS = [
  "vidu",
  "seedance",
  "kling",
  "sora",
  "t2v",
  "i2v",
  "embedding",
  "rerank",
  "video",
  "image"
] as const;

/** Whether an id names a text-chat model, judged from the id alone when no type metadata exists. */
export function isTextChatModelId(id: string): boolean {
  const key = id.trim().toLowerCase();
  return key.length > 0 && !NON_TEXT_MODEL_ID_TOKENS.some((token) => key.includes(token));
}
