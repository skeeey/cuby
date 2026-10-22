/** Model provisioning tests. */
import type { CuberouterModelChoicesView } from "@memmy/local-api-contracts";
import { describe, expect, it, vi } from "vitest";
import { applyCuberouterSelection, createModelWorkspace } from "../model-workspace.js";
import {
  provisionCuberouterKey,
  resolveCuberouterLoginKey,
  saveCatalogMutation
} from "../model-provisioning.js";

function configClientWithCalls() {
  const saved: any[] = [];
  const client = {
    getModelConfig: vi.fn(async () => ({
      providers: [],
      modelAssignments: createModelWorkspace(null).catalog.modelAssignments,
      configRevision: "rev-1"
    })),
    saveModelCatalog: vi.fn(async (input: any) => {
      saved.push(input);
      return { providers: [], modelAssignments: input.modelAssignments, configRevision: "rev-2" };
    })
  };
  return { client: client as any, saved };
}

/**
 * Server stub that remembers what was written and hands it back on the next read, the way the
 * local API does — including never echoing a stored secret (`apiKey: ""` on endpoints).
 */
function configClientServer(initial?: any) {
  const saved: any[] = [];
  let catalog = initial ?? createModelWorkspace(null).catalog;
  const client = {
    getModelConfig: vi.fn(async () => ({
      catalog,
      configRevision: catalog.configRevision,
      provider: "openai",
      endpoint: "",
      model: "",
      apiKey: "",
      apiKeyMasked: "",
      configured: true
    })),
    saveModelCatalog: vi.fn(async (input: any) => {
      saved.push(input);
      catalog = catalogFromWrite(input, saved.length);
      return {
        catalog,
        configRevision: catalog.configRevision,
        provider: "openai",
        endpoint: "",
        model: "",
        apiKey: "",
        apiKeyMasked: "",
        configured: true
      };
    })
  };
  return { client: client as any, saved };
}

/** Mirrors the server's catalog view after a write: stored secrets are never echoed back. */
function catalogFromWrite(input: any, revision: number) {
  return {
    ...createModelWorkspace(null).catalog,
    configRevision: `rev-${revision}`,
    providers: input.providers.map((provider: any) => ({
      provider: provider.provider,
      configured: true,
      hasApiKey: true,
      apiKeyMasked: "",
      apiKey: "",
      accountManaged: false,
      editable: true,
      endpoints: provider.endpoints.map((endpoint: any) => ({
        endpointId: endpoint.endpointId,
        apiBase: endpoint.apiBase,
        protocol: endpoint.protocol,
        hasApiKey: true,
        apiKeyMasked: "",
        apiKey: ""
      })),
      models: provider.models.map((model: any) => ({
        presetId: model.presetId,
        provider: provider.provider,
        endpointId: model.endpointId,
        protocol: provider.endpoints.find((endpoint: any) => endpoint.endpointId === model.endpointId)?.protocol
          ?? "openai-chat-completions",
        model: model.model,
        source: model.source,
        capabilities: [...model.capabilities],
        available: true
      }))
    })),
    modelAssignments: structuredClone(input.modelAssignments),
    configured: true
  };
}

