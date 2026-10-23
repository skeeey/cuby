/** Pure view-model helpers for the canonical model catalog returned by the local API. */
import {
  BUILTIN_LOCAL_EMBEDDING_ASSIGNMENT_ID,
  type CatalogEndpointInput,
  type CatalogProviderId,
  type ModelAssignment,
  type ModelCapability as CatalogCapability,
  type ModelConfigInput,
  type ModelConfigView,
  type ModelEndpointProtocol,
  type TextModelItemView
} from "@memmy/local-api-contracts";
import { CLIENT_PRESET_ID_PREFIX, type ModelProviderConfig } from "../api/config-client.js";

export const MODEL_WORKSPACE_STORAGE_KEY = "memmy-model-workspace-v1";

export type ModelWorkspaceMode = "account" | "byok";
export type ModelCapability = "chat" | "memorySummary" | "memoryEvolution" | "embedding" | "asr" | "image";
export type ModelAssignmentKind = "memorySummary" | "memoryEvolution" | "embedding" | "asr" | "image";
export type ModelWorkspaceMutationError =
  | "duplicate_provider"
  | "duplicate_model"
  | "invalid_connection"
  | "invalid_model"
  | "incompatible_model_capabilities"
  | "connection_not_found";

export interface ModelConnection {
  id: string;
  provider: string;
  endpointId: string;
  endpoint: string;
  protocol: ModelEndpointProtocol;
  apiKeyMasked: string;
  models: string[];
  modelEntries: ModelConnectionModel[];
  modelCapabilities: Record<string, ModelCapability>;
  presetIds: Record<string, string>;
  available: boolean;
  accountManaged: boolean;
}

export interface ModelConnectionModel {
  presetId: string;
  model: string;
  capability: ModelCapability;
  capabilities: CatalogCapability[];
}

export interface ModelWorkspaceSpace {
  connections: ModelConnection[];
  assignments: Partial<Record<ModelAssignmentKind, string>>;
  agentCandidateIds: string[];
  defaultAgentModelId: string | null;
}

export interface ModelWorkspace {
  catalog: ModelConfigView;
  spaces: Record<ModelWorkspaceMode, ModelWorkspaceSpace>;
}

export interface ModelCandidate {
  id: string;
  source: "platform" | "byok";
  provider: string;
  model: string;
  displayName: string;
  connectionId: string | null;
  endpointId: string;
  capability: ModelCapability;
  capabilities: CatalogCapability[];
  available: boolean;
}

/** One assigned model prepared for the local provider connection test. */
export type ChatModelTestTarget =
  | { presetId: string; status: "ready"; config: ModelProviderConfig }
  | { presetId: string; status: "platform"; config: null }
  | { presetId: string; status: "missing"; config: null };

/** Test-provider names accepted by the local API's model test endpoint. */
const MODEL_TEST_PROVIDER: Record<CatalogProviderId, string> = {
  openai: "openai_compatible",
  anthropic: "anthropic",
  gemini: "google",
  deepseek: "deepseek",
  zhipu: "zhipu",
  dashscope: "qwen",
  moonshot: "kimi",
  minimax: "minimax",
  qianfan: "baidu",
  volcengine: "doubao",
  stepfun: "stepfun",
  xiaomi_mimo: "xiaomi",
  memmy_account: "memmy_account"
};

/** Builds the connection-test payload for one assigned model; platform models have no local endpoint. */
export function chatModelTestTarget(workspace: ModelWorkspace, presetId: string): ChatModelTestTarget {
  const preset = workspace.catalog.providers
    .flatMap((provider) => provider.models)
    .find((model) => model.presetId === presetId);
  const provider = preset
    ? workspace.catalog.providers.find((item) => item.provider === preset.provider)
    : undefined;
  if (!preset) return { presetId, status: "missing", config: null };
  if (!provider) return { presetId, status: "missing", config: null };
  if (preset.source === "account" || provider.accountManaged) {
    return { presetId, status: "platform", config: null };
  }
  const endpoint = provider.endpoints.find((item) => item.endpointId === preset.endpointId);
  if (!endpoint) return { presetId, status: "missing", config: null };
  return {
    presetId,
    status: "ready",
    config: {
      provider: MODEL_TEST_PROVIDER[preset.provider],
      endpointId: preset.endpointId,
      protocol: preset.protocol,
      endpoint: endpoint.apiBase,
      model: preset.model,
      apiKey: "",
      apiKeyMasked: endpoint.apiKeyMasked || provider.apiKeyMasked,
      configured: true
    }
  };
}

export interface ModelConnectionInput {
  id?: string;
  provider: string;
  endpointId?: string;
  endpoint: string;
  protocol?: ModelEndpointProtocol;
  apiKey?: string;
  apiKeyMasked?: string;
  models: string[];
  modelEntries?: Array<{
    presetId?: string;
    model: string;
    capability: ModelCapability;
    capabilities?: ModelCapability[];
  }>;
  modelCapabilities?: Record<string, ModelCapability>;
}

export interface ModelWorkspaceMutationResult {
  workspace: ModelWorkspace;
  error: ModelWorkspaceMutationError | null;
}

export interface ByokPresetInput {
  provider: string;
  endpointId?: string;
  endpoint: string;
  protocol: ModelEndpointProtocol;
  apiKey?: string;
  apiKeyMasked?: string;
  model: string;
  capabilities: CatalogCapability[];
  presetId?: string;
}

export interface ResolvedModelSelection {
  candidate: ModelCandidate | null;
  candidateId: string | null;
  unavailable: boolean;
  reason: "saved" | "initial" | "unavailable" | "empty";
  previousModel?: string | null;
  previousProvider?: string | null;
}

export interface WorkspaceUsageTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface WorkspaceUsageRow extends WorkspaceUsageTotals {
  id: string;
  provider: string;
  model: string;
  breakdownAvailable: boolean;
}

const EMPTY_ASSIGNMENT: Omit<ModelAssignment, "ownerAccountId"> = {
  agent: { candidates: [], default: null },
  memorySummary: null,
  memoryEvolution: null,
  embedding: null,
  asr: null,
  imageGeneration: null
};

/** Returns the catalog embedded in app state, or an inert pre-bootstrap catalog. */
export function catalogFromConfig(config?: ModelProviderConfig | null): ModelConfigView {
  return config?.catalog ?? emptyCatalog();
}

