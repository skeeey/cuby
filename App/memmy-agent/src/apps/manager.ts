import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import semver from "semver";
import { VERSION } from "../version.js";
import {
  connectMcpServer,
  MCPToolWrapper,
  sanitizeName,
  type McpServerConnection,
} from "../core/agent-runtime/tools/mcp.js";
import type { AppRegistryEntry } from "./registry.js";
import type { AppRoots } from "./roots.js";
import { AppViewStore } from "./view.js";

export type AppState =
  | "discovered"
  | "validated"
  | "enabled"
  | "starting"
  | "ready"
  | "failed"
  | "disabled"
  | "missing_credentials";

export type AppStatus = {
  id: string;
  version: string;
  source: AppRegistryEntry["source"];
  state: AppState;
  error: string | null;
  toolNames: string[];
  viewUris: string[];
};

export type AppSessionContext = {
  sessionKey?: string | null;
  workspace?: string | null;
};

export type AppManagerOptions = {
  entries: AppRegistryEntry[];
  roots: AppRoots;
  registerTool: (tool: any) => void;
  unregisterTool: (name: string) => void;
  connect?: (name: string, cfg: any) => Promise<McpServerConnection>;
  logger?: Pick<Console, "info" | "warn" | "error">;
  now?: () => number;
};

type AppRuntime = {
  entry: AppRegistryEntry;
  status: AppStatus;
  store: AppViewStore;
  global: McpServerConnection | null;
  sessions: Map<string, McpServerConnection>;
  sessionStarts: Map<string, Promise<McpServerConnection>>;
  sessionWorkspaces: Map<string, string | null>;
  idleTimers: Map<string, NodeJS.Timeout>;
  failures: number;
  nextRetryAt: number;
};

const SESSION_IDLE_MS = 10 * 60 * 1000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function closeConnection(connection: McpServerConnection | null | undefined): Promise<void> {
  if (!connection) return;
  try {
    await connection.close();
  } catch {
    // A closing app server may already have exited.
  }
}

export class AppManager {
  private readonly entries: AppRegistryEntry[];
  private readonly roots: AppRoots;
  private readonly registerTool: (tool: any) => void;
  private readonly unregisterTool: (name: string) => void;
  private readonly connect: (name: string, cfg: any) => Promise<McpServerConnection>;
  private readonly logger: Pick<Console, "info" | "warn" | "error">;
  private readonly now: () => number;
  private readonly apps = new Map<string, AppRuntime>();
  private initialized = false;

  constructor(options: AppManagerOptions) {
    this.entries = options.entries;
    this.roots = options.roots;
    this.registerTool = options.registerTool;
    this.unregisterTool = options.unregisterTool;
    this.connect = options.connect ?? connectMcpServer;
    this.logger = options.logger ?? console;
    this.now = options.now ?? Date.now;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    await Promise.all(this.entries.map((entry) => this.startEntry(entry)));
  }

  list(): AppStatus[] {
    return [...this.apps.values()].map((runtime) => ({ ...runtime.status, toolNames: [...runtime.status.toolNames], viewUris: [...runtime.status.viewUris] }));
  }

  getStatus(id: string): AppStatus | undefined {
    const status = this.apps.get(id)?.status;
    return status ? { ...status, toolNames: [...status.toolNames], viewUris: [...status.viewUris] } : undefined;
  }

  async sessionFor(appId: string, context: AppSessionContext): Promise<McpServerConnection> {
    const runtime = this.requireRuntime(appId);
    const scope = runtime.entry.manifest.server.scope;
    if (scope === "global") {
      if (!runtime.global) throw new Error(`App ${appId} is not running`);
      return runtime.global;
    }

    if (
      runtime.status.state === "missing_credentials"
      || runtime.status.state === "disabled"
      || (runtime.status.state === "failed" && (runtime.failures >= 3 || this.now() < runtime.nextRetryAt))
    ) {
      throw new Error(runtime.status.error ?? `App ${appId} is not available`);
    }

    const key = context.sessionKey ?? "default";
    const workspace = context.workspace ?? null;
    const existing = runtime.sessions.get(key);
    if (existing) {
      const existingWorkspace = runtime.sessionWorkspaces.get(key) ?? null;
      if (workspace && workspace !== existingWorkspace) {
        const timer = runtime.idleTimers.get(key);
        if (timer) clearTimeout(timer);
        runtime.idleTimers.delete(key);
        runtime.sessions.delete(key);
        runtime.sessionWorkspaces.delete(key);
        await closeConnection(existing);
      } else {
        this.touchSession(runtime, key);
        return existing;
      }
    }

    const inFlight = runtime.sessionStarts.get(key);
    if (inFlight) return inFlight;

    const start = (async () => {
      const appDataDir = path.join(this.roots.data, appId);
      await mkdir(appDataDir, { recursive: true });
      const connection = await this.connect(
        appId,
        this.buildServerConfig(runtime.entry, appDataDir, workspace),
      );
      const raced = runtime.sessions.get(key);
      if (raced) {
        await closeConnection(connection);
        return raced;
      }
      runtime.sessions.set(key, connection);
      runtime.sessionWorkspaces.set(key, workspace);
      this.touchSession(runtime, key);
      if (!runtime.status.toolNames.length) {
        this.registerConnectionTools(runtime, connection);
      }
      runtime.status.state = "ready";
      runtime.status.error = null;
      runtime.failures = 0;
      runtime.nextRetryAt = 0;
      return connection;
    })();
    runtime.sessionStarts.set(key, start);
    try {
      return await start;
    } finally {
      runtime.sessionStarts.delete(key);
    }
  }