describe("provisionCuberouterKey", () => {
  it("writes one openai provider with the cuberouter endpoint and assigns three capabilities", async () => {
    const { client, saved } = configClientWithCalls();

    await provisionCuberouterKey({
      configClient: client,
      endpoint: { apiBase: "http://127.0.0.1:3000/v1", protocol: "openai-chat-completions", apiKey: "sk-plain" },
      defaultModel: "deepseek-flash",
      availableModels: ["deepseek-flash"]
    });

    expect(saved).toHaveLength(1);
    const provider = saved[0].providers.find((item: any) => item.provider === "openai");
    expect(provider.endpoints[0].apiBase).toBe("http://127.0.0.1:3000/v1");
    expect(provider.endpoints[0].apiKey).toBe("sk-plain");
    expect(provider.models[0].model).toBe("deepseek-flash");
    expect(provider.models[0].capabilities).toEqual(
      expect.arrayContaining(["agent", "memory_summary", "memory_evolution"])
    );
    const byok = saved[0].modelAssignments.byok;
    const presetId = provider.models[0].presetId;
    expect(byok.agent.default).toBe(presetId);
    expect(byok.agent.candidates).toContain(presetId);
    expect(byok.memorySummary).toBe(presetId);
    expect(byok.memoryEvolution).toBe(presetId);
    expect(byok.embedding).toBeNull();
  });

  it("retries once when the catalog revision is stale", async () => {
    const { client, saved } = configClientWithCalls();
    client.saveModelCatalog.mockRejectedValueOnce(
      Object.assign(new Error("stale"), { code: "model_config_changed" })
    );

    await provisionCuberouterKey({
      configClient: client,
      endpoint: { apiBase: "http://127.0.0.1:3000/v1", protocol: "openai-chat-completions", apiKey: "sk-plain" },
      defaultModel: "deepseek-flash",
      availableModels: ["deepseek-flash"]
    });

    expect(client.saveModelCatalog).toHaveBeenCalledTimes(2);
    expect(saved).toHaveLength(1);
  });

  it("re-provisions one endpoint and one preset when a previous login already wrote them", async () => {
    const server = configClientServer();
    const input = {
      configClient: server.client,
      endpoint: { apiBase: "http://127.0.0.1:3000/v1", protocol: "openai-chat-completions" as const, apiKey: "sk-plain" },
      defaultModel: "deepseek-flash",
      availableModels: ["deepseek-flash"]
    };

    await provisionCuberouterKey(input);
    await provisionCuberouterKey(input);

    expect(server.saved).toHaveLength(2);
    const [first, second] = server.saved;
    expect(first.providers).toHaveLength(1);
    expect(second.providers).toHaveLength(1);
    expect(second.providers[0].endpoints).toHaveLength(1);
    expect(second.providers[0].models).toHaveLength(1);
    expect(second.providers[0].endpoints[0].endpointId)
      .toBe(first.providers[0].endpoints[0].endpointId);
    expect(second.providers[0].models[0].presetId)
      .toBe(first.providers[0].models[0].presetId);
    // The server never echoes the stored secret, so every write must carry it again.
    expect(second.providers[0].endpoints[0].apiKey).toBe("sk-plain");
    expect(second.modelAssignments.byok.agent.default).toBe(second.providers[0].models[0].presetId);
  });

  it("drops the previous node's endpoints and models when logging in on another node", async () => {
    const seeded = applyCuberouterSelection(createModelWorkspace(null), {
      apiBase: "https://cn.example/v1",
      protocol: "openai-chat-completions",
      apiKey: "sk-cn",
      selection: {
        agent: { models: ["old-model"], default: "old-model" },
        memorySummary: "old-model",
        memoryEvolution: "old-model"
      }
    });
    const server = configClientServer(seeded.catalog);

    await provisionCuberouterKey({
      configClient: server.client,
      endpoint: { apiBase: "https://hk.example/v1", protocol: "openai-chat-completions", apiKey: "sk-hk" },
      defaultModel: "deepseek-flash",
      availableModels: ["deepseek-flash"]
    });

    expect(server.saved).toHaveLength(1);
    const provider = server.saved[0].providers[0];
    expect(provider.endpoints.map((endpoint: any) => endpoint.apiBase)).toEqual(["https://hk.example/v1"]);
    expect(provider.models.map((preset: any) => preset.model)).toEqual(["deepseek-flash"]);
    expect(JSON.stringify(server.saved[0])).not.toContain("old-model");
  });

  it("keeps the models the user assigned when a re-login re-provisions the key", async () => {
    // The re-login path: a new key arrives for the same line, and the assignments the user made
    // must survive it — only the credential changes.
    const seeded = applyCuberouterSelection(createModelWorkspace(null), {
      apiBase: "http://127.0.0.1:3000/v1",
      protocol: "openai-chat-completions",
      apiKey: "sk-old",
      selection: {
        agent: { models: ["gpt-oss-120b"], default: "gpt-oss-120b" },
        memorySummary: "gpt-oss-120b",
        memoryEvolution: "gpt-oss-120b"
      }
    });
    const server = configClientServer(seeded.catalog);

    await provisionCuberouterKey({
      configClient: server.client,
      endpoint: { apiBase: "http://127.0.0.1:3000/v1", protocol: "openai-chat-completions", apiKey: "sk-new" },
      defaultModel: "deepseek-flash",
      availableModels: ["gpt-oss-120b"]
    });

    expect(server.saved).toHaveLength(1);
    const provider = server.saved[0].providers[0];
    expect(provider.endpoints[0].apiKey).toBe("sk-new");
    expect(provider.models.map((preset: any) => preset.model)).toEqual(["gpt-oss-120b"]);
    const byok = server.saved[0].modelAssignments.byok;
    expect(byok.agent.default).toBe(provider.models[0].presetId);
    expect(byok.agent.candidates).toContain(provider.models[0].presetId);
    expect(byok.memorySummary).toBe(provider.models[0].presetId);
    expect(byok.memoryEvolution).toBe(provider.models[0].presetId);
    expect(JSON.stringify(server.saved[0])).not.toContain("deepseek-flash");
  });

  it("keeps a customized selection on the login's provision path, changing only the key", async () => {
    // A machine the user customized but never clicked a key row on has no selection record, so
    // the login decides "provision". That branch must still keep the catalog's models: only the
    // key changes, nothing is seeded over the three slots and no preset is pruned.
    const seeded = applyCuberouterSelection(createModelWorkspace(null), {
      apiBase: "http://127.0.0.1:3000/v1",
      protocol: "openai-chat-completions",
      apiKey: "sk-old",
      selection: {
        agent: { models: ["gpt-oss-120b", "deepseek-v4.1-flash"], default: "gpt-oss-120b" },
        memorySummary: "deepseek-v4.1-flash",
        memoryEvolution: "gpt-oss-120b"
      }
    });
    const server = configClientServer(seeded.catalog);

    const decision = await resolveCuberouterLoginKey({
      apiBase: "http://127.0.0.1:3000/v1",
      catalog: seeded.catalog,
      record: null,
      getModelChoices: async () => ({
        account: { username: "alice@a.com", organizationName: null },
        apiBase: "http://127.0.0.1:3000/v1",
        keys: [],
        models: ["gpt-oss-120b", "deepseek-v4.1-flash"]
      }),
      revealPersonalKey: async () => ({ key: "sk-revealed" })
    });
    expect(decision).toEqual({
      action: "provision",
      availableModels: ["gpt-oss-120b", "deepseek-v4.1-flash"]
    });

    await provisionCuberouterKey({
      configClient: server.client,
      endpoint: {
        apiBase: "http://127.0.0.1:3000/v1",
        protocol: "openai-chat-completions",
        apiKey: decision.action === "provision" ? "sk-fresh" : "unreachable"
      },
      defaultModel: "deepseek-flash",
      availableModels: (decision as { availableModels?: string[] | null }).availableModels ?? null
    });

    expect(server.saved).toHaveLength(1);
    const written = server.saved[0];
    const provider = written.providers[0];
    expect(provider.endpoints[0].apiKey).toBe("sk-fresh");
    const presetIdOf = (model: string) =>
      provider.models.find((preset: any) => preset.model === model).presetId;
    expect(provider.models.map((preset: any) => preset.model).sort())
      .toEqual(["deepseek-v4.1-flash", "gpt-oss-120b"]);
    const byok = written.modelAssignments.byok;
    expect(byok.agent.candidates).toEqual([presetIdOf("gpt-oss-120b"), presetIdOf("deepseek-v4.1-flash")]);
    expect(byok.agent.default).toBe(presetIdOf("gpt-oss-120b"));
    expect(byok.memorySummary).toBe(presetIdOf("deepseek-v4.1-flash"));
    expect(byok.memoryEvolution).toBe(presetIdOf("gpt-oss-120b"));
    // The build's default never lands in a slot the user already filled.
    expect(JSON.stringify(written)).not.toContain("deepseek-flash");
  });

  // The build's model is a preferred default, not a promise: a key may be seeded with it only
  // while the instance's own list (carried by the login decision) actually offers it, and an
  // unlisted default falls back to the first model the list does offer. The connection is never
  // written without a model — the catalog contract rejects that (`TextModelProviderInputSchema`
  // requires at least one model per provider). The four cases below pin each combination.
  it("enrolls every model the instance lists as an agent candidate", async () => {
    const server = configClientServer();

    await provisionCuberouterKey({
      configClient: server.client,
      endpoint: { apiBase: "http://127.0.0.1:3000/v1", protocol: "openai-chat-completions", apiKey: "sk-plain" },
      defaultModel: "gpt-oss-120b",
      availableModels: ["deepseek-flash", "gpt-oss-120b", "qwen3-235b"]
    });

    const written = server.saved[0];
    const provider = written.providers[0];
    const presetIdOf = (model: string) =>
      provider.models.find((preset: any) => preset.model === model)!.presetId;
    expect(provider.models.map((preset: any) => preset.model).sort())
      .toEqual(["deepseek-flash", "gpt-oss-120b", "qwen3-235b"]);
    expect(written.modelAssignments.byok.agent.candidates).toEqual([
      presetIdOf("deepseek-flash"),
      presetIdOf("gpt-oss-120b"),
      presetIdOf("qwen3-235b")
    ]);
    expect(written.modelAssignments.byok.agent.default).toBe(presetIdOf("gpt-oss-120b"));
  });

  it("seeds the build-time default into all three slots when the instance lists it", async () => {
    const server = configClientServer();
    const decision = await resolveCuberouterLoginKey({
      apiBase: "http://127.0.0.1:3000/v1",
      catalog: createModelWorkspace(null).catalog,
      record: null,
      getModelChoices: async () => ({
        account: { username: "alice@a.com", organizationName: null },
        apiBase: "http://127.0.0.1:3000/v1",
        keys: [],
        models: ["deepseek-flash", "gpt-oss-120b"]
      }),
      revealPersonalKey: async () => ({ key: "sk-revealed" })
    });
    // The list verdict travels with the decision: without it, provisioning cannot tell "the
    // instance does not list the default" from "the instance was never asked".
    expect(decision).toEqual({
      action: "provision",
      availableModels: ["deepseek-flash", "gpt-oss-120b"]
    });

    await provisionCuberouterKey({
      configClient: server.client,
      endpoint: { apiBase: "http://127.0.0.1:3000/v1", protocol: "openai-chat-completions", apiKey: "sk-fresh" },
      defaultModel: "deepseek-flash",
      availableModels: (decision as { availableModels?: string[] | null }).availableModels ?? null
    });

    expect(server.saved).toHaveLength(1);
    const written = server.saved[0];
    const provider = written.providers[0];
    expect(provider.endpoints[0].apiKey).toBe("sk-fresh");
    expect(provider.models.map((preset: any) => preset.model).sort())
      .toEqual(["deepseek-flash", "gpt-oss-120b"]);
    const presetIdOf = (model: string) =>
      provider.models.find((preset: any) => preset.model === model).presetId;
    const byok = written.modelAssignments.byok;
    expect(byok.agent.candidates).toEqual([
      presetIdOf("deepseek-flash"),
      presetIdOf("gpt-oss-120b")
    ]);
    expect(byok.agent.default).toBe(presetIdOf("deepseek-flash"));
    expect(byok.memorySummary).toBe(presetIdOf("deepseek-flash"));
    expect(byok.memoryEvolution).toBe(presetIdOf("deepseek-flash"));
  });

  it("seeds the first listed model when the instance does not list the build-time default", async () => {
    // A different deployment or group: the key is valid, the default model is not callable there.
    // The first listed model takes its place — the connection cannot be written without one
    // (`TextModelProviderInputSchema.models` is min(1)), so "seed nothing" is not a writable state.
    const server = configClientServer();

    await provisionCuberouterKey({
      configClient: server.client,
      endpoint: { apiBase: "http://127.0.0.1:3000/v1", protocol: "openai-chat-completions", apiKey: "sk-plain" },
      defaultModel: "deepseek-flash",
      availableModels: ["gpt-oss-120b", "qwen3-235b"]
    });

    expect(server.saved).toHaveLength(1);
    const written = server.saved[0];
    const provider = written.providers[0];
    expect(provider.endpoints[0].apiKey).toBe("sk-plain");
    // The contract's floor: a provider must carry at least one model.
    expect(provider.models.length).toBeGreaterThan(0);
    expect(provider.models.map((preset: any) => preset.model).sort())
      .toEqual(["gpt-oss-120b", "qwen3-235b"]);
    const presetIdOf = (model: string) =>
      provider.models.find((preset: any) => preset.model === model).presetId;
    const byok = written.modelAssignments.byok;
    expect(byok.agent.candidates).toEqual([
      presetIdOf("gpt-oss-120b"),
      presetIdOf("qwen3-235b")
    ]);
    expect(byok.agent.default).toBe(presetIdOf("gpt-oss-120b"));
    expect(byok.memorySummary).toBe(presetIdOf("gpt-oss-120b"));
    expect(byok.memoryEvolution).toBe(presetIdOf("gpt-oss-120b"));
    expect(JSON.stringify(written)).not.toContain("deepseek-flash");
  });

  it("seeds the build-time default when the model list is unknown", async () => {
    // The choices request failed (`availableModels: null`): the list could not be consulted, so
    // the connection keeps the build's default — the pre-change behavior, and the only writable one.
    const server = configClientServer();

    await provisionCuberouterKey({
      configClient: server.client,
      endpoint: { apiBase: "http://127.0.0.1:3000/v1", protocol: "openai-chat-completions", apiKey: "sk-plain" },
      defaultModel: "deepseek-flash",
      availableModels: null
    });

    expect(server.saved).toHaveLength(1);
    const written = server.saved[0];
    const provider = written.providers[0];
    expect(provider.endpoints[0].apiKey).toBe("sk-plain");
    expect(provider.models.length).toBeGreaterThan(0);
    expect(provider.models.map((preset: any) => preset.model)).toEqual(["deepseek-flash"]);
    const presetId = provider.models[0].presetId;
    const byok = written.modelAssignments.byok;
    expect(byok.agent.candidates).toEqual([presetId]);
    expect(byok.agent.default).toBe(presetId);
    expect(byok.memorySummary).toBe(presetId);
    expect(byok.memoryEvolution).toBe(presetId);
  });

  it("enrolls the instance's models without overwriting a memory-only selection", async () => {
    // A machine that configured only the memory slots: those choices must survive, while the
    // instance's chat models still become available in the conversation picker.
    const seeded = applyCuberouterSelection(createModelWorkspace(null), {
      apiBase: "http://127.0.0.1:3000/v1",
      protocol: "openai-chat-completions",
      apiKey: "sk-old",
      selection: { agent: { models: [] }, memorySummary: "gpt-oss-120b", memoryEvolution: "" }
    });
    const server = configClientServer(seeded.catalog);

    await provisionCuberouterKey({
      configClient: server.client,
      endpoint: { apiBase: "http://127.0.0.1:3000/v1", protocol: "openai-chat-completions", apiKey: "sk-new" },
      defaultModel: "deepseek-flash",
      availableModels: ["deepseek-flash", "gpt-oss-120b"]
    });

    expect(server.saved).toHaveLength(1);
    const written = server.saved[0];
    const provider = written.providers[0];
    expect(provider.endpoints[0].apiKey).toBe("sk-new");
    expect(provider.models.map((preset: any) => preset.model).sort())
      .toEqual(["deepseek-flash", "gpt-oss-120b"]);
    const presetIdOf = (model: string) =>
      provider.models.find((preset: any) => preset.model === model).presetId;
    const byok = written.modelAssignments.byok;
    expect([...byok.agent.candidates].sort()).toEqual([
      presetIdOf("deepseek-flash"),
      presetIdOf("gpt-oss-120b")
    ].sort());
    expect(byok.agent.default).toBe(presetIdOf("deepseek-flash"));
    expect(byok.memorySummary).toBe(presetIdOf("gpt-oss-120b"));
    expect(byok.memoryEvolution).toBeNull();
  });
});

