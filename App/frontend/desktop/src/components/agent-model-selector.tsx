import { isTextChatModelId } from "@memmy/local-api-contracts";
import type { ModelProviderConfig } from "../api/config-client.js";
import { useTranslation } from "../i18n/use-translation.js";
import { agentActions } from "../state/app-actions.js";
import { useAppState } from "../state/app-state.js";
import {
  createModelWorkspace,
  getModelCandidates,
  resolveModelSelection,
  type ModelWorkspaceMode
} from "../state/model-workspace.js";
import { ModelProviderLogo } from "./model-provider-logo.js";
import { Select, type SelectOption } from "./Select.js";

export interface AgentModelSelectorProps {
  mode: ModelWorkspaceMode;
  scopeKey: string;
  disabled: boolean;
  seedConfig?: ModelProviderConfig | null;
  /**
   * Called when the user explicitly picks a model, so the caller can persist it as the
   * mode default (remembered for new chats after restart). The per-chat selection is
   * still tracked separately in Agent state.
   */
  onDefaultModelSelected?: (candidateId: string) => void;
}

/** Per-chat catalog preset picker. Selection lives in Agent state, never browser storage. */
export function AgentModelSelector(props: AgentModelSelectorProps) {
  const { t } = useTranslation();
  const { state, dispatch } = useAppState();
  const workspace = createModelWorkspace(props.seedConfig ?? state.modelConfig);
  const candidates = getModelCandidates(workspace, props.mode, "chat")
    .filter((candidate) => isTextChatModelId(candidate.model));
  const committedSelection = state.agent.committedModelSelectionByScope[props.scopeKey];
  const pendingPreset = state.agent.pendingPresetByScope[props.scopeKey];
  const selectedPreset = pendingPreset
    ?? committedSelection?.presetId
    ?? null;
  const resolved = resolveModelSelection(workspace, props.mode, selectedPreset);
  // A stored selection that the text-chat filter hides still needs a disabled row in the menu,
  // so the trigger names the model the user has to switch away from.
  const resolvedIsListed = resolved.candidate !== null
    && candidates.some((candidate) => candidate.id === resolved.candidateId);
  const selectionUnavailable = resolved.unavailable || (resolved.candidateId !== null && !resolvedIsListed);
  const hasNoModels = candidates.length === 0 && !selectionUnavailable;

  const optionForCandidate = (candidate: (typeof candidates)[number]): SelectOption => ({
        value: candidate.id,
        label: candidate.source === "platform" ? t("home.modelSelector.platformAgent") : candidate.model,
        selectedLabel: candidate.source === "platform" ? t("home.modelSelector.platformAgent") : candidate.model,
        icon: <ModelProviderIcon source={candidate.source} provider={candidate.provider} model={candidate.model} />
  });
  const options: SelectOption[] = candidates.map(optionForCandidate);
  if (selectionUnavailable && resolved.candidateId) {
    const unavailableCandidate = resolved.candidate;
    const unavailableModel = committedSelection?.model
      ?? unavailableCandidate?.model
      ?? resolved.previousModel
      ?? t("home.modelSelector.unavailableOption");
    const unavailableProvider = committedSelection?.provider
      ?? unavailableCandidate?.provider
      ?? resolved.previousProvider;
    const unavailableSource = committedSelection?.source === "account"
      ? "platform"
      : committedSelection?.source === "byok"
        ? "byok"
        : unavailableCandidate?.source;
    const unavailableOption: SelectOption = {
      value: resolved.candidateId,
      label: unavailableModel,
      selectedLabel: unavailableModel,
      icon: unavailableProvider
        ? <ModelProviderIcon
            source={unavailableSource ?? "byok"}
            provider={unavailableProvider}
            model={unavailableModel}
          />
        : undefined,
      disabled: true
    };
    const firstCustomIndex = candidates.findIndex((candidate) => candidate.source === "byok");
    options.splice(firstCustomIndex >= 0 ? firstCustomIndex : options.length, 0, unavailableOption);
  }
  if (!options.length) {
    options.push({
      value: "__no_models__",
      label: t("home.modelSelector.emptyOption"),
      disabled: true
    });
  }

  function selectModel(candidateId: string) {
    dispatch(agentActions.pendingModelPresetUpdated(props.scopeKey, candidateId));
    props.onDefaultModelSelected?.(candidateId);
  }

  return (
    <div className="agent-model-selector" data-model-selector-scope={props.scopeKey}>
      <Select
        label={t("home.modelSelector.label")}
        labelClassName="sr-only"
        value={resolved.candidateId ?? ""}
        placeholder={hasNoModels && !selectionUnavailable
          ? t("home.modelSelector.emptyState")
          : t("home.modelSelector.empty")}
        options={options}
        onValueChange={selectModel}
        disabled={props.disabled}
        searchable
        searchPlaceholder={t("home.modelSelector.searchPlaceholder")}
        className="select-control--compact select-control--subtle agent-model-selector__control"
        buttonClassName="agent-model-selector__button"
        menuClassName="agent-model-selector__menu"
      />
    </div>
  );
}

function ModelProviderIcon(props: { source: "platform" | "byok"; provider: string; model?: string }) {
  if (props.source === "platform") {
    return <ModelProviderLogo provider="memmy" className="agent-model-selector__provider-logo" size={15} />;
  }
  return (
    <ModelProviderLogo
      provider={props.provider}
      model={props.model}
      className="agent-model-selector__provider-logo"
      size={15}
    />
  );
}
