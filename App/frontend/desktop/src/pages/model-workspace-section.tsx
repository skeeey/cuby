import { AlertTriangle } from "lucide-react";
import { BUILTIN_LOCAL_EMBEDDING_ASSIGNMENT_ID } from "@memmy/local-api-contracts";
import { useEffect, useRef, useState } from "react";
import type { ConfigClient, ModelProviderConfig } from "../api/config-client.js";
import { ModelProviderLogo } from "../components/model-provider-logo.js";
import type { SelectOption } from "../components/Select.js";
import { useTranslation } from "../i18n/use-translation.js";
import {
  createModelWorkspace,
  getModelCandidates,
  modelConfigInput,
  setDefaultAgentModel,
  setModelAssignment,
  type ModelAssignmentKind,
  type ModelCapability,
  type ModelWorkspaceMode
} from "../state/model-workspace.js";
import { ModelAssignmentSection } from "./model-assignment-section.js";
import {
  ModelLibrarySection,
  connectionProtocolLabel,
  modelCapabilityMessageKey
} from "./model-library-section.js";
import type { StoredConnectionTestState } from "./model-workspace-connection-test-state.js";

// Re-exported so the settings tests and other importers keep their entry point.
export {
  availableConnectionProtocols,
  editorProtocolForCapabilities,
  modelCapabilitiesForKind,
  normalizeEditorCapabilities,
  protocolFromConnection
} from "./model-library-section.js";
export type { ModelKind } from "./model-library-section.js";

export interface ModelWorkspaceSectionProps {
  mode: ModelWorkspaceMode;
  seedConfig?: ModelProviderConfig | null;
  configClient?: Pick<ConfigClient, "getModelConfig" | "saveModelCatalog" | "testModelConfig">;
  onConfigSaved?: (config: ModelProviderConfig) => void;
  autoOpenAddConnection?: boolean;
  onFinishSetup?: () => void;
  /** Called when the add/edit modal closes and the flow should return to the main chat. */
  onReturnToMain?: () => void;
}

/**
 * Multi-provider settings UI backed by the revisioned local model catalog API.
 */
