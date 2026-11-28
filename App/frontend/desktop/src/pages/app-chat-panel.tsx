import { useEffect, useRef, useState } from "react";
import { Send, X } from "lucide-react";
import { useTranslation } from "../i18n/use-translation.js";
import type { AppPageTarget } from "../state/apps-slice.js";
import { useAppState } from "../state/app-state.js";
import { AgentThreadMessages } from "./agent-thread-messages.js";

export interface AppChatPanelProps {
  open: boolean;
  appName: string;
  chatId: string | null;
  pendingAppMessage?: string | null;
  onClose: () => void;
  onEnsureChat: () => Promise<string>;
  onAppMessage: (chatId: string, content: string) => Promise<void>;
  onSendUserMessage?: (chatId: string, content: string) => Promise<void>;
  onPendingAppMessageConsumed?: () => void;
}

export async function ensurePanelChat(input: {
  target: Pick<AppPageTarget, "origin" | "chatId">;
  newChat: () => Promise<string>;
}): Promise<string> {
  if (input.target.origin === "chat" && input.target.chatId) {
    return input.target.chatId;
  }
  return input.newChat();
}

export function panelErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const detail = (error as { detail?: unknown }).detail;
    const reason = (error as { reason?: unknown }).reason;
    if (typeof detail === "string" && detail) {
      return typeof reason === "string" && reason ? `${detail}: ${reason}` : detail;
    }
    return error.message;
  }
  return String(error);
}

export function panelMessageMeta(message: { role: string; appId?: string; appControlled?: boolean }): string {
  return `${message.role}${message.appId ? ` · ${message.appId}` : ""}`;
}

export function AppChatPanel(props: AppChatPanelProps) {
  const { state } = useAppState();
  const { t } = useTranslation();
  const [resolvedChatId, setResolvedChatId] = useState<string | null>(props.chatId);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const sentPendingRef = useRef<string | null>(null);
  const currentChatId = props.chatId ?? resolvedChatId;

  useEffect(() => {
    if (!props.open) return;
    if (props.chatId) {
      setResolvedChatId(props.chatId);
      return;
    }
    let cancelled = false;
    setError(null);
    void props.onEnsureChat()
      .then((chatId) => {
        if (!cancelled) setResolvedChatId(chatId);
      })
      .catch((ensureError) => {
        if (!cancelled) setError(panelErrorMessage(ensureError));
      });
    return () => {
      cancelled = true;
    };
  }, [props.open, props.chatId, props.onEnsureChat]);

  useEffect(() => {
    if (!props.pendingAppMessage) {
      sentPendingRef.current = null;
    }
  }, [props.pendingAppMessage]);

  useEffect(() => {
    if (!props.open || !props.pendingAppMessage || !currentChatId) return;
    if (sentPendingRef.current === props.pendingAppMessage) return;
    sentPendingRef.current = props.pendingAppMessage;
    let cancelled = false;
    setSending(true);
    void props.onAppMessage(currentChatId, props.pendingAppMessage)
      .then(() => {
        if (!cancelled) props.onPendingAppMessageConsumed?.();
      })
      .catch((sendError) => {
        if (!cancelled) setError(panelErrorMessage(sendError));
      })
      .finally(() => {
        if (!cancelled) setSending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    props.open,
    props.pendingAppMessage,
    currentChatId,
    props.onAppMessage,
    props.onPendingAppMessageConsumed
  ]);

  if (!props.open) return null;

  const messages = currentChatId
    ? currentChatId === state.agent.currentChatId
      ? state.agent.messages
      : state.agent.messagesByChatId[currentChatId] ?? []
    : [];

  const submit = async (): Promise<void> => {
    const content = draft.trim();
    if (!content || !currentChatId || !props.onSendUserMessage) return;
    setDraft("");
    setSending(true);
    setError(null);
    try {
      await props.onSendUserMessage(currentChatId, content);
    } catch (sendError) {
      setError(panelErrorMessage(sendError));
    } finally {
      setSending(false);
    }
  };

  return (
    <aside
      className="cuby-app-chat-panel flex h-full w-full min-w-0 flex-col bg-background-paper"
      aria-label={`${props.appName} ${t("app.chat.panelTitle")}`}
    >
      <header className="flex items-center gap-2 border-b border-border-stone px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-ink">
          {props.appName} · {t("app.chat.panelTitle")}
        </span>
        <button
          type="button"
          aria-label={t("common.close")}
          title={t("common.close")}
          onClick={props.onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-btn text-text-ink/55 hover:bg-canvas-oat"
        >
          <X size={14} />
        </button>
      </header>
      {error ? <div className="px-3 py-2 text-xs text-status-error">{error}</div> : null}
      <div className="cuby-app-chat-panel__scroll min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="agent-conversation-content space-y-3">
          {messages.length ? (
            <AgentThreadMessages
              chatScopeKey={currentChatId ?? "app-chat"}
              chatId={currentChatId}
              messages={messages}
              isSending={state.agent.isSending}
            />
          ) : (
            <div className="py-8 text-center text-xs text-text-ink/45">{t("app.chat.empty")}</div>
          )}
        </div>
      </div>
      <div className="border-t border-border-stone p-2">
        <div className="agent-composer-shell agent-composer-shell--expanded rounded-card-lg">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={1}
            placeholder={t("app.chat.placeholder")}
            className="agent-composer-input--conversation block w-full resize-none rounded-card-lg bg-background-paper py-3 pl-4 pr-3 text-sm focus:outline-none placeholder:text-text-ink/40"
          />
          <div className="agent-composer-toolbar">
            <div className="agent-composer-toolbar__leading" />
            <div className="composer-actions">
              <button
                type="button"
                disabled={!draft.trim() || !props.onSendUserMessage || !currentChatId || sending}
                onClick={() => void submit()}
                aria-label={t("app.chat.send")}
                title={t("app.chat.send")}
                className={`composer-action-submit ${
                  !draft.trim() || !props.onSendUserMessage || !currentChatId || sending
                    ? "bg-text-ink/25 text-white cursor-not-allowed"
                    : "bg-action-sky text-white hover:bg-action-sky-hover shadow-sm cursor-pointer"
                }`}
              >
                <Send size={14} className="translate-y-[1px]" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
