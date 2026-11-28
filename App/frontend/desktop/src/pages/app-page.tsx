import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { MemmyAgentMessageRejectedError, type WebuiSessionTarget } from "../api/memmy-agent-client.js";
import { useOptionalAgentRuntimeBridge } from "../app/agent-runtime-bridge.js";
import {
  clearStoredAppPageTarget,
  readStoredAppPageTarget,
  writeStoredAppPageTarget
} from "../app/app-page-storage.js";
import { createAppBridgeTransport } from "../app/app-view-client.js";
import { AppViewHost } from "../app/app-view-host.js";
import { useTranslation } from "../i18n/use-translation.js";
import { agentActions, appActions, appsActions } from "../state/app-actions.js";
import type { AppPageTarget } from "../state/apps-slice.js";
import { useAppState } from "../state/app-state.js";
import { AppChatPanel } from "./app-chat-panel.js";
import { openPanelChat, sendPanelUserMessage } from "./app-page-chat.js";
import { SidebarResizeHandle, useResizableSidebar } from "./sidebar-resize.js";
import { AppFrame } from "./app-frame.js";

export interface AppPageViewProps {
  target: AppPageTarget | null;
  onReload: () => void;
  children?: ReactNode;
}

export function AppPageView(props: AppPageViewProps) {
  const { t } = useTranslation();
  if (!props.target) {
    return (
      <div className="cuby-app-page cuby-app-page--empty flex h-full items-center justify-center text-sm text-text-ink/55">
        {t("app.page.empty")}
      </div>
    );
  }
  return (
    <div className="cuby-app-page relative flex h-full min-h-0 w-full flex-col">
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
        <button
          type="button"
          aria-label={t("app.page.reload")}
          title={t("app.page.reload")}
          onClick={props.onReload}
          className="inline-flex h-7 w-7 items-center justify-center rounded-btn bg-background-paper/90 text-text-ink/55 shadow-sm hover:bg-canvas-oat"
        >
          <RotateCw size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1">{props.children}</div>
    </div>
  );
}

