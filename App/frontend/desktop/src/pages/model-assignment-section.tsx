import { Check, ChevronDown, ChevronUp, Info, Wrench } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";
import { SearchableSelect } from "../components/searchable-select.js";
import { Select, type SelectOption } from "../components/Select.js";
import { Tooltip } from "../components/tooltip.js";
import { useTranslation } from "../i18n/use-translation.js";
import type { ModelAssignmentKind } from "../state/model-workspace.js";

/** One selectable conversation model offered in the picker. */
export interface AssignmentCandidate {
  id: string;
  label: string;
  detail?: string;
}

/** One titled group of conversation models in the picker. */
export interface AssignmentCandidateGroup {
  key: string;
  title: string;
  icon?: ReactNode;
  candidates: AssignmentCandidate[];
}

/** One assignable purpose and the model choices offered for it. */
export interface ModelAssignmentRowSpec {
  kind: ModelAssignmentKind;
  label: string;
  description: string;
  tip?: string;
  badge?: string;
  value: string | undefined;
  options: SelectOption[];
  preserveUnassigned?: boolean;
  /** Renders a searchable dropdown instead of the plain Select (long model lists). */
  searchable?: boolean;
  testStatus?: ModelAssignmentTestStatus;
}

/** Result of the unified connection test for one assignment row. */
export interface ModelAssignmentTestStatus {
  status: "testing" | "success" | "error" | "skipped";
  message?: string;
}

export interface ModelAssignmentSectionProps {
  /** Multi-select conversation models for flows that still import a remote model list. */
  conversationGroups?: AssignmentCandidateGroup[];
  selectedCandidateIds?: string[];
  defaultCandidateId?: string | null;
  onToggleCandidate?(candidateId: string): void;
  onChooseDefaultCandidate?(candidateId: string): void;
  /** Single default-model picker: every chat model in the catalog is selectable. */
  defaultModel?: DefaultModelPickerSpec;
  /** Unified connection test across the assigned chat models. */
  testAll?: {
    label: string;
    pending: boolean;
    onTest: () => void;
    disabled?: boolean;
  };
  rows: ModelAssignmentRowSpec[];
  onRowChange(kind: ModelAssignmentKind, value: string): void;
  /** Disables the picker and every row control, for a caller with a save in flight. */
  disabled?: boolean;
}

/** One default-model dropdown row: the value new conversations start with. */
export interface DefaultModelPickerSpec {
  label: string;
  hint?: string;
  value: string | null;
  options: SelectOption[];
  onChange: (value: string) => void;
  testStatus?: ModelAssignmentTestStatus;
}