/** Builds the UI workspace directly from the server catalog. No legacy or browser state is imported. */
export function createModelWorkspace(config?: ModelProviderConfig | ModelConfigView | null): ModelWorkspace {
  const catalog = isCatalogView(config) ? config : catalogFromConfig(config);
  return {
    catalog,
    spaces: {
      account: createSpace(catalog, "account"),
      byok: createSpace(catalog, "byok")
    }
  };
}

/** Removes the obsolete cache after a successful catalog read. */
export function clearLegacyModelWorkspace(storage?: Pick<Storage, "removeItem">): void {
  try {
    storage?.removeItem(MODEL_WORKSPACE_STORAGE_KEY);
  } catch {
    // A denied browser storage area must not make a successful API read fail.
  }
}

/** Converts a view-model mutation back to the PUT DTO while retaining every catalog field. */
export function modelConfigInput(workspace: ModelWorkspace): ModelConfigInput {
  return modelConfigInputFromView(workspace.catalog);
}

export function modelConfigInputFromView(view: ModelConfigView): ModelConfigInput {
  const modelAssignments = cloneAssignments(view.modelAssignments);
  syncAgentCandidates(view, modelAssignments);
  return {
    configRevision: view.configRevision,
    providers: view.providers.filter((provider) => provider.editable && !provider.accountManaged).map((provider) => ({
      provider: provider.provider,
      ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
      ...(provider.ownerAccountId ? { ownerAccountId: provider.ownerAccountId } : {}),
      endpoints: provider.endpoints.map(endpointInput),
      models: provider.models.map((model) => ({
        presetId: model.presetId,
        endpointId: model.endpointId,
        model: model.model,
        source: model.source,
        ...(model.ownerAccountId ? { ownerAccountId: model.ownerAccountId } : {}),
        capabilities: [...model.capabilities]
      }))
    })),
    modelAssignments
  };
}

/** Adds or patches exactly one BYOK endpoint/preset and leaves all other catalog data untouched. */
export function upsertByokPreset(
  workspace: ModelWorkspace,
  input: ByokPresetInput
): { workspace: ModelWorkspace; presetId: string; endpointId: string } {
  const providerId = normalizeProvider(input.provider);
  const apiBase = input.endpoint.trim().replace(/\/+$/, "");
  const model = input.model.trim();
  if (!providerId || !isHttpUrl(apiBase) || !model || !input.capabilities.length) {
    throw new Error("invalid catalog preset");
  }
  if (!input.capabilities.every((capability) => protocolSupportsCatalog(input.protocol, capability))) {
    throw new Error("endpoint protocol does not support preset capabilities");
  }
  const next = cloneCatalog(workspace.catalog);
  let provider = next.providers.find((item) => item.provider === providerId && !item.accountManaged);
  if (!provider) {
    provider = {
      provider: providerId,
      configured: Boolean(input.apiKey),
      hasApiKey: Boolean(input.apiKey),
      apiKeyMasked: input.apiKey ? maskApiKey(input.apiKey) : "",
      apiKey: "",
      endpoints: [],
      accountManaged: false,
      editable: true,
      models: []
    };
    next.providers.push(provider);
  }
  let endpoint = provider.endpoints.find((item) => (
    input.endpointId
      ? item.endpointId === input.endpointId
      : item.apiBase.replace(/\/+$/, "") === apiBase
        && item.protocol === input.protocol
        && endpointAuthMatches(item, input)
  ));
  if (endpoint && input.endpointId && (
    endpoint.apiBase.replace(/\/+$/, "") !== apiBase
    || endpoint.protocol !== input.protocol
    || (input.apiKeyMasked && !input.apiKey && endpoint.apiKeyMasked !== input.apiKeyMasked)
  )) {
    throw new Error("explicit endpoint identity does not match model configuration");
  }
  if (!endpoint) {
    if (input.endpointId) throw new Error("explicit endpoint identity was not found");
    if (input.apiKeyMasked && !input.apiKey) {
      throw new Error("masked endpoint credentials require an explicit endpoint ID");
    }
    endpoint = {
      endpointId: newId("endpoint"),
      apiBase,
      protocol: input.protocol,
      hasApiKey: Boolean(input.apiKey),
      apiKeyMasked: input.apiKey ? maskApiKey(input.apiKey) : input.apiKeyMasked ?? "",
      apiKey: input.apiKey ?? ""
    };
    provider.endpoints.push(endpoint);
  } else if (input.apiKey) {
    endpoint.apiKey = input.apiKey;
    endpoint.apiKeyMasked = maskApiKey(input.apiKey);
    endpoint.hasApiKey = true;
  }
  const existing = provider.models.find((item) => (
    item.source === "byok"
    && item.endpointId === endpoint!.endpointId
    && item.model === model
  ));
  const presetId = existing?.presetId ?? input.presetId ?? newClientPresetId();
  const preset = {
    presetId,
    provider: providerId,
    endpointId: endpoint.endpointId,
    protocol: input.protocol,
    model,
    source: "byok" as const,
    capabilities: unique([...(existing?.capabilities ?? []), ...input.capabilities]) as CatalogCapability[],
    available: true
  };
  if (existing) Object.assign(existing, preset);
  else provider.models.push(preset);
  refreshEffectiveCandidates(next);
  return { workspace: createModelWorkspace(next), presetId, endpointId: endpoint.endpointId };
}

/** The cuberouter-managed selection, in model names (what the panel edits). */
export interface CuberouterSelection {
  agent: { models: string[]; default?: string };
  memorySummary: string;
  memoryEvolution: string;
}

export interface CuberouterSelectionInput {
  apiBase: string;
  protocol: ModelEndpointProtocol;
  /** Plaintext only when the key changed; omitted keeps the stored secret. */
  apiKey?: string;
  selection: CuberouterSelection;
}

/** Reads the current selection back out of a stored catalog (empty when unset). */
export function readCuberouterSelection(catalog: ModelConfigView, apiBase: string): CuberouterSelection {
  const normalized = apiBase.trim().replace(/\/+$/, "");
  const provider = cuberouterProvider(catalog.providers);
  const endpoint = provider?.endpoints.find((item) => item.apiBase.replace(/\/+$/, "") === normalized);
  // Presets carry endpointId, not apiBase: the endpoint lookup is what pins them to this line.
  const presets = (provider?.models ?? []).filter((preset) => (
    preset.source === "byok" && endpoint !== undefined && preset.endpointId === endpoint.endpointId
  ));
  const modelOf = (presetId: string | undefined) => presets.find((preset) => preset.presetId === presetId)?.model ?? "";
  const assignment = catalog.modelAssignments.byok;
  const agentModels = assignment.agent.candidates
    .map((presetId) => modelOf(presetId))
    .filter(Boolean);
  const agentDefault = modelOf(assignment.agent.default ?? undefined);
  return {
    agent: { models: agentModels, ...(agentDefault ? { default: agentDefault } : {}) },
    memorySummary: modelOf(assignment.memorySummary ?? undefined),
    memoryEvolution: modelOf(assignment.memoryEvolution ?? undefined)
  };
}

