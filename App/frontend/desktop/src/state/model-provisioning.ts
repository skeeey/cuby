/** Model provisioning module. */
import type {
  CuberouterModelChoicesView,
  ModelConfigView,
  ModelEndpointProtocol
} from "@memmy/local-api-contracts";
import type { ConfigClient, ModelProviderConfig } from "../api/config-client.js";
import type { AccountClient } from "../api/account-client.js";
import type { CuberouterKeySelection } from "./cuberouter-key-selection.js";
import {
  applyCuberouterSelection,
  clearCuberouterAccount,
  createModelWorkspace,
  keepCuberouterEndpoint,
  modelConfigInput,
  readCuberouterSelection,
  type CuberouterSelection,
  type ModelWorkspace
} from "./model-workspace.js";

/** What a login should do about the model key. */
export type CuberouterLoginKeyDecision =
  | { action: "reuse"; apiKey: string; record: CuberouterKeySelection }
  | { action: "provision"; availableModels: string[] | null }
  | { action: "keep" };

/**
 * Decides whether a login keeps the key this machine remembered. `reuse` needs the record to be
 * listed and usable (a personal key's plaintext is revealed on the spot); `keep` covers the one
 * case where nothing may be written — the instance could not be asked and a cuberouter
 * connection already exists — because a transient outage must not overwrite the user's key.
 * `provision` carries the instance's model list along (`null` when the instance could not be
 * asked), so the seeding behind it can tell a missing default from an unasked instance.
 */
export async function resolveCuberouterLoginKey(input: {
  apiBase: string;
  catalog: ModelConfigView;
  record: CuberouterKeySelection | null;
  getModelChoices: () => Promise<CuberouterModelChoicesView>;
  revealPersonalKey: (tokenId: number) => Promise<{ key: string }>;
}): Promise<CuberouterLoginKeyDecision> {
  try {
    const choices = await input.getModelChoices();
    const remembered = input.record
      ? choices.keys.find((key) => key.scope === input.record!.scope && key.id === input.record!.id && key.usable)
      : undefined;
    if (!input.record || !remembered) return { action: "provision", availableModels: choices.models };
    const apiKey = remembered.secret ?? (await input.revealPersonalKey(remembered.id)).key;
    return { action: "reuse", apiKey, record: input.record };
  } catch {
    return connectionHasCredential(input.catalog, input.apiBase)
      ? { action: "keep" }
      : { action: "provision", availableModels: null };
  }
}

/** Whether the stored catalog already carries a usable connection at this line's base. */
function connectionHasCredential(catalog: ModelConfigView, apiBase: string): boolean {
  const normalized = apiBase.trim().replace(/\/+$/, "");
  return catalog.providers.some((provider) => (
    !provider.accountManaged
    && provider.endpoints.some((endpoint) => (
      endpoint.apiBase.replace(/\/+$/, "") === normalized && (endpoint.hasApiKey || Boolean(endpoint.apiKeyMasked))
    ))
  ));
}

/**
 * Writes one cuberouter key. The catalog's current model selection always stays when it has one —
 * a login, provisioning included, must never reset the user's choices, and any non-empty slot
 * (an agent model or either memory model) counts as a selection. An empty selection is seeded
 * with the build's default while the instance's list (`availableModels`) offers it or could not
 * be consulted (`null`), otherwise the first model the list does offer.
 *
 * Every model the instance lists is enrolled as an agent candidate, so the conversation model
 * picker can offer the whole line instead of only the model that happened to be provisioned.
 * A connection cannot be written without a model — the catalog contract rejects that — so there
 * is no "seed nothing" branch.
 */
