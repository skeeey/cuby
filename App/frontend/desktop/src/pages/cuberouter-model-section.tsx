/** cuberouter model configuration section module. */
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { CuberouterKeyOption, CuberouterModelChoicesView } from "@memmy/local-api-contracts";
import type { AccountClient } from "../api/account-client.js";
import type { ConfigClient, ModelProviderConfig } from "../api/config-client.js";
import { Button } from "../components/button.js";
import { ModelProviderLogo } from "../components/model-provider-logo.js";
import type { MessageKey } from "../i18n/messages.js";
import { useTranslation } from "../i18n/use-translation.js";
import {
  applyCuberouterSelection,
  createModelWorkspace,
  readCuberouterSelection,
  type CuberouterSelection,
  type ModelWorkspace
} from "../state/model-workspace.js";
import { saveCatalogMutation } from "../state/model-provisioning.js";
import {
  cuberouterKeySelectionStorage,
  readCuberouterKeySelection,
  writeCuberouterKeySelection
} from "../state/cuberouter-key-selection.js";
import { ModelAssignmentSection } from "./model-assignment-section.js";

const PROTOCOL = "openai-chat-completions" as const;

export interface CuberouterModelSectionProps {
  username: string | null;
  organizationName: string | null;
  seedConfig?: ModelProviderConfig | null;
  configClient?: Pick<ConfigClient, "getModelConfig" | "saveModelCatalog" | "testModelConfig">;
  accountClient?: Pick<AccountClient, "getModelChoices" | "revealPersonalKey">;
  onConfigSaved?: (config: ModelProviderConfig) => void;
}

