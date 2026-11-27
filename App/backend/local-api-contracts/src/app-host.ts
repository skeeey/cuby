import { z } from "zod";

/** App host lifecycle states exposed to the desktop renderer. */
export const AppHostStateSchema = z.enum([
  "discovered",
  "validated",
  "enabled",
  "starting",
  "ready",
  "failed",
  "disabled",
  "missing_credentials",
]);
export type AppHostState = z.infer<typeof AppHostStateSchema>;

const AppHostCspSchema = z.object({
  connectDomains: z.array(z.string()).optional(),
  resourceDomains: z.array(z.string()).optional(),
  frameDomains: z.array(z.string()).optional(),
  baseUriDomains: z.array(z.string()).optional(),
}).strict();

const AppHostEntryPointSchema = z.object({
  surface: z.enum(["home", "settings"]),
  title: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
}).strict();

/** Whitelisted app metadata returned by `GET /api/apps`. */
export const AppHostSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  version: z.string(),
  source: z.enum(["bundled", "user", "dev"]),
  state: AppHostStateSchema,
  error: z.string().nullable(),
  ui: z.object({
    defaultResourceUri: z.string().nullable(),
    resources: z.array(z.object({ uri: z.string() }).strict()),
    displayModes: z.array(z.enum(["inline", "fullscreen", "pip"])),
    prefersBorder: z.boolean(),
    csp: AppHostCspSchema,
  }).strict(),
  capabilities: z.object({
    openLinks: z.boolean(),
    downloads: z.boolean(),
    appMessages: z.union([z.literal(false), z.literal("ask"), z.literal("allow")]),
  }).strict(),
  entryPoints: z.array(AppHostEntryPointSchema),
  hasUi: z.boolean(),
}).strict();
export type AppHostSummary = z.infer<typeof AppHostSummarySchema>;

/** MCP Apps view record shared between the agent host and the desktop renderer. */
export const AppHostViewSchema = z.object({
  viewId: z.string(),
  appId: z.string(),
  resourceUri: z.string(),
  toolCallId: z.string().optional(),
  toolName: z.string(),
  title: z.string(),
  displayMode: z.enum(["inline", "fullscreen"]),
  protocol: z.literal("mcp-apps/2026-01-26"),
  arguments: z.record(z.string(), z.unknown()).optional(),
  prefersBorder: z.boolean().optional(),
  csp: AppHostCspSchema.optional(),
  capabilities: z.object({
    openLinks: z.boolean().optional(),
    downloads: z.boolean().optional(),
    appMessages: z.union([z.literal(false), z.literal("ask"), z.literal("allow")]).optional(),
  }).strict().optional(),
  toolTimeout: z.number().optional(),
  initialResult: z.object({
    content: z.array(z.unknown()),
    structuredContent: z.unknown().optional(),
  }).strict().nullable().optional(),
  artifacts: z.array(z.object({
    path: z.string(),
    mimeType: z.string(),
  }).strict()).optional(),
  resultRef: z.string().optional(),
}).strict();
export type AppHostView = z.infer<typeof AppHostViewSchema>;

export const AppHostListResponseSchema = z.object({
  apps: z.array(AppHostSummarySchema),
}).strict();
export type AppHostListResponse = z.infer<typeof AppHostListResponseSchema>;

export const AppOpenResultSchema = z.object({
  view: AppHostViewSchema,
  bridge_chat_id: z.string(),
}).strict();
export type AppOpenResult = z.infer<typeof AppOpenResultSchema>;