/**
 * Materializes one cuberouter selection at one endpoint: a byok preset per distinct model (its
 * capabilities are the slots it serves), the assignments pointing at them, and a prune of the
 * endpoint's presets the selection no longer uses.
 */
export function applyCuberouterSelection(workspace: ModelWorkspace, input: CuberouterSelectionInput): ModelWorkspace {
  const providerId = CUBEROUTER_PROVIDER_ID;
  const apiBase = input.apiBase.trim().replace(/\/+$/, "");
  if (!isHttpUrl(apiBase)) throw new Error("invalid cuberouter endpoint");
  const selection = input.selection;
  const slots: Array<{ capability: "agent" | "memory_summary" | "memory_evolution"; models: string[] }> = [
    { capability: "agent", models: unique(selection.agent.models.map((model) => model.trim()).filter(Boolean)) },
    { capability: "memory_summary", models: selection.memorySummary.trim() ? [selection.memorySummary.trim()] : [] },
    { capability: "memory_evolution", models: selection.memoryEvolution.trim() ? [selection.memoryEvolution.trim()] : [] }
  ];

  const next = cloneCatalog(workspace.catalog);
  let provider = cuberouterProvider(next.providers);
  if (!provider) {
    if (!input.apiKey) throw new Error("cuberouter endpoint has no credential yet");
    provider = {
      provider: providerId,
      configured: true,
      hasApiKey: true,
      apiKeyMasked: maskApiKey(input.apiKey),
      apiKey: "",
      endpoints: [],
      accountManaged: false,
      editable: true,
      models: []
    };
    next.providers.push(provider);
  }
  let endpoint = provider.endpoints.find((item) => item.apiBase.replace(/\/+$/, "") === apiBase);
  if (!endpoint) {
    if (!input.apiKey) throw new Error("cuberouter endpoint has no credential yet");
    endpoint = {
      endpointId: newId("endpoint"),
      apiBase,
      protocol: input.protocol,
      hasApiKey: true,
      apiKeyMasked: maskApiKey(input.apiKey),
      apiKey: input.apiKey
    };
    provider.endpoints.push(endpoint);
  } else if (input.apiKey) {
    endpoint.apiKey = input.apiKey;
    endpoint.apiKeyMasked = maskApiKey(input.apiKey);
    endpoint.hasApiKey = true;
  }

  // One preset per model, carrying every slot it serves.
  const capabilitiesByModel = new Map<string, Set<CatalogCapability>>();
  for (const slot of slots) {
    for (const model of slot.models) {
      const set = capabilitiesByModel.get(model) ?? new Set<CatalogCapability>();
      set.add(slot.capability);
      capabilitiesByModel.set(model, set);
    }
  }
  const keepPresetIds = new Set<string>();
  const presetIdByModel = new Map<string, string>();
  for (const [model, capabilities] of capabilitiesByModel) {
    // Matched inside this endpoint only, as `upsertByokPreset` does: another connection may carry a
    // model of the same name and must keep its own preset, endpoint and capabilities.
    const existing = provider.models.find((item) => (
      item.source === "byok" && item.endpointId === endpoint!.endpointId && item.model === model
    ));
    const presetId = existing?.presetId ?? newClientPresetId();
    const preset = {
      presetId,
      provider: providerId,
      endpointId: endpoint.endpointId,
      protocol: input.protocol,
      model,
      source: "byok" as const,
      capabilities: [...capabilities].sort() as CatalogCapability[],
      available: true
    };
    if (existing) Object.assign(existing, preset);
    else provider.models.push(preset);
    keepPresetIds.add(presetId);
    presetIdByModel.set(model, presetId);
  }
  provider.models = provider.models.filter((item) => (
    item.endpointId !== endpoint!.endpointId
    || item.source !== "byok"
    || keepPresetIds.has(item.presetId)
  ));

  // Every preset still in the catalog: the endpoint prune above removed only this endpoint's stale
  // presets, so these ids are exactly the ones assignments may still reference.
  const remainingIds = new Set(next.providers.flatMap((item) => item.models.map((model) => model.presetId)));
  const assignment = next.modelAssignments.byok;
  const agentIds = slots[0]!.models.flatMap((model) => presetIdByModel.get(model) ?? []);
  // Candidates enrolled from other connections stay enrolled, but only while their preset still serves
  // the agent slot: the loop above just rewrote the capabilities of this endpoint's presets, and the
  // backend rejects an agent candidate whose preset no longer supports `agent`.
  const agentCandidateIds = new Set(
    visiblePresets(next, "byok")
      .filter((preset) => preset.capabilities.includes("agent"))
      .map((preset) => preset.presetId)
  );
  assignment.agent.candidates = unique([
    ...assignment.agent.candidates.filter((id) => agentCandidateIds.has(id)),
    ...agentIds
  ]);
  const defaultModel = selection.agent.default?.trim();
  assignment.agent.default = defaultModel && presetIdByModel.has(defaultModel)
    ? presetIdByModel.get(defaultModel)!
    : agentIds[0] ?? null;
  assignment.memorySummary = presetIdByModel.get(selection.memorySummary.trim()) ?? null;
  assignment.memoryEvolution = presetIdByModel.get(selection.memoryEvolution.trim()) ?? null;
  // Prune against every preset still in the catalog (as `deleteModelConnection` does), not just this
  // selection's: assignments pointing at another endpoint's presets must survive, while references to
  // the presets the endpoint prune above just removed are cleared.
  pruneInvalidAssignmentReferences(assignment, remainingIds);
  refreshEffectiveCandidates(next);
  return createModelWorkspace(next);
}

/**
 * Removes the cuberouter endpoints at the given node bases, together with their models and
 * assignment references. Other endpoints under the same provider (an ordinary OpenAI
 * connection, for example) and other providers stay untouched.
 */
