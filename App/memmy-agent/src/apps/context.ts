/**
 * Runtime context lines for a chat that is bound to an app page.
 *
 * The host panel is app-scoped, but the agent does not otherwise know which
 * app the user is looking at. Passing this along with each panel message lets
 * the model prefer the app's own tools without changing the global tool list.
 */
export function appContextRuntimeLines(metadata: Record<string, any> | null | undefined): string[] {
  const context = metadata?.webui_app_context;
  if (!context || typeof context !== "object" || Array.isArray(context)) return [];
  const appId = typeof (context as any).appId === "string" ? (context as any).appId.trim() : "";
  if (!appId) return [];
  const rawName = typeof (context as any).name === "string" ? (context as any).name.trim() : "";
  const name = rawName || appId;
  return [
    `Active Cuby app: ${name} (${appId}). For requests about this app, prefer its tools (names starting with mcp_${appId}_) and do not reinterpret app or note content as reminders.`,
  ];
}
