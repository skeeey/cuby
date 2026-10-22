/** cuberouter model configuration section module. */
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BUILTIN_LOCAL_EMBEDDING_ASSIGNMENT_ID,
  type CuberouterKeyOption,
  type CuberouterModelChoicesView,
  type ModelConfigView
} from "@memmy/local-api-contracts";
import type { AccountClient } from "../api/account-client.js";
import { ApiRequestError } from "../api/http.js";
import type { ConfigClient, ModelProviderConfig } from "../api/config-client.js";
import { Button } from "../components/button.js";
import type { MessageKey } from "../i18n/messages.js";
import { useTranslation } from "../i18n/use-translation.js";
import {
  applyCuberouterSelection,
  chatModelTestTarget,
  createModelWorkspace,
  readCuberouterSelection,
  type CuberouterSelection,
  type ModelWorkspace
} from "../state/model-workspace.js";
import { saveCatalogMutation } from "../state/model-provisioning.js";
import {
  clearCuberouterKeySelection,
  cuberouterKeySelectionStorage,
  defaultCuberouterKey,
  readCuberouterKeySelection,
  writeCuberouterKeySelection
} from "../state/cuberouter-key-selection.js";
import { ModelAssignmentSection, type ModelAssignmentTestStatus } from "./model-assignment-section.js";
import { formatCuberouterRemaining } from "./cuberouter-money.js";

const PROTOCOL = "openai-chat-completions" as const;

/** Why the choices read failed, and whether the fix is a fresh login rather than a retry. */
interface CuberouterChoicesError {
  /** The local API's own message, or null when the failure never reached it. */
  message: string | null;
  sessionExpired: boolean;
}

export interface CuberouterModelSectionProps {
  username: string | null;
  organizationName: string | null;
  seedConfig?: ModelProviderConfig | null;
  configClient?: Pick<ConfigClient, "getModelConfig" | "saveModelCatalog" | "testModelConfig">;
  accountClient?: Pick<AccountClient, "getModelChoices" | "getKeyModels" | "revealPersonalKey" | "reprovisionKey">;
  onConfigSaved?: (config: ModelProviderConfig) => void;
}