export function clearCuberouterAccount(
  workspace: ModelWorkspace,
  managedApiBases: readonly string[]
): ModelWorkspace {
  const next = cloneCatalog(workspace.catalog);
  const provider = cuberouterProvider(next.providers);
  if (!provider) return workspace;
  const managed = new Set(managedApiBases.map(apiOrigin));
  if (!managed.size) return workspace;
  const removedEndpointIds = new Set(
    provider.endpoints
      .filter((endpoint) => managed.has(apiOrigin(endpoint.apiBase)))
      .map((endpoint) => endpoint.endpointId)
  );
  if (!removedEndpointIds.size) return workspace;

  provider.endpoints = provider.endpoints.filter((endpoint) => !removedEndpointIds.has(endpoint.endpointId));
  provider.models = provider.models.filter((model) => !removedEndpointIds.has(model.endpointId));
  if (!provider.endpoints.length || !provider.models.length) {
    next.providers = next.providers.filter((item) => item !== provider);
  }
  const remainingIds = new Set(next.providers.flatMap((item) => item.models.map((model) => model.presetId)));
  pruneInvalidAssignmentReferences(next.modelAssignments.byok, remainingIds);
  pruneInvalidAssignmentReferences(next.modelAssignments.account, remainingIds);
  refreshEffectiveCandidates(next);
  return createModelWorkspace(next);
}

/**
 * Keeps only the cuberouter endpoint at `apiBase` among the known node bases, dropping the other
 * nodes' endpoints, presets and assignment references. An ordinary OpenAI endpoint at any other
 * base is not a cuberouter endpoint and survives. A same-node re-login keeps its selection; a
 * switch to another node starts from the new account's list.
 */
export function keepCuberouterEndpoint(
  workspace: ModelWorkspace,
  apiBase: string,
  managedApiBases: readonly string[]
): ModelWorkspace {
  const next = cloneCatalog(workspace.catalog);
  const provider = cuberouterProvider(next.providers);
  if (!provider) return workspace;
  const keepOrigin = apiOrigin(apiBase);
  const managed = new Set(managedApiBases.map(apiOrigin));
  managed.add(keepOrigin);
  const removedEndpointIds = new Set(
    provider.endpoints
      .filter((endpoint) => {
        const endpointOrigin = apiOrigin(endpoint.apiBase);
        return endpointOrigin !== keepOrigin && managed.has(endpointOrigin);
      })
      .map((endpoint) => endpoint.endpointId)
  );
  if (!removedEndpointIds.size) return workspace;

  provider.endpoints = provider.endpoints.filter((endpoint) => !removedEndpointIds.has(endpoint.endpointId));
  provider.models = provider.models.filter((model) => !removedEndpointIds.has(model.endpointId));
  if (!provider.endpoints.length || !provider.models.length) {
    next.providers = next.providers.filter((item) => item !== provider);
  }
  const remainingIds = new Set(next.providers.flatMap((item) => item.models.map((model) => model.presetId)));
  pruneInvalidAssignmentReferences(next.modelAssignments.byok, remainingIds);
  pruneInvalidAssignmentReferences(next.modelAssignments.account, remainingIds);
  refreshEffectiveCandidates(next);
  return createModelWorkspace(next);
}

/** Endpoint identity is the origin: cuberouter node tables store the origin, the catalog the /v1 base. */
function apiOrigin(apiBase: string): string {
  try {
    return new URL(apiBase.trim()).origin;
  } catch {
    return apiBase.trim().replace(/\/+$/, "");
  }
}

/** Assigns one preset in one mode without touching the other mode. */
export function assignCatalogPreset(
  workspace: ModelWorkspace,
  mode: ModelWorkspaceMode,
  capability: CatalogCapability,
  presetId: string
): ModelWorkspace {
  const candidate = visiblePresets(workspace.catalog, mode)
    .find((item) => item.presetId === presetId && item.capabilities.includes(capability));
  if (!candidate) return workspace;
  const next = cloneCatalog(workspace.catalog);
  const assignment = next.modelAssignments[mode];
  if (capability === "agent") {
    assignment.agent.candidates = unique([...assignment.agent.candidates, presetId]);
    assignment.agent.default = presetId;
  } else if (capability === "memory_summary") assignment.memorySummary = presetId;
  else if (capability === "memory_evolution") assignment.memoryEvolution = presetId;
  else if (capability === "embedding") assignment.embedding = presetId;
  else if (capability === "asr") assignment.asr = presetId;
  else assignment.imageGeneration = presetId;
  return createModelWorkspace(next);
}

/** Resolves the endpoint identity currently assigned to a catalog capability. */
export function assignedCatalogEndpointId(
  workspace: ModelWorkspace,
  mode: ModelWorkspaceMode,
  capability: CatalogCapability
): string | undefined {
  const assignment = workspace.catalog.modelAssignments[mode];
  const presetId = capability === "agent"
    ? assignment.agent.default ?? assignment.agent.candidates[0]
    : capability === "memory_summary"
      ? assignment.memorySummary
      : capability === "memory_evolution"
        ? assignment.memoryEvolution
        : capability === "embedding"
          ? assignment.embedding
          : capability === "asr"
            ? assignment.asr
            : assignment.imageGeneration;
  if (!presetId) return undefined;
  return workspace.catalog.providers.flatMap((provider) => provider.models)
    .find((preset) => preset.presetId === presetId)?.endpointId;
}

export function getModelCandidates(
  workspace: ModelWorkspace,
  mode: ModelWorkspaceMode,
  capability: ModelCapability = "chat"
): ModelCandidate[] {
  const required = toCatalogCapability(capability);
  return visiblePresets(workspace.catalog, mode)
    .filter((preset) => preset.capabilities.includes(required))
    .map((preset) => candidateFromPreset(workspace.catalog, preset, capability));
}

export function getTaskModelCandidates(workspace: ModelWorkspace, mode: ModelWorkspaceMode): ModelCandidate[] {
  const candidates = getModelCandidates(workspace, mode, "chat");
  const order = workspace.catalog.modelAssignments[mode].agent.candidates;
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return order.map((id) => byId.get(id)).filter((candidate): candidate is ModelCandidate => Boolean(candidate));
}

export function resolveModelSelection(
  workspace: ModelWorkspace,
  mode: ModelWorkspaceMode,
  selectedPresetId?: string | null
): ResolvedModelSelection {
  const candidates = getModelCandidates(workspace, mode, "chat");
  if (!candidates.length) {
    if (!selectedPresetId) {
      return { candidate: null, candidateId: null, unavailable: false, reason: "empty" };
    }
    return { candidate: null, candidateId: selectedPresetId, unavailable: true, reason: "unavailable" };
  }
  const candidateId = selectedPresetId ?? workspace.catalog.modelAssignments[mode].agent.default;
  if (!candidateId) {
    return { candidate: candidates[0]!, candidateId: candidates[0]!.id, unavailable: false, reason: "initial" };
  }
  const candidate = candidates.find((item) => item.id === candidateId) ?? null;
  return candidate
    ? { candidate, candidateId, unavailable: !candidate.available, reason: "saved" }
    : { candidate: null, candidateId, unavailable: true, reason: "unavailable" };
}