export function ModelWorkspaceSection(props: ModelWorkspaceSectionProps) {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useState(() => createModelWorkspace(props.seedConfig));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savePending, setSavePending] = useState(false);
  const saveInFlightRef = useRef(false);
  const hasMutatedRef = useRef(false);
  const [testStates, setTestStates] = useState<Record<string, StoredConnectionTestState>>({});
  const space = workspace.spaces[props.mode];
  const textCandidates = getModelCandidates(workspace, props.mode, "chat");
  const memorySummaryCandidates = getModelCandidates(workspace, props.mode, "memorySummary");
  const memoryEvolutionCandidates = getModelCandidates(workspace, props.mode, "memoryEvolution");
  const embeddingCandidates = getModelCandidates(workspace, props.mode, "embedding");
  const asrCandidates = getModelCandidates(workspace, props.mode, "asr");
  const imageCandidates = getModelCandidates(workspace, props.mode, "image");

  function commitWorkspace(next: typeof workspace, onSaved?: (savedWorkspace: typeof workspace) => void): boolean {
    if (saveInFlightRef.current) return false;
    setWorkspace(next);
    setSaveError(null);
    hasMutatedRef.current = true;
    if (props.configClient) {
      saveInFlightRef.current = true;
      setSavePending(true);
      void (async () => {
        try {
          const saved = await props.configClient!.saveModelCatalog(modelConfigInput(next));
          const savedWorkspace = createModelWorkspace(saved);
          setWorkspace(savedWorkspace);
          props.onConfigSaved?.(saved);
          onSaved?.(savedWorkspace);
        } catch (error) {
          setSaveError(modelWorkspaceErrorText(error, t));
          try {
            const latest = await props.configClient!.getModelConfig();
            setWorkspace(createModelWorkspace(latest));
            props.onConfigSaved?.(latest);
          } catch {
            // Keep the optimistic workspace visible when even the conflict reload is unavailable.
          }
        } finally {
          saveInFlightRef.current = false;
          setSavePending(false);
        }
      })();
    } else {
      onSaved?.(next);
    }
    return true;
  }

  useEffect(() => {
    if (!saveInFlightRef.current) setWorkspace(createModelWorkspace(props.seedConfig));
  }, [props.seedConfig]);

  useEffect(() => {
    if (!props.configClient) return;
    let active = true;
    void props.configClient.getModelConfig().then((saved) => {
      if (!active || hasMutatedRef.current) return;
      setWorkspace(createModelWorkspace(saved));
      props.onConfigSaved?.(saved);
    }).catch((error) => setSaveError(modelWorkspaceErrorText(error, t)));
    return () => { active = false; };
  }, [props.configClient]);

  function updateAssignment(kind: ModelAssignmentKind, candidateId: string) {
    commitWorkspace(setModelAssignment(workspace, props.mode, kind, candidateId));
  }

  function chooseDefaultAgentModel(candidateId: string) {
    commitWorkspace(setDefaultAgentModel(workspace, props.mode, candidateId));
  }

  const defaultChatOptions: SelectOption[] = [
    ...textCandidates.filter((candidate) => candidate.source === "platform"),
    ...textCandidates.filter((candidate) => candidate.source === "byok")
  ].map((candidate) => {
    const providerLabel = candidate.source === "platform"
      ? t("settings.modelWorkspace.platformName")
      : connectionProtocolLabel(candidate.provider, t);
    const modelLabel = candidate.source === "platform"
      ? t("home.modelSelector.platformAgent")
      : candidate.model;
    return {
      value: candidate.id,
      label: `${providerLabel} · ${modelLabel}`,
      selectedLabel: modelLabel
    };
  });

  const memorySummaryOptions = memorySummaryCandidates.map((candidate) => candidateOption(
    candidate.id,
    candidate.source === "platform" ? t("settings.modelWorkspace.platformName") : connectionProtocolLabel(candidate.provider, t),
    candidate.source === "platform" ? platformModelName(candidate.capability, t) : candidate.model,
    candidate.source === "platform" ? t("settings.modelWorkspace.platformModels") : t("settings.modelWorkspace.byokConnections"),
    candidate.source,
    candidate.provider
  ));
  const memoryEvolutionOptions = memoryEvolutionCandidates.map((candidate) => candidateOption(
    candidate.id,
    candidate.source === "platform" ? t("settings.modelWorkspace.platformName") : connectionProtocolLabel(candidate.provider, t),
    candidate.source === "platform" ? platformModelName(candidate.capability, t) : candidate.model,
    candidate.source === "platform" ? t("settings.modelWorkspace.platformModels") : t("settings.modelWorkspace.byokConnections"),
    candidate.source,
    candidate.provider
  ));
  const customEmbeddingOptions = embeddingCandidates
    .filter((candidate) => candidate.source === "byok")
    .map((candidate) => candidateOption(
      candidate.id,
      connectionProtocolLabel(candidate.provider, t),
      candidate.model,
      t("settings.modelWorkspace.byokConnections"),
      candidate.source,
      candidate.provider
    ));
  const cloudEmbeddingOptions = props.mode === "account"
    ? embeddingCandidates
        .filter((candidate) => candidate.source === "platform")
        .map((candidate): SelectOption => ({
          value: candidate.id,
          label: t("settings.modelWorkspace.platformEmbedding"),
          selectedLabel: t("settings.modelWorkspace.platformEmbedding"),
          groupLabel: t("settings.modelWorkspace.platformModels"),
          icon: <ModelProviderLogo provider="memmy" size={16} />
        }))
    : [];
  const asrOptions = asrCandidates.map((candidate) => candidateOption(
    candidate.id,
    candidate.source === "platform"
      ? t("settings.modelWorkspace.platformName")
      : connectionProtocolLabel(candidate.provider, t),
    candidate.source === "platform" ? platformModelName(candidate.capability, t) : candidate.model,
    candidate.source === "platform"
      ? t("settings.modelWorkspace.platformModels")
      : t("settings.modelWorkspace.byokConnections"),
    candidate.source,
    candidate.provider
  ));
  const imageOptions = imageCandidates.map((candidate) => candidateOption(
    candidate.id,
    candidate.source === "platform"
      ? t("settings.modelWorkspace.platformName")
      : connectionProtocolLabel(candidate.provider, t),
    candidate.source === "platform" ? platformModelName(candidate.capability, t) : candidate.model,
    candidate.source === "platform"
      ? t("settings.modelWorkspace.platformModels")
      : t("settings.modelWorkspace.byokConnections"),
    candidate.source,
    candidate.provider
  ));
  const embeddingOptions: SelectOption[] = [
    {
      value: BUILTIN_LOCAL_EMBEDDING_ASSIGNMENT_ID,
      label: t("settings.modelWorkspace.localEmbedding"),
      selectedLabel: t("settings.modelWorkspace.localEmbeddingShort"),
      groupLabel: t("settings.modelWorkspace.platformModels"),
      icon: <ModelProviderLogo provider="memmy" size={16} />
    },
    ...cloudEmbeddingOptions,
    ...customEmbeddingOptions
  ];
  const embeddingAssignment = space.assignments.embedding
    ?? (props.mode === "byok" ? BUILTIN_LOCAL_EMBEDDING_ASSIGNMENT_ID : undefined);

  return (
    <div className="model-workspace-layout" aria-busy={savePending}>
      {props.onFinishSetup && (
        <div className="flex items-center justify-between gap-4 rounded-card border border-action-sky/15 bg-action-sky/5 px-4 py-3">
          <p className="text-xs leading-relaxed text-text-ink/55">
            {t("settings.modelWorkspace.onboardingContinueHint")}
          </p>
          <button
            type="button"
            onClick={props.onFinishSetup}
            className="shrink-0 text-xs text-action-sky transition-colors cursor-pointer hover:text-action-sky-hover"
          >
            {t("apiKey.startUsing")}
          </button>
        </div>
      )}
      <div>
      <ModelLibrarySection
        mode={props.mode}
        workspace={workspace}
        space={space}
        commitWorkspace={commitWorkspace}
        savePending={savePending}
        saveError={saveError}
        testStates={testStates}
        setTestStates={setTestStates}
        configClient={props.configClient}
        setSaveError={setSaveError}
        autoOpenAddConnection={props.autoOpenAddConnection}
        onReturnToMain={props.onReturnToMain}
      />

      {saveError && (
        <div className="mt-2 mb-5 flex items-center gap-2 rounded-card bg-status-error-soft px-3 py-2 text-xs text-status-error" role="alert">
          <AlertTriangle size={13} aria-hidden="true" />
          {saveError}
        </div>
      )}

      <ModelAssignmentSection
        defaultModel={{
          label: t("settings.model.defaultModel"),
          hint: t("settings.modelWorkspace.defaultChatModelHint"),
          value: space.defaultAgentModelId,
          options: defaultChatOptions,
          onChange: chooseDefaultAgentModel
        }}
        rows={[
          { kind: "memorySummary", label: t("settings.model.memorySummary"), description: t("settings.model.memoryDesc"), tip: t("apiKey.modelPage.memoryHint"), value: space.assignments.memorySummary, options: memorySummaryOptions },
          { kind: "memoryEvolution", label: t("settings.model.skillEvolution"), description: t("settings.model.skillDesc"), value: space.assignments.memoryEvolution, options: memoryEvolutionOptions },
          { kind: "embedding", label: t("settings.model.embeddingSearch"), description: t("settings.model.embeddingDesc"), value: embeddingAssignment, options: embeddingOptions, preserveUnassigned: props.mode === "account" },
          { kind: "asr", label: t("settings.model.asr"), description: t("settings.model.asrDesc"), badge: t("settings.modelWorkspace.optional"), value: space.assignments.asr, options: asrOptions },
          { kind: "image", label: t("settings.model.imageGen"), description: t("settings.model.imageGenDesc"), badge: t("settings.modelWorkspace.optional"), value: space.assignments.image, options: imageOptions }
        ]}
        onRowChange={updateAssignment}
      />
      </div>
    </div>
  );
}

function candidateOption(
  value: string,
  providerLabel: string,
  model: string,
  groupLabel: string,
  source: "platform" | "byok" = "byok",
  providerId?: string
): SelectOption {
  return {
    value,
    label: `${providerLabel} · ${model}`,
    selectedLabel: model,
    groupLabel,
    icon: (
      <ModelProviderLogo
        provider={source === "platform" ? "memmy" : (providerId ?? providerLabel)}
        size={16}
      />
    )
  };
}

function platformModelName(
  capability: ModelCapability,
  t: ReturnType<typeof useTranslation>["t"]
): string {
  return t(modelCapabilityMessageKey(capability));
}

function modelWorkspaceErrorText(
  error: unknown,
  t: ReturnType<typeof useTranslation>["t"]
): string {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "model_config_changed") return t("settings.model.configChanged");
  if (code === "config_write_busy") return t("settings.modelWorkspace.saveBusy");
  return error instanceof Error && error.message
    ? error.message
    : t("settings.modelWorkspace.saveFailed");
}
