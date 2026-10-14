/** MCP tools section module. */
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Plus, Server } from "lucide-react";
import type {
  McpCustomServerInput,
  McpPresetPayload,
  McpPresetsPayload,
  MemmyAgentClient
} from "../api/memmy-agent-client.js";
import type { MessageKey } from "../i18n/messages.js";
import { useTranslation } from "../i18n/use-translation.js";
import { McpCustomServerModal, McpServerModal } from "./mcp-server-modal.js";

export type McpPresetsClient = Pick<
  MemmyAgentClient,
  "listMcpPresets" | "enableMcpPreset" | "removeMcpServer" | "testMcpServer" | "addCustomMcpServer"
>;

export type McpSectionModal =
  | { kind: "closed" }
  | { kind: "install"; preset: McpPresetPayload }
  | { kind: "manage"; preset: McpPresetPayload }
  | { kind: "custom" };

export interface McpToolsSectionViewProps {
  status: "loading" | "ready" | "error";
  message?: string;
  presets: McpPresetPayload[];
  modal: McpSectionModal;
  busy: boolean;
  modalError: string;
  testResult: McpPresetsPayload["last_action"] | null;
  onOpenInstall: (preset: McpPresetPayload) => void;
  onOpenManage: (preset: McpPresetPayload) => void;
  onOpenCustom: () => void;
  onCloseModal: () => void;
  onSubmitInstall: (values: Record<string, string>) => void;
  onTestServer: (name: string) => void;
  onRemoveServer: (name: string) => void;
  onSubmitCustom: (input: McpCustomServerInput) => void;
}