export function upsertModelConnection(
  workspace: ModelWorkspace,
  mode: ModelWorkspaceMode,
  input: ModelConnectionInput
): ModelWorkspaceMutationResult {
  const providerId = normalizeProvider(input.provider);
  const endpoint = input.endpoint.trim().replace(/\/+$/, "");
  const entries: Array<{ presetId?: string; model: string; capabilities: ModelCapability[]; capabilitiesExplicit: boolean }> = input.modelEntries?.length
    ? input.modelEntries.map((entry) => ({
        ...(entry.presetId ? { presetId: entry.presetId } : {}),
        model: entry.model.trim(),
        capabilities: unique(entry.capabilities?.length ? entry.capabilities : [entry.capability]),
        capabilitiesExplicit: Boolean(entry.capabilities?.length),
      })).filter((entry) => Boolean(entry.model))
    : input.models.map((model) => ({
        model: model.trim(),
        capabilities: [modelCapability(input, model)],
        capabilitiesExplicit: false,
      })).filter((entry) => Boolean(entry.model));
  const models = entries.map((entry) => entry.model);
  if (!providerId || !isHttpUrl(endpoint) || !models.length) {
    return { workspace, error: "invalid_connection" };
  }
  if (new Set(entries.map((entry) => entry.model.toLowerCase())).size !== entries.length) {
    return { workspace, error: "duplicate_model" };
  }

  const next = cloneCatalog(workspace.catalog);
  const existingConnection = input.id
    ? workspace.spaces[mode].connections.find((connection) => connection.id === input.id)
    : undefined;
  let endpointId = existingConnection?.endpointId ?? input.endpointId ?? newId("endpoint");
  if (
    existingConnection
    && existingConnection.provider !== providerId
    && next.providers.some((item) => (
      item.provider === providerId
      && item.endpoints.some((candidate) => candidate.endpointId === endpointId)
    ))
  ) {
    endpointId = newId("endpoint");
  }
  const protocol = input.protocol ?? protocolFor(providerId, entries[0]!.capabilities[0]!);
  if (!protocolSupportsModelCapabilities(protocol, entries.flatMap((entry) => entry.capabilities))) {
    return { workspace, error: "incompatible_model_capabilities" };
  }

  const previousEndpointId = existingConnection?.endpointId;
  const previousProvider = existingConnection
    ? next.providers.find((item) => item.provider === existingConnection.provider && !item.accountManaged)
    : undefined;
  if (previousProvider && previousEndpointId) {
    previousProvider.endpoints = previousProvider.endpoints.filter((item) => item.endpointId !== previousEndpointId);
    previousProvider.models = previousProvider.models.filter((item) => item.endpointId !== previousEndpointId);
    if (previousProvider.provider !== providerId && (!previousProvider.endpoints.length || !previousProvider.models.length)) {
      next.providers = next.providers.filter((item) => item !== previousProvider);
    }
  }

  let provider = next.providers.find((item) => item.provider === providerId && !item.accountManaged);
  if (!provider) {
    provider = {
      provider: providerId,
      configured: Boolean(input.apiKey),
      hasApiKey: Boolean(input.apiKey),
      apiKeyMasked: input.apiKey ? maskApiKey(input.apiKey) : input.apiKeyMasked ?? "",
      apiKey: "",
      endpoints: [],
      accountManaged: false,
      editable: true,
      models: []
    };
    next.providers.push(provider);
  }

  provider.endpoints.push({
    endpointId,
    apiBase: endpoint,
    protocol,
    hasApiKey: Boolean(input.apiKey || input.apiKeyMasked),
    apiKeyMasked: input.apiKey ? maskApiKey(input.apiKey) : input.apiKeyMasked ?? "",
    apiKey: input.apiKey ?? ""
  });
  provider.models.push(...entries.map((entry, index) => {
    const model = entry.model;
    const previousPreset = existingConnection
      ? (entry.presetId ? nextPresetById(workspace.catalog, entry.presetId) : null)
        ?? nextPresetByModelAndCapability(workspace.catalog, existingConnection.endpointId, model, entry.capabilities[0]!)
        ?? nextPresetByModel(workspace.catalog, existingConnection.endpointId, existingConnection.models[index] ?? "")
      : null;
    const selectedCapability = entry.capabilities[0]!;
    const capabilities = entry.capabilitiesExplicit
      ? unique(entry.capabilities.map(toCatalogCapability))
      : previousPreset && fromCapabilities(previousPreset.capabilities) === selectedCapability
        ? [...previousPreset.capabilities]
        : [toCatalogCapability(selectedCapability)];
    return {
      presetId: previousPreset?.presetId ?? newClientPresetId(),
      provider: providerId,
      endpointId,
      protocol,
      model,
      source: "byok" as const,
      capabilities,
      available: true
    };
  }));

  const nextPresetIds = provider.models.filter((item) => item.endpointId === endpointId).map((item) => item.presetId);
  const nextAgentPresetIds = provider.models
    .filter((item) => item.endpointId === endpointId && item.capabilities.includes("agent"))
    .map((item) => item.presetId);
  const previousPresetIds = existingConnection
    ? existingConnection.modelEntries.map((entry) => entry.presetId)
    : [];
  const assignment = next.modelAssignments[mode];
  assignment.agent.candidates = replaceIds(assignment.agent.candidates, previousPresetIds, nextAgentPresetIds);
  if (!assignment.agent.candidates.length) assignment.agent.candidates = [...nextAgentPresetIds];
  if (!assignment.agent.default || previousPresetIds.includes(assignment.agent.default)) {
    assignment.agent.default = nextPresetIds.find((id) => presetHasCapability(next, id, "agent")) ?? assignment.agent.default;
  }
  // BYOK presets are the source of truth: the backend re-derives account.agent.candidates
  // from byok.agent.candidates on every account-mode startup, dropping any BYOK preset that
  // is absent there. So a custom (source: "byok") model added while in account mode must also
  // be enrolled in the byok candidate list, otherwise it survives the session but vanishes on
  // the next restart.
  if (mode !== "byok") {
    const byokAgent = next.modelAssignments.byok.agent;
    byokAgent.candidates = replaceIds(byokAgent.candidates, previousPresetIds, nextAgentPresetIds);
    if (!byokAgent.default || previousPresetIds.includes(byokAgent.default)) {
      byokAgent.default = nextPresetIds.find((id) => presetHasCapability(next, id, "agent")) ?? byokAgent.default;
    }
  }
  const remainingIds = new Set(next.providers.flatMap((item) => item.models.map((model) => model.presetId)));
  pruneInvalidAssignmentReferences(next.modelAssignments.byok, remainingIds);
  pruneInvalidAssignmentReferences(next.modelAssignments.account, remainingIds);
  refreshEffectiveCandidates(next);
  return { workspace: createModelWorkspace(next), error: null };
}