export function CuberouterModelSection(props: CuberouterModelSectionProps) {
  const { t, language } = useTranslation();
  const [choices, setChoices] = useState<CuberouterModelChoicesView | null>(null);
  const [choicesError, setChoicesError] = useState<CuberouterChoicesError | null>(null);
  const [workspace, setWorkspace] = useState<ModelWorkspace>(() => createModelWorkspace(props.seedConfig));
  /** The draft the panel edits; seeded from the stored catalog once the line's apiBase is known. */
  const [selection, setSelection] = useState<CuberouterSelection | null>(null);
  const [pendingKeyId, setPendingKeyId] = useState<string | null>(null);
  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [assignmentTests, setAssignmentTests] = useState<
    Partial<Record<"agent" | "memorySummary" | "memoryEvolution", ModelAssignmentTestStatus>>
  >({});
  const [testingAssignments, setTestingAssignments] = useState(false);
  const [keyModels, setKeyModels] = useState<string[] | null>(null);
  const [keyModelsStatus, setKeyModelsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [keyFallbackNotice, setKeyFallbackNotice] = useState(false);
  const keyModelsCacheRef = useRef(new Map<string, string[]>());
  /** Guards the single save path before a render could re-disable its controls. */
  const saveInFlightRef = useRef(false);
  // A key action starts before its save: revealing a personal key is an await of its own, and
  // nothing else may commit while that reveal (or the save behind it) is still running.
  const busy = savePending || pendingKeyId !== null;

  const loadChoices = useCallback(() => {
    const client = props.accountClient;
    setChoices(null);
    setChoicesError(null);
    // A host that only wires the parts it has (a narrow or absent client) keeps the section in
    // its loading state, as the settings page does for its own account client.
    if (!client?.getModelChoices) return;
    void client.getModelChoices().then(setChoices).catch((error: unknown) => {
      // Only the local API's messages are written to be read by a person. A transport failure
      // or a bug would put something like "Failed to fetch" on screen, so those keep the
      // localized fallback instead of the raw message.
      const fromApi = error instanceof ApiRequestError;
      setChoicesError({
        message: fromApi && error.message ? error.message : null,
        sessionExpired: fromApi && error.code === "unauthorized"
      });
    });
  }, [props.accountClient]);

  useEffect(() => { loadChoices(); }, [loadChoices]);
  useEffect(() => { setWorkspace(createModelWorkspace(props.seedConfig)); }, [props.seedConfig]);
  useEffect(() => {
    if (!choices || selection !== null) return;
    setSelection(readCuberouterSelection(createModelWorkspace(props.seedConfig).catalog, choices.apiBase));
  }, [choices, selection, props.seedConfig]);

  const record = props.username ? readCuberouterKeySelection(props.username, cuberouterKeySelectionStorage()) : null;
  // A remembered switch wins while its row is still usable. With no record, show the key the
  // login flow provisions by default (`cuby-desktop-*`, organization first); the record is
  // reserved for an explicit switch, so the implicit default is derived on every load.
  const selectedKey = choices
    ? record
      ? choices.keys.find((key) => key.scope === record.scope && key.id === record.id && key.usable) ?? null
      : props.username
        ? defaultCuberouterKey(choices.keys, props.username)
        : null
    : null;

  /**
   * Reads the model list the selected key may actually call. `/api/user/models` only knows the
   * member's groups; the relay's `/v1/models` also applies the token's own model limits.
   */
  useEffect(() => {
    const client = props.accountClient;
    if (!choices || !selectedKey || !client?.getKeyModels) {
      setKeyModels(null);
      setKeyModelsStatus("idle");
      return;
    }
    const cacheKey = `${selectedKey.scope}:${selectedKey.id}`;
    const cached = keyModelsCacheRef.current.get(cacheKey);
    if (cached) {
      setKeyModels(cached);
      setKeyModelsStatus("ready");
      return;
    }
    let active = true;
    setKeyFallbackNotice(false);
    setKeyModels(null);
    setKeyModelsStatus("loading");
    void client.getKeyModels({ scope: selectedKey.scope, id: selectedKey.id })
      .then(({ models }) => {
        if (!active) return;
        keyModelsCacheRef.current.set(cacheKey, models);
        setKeyModels(models);
        setKeyModelsStatus("ready");
      })
      .catch(() => {
        if (!active) return;
        setKeyModels(null);
        setKeyModelsStatus("error");
      });
    return () => { active = false; };
  }, [choices, props.accountClient, selectedKey?.scope, selectedKey?.id]);

  /**
   * Aligns the catalog with what the selected key may call: every allowed model becomes an agent
   * candidate (the conversation picker reads that list), a disallowed default falls back to the
   * first allowed model, and a disallowed memory model does the same. Idempotent: once the saved
   * selection matches, reconcile returns no change and nothing is written.
   */
  useEffect(() => {
    if (!choices || !selection || savePending || saveInFlightRef.current) return;
    if (keyModelsStatus === "idle" || keyModelsStatus === "loading") return;
    const allowed = keyModels ?? choices.models;
    if (allowed.length === 0) return;
    if (!catalogHasEndpoint(workspace.catalog, choices.apiBase)) return;
    const next = reconcileCuberouterSelection(selection, allowed);
    if (!next.changed) return;
    if (next.fellBack) setKeyFallbackNotice(true);
    setSelection(next.selection);
    void commit((current, apiBase) => applyCuberouterSelection(current, {
      apiBase,
      protocol: PROTOCOL,
      selection: next.selection
    }));
    // The save reseeds the draft, after which this effect sees no difference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choices, keyModels, keyModelsStatus, savePending, selection, workspace.catalog]);

  /** Replays the draft from one workspace: storage is the only truth for which models this line holds. */
  function reseedSelection(from: ModelWorkspace): void {
    if (!choices) return;
    setSelection(readCuberouterSelection(from.catalog, choices.apiBase));
  }

  /**
   * Saves one mutation built from the current draft — the panel's single save path: the key card,
   * the assignment rows and the advanced library all land here, sharing one in-flight guard, one
   * error surface and one conflict retry. Resolves with the saved workspace, null when refused or
   * failed.
   */
  async function commit(
    mutate: (current: ModelWorkspace, apiBase: string) => ModelWorkspace
  ): Promise<ModelWorkspace | null> {
    if (!props.configClient || !choices || saveInFlightRef.current) return null;
    saveInFlightRef.current = true;
    setSavePending(true);
    setSaveError(null);
    try {
      const saved = await saveCatalogMutation({
        configClient: props.configClient,
        mutate: (current) => mutate(current, choices.apiBase)
      });
      const savedWorkspace = createModelWorkspace(saved);
      setWorkspace(savedWorkspace);
      // The catalog is authoritative: replay the draft, so an edit (a new apiBase, a deleted
      // connection, a pruned model) never leaves the draft naming models storage does not hold.
      reseedSelection(savedWorkspace);
      props.onConfigSaved?.(saved);
      return savedWorkspace;
    } catch {
      setSaveError(t("settings.modelWorkspace.saveFailed"));
      // A failed save leaves storage untouched: put the draft back onto the catalog we still hold.
      reseedSelection(workspace);
      return null;
    } finally {
      saveInFlightRef.current = false;
      setSavePending(false);
    }
  }

  /** Applies one key: personal keys are revealed on demand, organization ones ship their secret. */
  async function selectKey(key: CuberouterKeyOption): Promise<void> {
    if (!props.username || !selection) return;
    const id = `${key.scope}:${key.id}`;
    setPendingKeyId(id);
    setAssignmentTests({});
    setKeyFallbackNotice(false);
    try {
      const plaintext = key.secret ?? (await props.accountClient!.revealPersonalKey(key.id)).key;
      // The new key's relay list decides which models may stay selected. A failed read falls
      // back to the instance list and leaves the warning visible; the key still switches.
      let allowed = keyModelsCacheRef.current.get(id);
      if (!allowed && props.accountClient?.getKeyModels) {
        try {
          const result = await props.accountClient.getKeyModels({ scope: key.scope, id: key.id });
          allowed = result.models;
          keyModelsCacheRef.current.set(id, result.models);
        } catch {
          allowed = undefined;
        }
      }
      const candidates = allowed ?? choices?.models ?? [];
      if (candidates.length === 0) {
        setSaveError(t("settings.cuberouterModel.noKeyModels"));
        return;
      }
      const reconciled = reconcileCuberouterSelection(selection, candidates);
      setSelection(reconciled.selection);
      setKeyFallbackNotice(reconciled.fellBack);
      setKeyModels(candidates);
      setKeyModelsStatus(allowed ? "ready" : "error");
      const saved = await commit((current, apiBase) => applyCuberouterSelection(current, {
        apiBase,
        protocol: PROTOCOL,
        apiKey: plaintext,
        selection: reconciled.selection
      }));
      // The record names the key the catalog actually holds: a failed save must not claim it.
      if (saved) {
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

  /** Re-runs the instance-side find-or-create, then re-reads the key list. */
  async function onRefreshKeys(): Promise<void> {
    if (!props.configClient || !props.accountClient || !props.username) return;
    setSaveError(null);
    setSavePending(true);
    setAssignmentTests({});
    try {
      const provisioning = await props.accountClient.reprovisionKey();
      // The same preferred-default rule as the login: the model this instance actually lists —
      // the first one when the provisioned default is not among them. A connection must carry a
      // model (the catalog contract rejects a provider without one), so there is always a seed.
      const listedModels = choices?.models ?? [];
      const seedModel = listedModels.includes(provisioning.model)
        ? provisioning.model
        : listedModels[0] ?? provisioning.model;
      const fresh: CuberouterSelection = {
        agent: { models: [seedModel], default: seedModel },
        memorySummary: seedModel,
        memoryEvolution: seedModel
      };
      setSelection(fresh);
      const saved = await commit((current) => applyCuberouterSelection(current, {
        apiBase: provisioning.apiBase,
        protocol: PROTOCOL,
        apiKey: provisioning.apiKey,
        selection: fresh
      }));
      // A refused or failed save wrote nothing, so nothing may be claimed: the record stays (and
      // with it the entry) for a retry, and the list keeps describing what the catalog holds.
      if (!saved) return;
      // 刚写进去的这把 key 没有列表身份，记录清掉；面板重新拉列表后用户可再选。
      clearCuberouterKeySelection(props.username, cuberouterKeySelectionStorage());
      loadChoices();
    } catch {
      setSaveError(t("settings.modelWorkspace.saveFailed"));
    } finally {
      setSavePending(false);
    }
  }

  /** Applies one assignment change: draft first, then the panel's shared save path. */
  function updateSelection(patch: Partial<CuberouterSelection>): void {
    // Dropped, not queued: a change that arrives while a save runs would race that PUT.
    if (!selection || savePending) return;
    setAssignmentTests((current) => {
      const next = { ...current };
      if (patch.agent) delete next.agent;
      if ("memorySummary" in patch) delete next.memorySummary;
      if ("memoryEvolution" in patch) delete next.memoryEvolution;
      return next;
    });
    const next = { ...selection, ...patch };
    setSelection(next);
    void commit((current, apiBase) => applyCuberouterSelection(current, {
      apiBase,
      protocol: PROTOCOL,
      selection: next
    }));
  }

  /** Chooses the default chat model, enrolling it first when the catalog does not hold it yet. */
  function chooseDefaultModel(model: string): void {
    if (!selection) return;
    updateSelection({
      agent: {
        models: selection.agent.models.includes(model)
          ? selection.agent.models
          : [...selection.agent.models, model],
        default: model
      }
    });
  }

  /** Probes every distinct model assigned to the three chat roles, one request per model. */
  async function testAssignedModels(): Promise<void> {
    const configClient = props.configClient;
    if (!configClient || testingAssignments) return;
    const space = workspace.spaces.byok;
    const targets: Array<{
      key: "agent" | "memorySummary" | "memoryEvolution";
      presetId: string | null;
    }> = [
      { key: "agent", presetId: space.defaultAgentModelId },
      { key: "memorySummary", presetId: space.assignments.memorySummary ?? null },
      { key: "memoryEvolution", presetId: space.assignments.memoryEvolution ?? null }
    ];
    const unconfigured: ModelAssignmentTestStatus = {
      status: "skipped",
      message: t("settings.modelWorkspace.notConfigured")
    };
    const statusFor = (
      presetId: string | null,
      results: Map<string, ModelAssignmentTestStatus>
    ): ModelAssignmentTestStatus => (presetId ? results.get(presetId)! : unconfigured);

    setTestingAssignments(true);
    setAssignmentTests({
      agent: targets[0]!.presetId ? { status: "testing" } : unconfigured,
      memorySummary: targets[1]!.presetId ? { status: "testing" } : unconfigured,
      memoryEvolution: targets[2]!.presetId ? { status: "testing" } : unconfigured
    });

    const uniquePresetIds = [...new Set(targets.flatMap(({ presetId }) => presetId ? [presetId] : []))];
    const results = new Map<string, ModelAssignmentTestStatus>();
    await Promise.all(uniquePresetIds.map(async (presetId) => {
      const target = chatModelTestTarget(workspace, presetId);
      if (target.status === "platform") {
        results.set(presetId, {
          status: "skipped",
          message: t("settings.modelWorkspace.testPlatformSkipped")
        });
        return;
      }
      if (target.status === "missing") {
        results.set(presetId, { status: "error", message: t("settings.modelWorkspace.testFailed") });
        return;
      }
      try {
        const result = await configClient.testModelConfig(target.config, "chat");
        results.set(presetId, result.ok
          ? { status: "success", message: t("settings.modelWorkspace.testSuccess") }
          : { status: "error", message: result.message || t("settings.modelWorkspace.testFailed") });
      } catch {
        results.set(presetId, { status: "error", message: t("settings.modelWorkspace.testFailed") });
      }
    }));

    setAssignmentTests({
      agent: statusFor(targets[0]!.presetId, results),
      memorySummary: statusFor(targets[1]!.presetId, results),
      memoryEvolution: statusFor(targets[2]!.presetId, results)
    });
    setTestingAssignments(false);
  }

  // The selected key's own list is authoritative once it has loaded; the instance list is the
  // provisional/fallback source while it loads or when the relay read fails.
  const availableModels = keyModels ?? choices?.models ?? [];
  const modelOptions = availableModels.map((model) => ({ value: model, label: model }));
  /** Draft agent models the selected key/instance no longer lists; kept visible while reconciling. */
  const staleAgentModels = (selection?.agent.models ?? []).filter((model) => !availableModels.includes(model));
  const conversationModels = [...availableModels, ...staleAgentModels];
  const showsOffListHint = selection !== null && (
    staleAgentModels.length > 0
    || (selection.memorySummary !== "" && !availableModels.includes(selection.memorySummary))
    || (selection.memoryEvolution !== "" && !availableModels.includes(selection.memoryEvolution))
  );

  /** One memory row's options, appending a stored value the selected key no longer allows. */
  function rowOptionsFor(value: string): Array<{ value: string; label: string }> {
    return value !== "" && !availableModels.includes(value)
      ? [...modelOptions, { value, label: value }]
      : modelOptions;
  }

  if (choicesError) {
    return (
      <div className="model-workspace-layout">
        <p className="text-xs text-text-ink/60">
          {choicesError.sessionExpired
            ? t("settings.cuberouterModel.sessionExpired")
            : choicesError.message ?? t("settings.cuberouterModel.loadFailed")}
        </p>
        {choicesError.sessionExpired ? (
          // Retrying resends the token the instance just refused, so it can never succeed.
          // Point at the one action that does.
          <p className="text-xs text-text-ink/45">{t("settings.cuberouterModel.relogin")}</p>
        ) : (
          <Button type="button" size="sm" variant="secondary" onClick={loadChoices}>
            {t("settings.cuberouterModel.retry")}
          </Button>
        )}
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
                  : t("settings.cuberouterModel.remaining", {
                      amount: formatCuberouterRemaining(
                        key.billing.remainingQuota,
                        choices?.currency,
                        language
                      )
                    })}
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

      {keyModelsStatus === "error" && (
        <p className="mt-3 text-xs text-text-ink/60">
          {t("settings.cuberouterModel.keyModelsFailed")}
        </p>
      )}
      {keyFallbackNotice && (
        <p className="mt-3 text-xs text-text-ink/60">
          {t("settings.cuberouterModel.keyFallback")}
        </p>
      )}
      {choices && keyModelsStatus === "ready" && keyModels?.length === 0 && (
        <p className="mt-3 text-xs text-text-ink/60">
          {t("settings.cuberouterModel.noKeyModels")}
        </p>
      )}
      {choices && availableModels.length === 0 && keyModelsStatus !== "ready" && (
        <p className="mt-3 text-xs text-text-ink/60">{t("settings.cuberouterModel.noModels")}</p>
      )}
      {selection && (
        <>
          <ModelAssignmentSection
            defaultModel={{
              label: t("settings.cuberouterModel.defaultChatModel"),
              hint: t("settings.modelWorkspace.defaultChatModelHint"),
              value: selection.agent.default ?? null,
              options: conversationModels.map((model) => ({ value: model, label: model })),
              onChange: chooseDefaultModel,
              testStatus: assignmentTests.agent
            }}
            testAll={{
              label: t("settings.modelWorkspace.testAssignedModels"),
              pending: testingAssignments,
              disabled: !props.configClient || busy,
              onTest: () => void testAssignedModels()
            }}
            rows={[
              {
                kind: "memorySummary",
                label: t("settings.model.memorySummary"),
                description: t("settings.model.memoryDesc"),
                tip: t("apiKey.modelPage.memoryHint"),
                value: selection.memorySummary,
                options: rowOptionsFor(selection.memorySummary),
                searchable: true,
                preserveUnassigned: true,
                testStatus: assignmentTests.memorySummary
              },
              {
                kind: "memoryEvolution",
                label: t("settings.model.skillEvolution"),
                description: t("settings.model.skillDesc"),
                value: selection.memoryEvolution,
                options: rowOptionsFor(selection.memoryEvolution),
                searchable: true,
                preserveUnassigned: true,
                testStatus: assignmentTests.memoryEvolution
              },
              {
                kind: "embedding",
                label: t("settings.model.embeddingSearch"),
                description: t("settings.model.embeddingDesc"),
                value: BUILTIN_LOCAL_EMBEDDING_ASSIGNMENT_ID,
                options: [{
                  value: BUILTIN_LOCAL_EMBEDDING_ASSIGNMENT_ID,
                  label: t("settings.cuberouterModel.embeddingBuiltin")
                }],
                disabled: true
              }
            ]}
            onRowChange={(kind, value) => {
              if (kind === "memorySummary") updateSelection({ memorySummary: value });
              else if (kind === "memoryEvolution") updateSelection({ memoryEvolution: value });
            }}
            disabled={busy || keyModelsStatus === "loading"}
          />
          {showsOffListHint && (
            <p className="mt-2 px-3.5 text-xs leading-relaxed text-text-ink/60">
              {t("settings.cuberouterModel.offListHint")}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Aligns one draft with the models a key may call. Every allowed model is enrolled so the
 * conversation picker can offer it; a default or memory model that is no longer allowed falls
 * back to the first allowed model, while an unset memory slot stays unset.
 */
export function reconcileCuberouterSelection(
  selection: CuberouterSelection,
  allowed: string[]
): { selection: CuberouterSelection; changed: boolean; fellBack: boolean } {
  const nextDefault = selection.agent.default && allowed.includes(selection.agent.default)
    ? selection.agent.default
    : allowed[0]!;
  const nextMemorySummary = selection.memorySummary
    ? (allowed.includes(selection.memorySummary) ? selection.memorySummary : allowed[0]!)
    : "";
  const nextMemoryEvolution = selection.memoryEvolution
    ? (allowed.includes(selection.memoryEvolution) ? selection.memoryEvolution : allowed[0]!)
    : "";
  const next: CuberouterSelection = {
    agent: { models: allowed, default: nextDefault },
    memorySummary: nextMemorySummary,
    memoryEvolution: nextMemoryEvolution
  };
  const fellBack = (selection.agent.default !== undefined && !allowed.includes(selection.agent.default))
    || selection.agent.models.some((model) => !allowed.includes(model))
    || (selection.memorySummary !== "" && !allowed.includes(selection.memorySummary))
    || (selection.memoryEvolution !== "" && !allowed.includes(selection.memoryEvolution));
  const changed = !sameStringSet(selection.agent.models, allowed)
    || selection.agent.default !== nextDefault
    || selection.memorySummary !== nextMemorySummary
    || selection.memoryEvolution !== nextMemoryEvolution;
  return { selection: next, changed, fellBack };
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const values = new Set(left);
  return right.every((value) => values.has(value));
}

/** Whether the catalog already carries a connection at this line's base. */
function catalogHasEndpoint(catalog: ModelConfigView, apiBase: string): boolean {
  const normalized = apiBase.trim().replace(/\/+$/, "");
  return catalog.providers.some((provider) => provider.endpoints.some((endpoint) => (
    endpoint.apiBase.replace(/\/+$/, "") === normalized
  )));
}

/** The status badge message for one instance token state. */
function statusMessageKey(status: number): MessageKey {
  if (status === 2) return "settings.cuberouterModel.statusDisabled";
  if (status === 3) return "settings.cuberouterModel.statusExpired";
  return "settings.cuberouterModel.statusExhausted";
}
