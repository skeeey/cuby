/** MCP server modal module. */
import { useState } from "react";
import { X } from "lucide-react";
import type { McpCustomServerInput, McpPresetPayload, McpPresetsPayload } from "../api/memmy-agent-client.js";
import { useTranslation } from "../i18n/use-translation.js";

export interface McpServerModalProps {
  mode: "install" | "manage";
  preset: McpPresetPayload;
  busy: boolean;
  error: string;
  testResult: McpPresetsPayload["last_action"] | null;
  onClose: () => void;
  onSubmitInstall: (values: Record<string, string>) => void;
  onTest: (name: string) => void;
  onRemove: (name: string) => void;
}

/** Handles mcp server modal. */
export function McpServerModal(props: McpServerModalProps) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>({});

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-text-ink/30 backdrop-blur-sm" role="presentation" onClick={(event) => event.target === event.currentTarget && props.onClose()}>
      <div className="w-full max-w-md overflow-hidden rounded-card-lg border border-border-stone/30 bg-background-paper shadow-2xl">
        <header className="flex items-center justify-between border-b border-border-stone/30 px-4 py-3">
          <h2 className="text-sm font-semibold text-text-ink">
            {t(props.mode === "install" ? "tools.mcp.modal.installTitle" : "tools.mcp.modal.manageTitle", {
              name: props.preset.display_name
            })}
          </h2>
          <button type="button" onClick={props.onClose} aria-label={t("common.close")} className="text-text-ink/45 hover:text-text-ink">
            <X size={16} />
          </button>
        </header>
        <div className="space-y-3 px-4 py-4">
          {props.preset.requires && (
            <p className="text-xs text-text-ink/55">{t("tools.mcp.modal.requirements", { requirements: props.preset.requires })}</p>
          )}
          {props.preset.note && <p className="text-xs text-text-ink/55">{props.preset.note}</p>}

          {props.mode === "install" &&
            props.preset.required_fields.map((field) => (
              <label key={field.name} className="block space-y-1">
                <span className="text-xs text-text-ink/70">{field.label}</span>
                <input
                  type={field.secret ? "password" : "text"}
                  value={values[field.name] ?? ""}
                  placeholder={field.configured ? t("common.configured") : field.placeholder}
                  onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                  className="w-full rounded-input border-content-panel bg-background-paper px-3 py-2 text-sm focus:outline-none"
                />
              </label>
            ))}

          {props.mode === "manage" && (
            <>
              {props.preset.connection_summary && (
                <p className="break-all rounded-card border-content-panel bg-canvas-oat/30 px-3 py-2 text-xs text-text-ink/65">
                  {props.preset.connection_summary}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={props.busy}
                  onClick={() => props.onTest(props.preset.name)}
                  className="rounded-btn border border-content-panel bg-background-paper px-3 py-1.5 text-xs text-text-ink/70 hover:bg-canvas-oat/40 disabled:opacity-50"
                >
                  {t("tools.mcp.modal.test")}
                </button>
                <button
                  type="button"
                  disabled={props.busy}
                  onClick={() => props.onRemove(props.preset.name)}
                  className="rounded-btn border border-status-error/30 bg-status-error/10 px-3 py-1.5 text-xs text-status-error hover:bg-status-error/20 disabled:opacity-50"
                >
                  {t("tools.mcp.modal.remove")}
                </button>
              </div>
              {props.testResult?.message && (
                <p className={`text-xs ${props.testResult.ok === false ? "text-status-error" : "text-status-success"}`}>
                  {props.testResult.message}
                </p>
              )}
            </>
          )}

          {props.error && <p className="text-xs text-status-error">{props.error}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-border-stone/30 px-4 py-3">
          <button type="button" onClick={props.onClose} className="rounded-btn px-3 py-1.5 text-xs text-text-ink/65 hover:bg-canvas-oat/40">
            {t("common.cancel")}
          </button>
          {props.mode === "install" && (
            <button
              type="button"
              disabled={props.busy}
              onClick={() => props.onSubmitInstall(values)}
              className="rounded-btn bg-action-sky px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {t("tools.mcp.modal.install")}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

export interface McpCustomServerModalProps {
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (input: McpCustomServerInput) => void;
}

function parseLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseKeyValueLines(value: string): Record<string, string> {
  return Object.fromEntries(
    parseLines(value)
      .map((line) => {
        const index = line.indexOf("=");
        if (index <= 0) return null;
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      })
      .filter((entry): entry is [string, string] => entry !== null)
  );
}

/** Handles mcp custom server modal. */
export function McpCustomServerModal(props: McpCustomServerModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<McpCustomServerInput["transport"]>("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState("");
  const [cwd, setCwd] = useState("");
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState("");
  const [timeout, setTimeoutValue] = useState("30");
  const [validationError, setValidationError] = useState("");

  function submit() {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(name.trim())) {
      setValidationError(t("tools.mcp.custom.nameInvalid"));
      return;
    }
    if (transport === "stdio" && !command.trim()) {
      setValidationError(t("tools.mcp.custom.commandRequired"));
      return;
    }
    if (transport !== "stdio" && !url.trim()) {
      setValidationError(t("tools.mcp.custom.urlRequired"));
      return;
    }
    setValidationError("");

    const parsedTimeout = Number.parseInt(timeout, 10);
    const input: McpCustomServerInput = {
      name: name.trim().toLowerCase(),
      transport,
      ...(transport === "stdio" ? { command: command.trim() } : { url: url.trim() }),
      ...(parseLines(args).length ? { args: parseLines(args) } : {}),
      ...(Object.keys(parseKeyValueLines(env)).length ? { env: parseKeyValueLines(env) } : {}),
      ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
      ...(transport !== "stdio" && Object.keys(parseKeyValueLines(headers)).length
        ? { headers: parseKeyValueLines(headers) }
        : {}),
      tool_timeout: Number.isFinite(parsedTimeout) ? parsedTimeout : 30
    };
    props.onSubmit(input);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-text-ink/30 backdrop-blur-sm" role="presentation" onClick={(event) => event.target === event.currentTarget && props.onClose()}>
      <div className="w-full max-w-md overflow-hidden rounded-card-lg border border-border-stone/30 bg-background-paper shadow-2xl">
        <header className="flex items-center justify-between border-b border-border-stone/30 px-4 py-3">
          <h2 className="text-sm font-semibold text-text-ink">{t("tools.mcp.custom.title")}</h2>
          <button type="button" onClick={props.onClose} aria-label={t("common.close")} className="text-text-ink/45 hover:text-text-ink">
            <X size={16} />
          </button>
        </header>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto px-4 py-4">
          <label className="block space-y-1">
            <span className="text-xs text-text-ink/70">{t("tools.mcp.custom.name")}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-input border-content-panel bg-background-paper px-3 py-2 text-sm focus:outline-none" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-text-ink/70">{t("tools.mcp.custom.transport")}</span>
            <select value={transport} onChange={(event) => setTransport(event.target.value as McpCustomServerInput["transport"])} className="w-full rounded-input border-content-panel bg-background-paper px-3 py-2 text-sm focus:outline-none">
              <option value="stdio">stdio</option>
              <option value="sse">sse</option>
              <option value="streamableHttp">streamableHttp</option>
            </select>
          </label>
          {transport === "stdio" ? (
            <>
              <label className="block space-y-1">
                <span className="text-xs text-text-ink/70">{t("tools.mcp.custom.command")}</span>
                <input value={command} onChange={(event) => setCommand(event.target.value)} className="w-full rounded-input border-content-panel bg-background-paper px-3 py-2 text-sm focus:outline-none" />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-text-ink/70">{t("tools.mcp.custom.args")}</span>
                <textarea value={args} onChange={(event) => setArgs(event.target.value)} rows={3} className="w-full rounded-input border-content-panel bg-background-paper px-3 py-2 text-sm focus:outline-none" />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-text-ink/70">{t("tools.mcp.custom.cwd")}</span>
                <input value={cwd} onChange={(event) => setCwd(event.target.value)} className="w-full rounded-input border-content-panel bg-background-paper px-3 py-2 text-sm focus:outline-none" />
              </label>
            </>
          ) : (
            <>
              <label className="block space-y-1">
                <span className="text-xs text-text-ink/70">{t("tools.mcp.custom.url")}</span>
                <input value={url} onChange={(event) => setUrl(event.target.value)} className="w-full rounded-input border-content-panel bg-background-paper px-3 py-2 text-sm focus:outline-none" />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-text-ink/70">{t("tools.mcp.custom.headers")}</span>
                <textarea value={headers} onChange={(event) => setHeaders(event.target.value)} rows={2} className="w-full rounded-input border-content-panel bg-background-paper px-3 py-2 text-sm focus:outline-none" />
              </label>
            </>
          )}
          <label className="block space-y-1">
            <span className="text-xs text-text-ink/70">{t("tools.mcp.custom.env")}</span>
            <textarea value={env} onChange={(event) => setEnv(event.target.value)} rows={2} className="w-full rounded-input border-content-panel bg-background-paper px-3 py-2 text-sm focus:outline-none" />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-text-ink/70">{t("tools.mcp.custom.timeout")}</span>
            <input type="number" value={timeout} onChange={(event) => setTimeoutValue(event.target.value)} className="w-full rounded-input border-content-panel bg-background-paper px-3 py-2 text-sm focus:outline-none" />
          </label>
          {(validationError || props.error) && <p className="text-xs text-status-error">{validationError || props.error}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-border-stone/30 px-4 py-3">
          <button type="button" onClick={props.onClose} className="rounded-btn px-3 py-1.5 text-xs text-text-ink/65 hover:bg-canvas-oat/40">
            {t("common.cancel")}
          </button>
          <button type="button" disabled={props.busy} onClick={submit} className="rounded-btn bg-action-sky px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            {t("tools.mcp.custom.save")}
          </button>
        </footer>
      </div>
    </div>
  );
}
