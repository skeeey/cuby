/** Structured provider logs. Never include prompts, messages, headers or credentials. */
export interface ProviderLogFields {
  provider: string;
  model: string | null;
  attempt?: number;
  attempts?: number;
  delaySeconds?: number;
  status?: number | null;
  kind?: string | null;
  type?: string | null;
  code?: string | null;
  category?: string | null;
  reason?: string;
  toProvider?: string;
  toModel?: string | null;
  failures?: number;
  cooldownSeconds?: number;
  detail?: string | null;
}

/** One retry is about to wait before the next attempt. */
export function logProviderRetry(fields: ProviderLogFields): void {
  console.warn("[provider] retrying model request", sanitize(fields));
}

/** A request succeeded after at least one retry. */
export function logProviderRecovered(fields: ProviderLogFields): void {
  console.info("[provider] model request succeeded after retries", sanitize(fields));
}

/** The request will not be retried and returns an error to the caller. */
export function logProviderFailure(fields: ProviderLogFields): void {
  console.error("[provider] model request failed", sanitize(fields));
}

/** The request failed after output was already streamed, so a retry is skipped. */
export function logProviderStreamedFailure(fields: ProviderLogFields): void {
  console.warn("[provider] not retrying after streamed output", sanitize(fields));
}

/** A fallback model is about to be tried. */
export function logProviderFallback(fields: ProviderLogFields): void {
  console.warn("[provider] falling back to backup model", sanitize(fields));
}

/** A fallback model answered successfully. */
export function logProviderFallbackSuccess(fields: ProviderLogFields): void {
  console.info("[provider] fallback model succeeded", sanitize(fields));
}

/** The primary model is being skipped for the cooldown window. */
export function logProviderCircuitOpen(fields: ProviderLogFields): void {
  console.warn("[provider] primary model circuit opened", sanitize(fields));
}

function sanitize(fields: ProviderLogFields): Record<string, unknown> {
  const { detail, ...rest } = fields;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) result[key] = value;
  }
  if (detail) {
    result.detail = sanitizeDetail(detail);
  }
  return result;
}

function sanitizeDetail(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-***")
    .replace(/\bBearer\s+[A-Za-z0-9._-]+\b/gi, "Bearer ***")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}