export function deleteModelConnection(
  workspace: ModelWorkspace,
  mode: ModelWorkspaceMode,
  connectionId: string
): ModelWorkspaceMutationResult {
  const connection = workspace.spaces[mode].connections.find((item) => item.id === connectionId);
  if (!connection || connection.accountManaged) return { workspace, error: "connection_not_found" };
  const next = cloneCatalog(workspace.catalog);
  const provider = next.providers.find((item) => item.provider === connection.provider && !item.accountManaged);
  if (!provider) return { workspace, error: "connection_not_found" };
  provider.endpoints = provider.endpoints.filter((item) => item.endpointId !== connection.endpointId);
  provider.models = provider.models.filter((item) => item.endpointId !== connection.endpointId);
  if (!provider.endpoints.length || !provider.models.length) {
    next.providers = next.providers.filter((item) => item !== provider);
  }
  const remainingIds = new Set(next.providers.flatMap((item) => item.models.map((model) => model.presetId)));
  pruneInvalidAssignmentReferences(next.modelAssignments.byok, remainingIds);
  pruneInvalidAssignmentReferences(next.modelAssignments.account, remainingIds);
  refreshEffectiveCandidates(next);
  return { workspace: createModelWorkspace(next), error: null };
}

export function setModelConnectionAvailability(
  workspace: ModelWorkspace,
  _mode: ModelWorkspaceMode,
  connectionId: string,
  available: boolean
): ModelWorkspace {
  const next = cloneCatalog(workspace.catalog);
  for (const provider of next.providers) {
    for (const model of provider.models) {
      if (`${provider.provider}:${model.endpointId}` === connectionId) model.available = available;
    }
  }
  refreshEffectiveCandidates(next);
  return createModelWorkspace(next);
}

export function setTaskModelCandidates(
  workspace: ModelWorkspace,
  mode: ModelWorkspaceMode,
  candidateIds: string[]
): ModelWorkspace {
  const next = cloneCatalog(workspace.catalog);
  const allowed = new Set(getModelCandidates(workspace, mode, "chat").map((candidate) => candidate.id));
  const selected = unique(candidateIds.filter((id) => allowed.has(id)));
  next.modelAssignments[mode].agent.candidates = selected;
  if (!selected.includes(next.modelAssignments[mode].agent.default ?? "")) {
    next.modelAssignments[mode].agent.default = selected[0] ?? null;
  }
  return createModelWorkspace(next);
}

export function setDefaultAgentModel(
  workspace: ModelWorkspace,
  mode: ModelWorkspaceMode,
  candidateId: string
): ModelWorkspace {
  const allowed = new Set(getModelCandidates(workspace, mode, "chat").map((candidate) => candidate.id));
  if (!allowed.has(candidateId)) return workspace;
  const next = cloneCatalog(workspace.catalog);
  next.modelAssignments[mode].agent.default = candidateId;
  return createModelWorkspace(next);
}

/**
 * Builds the persistence payload that makes `candidateId` the `mode` default, or null when there
 * is nothing to persist (the id is not a chat-capable model visible in this mode, or it is already
 * the default). `modelConfigInputFromView` enrolls every chat model as a candidate, so the default
 * is accepted by the backend even when the user picked a model the config did not list yet.
 */
export function defaultModelSelectionInput(
  workspace: ModelWorkspace,
  mode: ModelWorkspaceMode,
  candidateId: string
): ModelConfigInput | null {
  const candidate = getModelCandidates(workspace, mode, "chat").find((item) => item.id === candidateId);
  if (!candidate) return null;
  const agent = workspace.catalog.modelAssignments[mode].agent;
  if (agent.default === candidateId && agent.candidates.includes(candidateId)) return null;
  const next = cloneCatalog(workspace.catalog);
  next.modelAssignments[mode].agent.default = candidateId;
  return modelConfigInputFromView(next);
}

export function setModelAssignment(
  workspace: ModelWorkspace,
  mode: ModelWorkspaceMode,
  kind: ModelAssignmentKind,
  candidateId: string | null
): ModelWorkspace {
  const key = kind === "image" ? "imageGeneration" : kind;
  if (candidateId === null) {
    const next = cloneCatalog(workspace.catalog);
    next.modelAssignments[mode][key] = null;
    return createModelWorkspace(next);
  }
  if (kind === "embedding" && candidateId === BUILTIN_LOCAL_EMBEDDING_ASSIGNMENT_ID) {
    const next = cloneCatalog(workspace.catalog);
    next.modelAssignments[mode].embedding = candidateId;
    return createModelWorkspace(next);
  }
  const capability = assignmentCapability(kind);
  const allowed = new Set(getModelCandidates(workspace, mode, capability).map((candidate) => candidate.id));
  if (!allowed.has(candidateId)) return workspace;
  const next = cloneCatalog(workspace.catalog);
  next.modelAssignments[mode][key] = candidateId;
  return createModelWorkspace(next);
}

export function maskApiKey(apiKey: string): string {
  const normalized = apiKey.trim();
  if (!normalized) return "";
  return `••••••••${normalized.slice(-4)}`;
}

export function buildWorkspaceUsageRows(
  workspace: ModelWorkspace,
  mode: ModelWorkspaceMode,
  usage: WorkspaceUsageTotals
): WorkspaceUsageRow[] {
  const candidates = getModelCandidates(workspace, mode).filter((candidate) => candidate.source === "byok");
  const attributable = candidates.length === 1;
  return candidates.map((candidate) => ({
    id: candidate.id,
    provider: candidate.provider,
    model: candidate.model,
    inputTokens: attributable ? usage.inputTokens : 0,
    outputTokens: attributable ? usage.outputTokens : 0,
    totalTokens: attributable ? usage.totalTokens : 0,
    breakdownAvailable: attributable
  }));
}

