import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as mcpTools from "../../../src/core/agent-runtime/tools/mcp.js";
import { loadConfig, saveConfig, setConfigPath } from "../../../src/config/loader.js";
import { Config } from "../../../src/config/schema.js";
import {
  McpPresetError,
  customMcpAction,
  attachMcpHotReloadResult,
  mcpPresetsAction,
  mcpPresetsPayload,
  mcpPresetsSettingsAction,
  mcpPresetsTestAction,
  normalizeMcpPresetMentions,
} from "../../../src/entrypoints/frontend-bridge/mcp-presets-api.js";

const roots: string[] = [];
const oldPath = process.env.PATH;
const oldDataDir = process.env.CUBY_AGENT_DATA_DIR;
const oldPresetEnv = {
  FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY,
  BRAVE_API_KEY: process.env.BRAVE_API_KEY,
};

function useConfig(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memmy-mcp-presets-"));
  roots.push(root);
  delete process.env.CUBY_AGENT_DATA_DIR;
  setConfigPath(path.join(root, "config.yaml"));
  return root;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.env.PATH = oldPath;
  if (oldDataDir == null) delete process.env.CUBY_AGENT_DATA_DIR;
  else process.env.CUBY_AGENT_DATA_DIR = oldDataDir;
  for (const [key, value] of Object.entries(oldPresetEnv)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  setConfigPath(path.join(os.tmpdir(), "memmy-agent-empty-config.yaml"));
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("mcp presets api", () => {
  it("detects bundled OCU with an empty PATH and preserves the portable config", () => {
    useConfig();
    saveConfig(new Config({ tools: { mcpServers: {
      open_computer_use: { type: "stdio", command: "open-computer-use", args: ["mcp"] },
    } } }));
    process.env.PATH = "";
    const payload = mcpPresetsPayload();
    const server = payload.presets.find((item: any) => item.name === "open_computer_use");
    expect(server).toMatchObject({ available: true, status: "configured" });
    expect(loadConfig().tools.mcpServers.open_computer_use.command).toBe("open-computer-use");
  });

  it("lists supported preset cards", () => {
    useConfig();

    const payload = mcpPresetsPayload();
    const names = new Set(payload.presets.map((preset: any) => preset.name));

    for (const name of ["firecrawl", "exa", "brave-search", "figma"]) {
      expect(names.has(name)).toBe(true);
    }
    const brave = payload.presets.find((preset: any) => preset.name === "brave-search");
    expect(brave.installed).toBe(false);
    expect(brave.install_supported).toBe(true);
    expect(brave.required_fields[0].configured).toBe(false);
    expect(brave.connection_summary).not.toContain("BRAVE_API_KEY");
    expect(brave.manifest).toMatchObject({
      schema: "agent-app.v1",
      id: "brave-search",
      source: "mcp-preset",
      display_name: "Brave Search",
      category: "web",
      capabilities: [{ type: "mcp", transport: "stdio" }],
      install: { strategy: "config", verification: ["config_present", "dependency_available"] },
      remove: { verification: ["config_absent", "managed_paths_absent"] },
      trust: { registry: "mcp-presets", level: "builtin", review_status: "builtin_preset" },
    });
  });

  it("serves only the four office-facing presets and marks the developer pair", () => {
    useConfig();

    const payload = mcpPresetsPayload();
    const presets = payload.presets as Array<Record<string, any>>;

    expect(presets.map((preset) => preset.name)).toEqual([
      "firecrawl",
      "exa",
      "brave-search",
      "figma",
      "open_computer_use",
    ]);
    expect(presets.find((preset) => preset.name === "figma")?.group).toBe("dev");
    expect(presets.find((preset) => preset.name === "firecrawl")?.group).toBe("dev");
    expect(presets.find((preset) => preset.name === "exa")?.group).toBe("");
    expect(presets.find((preset) => preset.name === "brave-search")?.group).toBe("");
  });

  it("enables brave-search and scrubs the returned payload", () => {
    useConfig();

    const payload = mcpPresetsAction("enable", {
      name: ["brave-search"],
      brave_api_key: ["BSA_test"],
    });

    expect(payload.requires_restart).toBe(true);
    expect(payload.last_action.ok).toBe(true);
    expect(payload.last_action.installed).toBe(true);
    expect(payload.last_action.verification).toEqual(["config_present"]);
    const preset = payload.presets.find((row: any) => row.name === "brave-search");
    expect(preset.installed).toBe(true);
    expect(preset.configured).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("BSA_test");
    expect(loadConfig().tools.mcpServers["brave-search"].env.BRAVE_API_KEY).toBe("BSA_test");
  });

  it("preserves current image catalog and unknown nested fields when enabling a preset", () => {
    useConfig();
    saveConfig(new Config({
      providers: {
        openai: {
          apiKey: "sk-byok",
          futureProviderField: "keep-provider",
          endpoints: {
            image: {
              apiBase: "https://api.openai.com/v1",
              protocol: "openai-images",
              futureEndpointField: "keep-endpoint",
            },
          },
        },
      },
      modelPresets: {
        image: {
          provider: "openai",
          endpoint: "image",
          model: "gpt-image-1",
          source: "byok",
          capabilities: ["image_generation"],
          futurePresetField: "keep-preset",
        },
      },
      modelAssignments: {
        byok: {
          agent: { candidates: [], default: null },
          imageGeneration: "image",
        },
      },
      tools: {
        imageGeneration: {
          enabled: true,
          defaultImageSize: "2K",
        },
      },
    }));

    mcpPresetsAction("enable", {
      name: ["brave-search"],
      brave_api_key: ["BSA_test"],
    });

    const saved = loadConfig();
    expect(saved.tools.imageGeneration.toObject()).toMatchObject({ enabled: true, defaultImageSize: "2K" });
    expect(saved.modelAssignments.byok.imageGeneration).toBe("image");
    expect(saved.providers.openai.toObject()).toMatchObject({ futureProviderField: "keep-provider" });
    expect(saved.providers.openai.endpoints.image.toObject()).toMatchObject({ futureEndpointField: "keep-endpoint" });
    expect(saved.modelPresets.image.toObject()).toMatchObject({ futurePresetField: "keep-preset" });
  });

  it("preserves session DAG and compaction config when enabling a preset", () => {
    useConfig();
    saveConfig(new Config({
      sessionDag: {
        enabled: true,
        maxBuilderContextNodes: 64,
        maxUpdateAttempts: 7,
        retryBackoffMs: [1000, 5000, 30000],
        maxConcurrentSessionQueues: 6,
        compactionCatchupTimeoutMs: 180000,
      },
      contextCompaction: {
        summaryMode: "dag",
      },
    }));

    mcpPresetsAction("enable", {
      name: ["brave-search"],
      brave_api_key: ["BSA_test"],
    });

    const saved = loadConfig();
    expect(saved.sessionDag.maxBuilderContextNodes).toBe(64);
    expect(saved.sessionDag.maxUpdateAttempts).toBe(7);
    expect(saved.sessionDag.maxConcurrentSessionQueues).toBe(6);
    expect(saved.contextCompaction.summaryMode).toBe("dag");
  });

  it("reuses existing preset credentials and environment fallbacks", () => {
    useConfig();

    mcpPresetsAction("enable", {
      name: ["brave-search"],
      brave_api_key: ["BSA_test"],
    });
    mcpPresetsAction("enable", { name: ["brave-search"] });
    expect(loadConfig().tools.mcpServers["brave-search"].env.BRAVE_API_KEY).toBe("BSA_test");

    process.env.FIRECRAWL_API_KEY = "fc-from-env";
    try {
      const payload = mcpPresetsAction("enable", { name: ["firecrawl"] });
      const row = payload.presets.find((item: any) => item.name === "firecrawl");
      expect(row.required_fields[0].configured).toBe(true);
      expect(loadConfig().tools.mcpServers.firecrawl.env.FIRECRAWL_API_KEY).toBe("${FIRECRAWL_API_KEY}");
    } finally {
      delete process.env.FIRECRAWL_API_KEY;
    }
  });

  it("requires missing preset secrets", () => {
    useConfig();

    expect(() => mcpPresetsAction("enable", { name: ["brave-search"] })).toThrow(McpPresetError);
    try {
      mcpPresetsAction("enable", { name: ["brave-search"] });
    } catch (error) {
      expect((error as McpPresetError).status).toBe(400);
      expect((error as McpPresetError).message).toContain("Brave Search API key");
    }
  });

  it("uses the runtime data directory for managed stdio preset cwd", () => {
    const root = useConfig();
    const dataDir = path.join(root, "data");
    process.env.CUBY_AGENT_DATA_DIR = dataDir;

    mcpPresetsAction("enable", { name: ["brave-search"], brave_api_key: ["BSA_test"] });

    const cwd = (loadConfig().tools.mcpServers["brave-search"] as any).cwd;
    expect(cwd).toBe(path.join(dataDir, "mcp", "brave-search"));
    expect(fs.statSync(path.join(dataDir, "mcp", "brave-search")).isDirectory()).toBe(true);
  });

  it("writes URLs for no-auth remote presets", () => {
    useConfig();

    mcpPresetsAction("enable", { name: ["figma"] });
    mcpPresetsAction("enable", { name: ["exa"] });

    const config = loadConfig();
    expect(config.tools.mcpServers.figma.url).toBe("http://127.0.0.1:3845/mcp");
    expect(config.tools.mcpServers.exa.url).toBe("https://mcp.exa.ai/mcp");
  });

  it("writes builtin server configs for Figma and Brave", () => {
    useConfig();

    mcpPresetsAction("enable", { name: ["figma"] });
    mcpPresetsAction("enable", { name: ["brave-search"], brave_api_key: ["BSA-secret"] });

    const config = loadConfig();
    expect(config.tools.mcpServers.figma.url).toBe("http://127.0.0.1:3845/mcp");
    expect(config.tools.mcpServers["brave-search"].args).toEqual([
      "-y",
      "@brave/brave-search-mcp-server@latest",
      "--transport",
      "stdio",
    ]);
    expect(config.tools.mcpServers["brave-search"].env.BRAVE_API_KEY).toBe("BSA-secret");
  });

  it("writes scrubbed firecrawl env configuration", () => {
    useConfig();

    const payload = mcpPresetsAction("enable", {
      name: ["firecrawl"],
      firecrawl_api_key: ["fc-secret"],
    });

    expect(JSON.stringify(payload)).not.toContain("fc-secret");
    expect(loadConfig().tools.mcpServers.firecrawl.env.FIRECRAWL_API_KEY).toBe("fc-secret");
  });

  it("removes a managed MCP preset and its managed cwd", () => {
    const root = useConfig();
    mcpPresetsAction("enable", { name: ["brave-search"], brave_api_key: ["BSA_test"] });
    const managedCwd = path.join(root, "mcp", "brave-search");
    fs.writeFileSync(path.join(managedCwd, "cache.txt"), "managed runtime data", "utf8");

    const payload = mcpPresetsAction("remove", { name: ["brave-search"] });

    expect(payload.requires_restart).toBe(true);
    expect(payload.last_action.ok).toBe(true);
    expect(payload.last_action.removed).toBe(true);
    expect(payload.last_action.managed_paths_removed).toEqual(["runtime:mcp/brave-search"]);
    expect(fs.existsSync(managedCwd)).toBe(false);
    expect(loadConfig().tools.mcpServers).not.toHaveProperty("brave-search");
  });

  it("preserves user cwd when removing a custom MCP server", () => {
    const root = useConfig();
    const userCwd = path.join(root, "user-cwd");
    fs.mkdirSync(userCwd);
    customMcpAction("custom", {
      name: ["internal-docs"],
      transport: ["stdio"],
      command: ["node"],
      args: ['["server.js"]'],
      cwd: [userCwd],
    });

    const payload = mcpPresetsAction("remove", { name: ["internal-docs"] });

    expect(payload.last_action.ok).toBe(true);
    expect(fs.existsSync(userCwd)).toBe(true);
    expect(loadConfig().tools.mcpServers).not.toHaveProperty("internal-docs");
  });

  it("reports missing test dependencies", async () => {
    useConfig();
    mcpPresetsAction("enable", { name: ["brave-search"], brave_api_key: ["BSA_test"] });
    process.env.PATH = "";

    const payload = await mcpPresetsTestAction({ name: ["brave-search"] });

    expect(payload.last_action.ok).toBe(false);
    expect(payload.last_action.message).toContain("npx");
  });

  it("connects to a preset and reports tools", async () => {
    useConfig();
    mcpPresetsAction("enable", { name: ["brave-search"], brave_api_key: ["BSA_test"] });
    const config = loadConfig();
    config.tools.mcpServers["brave-search"].command = process.execPath;
    saveConfig(config);
    vi.spyOn(mcpTools, "connectMcpServers").mockImplementation(async (servers, registry) => {
      expect(Object.keys(servers)).toEqual(["brave-search"]);
      registry.register({
        name: "mcp_brave-search_search",
        toSchema: () => ({ name: "mcp_brave-search_search", description: "", parameters: {} }),
      } as any);
      return { "brave-search": { aclose: async () => undefined } };
    });

    const payload = await mcpPresetsTestAction({ name: ["brave-search"] });

    expect(payload.last_action.ok).toBe(true);
    expect(payload.last_action.tool_count).toBe(1);
    expect(payload.last_action.tool_names).toEqual(["mcp_brave-search_search"]);
  });

  it("resolves environment placeholders before testing MCP presets", async () => {
    process.env.FIRECRAWL_API_KEY = "fc-from-env";
    useConfig();
    mcpPresetsAction("enable", { name: ["firecrawl"] });
    const config = loadConfig();
    config.tools.mcpServers.firecrawl.command = process.execPath;
    saveConfig(config);
    vi.spyOn(mcpTools, "connectMcpServers").mockImplementation(async (servers, registry) => {
      expect(servers.firecrawl.env.FIRECRAWL_API_KEY).toBe("fc-from-env");
      registry.register({
        name: "mcp_firecrawl_scrape",
        toSchema: () => ({ name: "mcp_firecrawl_scrape", description: "", parameters: {} }),
      } as any);
      return { firecrawl: { aclose: async () => undefined } };
    });

    const payload = await mcpPresetsTestAction({ name: ["firecrawl"] });

    expect(payload.last_action.ok).toBe(true);
    expect(loadConfig().tools.mcpServers.firecrawl.env.FIRECRAWL_API_KEY).toBe("${FIRECRAWL_API_KEY}");
  });

  it("times out slow MCP preset test connections", async () => {
    useConfig();
    mcpPresetsAction("enable", { name: ["brave-search"], brave_api_key: ["BSA_test"] });
    const config = loadConfig();
    config.tools.mcpServers["brave-search"].command = process.execPath;
    (config.tools.mcpServers["brave-search"] as any).tool_timeout = 60;
    saveConfig(config);
    vi.spyOn(mcpTools, "connectMcpServers").mockReturnValue(new Promise(() => undefined) as any);
    vi.useFakeTimers();

    const pending = mcpPresetsTestAction({ name: ["brave-search"] });
    await vi.advanceTimersByTimeAsync(20_000);
    const payload = await pending;

    expect(payload.last_action.ok).toBe(false);
    expect(payload.last_action.error).toBe("timeout");
    expect(payload.last_action.message).toBe("Brave Search test timed out.");
  });

  it("keeps hyphenated MCP server names in test tool prefixes", async () => {
    useConfig();
    mcpPresetsAction("enable", { name: ["brave-search"], brave_api_key: ["BSA-secret"] });
    const config = loadConfig();
    config.tools.mcpServers["brave-search"].command = process.execPath;
    saveConfig(config);
    vi.spyOn(mcpTools, "connectMcpServers").mockImplementation(async (_servers, registry) => {
      registry.register({
        name: "mcp_brave-search_search",
        toSchema: () => ({ name: "mcp_brave-search_search", description: "", parameters: {} }),
      } as any);
      return { "brave-search": { aclose: async () => undefined } };
    });

    const payload = await mcpPresetsTestAction({ name: ["brave-search"] });

    expect(payload.last_action.ok).toBe(true);
    expect(payload.last_action.tool_names).toEqual(["mcp_brave-search_search"]);
  });

  it("scrubs connection errors", async () => {
    useConfig();
    mcpPresetsAction("enable", { name: ["brave-search"], brave_api_key: ["BSA_test"] });
    vi.spyOn(mcpTools, "connectMcpServers").mockRejectedValue(
      new Error("failed to connect: BRAVE_API_KEY=BSA_test"),
    );

    const payload = await mcpPresetsTestAction({ name: ["brave-search"] });

    expect(payload.last_action.ok).toBe(false);
    expect(JSON.stringify(payload)).not.toContain("BSA_test");
    expect(payload.last_action.error).toContain("<redacted>");
  });

  it("does not enable unlisted OAuth placeholders", () => {
    useConfig();

    expect(() => mcpPresetsAction("enable", { name: ["linear"] })).toThrow(McpPresetError);
    try {
      mcpPresetsAction("enable", { name: ["linear"] });
    } catch (error) {
      expect((error as McpPresetError).status).toBe(404);
    }
  });

  it("normalizes known preset mentions only", () => {
    useConfig();

    expect(normalizeMcpPresetMentions([
      {
        name: "brave-search",
        display_name: "Brave Search",
        transport: "stdio",
        configured: true,
        logo_url: "https://example.invalid/logo.svg",
      },
      { name: "github" },
      { name: "totally-unknown" },
      "bad",
    ])).toEqual([
      {
        name: "brave-search",
        display_name: "Brave Search",
        transport: "stdio",
        configured: true,
        logo_url: "https://example.invalid/logo.svg",
      },
    ]);
  });

  it("writes custom MCP server config and catalog row", () => {
    useConfig();

    const payload = customMcpAction("custom", {
      name: ["internal-docs"],
      transport: ["stdio"],
      command: ["node"],
      args: ['["server.js"]'],
      env: ['{"DOCS_TOKEN":"docs-secret-value"}'],
      tool_timeout: ["45"],
    });

    expect(payload.requires_restart).toBe(true);
    const row = payload.presets.find((item: any) => item.name === "internal-docs");
    expect(row.source).toBe("custom");
    expect(row.transport).toBe("stdio");
    expect(row.connection_summary).toBe("node server.js");
    expect(row.manifest.schema).toBe("agent-app.v1");
    expect(row.manifest.source).toBe("mcp-custom");
    expect(row.manifest.capabilities[0].command).toBe("node");
    expect(JSON.stringify(row.manifest)).not.toContain("server.js");
    expect(JSON.stringify(payload)).not.toContain("docs-secret-value");
    const config = loadConfig();
    expect(config.tools.mcpServers["internal-docs"].args).toEqual(["server.js"]);
    expect(config.tools.mcpServers["internal-docs"].env.DOCS_TOKEN).toBe("docs-secret-value");
  });

  it("validates custom MCP server transports and parses headers and defaults", () => {
    useConfig();

    expect(() => customMcpAction("custom", { name: ["bad-stdio"], transport: ["stdio"] })).toThrow(McpPresetError);
    expect(() => customMcpAction("custom", { name: ["bad-http"], transport: ["streamableHttp"] })).toThrow(McpPresetError);

    customMcpAction("custom", {
      name: ["remote-docs"],
      url: ["https://example.com/mcp"],
      headers: ['{"Authorization":"Bearer secret"}'],
    });

    const cfg = loadConfig().tools.mcpServers["remote-docs"] as any;
    expect(cfg.transport).toBe("streamableHttp");
    expect(cfg.headers.Authorization).toBe("Bearer secret");
    expect(cfg.enabled_tools).toEqual(["*"]);
    expect(cfg.tool_timeout).toBe(30);
  });

  it("imports MCP config and updates tool allowlists", () => {
    useConfig();

    let payload = customMcpAction("import", {
      config: [
        '{"mcpServers":{"docs":{"command":"npx","args":["-y","docs-mcp"],"env":{"API_KEY":"config-secret-value"}},"remote-docs":{"transport":"sse","url":"https://example.com/sse"}}}',
      ],
    });

    expect(payload.last_action.message).toBe("Imported 2 MCP server(s).");
    let config = loadConfig();
    expect(config.tools.mcpServers.docs.command).toBe("npx");
    expect(config.tools.mcpServers.docs.args).toEqual(["-y", "docs-mcp"]);
    expect((config.tools.mcpServers["remote-docs"] as any).type).toBe("sse");
    expect(config.tools.mcpServers["remote-docs"].url).toBe("https://example.com/sse");
    expect(config.tools.mcpServers.docs.env.API_KEY).toBe("config-secret-value");
    expect(JSON.stringify(payload)).not.toContain("config-secret-value");

    payload = customMcpAction("tools", { name: ["docs"], enabled_tools: ['["mcp_docs_search"]'] });
    expect(payload.presets.find((item: any) => item.name === "docs").enabled_tools).toEqual(["mcp_docs_search"]);
    expect((loadConfig().tools.mcpServers.docs as any).enabled_tools).toEqual(["mcp_docs_search"]);

    payload = customMcpAction("tools", { name: ["docs"], enabled_tools: ["[]"] });
    expect(payload.presets.find((item: any) => item.name === "docs").enabled_tools).toEqual([]);
    config = loadConfig();
    expect((config.tools.mcpServers.docs as any).enabled_tools).toEqual([]);

    expect(() => customMcpAction("import", { config: ['{"mcpServers":{"bad":{"transport":"stdio"}}}'] })).toThrow(McpPresetError);

    payload = customMcpAction("import-cursor", {
      config: ['{"cursor-docs":{"command":"node","args":["server.js"]}}'],
    });
    expect(payload.last_action.message).toBe("Imported 1 MCP server(s).");
    expect(loadConfig().tools.mcpServers["cursor-docs"].command).toBe("node");
  });

  it("attaches hot reload results for settings actions", async () => {
    useConfig();

    const payload = attachMcpHotReloadResult(
      { last_action: { ok: true, message: "Saved MCP server docs." }, requires_restart: true },
      { ok: true, message: "Hot reloaded.", requires_restart: false },
    );
    expect(payload.requires_restart).toBe(false);
    expect(payload.last_action.message).toBe("Saved MCP server docs. Hot reloaded.");

    const settingsPayload = await mcpPresetsSettingsAction(
      "custom",
      {
        name: ["docs"],
        transport: ["stdio"],
        command: ["node"],
      },
      { reloadMcp: async () => ({ ok: true, message: "Reloaded.", requires_restart: false }) },
    );
    expect(settingsPayload.hot_reload.ok).toBe(true);
    expect(settingsPayload.requires_restart).toBe(false);
    expect(loadConfig().tools.mcpServers.docs.command).toBe("node");
  });

  it("accepts configured custom servers in normalized mentions", () => {
    useConfig();
    customMcpAction("custom", {
      name: ["docs"],
      transport: ["streamableHttp"],
      url: ["https://example.com/mcp"],
    });

    expect(normalizeMcpPresetMentions([
      { name: "docs", display_name: "Docs", transport: "streamableHttp" },
    ])).toEqual([{ name: "docs", display_name: "Docs", transport: "streamableHttp" }]);
  });
});
