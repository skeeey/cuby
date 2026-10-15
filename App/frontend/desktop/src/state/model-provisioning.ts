/** Model provisioning module. */
import type {
  CuberouterModelChoicesView,
  ModelConfigView,
  ModelEndpointProtocol
} from "@memmy/local-api-contracts";
import type { ConfigClient, ModelProviderConfig } from "../api/config-client.js";
import type { CuberouterKeySelection } from "./cuberouter-key-selection.js";
import {
  applyCuberouterSelection,
  createModelWorkspace,
  modelConfigInput,
  readCuberouterSelection,
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
 * (an agent model or either memory model) counts as a selection. Only a line with no selection
 * yet is seeded with the build's default model, and only while the instance's list
 * (`availableModels`) actually offers it: an unlisting or unknown instance seeds nothing, so the
 * panel shows 未配置 and guides the user instead of writing a model the account cannot call.
 */
export async function provisionCuberouterKey(input: {
  configClient: ConfigClient;
  endpoint: { apiBase: string; protocol: ModelEndpointProtocol; apiKey: string };
  defaultModel: string;
  /** The instance's model list; null when the choices request failed and the list is unknown. */
  availableModels: string[] | null;
}): Promise<ModelProviderConfig> {
  return saveCatalogMutation({
    configClient: input.configClient,
    mutate: (workspace) => {
      const current = readCuberouterSelection(workspace.catalog, input.endpoint.apiBase);
      const hasSelection = current.agent.models.length > 0
        || Boolean(current.memorySummary)
        || Boolean(current.memoryEvolution);
      const seedable = !hasSelection && Boolean(input.availableModels?.includes(input.defaultModel));
      const selection = hasSelection
        ? current
        : seedable
          ? {
              agent: { models: [input.defaultModel], default: input.defaultModel },
              memorySummary: input.defaultModel,
              memoryEvolution: input.defaultModel
            }
          : { agent: { models: [] }, memorySummary: "", memoryEvolution: "" };
      return applyCuberouterSelection(workspace, {
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