function createSpace(catalog: ModelConfigView, mode: ModelWorkspaceMode): ModelWorkspaceSpace {
  const candidates = visiblePresets(catalog, mode);
  const visibleIds = new Set(candidates.map((preset) => preset.presetId));
  const connections = catalog.providers.flatMap((provider): ModelConnection[] => provider.endpoints.flatMap((endpoint): ModelConnection[] => {
    const models = provider.models.filter((model) => (
      model.endpointId === endpoint.endpointId
      && visibleIds.has(model.presetId)
    ));
    if (!models.length || provider.accountManaged) return [];
    const id = `${provider.provider}:${endpoint.endpointId}`;
    return [{
      id,
      provider: provider.provider,
      endpointId: endpoint.endpointId,
      endpoint: endpoint.apiBase,
      protocol: endpoint.protocol,
      apiKeyMasked: endpoint.apiKeyMasked || provider.apiKeyMasked,
      models: models.map((model) => model.model),
      modelEntries: models.map((model) => ({
        presetId: model.presetId,
        model: model.model,
        capability: fromCapabilities(model.capabilities),
        capabilities: [...model.capabilities]
      })),
      modelCapabilities: Object.fromEntries(models.map((model) => [model.model, fromCapabilities(model.capabilities)])),
      presetIds: Object.fromEntries(models.map((model) => [model.model, model.presetId])),
      available: models.some((model) => model.available),
      accountManaged: provider.accountManaged
    }];
  }));
  const assignment = catalog.modelAssignments[mode];
  return {
    connections,
    assignments: {
      memorySummary: assignment.memorySummary ?? undefined,
      memoryEvolution: assignment.memoryEvolution ?? undefined,
      embedding: assignment.embedding ?? undefined,
      asr: assignment.asr ?? undefined,
      image: assignment.imageGeneration ?? undefined
    },
    agentCandidateIds: [...assignment.agent.candidates],
    defaultAgentModelId: assignment.agent.default
  };
}

function candidateFromPreset(catalog: ModelConfigView, preset: TextModelItemView, capability: ModelCapability): ModelCandidate {
  const provider = catalog.providers.find((item) => item.provider === preset.provider);
  return {
    id: preset.presetId,
    source: preset.source === "account" ? "platform" : "byok",
    provider: preset.provider,
    model: preset.model,
    displayName: preset.model,
    connectionId: preset.source === "account" ? null : `${preset.provider}:${preset.endpointId}`,
    endpointId: preset.endpointId,
    capability,
    capabilities: [...preset.capabilities],
    available: preset.available && Boolean(provider)
  };
}

function endpointInput(endpoint: ModelConfigView["providers"][number]["endpoints"][number]): CatalogEndpointInput {
  return {
    endpointId: endpoint.endpointId,
    apiBase: endpoint.apiBase,
    protocol: endpoint.protocol,
    ...(endpoint.apiKey ? { apiKey: endpoint.apiKey } : {})
  };
}

function emptyCatalog(): ModelConfigView {
  return {
    configRevision: "unavailable",
    providers: [],
    modelAssignments: { byok: cloneAssignment(EMPTY_ASSIGNMENT), account: cloneAssignment(EMPTY_ASSIGNMENT) },
    effectiveCandidates: { byok: [], account: [] },
    configured: false,
    updatedAt: new Date(0).toISOString()
  };
}

function isCatalogView(value: unknown): value is ModelConfigView {
  return Boolean(value && typeof value === "object" && "effectiveCandidates" in value && "modelAssignments" in value);
}

function cloneCatalog(catalog: ModelConfigView): ModelConfigView {
  return structuredClone(catalog);
}

function cloneAssignments(assignments: ModelConfigView["modelAssignments"]): ModelConfigView["modelAssignments"] {
  return { byok: cloneAssignment(assignments.byok), account: cloneAssignment(assignments.account) };
}

function cloneAssignment<T extends Omit<ModelAssignment, "ownerAccountId"> | ModelAssignment>(assignment: T): T {
  return { ...assignment, agent: { candidates: [...assignment.agent.candidates], default: assignment.agent.default } };
}

/** The single BYOK provider cuberouter owns; the reader and the writer must look up the same one. */
const CUBEROUTER_PROVIDER_ID: CatalogProviderId = "openai";

function cuberouterProvider(
  providers: ModelConfigView["providers"]
): ModelConfigView["providers"][number] | undefined {
  return providers.find((item) => item.provider === CUBEROUTER_PROVIDER_ID && !item.accountManaged);
}

function normalizeProvider(provider: string): CatalogProviderId | null {
  const normalized = provider.trim().toLowerCase();
  const aliases: Record<string, CatalogProviderId> = { qwen: "dashscope", kimi: "moonshot", baidu: "qianfan", doubao: "volcengine", xiaomi: "xiaomi_mimo" };
  const candidate = aliases[normalized] ?? normalized;
  return ["openai", "anthropic", "gemini", "deepseek", "zhipu", "dashscope", "moonshot", "minimax", "qianfan", "volcengine", "stepfun", "xiaomi_mimo", "memmy_account"].includes(candidate)
    ? candidate as CatalogProviderId
    : null;
}

function protocolFor(provider: CatalogProviderId, capability: ModelCapability): ModelEndpointProtocol {
  if (capability === "embedding") return "openai-embeddings";
  if (capability === "asr") return "dashscope-input-audio-chat";
  if (capability === "image") return provider === "dashscope" ? "dashscope-multimodal-generation" : "openai-images";
  if (provider === "anthropic") return "anthropic-messages";
  if (provider === "gemini") return "gemini-generate-content";
  if (provider === "memmy_account") return "memmy-account";
  return "openai-chat-completions";
}

export function protocolSupportsModelCapabilities(protocol: ModelEndpointProtocol, capabilities: ModelCapability[]): boolean {
  return capabilities.every((capability) => protocolSupportsCatalog(protocol, toCatalogCapability(capability)));
}

function protocolSupportsCatalog(protocol: ModelEndpointProtocol, capability: CatalogCapability): boolean {
  if (capability === "agent" || capability === "memory_summary" || capability === "memory_evolution") {
    return protocolForCapability(protocol) === "chat";
  }
  if (capability === "image_generation") return protocolForCapability(protocol) === "image";
  return protocolForCapability(protocol) === capability;
}

