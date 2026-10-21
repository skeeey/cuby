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
  const candidates = getModelCandidates(workspace, props.mode, "chat");
  const committedSelection = state.agent.committedModelSelectionByScope[props.scopeKey];
  const pendingPreset = state.agent.pendingPresetByScope[props.scopeKey];
  const selectedPreset = pendingPreset
    ?? committedSelection?.presetId
    ?? null;
  const resolved = resolveModelSelection(workspace, props.mode, selectedPreset);
  const hasNoModels = candidates.length === 0 && !resolved.candidate;

  const optionForCandidate = (candidate: (typeof candidates)[number]): SelectOption => ({
        value: candidate.id,
        label: candidate.source === "platform" ? t("home.modelSelector.platformAgent") : candidate.model,
        selectedLabel: candidate.source === "platform" ? t("home.modelSelector.platformAgent") : candidate.model,
        icon: <ModelProviderIcon source={candidate.source} provider={candidate.provider} />
  });
  const options: SelectOption[] = candidates.map(optionForCandidate);
  if (resolved.unavailable && resolved.candidateId) {
    const unavailableModel = committedSelection?.model ?? resolved.previousModel ?? t("home.modelSelector.unavailableOption");
    const unavailableOption: SelectOption = {
      value: resolved.candidateId,
      label: unavailableModel,
      selectedLabel: unavailableModel,
      icon: committedSelection?.provider || resolved.previousProvider
        ? <ModelProviderIcon
            source={committedSelection?.source === "account" ? "platform" : "byok"}
            provider={committedSelection?.provider ?? resolved.previousProvider!}
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
        placeholder={hasNoModels && !resolved.unavailable
          ? t("home.modelSelector.emptyState")
          : t("home.modelSelector.empty")}
        options={options}
        onValueChange={selectModel}
        disabled={props.disabled}
        className="select-control--compact select-control--subtle agent-model-selector__control"
        buttonClassName="agent-model-selector__button"
        menuClassName="agent-model-selector__menu"
      />
    </div>
  );
}

function ModelProviderIcon(props: { source: "platform" | "byok"; provider: string }) {
  if (props.source === "platform") {
    return <ModelProviderLogo provider="memmy" className="agent-model-selector__provider-logo" size={15} />;
  }
  return <ModelProviderLogo provider={props.provider} className="agent-model-selector__provider-logo" size={15} />;
}