  async ensureSessionTools(context: AppSessionContext): Promise<void> {
    for (const runtime of this.apps.values()) {
      if (runtime.entry.manifest.server.scope !== "session") continue;
      if (
        runtime.status.state === "missing_credentials"
        || runtime.status.state === "disabled"
        || runtime.failures >= 3
        || (runtime.status.state === "failed" && this.now() < runtime.nextRetryAt)
      ) {
        continue;
      }
      try {
        await this.sessionFor(runtime.entry.id, context);
      } catch (error) {
        runtime.failures += 1;
        runtime.nextRetryAt = this.now() + Math.min(60_000, 1000 * 2 ** runtime.failures);
        runtime.status.state = "failed";
        runtime.status.error = errorMessage(error);
        this.unregisterRuntimeTools(runtime);
        this.logger.warn(`[apps] ${runtime.entry.id} failed to start session: ${runtime.status.error}`);
      }
    }
  }

  async callTool(
    appId: string,
    toolName: string,
    args: Record<string, any>,
    context: AppSessionContext,
  ): Promise<any> {
    const runtime = this.requireRuntime(appId);
    const connection = await this.sessionFor(appId, context);
    return connection.session.callTool(
      toolName,
      args,
      runtime.entry.manifest.server.toolTimeout ?? 30,
    );
  }

  async readResource(appId: string, uri: string, context: AppSessionContext): Promise<any> {
    const runtime = this.requireRuntime(appId);
    const connection = await this.sessionFor(appId, context);
    return connection.session.readResource(
      uri,
      runtime.entry.manifest.server.toolTimeout ?? 30,
    );
  }

