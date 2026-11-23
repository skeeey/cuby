import { z } from "zod";

const PLATFORM_KEY_RE = /^(win32|darwin|linux)-(x64|arm64)$/;
const APP_ID_RE = /^[a-z0-9-]+$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+].*)?$/;
const ALLOWED_PLACEHOLDERS = new Set(["APP_ROOT", "APP_DATA", "SESSION_WORKSPACE", "CUBY_USER_DATA"]);

const PlatformCommandSchema = z.union([
  z.string().min(1),
  z.record(z.string().regex(PLATFORM_KEY_RE), z.string().min(1)),
]);

const McpResourceCspSchema = z.object({
  connectDomains: z.array(z.string()).optional(),
  resourceDomains: z.array(z.string()).optional(),
  frameDomains: z.array(z.string()).optional(),
  baseUriDomains: z.array(z.string()).optional(),
}).strict();

const UiResourceSchema = z.object({
  uri: z.string().regex(/^ui:\/\//),
  entry: z.string().min(1),
}).strict();

const UiSchema = z.object({
  resources: z.array(UiResourceSchema).default([]),
  defaultResourceUri: z.string().regex(/^ui:\/\//).optional(),
  displayModes: z.array(z.enum(["inline", "fullscreen", "pip"])).optional(),
  prefersBorder: z.boolean().optional(),
  csp: McpResourceCspSchema.optional(),
}).strict();

const ServerSchema = z.object({
  scope: z.enum(["global", "session"]).default("global"),
  transport: z.enum(["stdio", "streamableHttp"]),
  command: PlatformCommandSchema,
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  toolTimeout: z.number().positive().optional(),
  enabledTools: z.array(z.string()).optional(),
}).strict();

const CredentialSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["secret", "json"]),
  required: z.boolean().optional(),
  schema: z.record(z.string(), z.unknown()).optional(),
}).strict();

const SkillSchema = z.object({
  path: z.string().min(1),
  readonly: z.boolean().optional(),
}).strict();

const EntryPointActionSchema = z.object({
  kind: z.literal("tool"),
  tool: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).optional(),
}).strict();

const EntryPointSchema = z.object({
  surface: z.enum(["home", "settings"]),
  title: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().optional(),
  action: EntryPointActionSchema.optional(),
}).strict();

const ModelConfigSchema = z.object({
  required: z.boolean().optional(),
  protocols: z.array(z.string().min(1)),
}).strict();

const CapabilitiesSchema = z.object({
  appToolCalls: z.array(z.string()),
  appMessages: z.union([z.literal(false), z.literal("ask"), z.literal("allow")]),
  downloads: z.boolean().optional(),
  openLinks: z.boolean().optional(),
  workspace: z.enum(["none", "read", "write"]).default("none"),
  modelConfig: ModelConfigSchema.optional(),
}).strict();

const RuntimeSchema = z.object({
  kind: z.string().min(1),
  version: z.string().min(1),
  bundled: z.boolean().optional(),
  platforms: z.record(z.string().regex(PLATFORM_KEY_RE), z.string().min(1)).optional(),
}).strict();

const BuildSchema = z.object({
  ui: z.object({
    command: z.string().min(1),
    output: z.string().min(1),
  }).strict().optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
}).strict();

const LicenseSchema = z.object({
  name: z.string().min(1),
  spdx: z.string().min(1),
  noticeFile: z.string().optional(),
  sourceOffer: z.string().optional(),
}).strict();

const IntegritySchema = z.object({
  algorithm: z.string().min(1),
}).strict();

export const AppManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(APP_ID_RE),
  name: z.string().min(1),
  version: z.string().regex(SEMVER_RE),
  description: z.string().optional(),
  engines: z.object({
    cuby: z.string().min(1),
  }).strict(),
  server: ServerSchema,
  credentials: z.array(CredentialSchema).optional(),
  ui: UiSchema.optional(),
  skills: z.array(SkillSchema).optional(),
  entryPoints: z.array(EntryPointSchema).optional(),
  capabilities: CapabilitiesSchema,
  runtime: RuntimeSchema.optional(),
  build: BuildSchema.optional(),
  licenses: z.array(LicenseSchema).optional(),
  integrity: IntegritySchema.optional(),
}).strict().superRefine((manifest, ctx) => {
  const resources = manifest.ui?.resources ?? [];
  const seen = new Set<string>();
  for (const [index, resource] of resources.entries()) {
    if (seen.has(resource.uri)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ui", "resources", index, "uri"],
        message: `Duplicate UI resource URI: ${resource.uri}`,
      });
    }
    seen.add(resource.uri);
  }
  if (manifest.ui?.defaultResourceUri && !seen.has(manifest.ui.defaultResourceUri)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["ui", "defaultResourceUri"],
      message: `defaultResourceUri is not declared in ui.resources: ${manifest.ui.defaultResourceUri}`,
    });
  }
  if (manifest.capabilities.workspace !== "none" && manifest.server.scope !== "session") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["capabilities", "workspace"],
      message: "capabilities.workspace requires server.scope to be \"session\"",
    });
  }
});

export type AppManifest = z.infer<typeof AppManifestSchema>;

export class AppManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppManifestError";
  }
}

function assertPlaceholders(value: unknown, path: string, manifest: AppManifest): void {
  for (const match of JSON.stringify(value).matchAll(/\$\{([A-Z_]+)\}/g)) {
    const name = match[1]!;
    if (!ALLOWED_PLACEHOLDERS.has(name)) {
      throw new AppManifestError(`Unknown placeholder \${${name}} at ${path}`);
    }
    if (
      name === "SESSION_WORKSPACE"
      && (manifest.server.scope !== "session" || manifest.capabilities.workspace === "none")
    ) {
      throw new AppManifestError(
        "${SESSION_WORKSPACE} requires server.scope=\"session\" and a workspace capability",
      );
    }
  }
}

const PLAINTEXT_SECRET_RE = /^(sk-|xoxb-|Bearer\s)/i;
const LONG_TOKEN_RE = /^[A-Za-z0-9+/=_-]{40,}$/;

function assertNoPlaintextSecrets(manifest: AppManifest): void {
  for (const [key, value] of Object.entries(manifest.server.env ?? {})) {
    if (PLAINTEXT_SECRET_RE.test(value) || LONG_TOKEN_RE.test(value)) {
      throw new AppManifestError(
        `server.env.${key} looks like a plaintext secret; declare it in credentials instead`,
      );
    }
  }
}

export function parseAppManifest(value: unknown): AppManifest {
  const parsed = AppManifestSchema.safeParse(value);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new AppManifestError(`Invalid app manifest: ${detail}`);
  }
  const manifest = parsed.data;
  assertPlaceholders(manifest.server, "server", manifest);
  assertNoPlaintextSecrets(manifest);
  return manifest;
}
