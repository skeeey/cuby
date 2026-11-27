import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "../i18n/use-translation.js";
import type { AppPageTarget } from "../state/apps-slice.js";
import { useAppState } from "../state/app-state.js";

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
        if (!cancelled) setError(errorMessage(ensureError));
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
        if (!cancelled) setError(errorMessage(sendError));
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
      setError(errorMessage(sendError));
    } finally {
      setSending(false);
    }
  };

  return (
    <aside
      className="cuby-app-chat-panel flex h-full w-[380px] max-w-[48%] min-w-0 shrink-0 flex-col border-l border-border-stone bg-background-paper"
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
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length ? messages.map((message) => (
          <div key={message.id} className="cuby-app-chat-panel__message text-[13px]">
            <div className="mb-0.5 text-[10px] uppercase tracking-wide text-text-ink/40">{panelMessageMeta(message)}</div>
            <div className={`whitespace-pre-wrap break-words ${message.role === "user" ? "text-text-ink" : "text-text-ink/75"}`}>
              {message.content}
            </div>
          </div>
        )) : (
          <div className="text-xs text-text-ink/45">{t("app.chat.empty")}</div>
        )}
      </div>
      <div className="flex items-end gap-2 border-t border-border-stone p-2">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={2}
          placeholder={t("app.chat.placeholder")}
          className="min-h-[38px] flex-1 resize-none rounded-btn border border-border-stone bg-canvas-oat/40 px-2 py-1.5 text-[13px] text-text-ink outline-none"
        />
        <button
          type="button"
          disabled={!draft.trim() || !props.onSendUserMessage || sending}
          onClick={() => void submit()}
          className="rounded-btn bg-action-sky px-3 py-1.5 text-xs text-white disabled:opacity-50"
        >
          {t("app.chat.send")}
        </button>
      </div>
    </aside>
  );
}