/** Conversation-model picker plus one row per assignable purpose. */
export function ModelAssignmentSection(props: ModelAssignmentSectionProps): ReactNode {
  const { t } = useTranslation();
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);
  const conversationGroups = props.conversationGroups ?? [];
  const showsConversationPicker = props.conversationGroups !== undefined;
  const selectedCandidateIds = props.selectedCandidateIds ?? [];
  const candidatesById = new Map(
    conversationGroups
      .flatMap((group) => group.candidates)
      .map((candidate) => [candidate.id, candidate])
  );
  const selectedCandidates = selectedCandidateIds
    .map((candidateId) => candidatesById.get(candidateId))
    .filter((candidate): candidate is AssignmentCandidate => Boolean(candidate));
  const selectedTaskModelsText = selectedCandidates.length > 0
    ? selectedCandidates.map((candidate) => candidate.label).join("、")
    : t("settings.modelWorkspace.notConfigured");
  const hasConversationCandidates = conversationGroups
    .some((group) => group.candidates.length > 0);

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wrench size={16} className="text-text-ink/60" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-text-ink">{t("settings.modelWorkspace.bindingTitle")}</h3>
        </div>
        {props.testAll && (
          <button
            type="button"
            disabled={props.disabled || props.testAll.disabled || props.testAll.pending}
            onClick={props.testAll.onTest}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-btn bg-action-sky/10 px-2.5 py-1 text-xs text-action-sky transition-colors hover:bg-action-sky/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {props.testAll.pending ? t("settings.modelWorkspace.testing") : props.testAll.label}
          </button>
        )}
      </div>
      <div className="bg-background-paper rounded-card-lg border-content-panel p-6">
        <p className="text-xs leading-relaxed text-text-ink/45">
          {t("settings.modelWorkspace.bindingHint")}
        </p>
        <div className="mt-2 space-y-1">
        {props.defaultModel && (
          <div className="flex items-center justify-between gap-4 bg-action-sky/5 px-3.5 py-3">
            <div className="min-w-0">
              <p className="model-assignment-label">{props.defaultModel.label}</p>
              {props.defaultModel.hint && (
                <p className="mt-0.5 text-[11px] text-text-ink/45">{props.defaultModel.hint}</p>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <SearchableSelect
                label={t("settings.modelWorkspace.chooseFor", { feature: props.defaultModel.label })}
                value={props.defaultModel.value ?? ""}
                placeholder={t("settings.modelWorkspace.notConfigured")}
                searchPlaceholder={t("settings.cuberouterModel.searchModels")}
                options={props.defaultModel.options}
                onValueChange={props.defaultModel.onChange}
                disabled={props.disabled || props.defaultModel.options.length === 0}
                className="select-control--compact select-control--subtle model-assignment-select"
                menuClassName="model-assignment-select__menu"
              />
              <AssignmentTestStatusLabel status={props.defaultModel.testStatus} />
            </div>
          </div>
        )}
        {showsConversationPicker && (
        <>
        <div className="flex items-center justify-between gap-4 bg-action-sky/5 px-3.5 py-3">
          <div className="min-w-0">
            <p className="text-sm text-text-ink/80">{t("settings.modelWorkspace.conversationModels")}</p>
            <p className="mt-0.5 text-[11px] text-text-ink/45">
              {t("settings.modelWorkspace.taskSelectionHint")}
            </p>
            <p className="task-model-selection-summary" title={selectedTaskModelsText}>
              {t("settings.modelWorkspace.taskSelectedModels", { models: selectedTaskModelsText })}
            </p>
          </div>
          <button
            type="button"
            aria-expanded={taskPickerOpen}
            disabled={props.disabled || !hasConversationCandidates}
            onClick={() => setTaskPickerOpen((open) => !open)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-btn bg-action-sky/10 px-2.5 py-1 text-xs text-action-sky transition-colors hover:bg-action-sky/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("settings.modelWorkspace.taskSelectedCount", { count: selectedCandidateIds.length })}
            {taskPickerOpen
              ? <ChevronUp size={12} aria-hidden="true" />
              : <ChevronDown size={12} aria-hidden="true" />}
          </button>
        </div>
        {taskPickerOpen && (
          <div className="task-model-picker">
            {conversationGroups.map((group) => {
              if (group.candidates.length === 0) return null;
              return (
                <div key={group.key} className="task-model-picker__group">
                  <div className="task-model-picker__group-title">
                    {group.icon}
                    {group.title}
                  </div>
                  {group.candidates.map((candidate) => {
                    const selected = selectedCandidateIds.includes(candidate.id);
                    const lastSelected = selected && selectedCandidateIds.length === 1;
                    const isDefault = props.defaultCandidateId === candidate.id;
                    return (
                      <div key={candidate.id} className="task-model-picker__option">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={selected}
                          disabled={props.disabled || lastSelected}
                          title={lastSelected ? t("settings.modelWorkspace.taskAtLeastOne") : undefined}
                          onClick={() => props.onToggleCandidate?.(candidate.id)}
                          className="task-model-picker__choice"
                        >
                        <span className={`task-model-picker__checkbox${selected ? " is-selected" : ""}`}>
                          {selected && <Check size={11} strokeWidth={3} aria-hidden="true" />}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-left">
                          {candidate.label}
                        </span>
                        <span className="shrink-0 text-[10px] text-text-ink/40">
                          {candidate.detail}
                        </span>
                        </button>
                        {selected && (
                          <button
                            type="button"
                            aria-pressed={isDefault}
                            disabled={props.disabled}
                            onClick={() => props.onChooseDefaultCandidate?.(candidate.id)}
                            className="task-model-picker__default-button shrink-0"
                          >
                            {isDefault
                              ? t("settings.modelWorkspace.defaultModel")
                              : t("settings.modelWorkspace.setDefaultModel")}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
        </>
        )}
        {props.rows.map((row) => (
          <Fragment key={row.kind}>
            <div className="h-px bg-border-stone/30" />
            <AssignmentRow
              kind={row.kind}
              label={row.label}
              description={row.description}
              tip={row.tip}
              badge={row.badge}
              value={row.value}
              options={row.options}
              onChange={props.onRowChange}
              preserveUnassigned={row.preserveUnassigned}
              searchable={row.searchable}
              disabled={props.disabled}
              testStatus={row.testStatus}
            />
          </Fragment>
        ))}
        </div>
      </div>
    </section>
  );
}

function AssignmentRow(props: {
  kind: ModelAssignmentKind;
  label: string;
  description: string;
  tip?: string;
  badge?: string;
  value: string | undefined;
  options: SelectOption[];
  onChange: (kind: ModelAssignmentKind, value: string) => void;
  preserveUnassigned?: boolean;
  searchable?: boolean;
  disabled?: boolean;
  testStatus?: ModelAssignmentTestStatus;
}) {
  const { t } = useTranslation();
  const optionExists = props.options.some((option) => option.value === props.value);
  const value = optionExists
    ? props.value!
    : props.preserveUnassigned
      ? ""
      : props.options[0]?.value ?? "";
  return (
    <div className="flex items-center justify-between gap-4 px-3.5 py-2.5">
      <div className="min-w-0">
        <div className="model-assignment-label-row">
          <span className="model-assignment-label">{props.label}</span>
          {props.tip ? (
            <Tooltip content={props.tip}>
              <button
                type="button"
                className="model-assignment-tip-icon"
                aria-label={props.tip}
              >
                <Info size={12} strokeWidth={1.9} aria-hidden="true" />
              </button>
            </Tooltip>
          ) : null}
          {props.badge && (
            <span className="rounded-tag bg-canvas-oat px-2 py-0.5 text-[10px] text-text-ink/50">
              {props.badge}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] text-text-ink/45">{props.description}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {props.searchable ? (
          <SearchableSelect
            label={t("settings.modelWorkspace.chooseFor", { feature: props.label })}
            value={value}
            placeholder={t("settings.modelWorkspace.notConfigured")}
            searchPlaceholder={t("settings.cuberouterModel.searchModels")}
            options={props.options}
            onValueChange={(next) => props.onChange(props.kind, next)}
            disabled={props.disabled || props.options.length === 0}
            className="select-control--compact select-control--subtle model-assignment-select"
            menuClassName="model-assignment-select__menu"
          />
        ) : (
          <Select
            label={t("settings.modelWorkspace.chooseFor", { feature: props.label })}
            labelClassName="sr-only"
            value={value}
            placeholder={t("settings.modelWorkspace.notConfigured")}
            options={props.options}
            onValueChange={(next) => props.onChange(props.kind, next)}
            disabled={props.disabled || props.options.length === 0}
            className="select-control--compact select-control--subtle model-assignment-select"
            menuClassName="model-assignment-select__menu"
          />
        )}
        <AssignmentTestStatusLabel status={props.testStatus} />
      </div>
    </div>
  );
}

function AssignmentTestStatusLabel(props: { status?: ModelAssignmentTestStatus }): ReactNode {
  const { t } = useTranslation();
  if (!props.status) return null;
  const text = props.status.status === "testing"
    ? t("settings.modelWorkspace.testing")
    : props.status.status === "success"
      ? t("settings.modelWorkspace.testSuccess")
      : props.status.status === "skipped"
        ? props.status.message ?? t("settings.modelWorkspace.notConfigured")
        : t("settings.modelWorkspace.testFailed");
  const tone = props.status.status === "success"
    ? "text-status-success"
    : props.status.status === "error"
      ? "text-status-error"
      : "text-text-ink/40";
  return (
    <span
      className={`model-assignment-test-status block max-w-[220px] truncate text-[10px] ${tone}`}
      title={props.status.message ?? text}
    >
      {text}
    </span>
  );
}