/** Handles mcp tools section view. */
export function McpToolsSectionView(props: McpToolsSectionViewProps) {
  const { t } = useTranslation();
  const [devOpen, setDevOpen] = useState(false);
  const general = props.presets.filter((preset) => preset.group !== "dev");
  const dev = props.presets.filter((preset) => preset.group === "dev");

  return (
    <section className="mb-8">
      <div className="mb-4 flex items-center justify-between gap-2.5">
        <span className="text-base font-semibold text-text-ink">{t("tools.mcp.title")}</span>
        <button
          type="button"
          onClick={props.onOpenCustom}
          className="flex items-center gap-1.5 rounded-btn border border-content-panel bg-background-paper px-3 py-1.5 text-xs text-text-ink/65 transition-colors hover:bg-canvas-oat/40"
        >
          <Plus size={13} />
          {t("tools.mcp.customAdd")}
        </button>
      </div>

      {props.status === "loading" && <p className="text-sm text-text-ink/55">{t("common.loading")}</p>}
      {props.status === "error" && (
        <p className="rounded-card border-content-panel bg-background-paper p-4 text-sm text-text-ink/55">
          {props.message || t("tools.mcp.loadFailed")}
        </p>
      )}
      {props.status === "ready" && (
        <>
          <div className="tools-icon-grid">
            {general.map((preset) => (
              <McpServerCard
                key={preset.name}
                preset={preset}
                onOpen={preset.installed ? props.onOpenManage : props.onOpenInstall}
              />
            ))}
          </div>
          {dev.length > 0 && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setDevOpen((open) => !open)}
                className="flex items-center gap-1.5 text-xs text-text-ink/55 transition-colors hover:text-text-ink"
              >
                <ChevronDown size={13} className={devOpen ? "rotate-180 transition-transform" : "transition-transform"} />
                {t("tools.mcp.devGroup")} ({dev.length})
              </button>
              {devOpen && (
                <div className="tools-icon-grid mt-3">
                  {dev.map((preset) => (
                    <McpServerCard
                      key={preset.name}
                      preset={preset}
                      onOpen={preset.installed ? props.onOpenManage : props.onOpenInstall}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {(props.modal.kind === "install" || props.modal.kind === "manage") && (
        <McpServerModal
          mode={props.modal.kind}
          preset={props.modal.preset}
          busy={props.busy}
          error={props.modalError}
          testResult={props.testResult}
          onClose={props.onCloseModal}
          onSubmitInstall={props.onSubmitInstall}
          onTest={props.onTestServer}
          onRemove={props.onRemoveServer}
        />
      )}
      {props.modal.kind === "custom" && (
        <McpCustomServerModal busy={props.busy} error={props.modalError} onClose={props.onCloseModal} onSubmit={props.onSubmitCustom} />
      )}
    </section>
  );
}

function McpServerCard(props: { preset: McpPresetPayload; onOpen: (preset: McpPresetPayload) => void }) {
  const { t } = useTranslation();
  const label = t(mcpStatusKey(props.preset.status));

  return (
    <button
      type="button"
      className={`integration-card rounded-card integration-card-integration ${mcpCardStatusClass(props.preset.status)}`}
      title={props.preset.description}
      aria-label={`${props.preset.display_name}, ${label}.`}
      onClick={() => props.onOpen(props.preset)}
    >
      {props.preset.logo_url ? (
        <img src={props.preset.logo_url} alt="" className="integration-card-logo" />
      ) : (
        <span className="integration-card-logo flex items-center justify-center text-text-ink/45">
          <Server size={20} />
        </span>
      )}
      <span className="integration-card-content">
        <span className="integration-card-name">{props.preset.display_name}</span>
        <span className={`integration-card-state-label ${mcpStatusTextClass(props.preset.status)}`}>{label}</span>
      </span>
    </button>
  );
}

/** Handles mcp status key. */
export function mcpStatusKey(status: string): MessageKey {
  switch (status) {
    case "configured":
      return "tools.mcp.status.configured";
    case "missing_credentials":
      return "tools.mcp.status.missingCredentials";
    case "missing_dependency":
      return "tools.mcp.status.missingDependency";
    case "coming_soon":
      return "tools.mcp.status.comingSoon";
    default:
      return "tools.mcp.status.notInstalled";
  }
}

function mcpCardStatusClass(status: string): string {
  if (status === "configured") {
    return "integration-card-status-connected";
  }
  if (status === "missing_credentials" || status === "missing_dependency") {
    return "integration-card-status-error";
  }
  return "integration-card-status-default";
}

function mcpStatusTextClass(status: string): string {
  if (status === "configured") {
    return "text-status-success";
  }
  if (status === "missing_credentials" || status === "missing_dependency") {
    return "text-status-error";
  }
  return "text-text-ink/45";
}

/** Handles mcp tools section. */
export function McpToolsSection(props: { client: McpPresetsClient | null }) {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; message?: string; presets: McpPresetPayload[] }>({
    status: "loading",
    presets: []
  });
  const [modal, setModal] = useState<McpSectionModal>({ kind: "closed" });
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState("");
  const [testResult, setTestResult] = useState<McpPresetsPayload["last_action"] | null>(null);

  const load = useCallback(async () => {
    if (!props.client) {
      setState({ status: "loading", presets: [] });
      return;
    }
    try {
      const payload = await props.client.listMcpPresets();
      setState({ status: "ready", presets: payload.presets });
    } catch (error) {
      setState({ status: "error", presets: [], message: error instanceof Error ? error.message : String(error) });
    }
  }, [props.client]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = useCallback(
    async (action: () => Promise<McpPresetsPayload>, options: { keepModal?: boolean } = {}) => {
      setBusy(true);
      setModalError("");
      try {
        const payload = await action();
        setState({ status: "ready", presets: payload.presets });
        setTestResult(payload.last_action ?? null);
        if (payload.last_action?.ok === false) {
          setModalError(payload.last_action.message ?? "");
        }
        if (!options.keepModal) {
          setModal({ kind: "closed" });
        }
      } catch (error) {
        setModalError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    []
  );

  return (
    <McpToolsSectionView
      status={state.status}
      message={state.message}
      presets={state.presets}
      modal={modal}
      busy={busy}
      modalError={modalError}
      testResult={testResult}
      onOpenInstall={(preset) => {
        setModalError("");
        setTestResult(null);
        setModal({ kind: "install", preset });
      }}
      onOpenManage={(preset) => {
        setModalError("");
        setTestResult(null);
        setModal({ kind: "manage", preset });
      }}
      onOpenCustom={() => {
        setModalError("");
        setTestResult(null);
        setModal({ kind: "custom" });
      }}
      onCloseModal={() => setModal({ kind: "closed" })}
      onSubmitInstall={(values) => {
        if (modal.kind === "install" && props.client) {
          void runAction(() => props.client!.enableMcpPreset(modal.preset.name, values));
        }
      }}
      onTestServer={(name) => {
        if (props.client) {
          void runAction(() => props.client!.testMcpServer(name), { keepModal: true });
        }
      }}
      onRemoveServer={(name) => {
        if (props.client) {
          void runAction(() => props.client!.removeMcpServer(name));
        }
      }}
      onSubmitCustom={(input) => {
        if (props.client) {
          void runAction(() => props.client!.addCustomMcpServer(input));
        }
      }}
    />
  );
}