export function AppPage() {
  const { state, dispatch } = useAppState();
  const { t } = useTranslation();
  const bridge = useOptionalAgentRuntimeBridge();
  const target = state.navigation.appPage;
  const pageError = state.navigation.appPageError;
  const [reloadKey, setReloadKey] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelChatId, setPanelChatId] = useState<string | null>(null);
  const [pendingAppMessage, setPendingAppMessage] = useState<string | null>(null);
  const panelChatNeedsTargetRef = useRef(false);
  const panelChatModelPresetRef = useRef<string | null>(null);
  const panelResize = useResizableSidebar({
    storageKey: "memmy.appChatPanel.width",
    defaultWidth: 420,
    minWidth: 260,
    maxWidth: 900,
    invert: true
  });
  const connection = bridge?.connection ?? null;
  const storage = typeof window === "undefined" ? undefined : window.sessionStorage;
  const client = useMemo(
    () => (target && connection ? createAppBridgeTransport(connection, target.bridgeChatId) : null),
    [target, connection]
  );

  useEffect(() => {
    setPanelOpen(false);
    setPanelChatId(null);
    setPendingAppMessage(null);
    panelChatNeedsTargetRef.current = false;
    panelChatModelPresetRef.current = null;
  }, [target?.view.viewId]);

  useEffect(() => {
    if (!target || state.apps.status !== "ready") return;
    const summary = state.apps.items.find((app) => app.id === target.appId);
    if (!summary || summary.state === "disabled") {
      clearStoredAppPageTarget(storage);
      dispatch(appActions.clearAppPage());
    }
  }, [target, state.apps, dispatch, storage]);

  const restoredTargetRef = useRef<AppPageTarget | null>(null);
  useEffect(() => {
    if (target) {
      writeStoredAppPageTarget(storage, target);
      return;
    }
    if (!restoredTargetRef.current) {
      restoredTargetRef.current = readStoredAppPageTarget(storage);
    }
    const stored = restoredTargetRef.current;
    if (!stored) return;
    if (stored.origin === "chat") {
      restoredTargetRef.current = null;
      dispatch(appActions.openAppPage(stored));
      return;
    }
    if (!connection) return;
    restoredTargetRef.current = null;
    void appsActions.openApp(connection, dispatch, {
      appId: stored.appId,
      target: stored.target ?? { kind: "standalone" }
    });
  }, [target, connection, dispatch, storage]);

  useEffect(() => {
    if (!target || !connection) return;
    connection.attach(target.bridgeChatId);
  }, [target?.bridgeChatId, connection]);

  const reload = useCallback(() => {
    if (!target) return;
    if (target.origin === "chat") {
      setReloadKey((value) => value + 1);
      return;
    }
    if (!connection) return;
    const appTarget: WebuiSessionTarget = target.target ?? { kind: "standalone" };
    void appsActions.openApp(connection, dispatch, { appId: target.appId, target: appTarget });
  }, [target, connection, dispatch]);

  const resolvePanelChat = useCallback(async (): Promise<string> => {
    if (panelChatId) return panelChatId;
    if (!target) throw new Error("No app selected");
    if (!connection) throw new Error("Agent gateway is not ready");
    const result = await openPanelChat({
      target,
      connection,
      ensureChatSubscription: (chatId) => bridge?.ensureChatSubscription(chatId),
      onNewChat: (chatId) => dispatch(agentActions.newChatCreated(chatId))
    });
    panelChatNeedsTargetRef.current = result.isNewChat;
    panelChatModelPresetRef.current = result.modelPreset ?? null;
    setPanelChatId(result.chatId);
    return result.chatId;
  }, [panelChatId, target, connection, bridge, dispatch]);

  const openChat = useCallback(async (input: { message?: string }): Promise<void> => {
    if (input.message) setPendingAppMessage(input.message);
    setPanelOpen(true);
  }, []);

  const consumePendingAppMessage = useCallback(() => setPendingAppMessage(null), []);

  const sendAppMessage = useCallback(async (chatId: string, content: string): Promise<void> => {
    if (!connection || !target) throw new Error("App host is unavailable");
    const appContext = { appId: target.appId, name: target.view.title || target.appId };
    const sendTarget = panelChatNeedsTargetRef.current;
    const targetValue: WebuiSessionTarget | undefined = sendTarget
      ? target.target ?? { kind: "standalone" }
      : undefined;
    const modelPreset = sendTarget ? panelChatModelPresetRef.current : null;
    let clientRequestId: string;
    try {
      ({ clientRequestId } = await sendPanelUserMessage({
        connection,
        chatId,
        content,
        ...(targetValue ? { target: targetValue } : {}),
        sendTarget,
        modelPreset,
        source: "mcp-app",
        appId: target.appId,
        viewId: target.view.viewId,
        appControlled: true,
        appContext
      }));
    } catch (error) {
      if (
        sendTarget
        && error instanceof MemmyAgentMessageRejectedError
        && error.detail === "session_binding_rejected"
      ) {
        try {
          ({ clientRequestId } = await sendPanelUserMessage({
            connection,
            chatId,
            content,
            sendTarget: false,
            source: "mcp-app",
            appId: target.appId,
            viewId: target.view.viewId,
            appControlled: true,
            appContext
          }));
        } catch (retryError) {
          dispatch(agentActions.transientSendFailed(chatId));
          throw retryError;
        }
      } else {
        dispatch(agentActions.transientSendFailed(chatId));
        throw error;
      }
    }
    panelChatNeedsTargetRef.current = false;
    panelChatModelPresetRef.current = null;
    dispatch(agentActions.userMessageQueued({
      chatId,
      content,
      focus: true,
      clientRequestId,
      appId: target.appId,
      appControlled: true,
      ...(targetValue ? { target: targetValue } : {})
    }));
  }, [connection, target, dispatch]);

  const sendUserMessage = useCallback(async (chatId: string, content: string): Promise<void> => {
    if (!connection) throw new Error("Agent gateway is not ready");
    const appContext = target ? { appId: target.appId, name: target.view.title || target.appId } : undefined;
    let sendTarget = panelChatNeedsTargetRef.current;
    const targetValue: WebuiSessionTarget | undefined = sendTarget
      ? target?.target ?? { kind: "standalone" }
      : undefined;
    const modelPreset = sendTarget ? panelChatModelPresetRef.current : null;
    let clientRequestId: string;
    try {
      ({ clientRequestId } = await sendPanelUserMessage({
        connection,
        chatId,
        content,
        ...(targetValue ? { target: targetValue } : {}),
        sendTarget,
        modelPreset,
        ...(appContext ? { appContext } : {})
      }));
    } catch (error) {
      // The panel chat may already have a session (for example after an app
      // message). Retry once without the one-shot target, which the gateway
      // rejects on an existing session.
      if (
        sendTarget
        && error instanceof MemmyAgentMessageRejectedError
        && error.detail === "session_binding_rejected"
      ) {
        try {
          ({ clientRequestId } = await sendPanelUserMessage({
            connection,
            chatId,
            content,
            sendTarget: false,
            ...(appContext ? { appContext } : {})
          }));
          sendTarget = false;
          panelChatNeedsTargetRef.current = false;
          panelChatModelPresetRef.current = null;
        } catch (retryError) {
          dispatch(agentActions.transientSendFailed(chatId));
          throw retryError;
        }
      } else {
        dispatch(agentActions.transientSendFailed(chatId));
        throw error;
      }
    }
    if (sendTarget) {
      panelChatNeedsTargetRef.current = false;
      panelChatModelPresetRef.current = null;
    }
    dispatch(agentActions.userMessageQueued({
      chatId,
      content,
      focus: true,
      clientRequestId,
      ...(targetValue ? { target: targetValue } : {})
    }));
  }, [connection, target, dispatch]);

  const panelChatIdForView = target?.origin === "chat" ? target.chatId ?? null : panelChatId;

  if (!target && pageError) {
    return (
      <AppFrame title={t("nav.apps")}>
        <div className="cuby-app-page flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="max-w-md text-sm text-status-error">{pageError.error}</div>
          <button
            type="button"
            onClick={() => {
              if (!connection) return;
              void appsActions.openApp(connection, dispatch, {
                appId: pageError.appId,
                ...(pageError.target ? { target: pageError.target } : {})
              });
            }}
            className="rounded-btn bg-action-sky px-3 py-1.5 text-xs text-white"
          >
            {t("app.page.retry")}
          </button>
        </div>
      </AppFrame>
    );
  }

  return (
    <AppFrame title={t("nav.apps")}>
      <AppPageView target={target} onReload={reload}>
        {target && client ? (
          <div className="flex h-full min-h-0 w-full">
            <div className="relative min-h-0 min-w-0 flex-1">
              <AppViewHost
                key={`${target.view.viewId}:${reloadKey}`}
                view={target.view}
                chatId={target.bridgeChatId}
                client={client}
                layout="page"
                onOpenChat={openChat}
              />
            </div>
            {panelOpen ? (
              <div className="flex h-full min-h-0 shrink-0" style={panelResize.sidebarStyle}>
                <SidebarResizeHandle
                  label={t("app.chat.resize")}
                  width={panelResize.width}
                  minWidth={panelResize.minWidth}
                  maxWidth={panelResize.maxWidth}
                  isResizing={panelResize.isResizing}
                  onResizeStart={panelResize.beginResize}
                  onResizeBy={panelResize.resizeBy}
                />
                <AppChatPanel
                  open={panelOpen}
                  appName={target.view.title || target.appId}
                  chatId={panelChatIdForView}
                  pendingAppMessage={pendingAppMessage}
                  onClose={() => setPanelOpen(false)}
                  onEnsureChat={resolvePanelChat}
                  onAppMessage={sendAppMessage}
                  onSendUserMessage={sendUserMessage}
                  onPendingAppMessageConsumed={consumePendingAppMessage}
                />
              </div>
            ) : null}
          </div>
        ) : target ? (
          <div className="flex h-full items-center justify-center p-6 text-sm text-text-ink/55">
            {t("app.view.hostUnavailable")}
          </div>
        ) : null}
      </AppPageView>
    </AppFrame>
  );
}