export async function provisionCuberouterKey(input: {
  configClient: ConfigClient;
  endpoint: { apiBase: string; protocol: ModelEndpointProtocol; apiKey: string };
  defaultModel: string;
  /** The instance's model list; null when the choices request failed and the list is unknown. */
  availableModels: string[] | null;
  /** Every configured cuberouter node base; endpoints at these bases belong to the account. */
  managedApiBases?: string[];
}): Promise<ModelProviderConfig> {
  return saveCatalogMutation({
    configClient: input.configClient,
    mutate: (workspace) => {
      // A login on another node must not carry the previous account's models along.
      const loginWorkspace = keepCuberouterEndpoint(
        workspace,
        input.endpoint.apiBase,
        input.managedApiBases ?? [input.endpoint.apiBase]
      );
      const current = readCuberouterSelection(loginWorkspace.catalog, input.endpoint.apiBase);
      const hasSelection = current.agent.models.length > 0
        || Boolean(current.memorySummary)
        || Boolean(current.memoryEvolution);
      // Only an empty selection gets the build's default, and only while the instance's list
      // leaves it standing: an unlisted default yields to the first model the list does offer.
      // The empty-list guard can only fire for a malformed list.
      const listed = (input.availableModels ?? []).map((model) => model.trim()).filter(Boolean);
      const seedModel = input.availableModels === null || listed.includes(input.defaultModel)
        ? input.defaultModel
        : listed[0] ?? input.defaultModel;
      let selection: CuberouterSelection;
      if (listed.length > 0) {
        // The key's list is authoritative: enroll every allowed model, keep a default/memory
        // choice only while it is still allowed, and otherwise fall back to the first allowed one.
        const defaultModel = current.agent.default && listed.includes(current.agent.default)
          ? current.agent.default
          : seedModel;
        const memorySummary = !hasSelection
          ? seedModel
          : current.memorySummary
            ? (listed.includes(current.memorySummary) ? current.memorySummary : listed[0]!)
            : "";
        const memoryEvolution = !hasSelection
          ? seedModel
          : current.memoryEvolution
            ? (listed.includes(current.memoryEvolution) ? current.memoryEvolution : listed[0]!)
            : "";
        selection = {
          agent: { models: listed, default: defaultModel },
          memorySummary,
          memoryEvolution
        };
      } else if (hasSelection) {
        selection = current;
      } else {
        selection = {
          agent: { models: [seedModel], default: seedModel },
          memorySummary: seedModel,
          memoryEvolution: seedModel
        };
      }
      return applyCuberouterSelection(loginWorkspace, {
        apiBase: input.endpoint.apiBase,
        protocol: input.endpoint.protocol,
        apiKey: input.endpoint.apiKey,
        selection
      });
    }
  });
}

/** Reads the latest catalog, applies a pure mutation, saves; retries once on catalog conflicts. */
export async function saveCatalogMutation(input: {
  configClient: Pick<ConfigClient, "getModelConfig" | "saveModelCatalog">;
  mutate: (workspace: ModelWorkspace) => ModelWorkspace;
}): Promise<ModelProviderConfig> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const latest = await input.configClient.getModelConfig();
    const next = input.mutate(createModelWorkspace(latest));
    try {
      return await input.configClient.saveModelCatalog(modelConfigInput(next));
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : undefined;
      if (code !== "model_config_changed" && code !== "config_write_busy") throw error;
      lastError = error;
    }
  }
  throw lastError ?? new Error("unreachable: saveCatalogMutation retried without resolving");
}

/**
 * The node bases whose endpoints belong to the active cuberouter account. Reads the configured
 * node table; a caller that already knows the current base can pass it as a fallback, and the
 * account's own model choices are the last resort (and throw when the account is unreachable).
 */
export async function collectCuberouterApiBases(input: {
  accountClient: Pick<AccountClient, "getNodes" | "getModelChoices">;
  fallbackApiBase?: string;
}): Promise<string[]> {
  const bases = new Set<string>();
  const add = (base: string | undefined | null) => {
    const trimmed = base?.trim();
    if (!trimmed) return;
    try {
      bases.add(new URL(trimmed).origin);
    } catch {
      bases.add(trimmed.replace(/\/+$/, ""));
    }
  };
  try {
    const nodes = await input.accountClient.getNodes();
    for (const url of Object.values(nodes.nodeUrls ?? {})) add(url);
  } catch {
    // The caller may still know the current base; otherwise fall through to the account read.
  }
  add(input.fallbackApiBase);
  if (!bases.size) {
    const choices = await input.accountClient.getModelChoices();
    add(choices.apiBase);
  }
  return [...bases];
}

/**
 * Removes the active account's cuberouter endpoints before the session is cleared. Throwing on
 * failure is deliberate: the caller must abort the logout so the key cannot be left behind.
 */
export async function clearCuberouterAccountForLogout(input: {
  configClient: Pick<ConfigClient, "getModelConfig" | "saveModelCatalog">;
  managedApiBases: readonly string[];
}): Promise<ModelProviderConfig> {
  return saveCatalogMutation({
    configClient: input.configClient,
    mutate: (workspace) => clearCuberouterAccount(workspace, input.managedApiBases)
  });
}