describe("resolveCuberouterLoginKey", () => {
  const record = { username: "alice@a.com", scope: "personal" as const, id: 41, name: "my-own-key" };
  const listedKey = {
    scope: "personal" as const,
    id: 41,
    name: "my-own-key",
    status: 1,
    usable: true,
    billing: { kind: "personal" as const, remainingQuota: 100 }
  };

  /** The instance's answer with the given key rows, everything else fixed. */
  function choicesOf(keys: CuberouterModelChoicesView["keys"], withSecret = false): CuberouterModelChoicesView {
    return {
      account: { username: "alice@a.com", organizationName: null },
      apiBase: "https://cn.example/v1",
      keys: withSecret ? keys.map((key) => ({ ...key, secret: "sk-listed" })) : keys,
      models: ["deepseek-flash"]
    };
  }

  it("reuses a remembered personal key by revealing its plaintext", async () => {
    const revealPersonalKey = vi.fn(async () => ({ key: "sk-revealed" }));

    await expect(resolveCuberouterLoginKey({
      apiBase: "https://cn.example/v1",
      catalog: createModelWorkspace(null).catalog,
      record,
      getModelChoices: async () => choicesOf([listedKey]),
      revealPersonalKey
    })).resolves.toEqual({ action: "reuse", apiKey: "sk-revealed", record });
    expect(revealPersonalKey).toHaveBeenCalledWith(41);
  });

  it("reuses an organization key's listed secret without revealing anything", async () => {
    const revealPersonalKey = vi.fn(async () => ({ key: "sk-revealed" }));
    const organization = { ...listedKey, scope: "organization" as const };

    await expect(resolveCuberouterLoginKey({
      apiBase: "https://cn.example/v1",
      catalog: createModelWorkspace(null).catalog,
      record: { ...record, scope: "organization" },
      getModelChoices: async () => choicesOf([organization], true),
      revealPersonalKey
    })).resolves.toEqual({
      action: "reuse",
      apiKey: "sk-listed",
      record: { ...record, scope: "organization" }
    });
    expect(revealPersonalKey).not.toHaveBeenCalled();
  });

  it("provisions when the remembered key is missing or no longer usable", async () => {
    const resolve = (keys: CuberouterModelChoicesView["keys"]) => resolveCuberouterLoginKey({
      apiBase: "https://cn.example/v1",
      catalog: createModelWorkspace(null).catalog,
      record,
      getModelChoices: async () => choicesOf(keys),
      revealPersonalKey: async () => ({ key: "sk-revealed" })
    });

    await expect(resolve([])).resolves.toEqual({ action: "provision", availableModels: ["deepseek-flash"] });
    await expect(resolve([{ ...listedKey, usable: false }]))
      .resolves.toEqual({ action: "provision", availableModels: ["deepseek-flash"] });
    await expect(resolveCuberouterLoginKey({
      apiBase: "https://cn.example/v1",
      catalog: createModelWorkspace(null).catalog,
      record: null,
      getModelChoices: async () => choicesOf([listedKey]),
      revealPersonalKey: async () => ({ key: "sk-revealed" })
    })).resolves.toEqual({ action: "provision", availableModels: ["deepseek-flash"] });
  });

  it("keeps a connection already written when the instance cannot be asked", async () => {
    // A transient outage must not overwrite the key the user picked: with a cuberouter
    // connection in the catalog, the login writes nothing.
    const seeded = applyCuberouterSelection(createModelWorkspace(null), {
      apiBase: "https://cn.example/v1",
      protocol: "openai-chat-completions",
      apiKey: "sk-already-chosen",
      selection: { agent: { models: ["deepseek-flash"] }, memorySummary: "", memoryEvolution: "" }
    });

    await expect(resolveCuberouterLoginKey({
      apiBase: "https://cn.example/v1/",
      catalog: seeded.catalog,
      record,
      getModelChoices: async () => {
        throw new Error("instance offline");
      },
      revealPersonalKey: async () => ({ key: "sk-revealed" })
    })).resolves.toEqual({ action: "keep" });
  });

  it("provisions when the instance cannot be asked and nothing is written", async () => {
    // The list is unknown on this path: the decision says so with `availableModels: null` rather
    // than leaving the seeding to guess, and an unknown list seeds the build-time default model
    // (a connection cannot be written without one).
    await expect(resolveCuberouterLoginKey({
      apiBase: "https://cn.example/v1",
      catalog: createModelWorkspace(null).catalog,
      record,
      getModelChoices: async () => {
        throw new Error("instance offline");
      },
      revealPersonalKey: async () => ({ key: "sk-revealed" })
    })).resolves.toEqual({ action: "provision", availableModels: null });
  });
});

describe("saveCatalogMutation", () => {
  it("re-reads and retries once when the catalog changed under it", async () => {
    const saved: any[] = [];
    const client = {
      getModelConfig: vi.fn(async () => ({ catalog: createModelWorkspace(null).catalog, configRevision: "rev-1" })),
      saveModelCatalog: vi.fn(async (input: any) => {
        saved.push(input);
        if (saved.length === 1) throw Object.assign(new Error("changed"), { code: "model_config_changed" });
        return { catalog: createModelWorkspace(null).catalog, configRevision: "rev-2" };
      })
    };

    await saveCatalogMutation({
      configClient: client as any,
      mutate: (workspace) => applyCuberouterSelection(workspace, {
        apiBase: "https://cn.example/v1",
        protocol: "openai-chat-completions",
        apiKey: "sk-1",
        selection: { agent: { models: ["a"] }, memorySummary: "a", memoryEvolution: "a" }
      })
    });

    expect(client.saveModelCatalog).toHaveBeenCalledTimes(2);
    expect(client.getModelConfig).toHaveBeenCalledTimes(2);
  });
});