export function CuberouterModelSection(props: CuberouterModelSectionProps) {
  const { t } = useTranslation();
  const [choices, setChoices] = useState<CuberouterModelChoicesView | null>(null);
  const [choicesFailed, setChoicesFailed] = useState(false);
  const [workspace, setWorkspace] = useState<ModelWorkspace>(() => createModelWorkspace(props.seedConfig));
  /** The draft the panel edits; seeded from the stored catalog once the line's apiBase is known. */
  const [selection, setSelection] = useState<CuberouterSelection | null>(null);
  const [pendingKeyId, setPendingKeyId] = useState<string | null>(null);
  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const loadChoices = useCallback(() => {
    const client = props.accountClient;
    setChoices(null);
    setChoicesFailed(false);
    // A host that only wires the parts it has (a narrow or absent client) keeps the section in
    // its loading state, as the settings page does for its own account client.
    if (!client?.getModelChoices) return;
    void client.getModelChoices().then(setChoices).catch(() => setChoicesFailed(true));
  }, [props.accountClient]);

  useEffect(() => { loadChoices(); }, [loadChoices]);
  useEffect(() => { setWorkspace(createModelWorkspace(props.seedConfig)); }, [props.seedConfig]);
  useEffect(() => {
    if (!choices || selection !== null) return;
    setSelection(readCuberouterSelection(createModelWorkspace(props.seedConfig).catalog, choices.apiBase));
  }, [choices, selection, props.seedConfig]);

  const record = props.username ? readCuberouterKeySelection(props.username, cuberouterKeySelectionStorage()) : null;
  const selectedKey = record && choices
    ? choices.keys.find((key) => key.scope === record.scope && key.id === record.id && key.usable) ?? null
    : null;

  /** Saves one mutation built from the current draft, refreshing the workspace on success. */
  async function commit(mutate: (current: ModelWorkspace, apiBase: string) => ModelWorkspace): Promise<boolean> {
    if (!props.configClient || !choices) return false;
    setSavePending(true);
    setSaveError(null);
    try {
      const saved = await saveCatalogMutation({
        configClient: props.configClient,
        mutate: (current) => mutate(current, choices.apiBase)
      });
      setWorkspace(createModelWorkspace(saved));
      props.onConfigSaved?.(saved);
      return true;
    } catch {
      setSaveError(t("settings.modelWorkspace.saveFailed"));
      return false;
    } finally {
      setSavePending(false);
    }
  }

  /** Applies one key: personal keys are revealed on demand, organization ones ship their secret. */
  async function selectKey(key: CuberouterKeyOption): Promise<void> {
    if (!props.username || !selection) return;
    const id = `${key.scope}:${key.id}`;
    setPendingKeyId(id);
    try {
      const plaintext = key.secret ?? (await props.accountClient!.revealPersonalKey(key.id)).key;
      const committed = await commit((current, apiBase) => applyCuberouterSelection(current, {
        apiBase,
        protocol: PROTOCOL,
        apiKey: plaintext,
        selection
      }));
      // The record names the key the catalog actually holds: a failed save must not claim it.
      if (committed) {
        writeCuberouterKeySelection(
          { username: props.username!, scope: key.scope, id: key.id, name: key.name },
          cuberouterKeySelectionStorage()
        );
      }
    } catch {
      setSaveError(t("settings.modelWorkspace.saveFailed"));
    } finally {
      setPendingKeyId(null);
    }
  }

  /** Task 13 接线：重新走一次登录时的 find-or-create（`provisionCuberouterKey({ …, keepSelection: false })`）。 */
  function onRefreshKeys(): void {
    // 见 Task 13。
  }

  /** Applies one assignment change: draft first, then the panel's shared save path. */
  function updateSelection(patch: Partial<CuberouterSelection>): void {
    // Dropped, not queued: a change that arrives while a save runs would race that PUT.
    if (!selection || savePending) return;
    const next = { ...selection, ...patch };
    setSelection(next);
    void commit((current, apiBase) => applyCuberouterSelection(current, {
      apiBase,
      protocol: PROTOCOL,
      selection: next
    }));
  }

  const models = choices?.models ?? [];
  const modelOptions = models.map((model) => ({ value: model, label: model }));

  if (choicesFailed) {
    return (
      <div className="model-workspace-layout">
        <p className="text-xs text-text-ink/60">{t("settings.cuberouterModel.loadFailed")}</p>
        <Button type="button" size="sm" variant="secondary" onClick={loadChoices}>
          {t("settings.cuberouterModel.retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="model-workspace-layout" aria-busy={savePending || !choices}>
      <p className="text-sm text-text-ink/80">
        {props.username}{props.organizationName ? ` (${props.organizationName})` : ""}
      </p>

      <section className="mt-6">
        <h3 className="text-sm font-semibold text-text-ink">{t("settings.cuberouterModel.keysTitle")}</h3>
        <p className="mt-1 text-xs leading-relaxed text-text-ink/45">
          {t("settings.cuberouterModel.keysHint")}
        </p>
        <div className="mt-3 space-y-2">
          {(choices?.keys ?? []).map((key) => (
            <div key={`${key.scope}:${key.id}`} className="flex items-center gap-3">
              <input
                type="radio"
                name="cuberouter-key"
                aria-label={key.name}
                checked={selectedKey?.scope === key.scope && selectedKey.id === key.id}
                disabled={!key.usable || pendingKeyId !== null || savePending}
                onChange={() => void selectKey(key)}
              />
              <span className="min-w-0 flex-1 truncate text-sm text-text-ink/80">{key.name}</span>
              <span className="shrink-0 text-xs text-text-ink/50">
                {key.billing.kind === "personal"
                  ? t("settings.cuberouterModel.billingPersonal")
                  : t("settings.cuberouterModel.billingOrganization", { name: key.billing.organizationName })}
                {" · "}
                {key.billing.remainingQuota === null
                  ? t("settings.cuberouterModel.balanceUnknown")
                  : t("settings.cuberouterModel.remaining", { amount: String(key.billing.remainingQuota) })}
              </span>
              {key.status !== undefined && key.status !== 1 && (
                <span className="shrink-0 rounded-tag bg-canvas-oat px-2 py-0.5 text-[10px] text-text-ink/50">
                  {t(statusMessageKey(key.status))}
                </span>
              )}
            </div>
          ))}
        </div>
        {choices && record && !selectedKey && (
          <div className="mt-3 flex items-center gap-3">
            <p className="text-xs text-text-ink/60">{t("settings.cuberouterModel.keyMissing")}</p>
            <Button type="button" size="sm" variant="secondary" onClick={onRefreshKeys}>
              <RefreshCw size={13} aria-hidden="true" />
              {t("settings.cuberouterModel.refreshKeys")}
            </Button>
          </div>
        )}
      </section>

      {saveError && <p className="mt-3 text-xs text-text-ink/60">{saveError}</p>}

      {choices && models.length === 0 && (
        <p className="mt-3 text-xs text-text-ink/60">{t("settings.cuberouterModel.noModels")}</p>
      )}
      {selection && (
        <>
          <ModelAssignmentSection
            conversationGroups={models.length > 0 ? [{
              key: "cuberouter",
              title: t("settings.cuberouterModel.modelsGroup"),
              icon: <ModelProviderLogo provider="openai" size={14} />,
              candidates: models.map((model) => ({
                id: model,
                label: model,
                detail: t("settings.cuberouterModel.modelsGroup")
              }))
            }] : []}
            selectedCandidateIds={selection.agent.models}
            defaultCandidateId={selection.agent.default ?? null}
            onToggleCandidate={(model) => updateSelection({ agent: toggleAgentModel(selection.agent, model) })}
            onChooseDefaultCandidate={(model) => updateSelection({ agent: { ...selection.agent, default: model } })}
            rows={[
              {
                kind: "memorySummary",
                label: t("settings.model.memorySummary"),
                description: t("settings.model.memoryDesc"),
                tip: t("apiKey.modelPage.memoryHint"),
                value: selection.memorySummary,
                options: modelOptions,
                searchable: true,
                preserveUnassigned: true
              },
              {
                kind: "memoryEvolution",
                label: t("settings.model.skillEvolution"),
                description: t("settings.model.skillDesc"),
                value: selection.memoryEvolution,
                options: modelOptions,
                searchable: true,
                preserveUnassigned: true
              }
            ]}
            onRowChange={(kind, value) => updateSelection(
              kind === "memorySummary" ? { memorySummary: value } : { memoryEvolution: value }
            )}
            disabled={savePending}
          />
          {/* Read-only: the local embedding model stays memmy's built-in default. */}
          <div className="flex items-center justify-between gap-4 px-3.5 py-2.5">
            <span className="text-sm text-text-ink/80">{t("settings.model.embeddingSearch")}</span>
            <span className="text-xs text-text-ink/50">{t("settings.cuberouterModel.embeddingBuiltin")}</span>
          </div>
        </>
      )}
      {/* Task 12 再加「高级」折叠。 */}
    </div>
  );
}

/** Toggles one conversation model, keeping at least one selected (the picker's own rule). */
export function toggleAgentModel(
  agent: CuberouterSelection["agent"],
  model: string
): CuberouterSelection["agent"] {
  const models = agent.models.includes(model)
    ? agent.models.filter((item) => item !== model)
    : [...agent.models, model];
  const next: CuberouterSelection["agent"] = {
    models: models.length > 0 ? models : agent.models,
    ...(agent.default ? { default: agent.default } : {})
  };
  if (next.default && !next.models.includes(next.default)) {
    next.default = next.models[0];
  }
  return next;
}

/** The status badge message for one instance token state. */
function statusMessageKey(status: number): MessageKey {
  if (status === 2) return "settings.cuberouterModel.statusDisabled";
  if (status === 3) return "settings.cuberouterModel.statusExpired";
  return "settings.cuberouterModel.statusExhausted";
}