function protocolForCapability(protocol: ModelEndpointProtocol): ModelCapability {
  if (protocol === "openai-embeddings") return "embedding";
  if (protocol === "dashscope-input-audio-chat") return "asr";
  if (protocol === "openai-images" || protocol === "dashscope-multimodal-generation") return "image";
  return "chat";
}

function modelCapability(input: ModelConnectionInput, model: string): ModelCapability {
  return input.modelCapabilities?.[model] ?? "chat";
}

function toCatalogCapability(capability: ModelCapability): CatalogCapability {
  if (capability === "chat") return "agent";
  if (capability === "memorySummary") return "memory_summary";
  if (capability === "memoryEvolution") return "memory_evolution";
  if (capability === "image") return "image_generation";
  return capability;
}

function fromCapabilities(capabilities: CatalogCapability[]): ModelCapability {
  if (capabilities.includes("agent")) return "chat";
  if (capabilities.includes("memory_summary")) return "memorySummary";
  if (capabilities.includes("memory_evolution")) return "memoryEvolution";
  if (capabilities.includes("embedding")) return "embedding";
  if (capabilities.includes("asr")) return "asr";
  return "image";
}

function assignmentCapability(kind: ModelAssignmentKind): ModelCapability {
  if (kind === "memorySummary") return "memorySummary";
  if (kind === "memoryEvolution") return "memoryEvolution";
  if (kind === "embedding") return "embedding";
  if (kind === "asr") return "asr";
  if (kind === "image") return "image";
  return "chat";
}

function nextPresetByModel(catalog: ModelConfigView, endpointId: string, model: string): TextModelItemView | null {
  return catalog.providers.flatMap((provider) => provider.models)
    .find((preset) => preset.endpointId === endpointId && preset.model === model) ?? null;
}

function nextPresetByModelAndCapability(
  catalog: ModelConfigView,
  endpointId: string,
  model: string,
  capability: ModelCapability
): TextModelItemView | null {
  return catalog.providers.flatMap((provider) => provider.models)
    .find((preset) => (
      preset.endpointId === endpointId
      && preset.model === model
      && fromCapabilities(preset.capabilities) === capability
    )) ?? null;
}

function nextPresetById(catalog: ModelConfigView, presetId: string): TextModelItemView | null {
  return catalog.providers.flatMap((provider) => provider.models)
    .find((preset) => preset.presetId === presetId) ?? null;
}

function replaceIds(current: string[], oldIds: string[], nextIds: string[]): string[] {
  const old = new Set(oldIds);
  const kept = current.filter((id) => !old.has(id));
  return unique([...kept, ...nextIds]);
}

function pruneInvalidAssignmentReferences(assignment: ModelAssignment, validIds: ReadonlySet<string>): void {
  assignment.agent.candidates = assignment.agent.candidates.filter((id) => validIds.has(id));
  if (!assignment.agent.default || !assignment.agent.candidates.includes(assignment.agent.default)) {
    assignment.agent.default = assignment.agent.candidates[0] ?? null;
  }
  for (const key of ["memorySummary", "memoryEvolution", "embedding", "asr", "imageGeneration"] as const) {
    const candidateId = assignment[key];
    if (!candidateId || (key === "embedding" && candidateId === BUILTIN_LOCAL_EMBEDDING_ASSIGNMENT_ID)) continue;
    if (!validIds.has(candidateId)) assignment[key] = null;
  }
}

function refreshEffectiveCandidates(catalog: ModelConfigView): void {
  const presets = catalog.providers.flatMap((provider) => provider.models);
  const byId = new Map(presets.map((preset) => [preset.presetId, preset]));
  catalog.effectiveCandidates.byok = catalog.modelAssignments.byok.agent.candidates
    .map((presetId) => byId.get(presetId))
    .filter((preset): preset is TextModelItemView => Boolean(preset));
  catalog.effectiveCandidates.account = catalog.modelAssignments.account.agent.candidates
    .map((presetId) => byId.get(presetId))
    .filter((preset): preset is TextModelItemView => Boolean(preset));
  catalog.configured = catalog.modelAssignments.byok.agent.candidates.length > 0
    || catalog.modelAssignments.account.agent.candidates.length > 0;
}

function visiblePresets(catalog: ModelConfigView, mode: ModelWorkspaceMode): TextModelItemView[] {
  const ownerAccountId = catalog.modelAssignments.account.ownerAccountId;
  return catalog.providers.flatMap((provider) => provider.models).filter((preset) => {
    if (preset.source === "byok") return true;
    return mode === "account"
      && Boolean(ownerAccountId)
      && preset.ownerAccountId === ownerAccountId;
  });
}

/**
 * The catalog is the source of truth: every chat-capable model visible in the mode is an Agent
 * candidate, so users no longer curate the list by hand. Platform models lead the account list,
 * mirroring the backend's account projection.
 */
function syncAgentCandidates(
  view: ModelConfigView,
  assignments: ModelConfigView["modelAssignments"]
): void {
  fillAgentCandidates(view, assignments.byok, "byok");
  if (assignments.account.ownerAccountId) {
    fillAgentCandidates(view, assignments.account, "account");
  }
}

function fillAgentCandidates(
  view: ModelConfigView,
  assignment: { agent: { candidates: string[]; default: string | null } },
  mode: ModelWorkspaceMode
): void {
  const agentPresets = visiblePresets(view, mode)
    .filter((preset) => preset.capabilities.includes("agent"));
  const candidateIds = [
    ...agentPresets.filter((preset) => preset.source === "account"),
    ...agentPresets.filter((preset) => preset.source === "byok")
  ].map((preset) => preset.presetId);
  assignment.agent.candidates = candidateIds;
  if (!assignment.agent.default || !candidateIds.includes(assignment.agent.default)) {
    assignment.agent.default = candidateIds[0] ?? null;
  }
}

function presetHasCapability(catalog: ModelConfigView, presetId: string, capability: CatalogCapability): boolean {
  return catalog.providers.some((provider) => provider.models.some((preset) => preset.presetId === presetId && preset.capabilities.includes(capability)));
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function newId(prefix: string): string {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

function endpointAuthMatches(
  endpoint: ModelConfigView["providers"][number]["endpoints"][number],
  input: Pick<ByokPresetInput, "apiKey" | "apiKeyMasked">
): boolean {
  if (input.apiKey) return endpoint.apiKey === input.apiKey;
  if (input.apiKeyMasked) return false;
  return !endpoint.hasApiKey && !endpoint.apiKey && !endpoint.apiKeyMasked;
}

function newClientPresetId(): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${CLIENT_PRESET_ID_PREFIX}${suffix}`;
}