  async readViewResult(appId: string, viewId: string): Promise<any | null> {
    this.requireRuntime(appId);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(viewId)) {
      return null;
    }
    try {
      const raw = await readFile(
        path.join(this.roots.data, appId, "views", viewId, "result.json"),
        "utf8",
      );
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  canAppMessage(appId: string): boolean {
    const runtime = this.apps.get(appId);
    return Boolean(runtime) && runtime!.entry.manifest.capabilities.appMessages === "allow";
  }

  canAppCallTool(appId: string, toolName: string): boolean {
    const runtime = this.apps.get(appId);
    if (!runtime) return false;
    const allowlist = runtime.entry.manifest.capabilities.appToolCalls;
    if (!allowlist.length) return false;
    const wrapped = sanitizeName(`mcp_${appId}_${toolName}`);
    return allowlist.includes(toolName) || allowlist.includes(wrapped);
  }

  async stop(): Promise<void> {
    for (const runtime of this.apps.values()) {
      for (const timer of runtime.idleTimers.values()) clearTimeout(timer);
      runtime.idleTimers.clear();
      if (runtime.global) {
        await closeConnection(runtime.global);
        runtime.global = null;
      }
      for (const connection of runtime.sessions.values()) {
        await closeConnection(connection);
      }
      runtime.sessions.clear();
    }
  }

  private requireRuntime(appId: string): AppRuntime {
    const runtime = this.apps.get(appId);
    if (!runtime) throw new Error(`Unknown app: ${appId}`);
    return runtime;
  }

  private async startEntry(entry: AppRegistryEntry): Promise<void> {
    const status: AppStatus = {
      id: entry.id,
      version: entry.version,
      source: entry.source,
      state: "discovered",
      error: null,
      toolNames: [],
      viewUris: (entry.manifest.ui?.resources ?? []).map((resource) => resource.uri),
    };
    const runtime: AppRuntime = {
      entry,
      status,
      store: new AppViewStore(path.join(this.roots.data, entry.id)),
      global: null,
      sessions: new Map(),
      sessionStarts: new Map(),
      sessionWorkspaces: new Map(),
      idleTimers: new Map(),
      failures: 0,
      nextRetryAt: 0,
    };
    this.apps.set(entry.id, runtime);

    if (!semver.satisfies(VERSION, entry.manifest.engines.cuby)) {
      status.state = "failed";
      status.error = `requires Cuby ${entry.manifest.engines.cuby}`;
      return;
    }

    const missing = (entry.manifest.credentials ?? [])
      .filter((credential) => credential.required)
      .filter((credential) => !process.env[credential.key]);
    if (missing.length) {
      status.state = "missing_credentials";
      status.error = `Missing credentials: ${missing.map((credential) => credential.key).join(", ")}`;
      return;
    }

    status.state = "validated";
    if (entry.manifest.server.scope === "session") {
      status.state = "ready";
      return;
    }

    status.state = "starting";
    try {
      const appDataDir = path.join(this.roots.data, entry.id);
      await mkdir(appDataDir, { recursive: true });
      const connection = await this.connect(
        entry.id,
        this.buildServerConfig(entry, appDataDir, null),
      );
      runtime.global = connection;
      this.registerConnectionTools(runtime, connection);
      status.state = "ready";
    } catch (error) {
      status.state = "failed";
      status.error = errorMessage(error);
      this.logger.warn(`[apps] ${entry.id} failed to start: ${status.error}`);
    }
  }

  private registerConnectionTools(runtime: AppRuntime, connection: McpServerConnection): void {
    const { entry, status } = runtime;
    const enabledTools = new Set(entry.manifest.server.enabledTools ?? ["*"]);
    const allowAll = enabledTools.has("*");
    const timeout = entry.manifest.server.toolTimeout ?? 30;
    const appView = {
      appId: entry.id,
      store: runtime.store,
      prefersBorder: entry.manifest.ui?.prefersBorder,
      csp: entry.manifest.ui?.csp,
      capabilities: {
        openLinks: entry.manifest.capabilities.openLinks === true,
        downloads: entry.manifest.capabilities.downloads === true,
      },
      toolTimeout: timeout,
    };
    const resolveSession = entry.manifest.server.scope === "session"
      ? (context: any) => this.sessionFor(entry.id, {
          sessionKey: context?.sessionKey,
          workspace: context?.workspace,
        }).then((session) => session.session)
      : undefined;
    for (const toolDef of connection.tools) {
      const wrapped = sanitizeName(`mcp_${entry.id}_${toolDef.name}`);
      if (!allowAll && !enabledTools.has(toolDef.name) && !enabledTools.has(wrapped)) continue;
      const wrapper = new MCPToolWrapper(
        connection.session,
        entry.id,
        toolDef,
        timeout,
        undefined,
        connection.managed,
        appView,
        resolveSession,
      );
      this.registerTool(wrapper);
      status.toolNames.push(wrapper.name);
    }
  }

  private unregisterRuntimeTools(runtime: AppRuntime): void {
    for (const name of runtime.status.toolNames) {
      this.unregisterTool(name);
    }
    runtime.status.toolNames = [];
  }

  private buildServerConfig(
    entry: AppRegistryEntry,
    appDataDir: string,
    sessionWorkspace: string | null,
  ): Record<string, any> {
    const placeholders: Record<string, string> = {
      APP_ROOT: entry.path,
      APP_DATA: appDataDir,
      CUBY_USER_DATA: process.env.CUBY_USER_DATA?.trim() || path.dirname(this.roots.data),
      ...(entry.manifest.server.scope === "session"
        && entry.manifest.capabilities.workspace !== "none"
        ? { SESSION_WORKSPACE: sessionWorkspace ?? "" }
        : {}),
    };
    const expand = (value: string): string =>
      value.replace(/\$\{([A-Z_]+)\}/g, (_match, name: string) => placeholders[name] ?? "");

    const command = entry.manifest.server.command;
    const expandedCommand = typeof command === "string"
      ? expand(command)
      : command[`${process.platform}-${process.arch}`];
    if (!expandedCommand) {
      throw new Error(`No server command for ${process.platform}-${process.arch}`);
    }

    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(entry.manifest.server.env ?? {})) {
      env[key] = expand(value);
    }
    for (const credential of entry.manifest.credentials ?? []) {
      const value = process.env[credential.key];
      if (value) env[credential.key] = value;
    }

    return {
      transport: entry.manifest.server.transport,
      command: expandedCommand,
      args: (entry.manifest.server.args ?? []).map(expand),
      ...(entry.manifest.server.cwd ? { cwd: expand(entry.manifest.server.cwd) } : {}),
      env,
    };
  }

  private touchSession(runtime: AppRuntime, key: string): void {
    const existing = runtime.idleTimers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      runtime.idleTimers.delete(key);
      const connection = runtime.sessions.get(key);
      runtime.sessions.delete(key);
      void closeConnection(connection);
    }, SESSION_IDLE_MS);
    timer.unref?.();
    runtime.idleTimers.set(key, timer);
  }
}
