/**
 * Normalized app context carried by an app-panel message.
 *
 * `appId` is required; `name` is the human-facing label the panel used.
 */
export type WebuiAppContext = { appId: string; name?: string };

/** Returns a trimmed app context, or null when the value has no usable app id. */
export function normalizeWebuiAppContext(value: unknown): WebuiAppContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const appId = typeof (value as any).appId === "string" ? (value as any).appId.trim() : "";
  if (!appId) return null;
  const name = typeof (value as any).name === "string" ? (value as any).name.trim() : "";
  return { appId, ...(name ? { name } : {}) };
}

/**
 * Runtime context lines for a chat that is bound to an app page.
 *
 * The host panel is app-scoped, but the agent does not otherwise know which
 * app the user is looking at. Passing this along with each panel message lets
 * the model prefer the app's own tools without changing the global tool list.
 */
export function appContextRuntimeLines(metadata: Record<string, any> | null | undefined): string[] {
  const context = normalizeWebuiAppContext(metadata?.webui_app_context);
  if (!context) return [];
  const { appId } = context;
  const name = context.name ?? appId;
  return [
    `Active Cuby app: ${name} (${appId}). For requests about this app, prefer its tools (names starting with mcp_${appId}_) and do not reinterpret app or note content as reminders.`,
  ];
}
