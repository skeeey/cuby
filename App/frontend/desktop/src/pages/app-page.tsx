import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { RotateCw } from "lucide-react";
import type { WebuiSessionTarget } from "../api/memmy-agent-client.js";
import { useOptionalAgentRuntimeBridge } from "../app/agent-runtime-bridge.js";
import { createAppBridgeTransport } from "../app/app-view-client.js";
import { AppViewHost } from "../app/app-view-host.js";
import { useTranslation } from "../i18n/use-translation.js";
import { appsActions } from "../state/app-actions.js";
import type { AppPageTarget } from "../state/apps-slice.js";
import { useAppState } from "../state/app-state.js";
import { AppChatPanel, ensurePanelChat } from "./app-chat-panel.js";
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
      <button
        type="button"
        aria-label={t("app.page.reload")}
        title={t("app.page.reload")}
        onClick={props.onReload}
        className="absolute right-3 top-3 z-10 inline-flex h-7 w-7 items-center justify-center rounded-btn bg-background-paper/90 text-text-ink/55 shadow-sm hover:bg-canvas-oat"
      >
        <RotateCw size={14} />
      </button>
      <div className="min-h-0 flex-1">{props.children}</div>
    </div>
  );
}

export function AppPage() {
  const { state, dispatch } = useAppState();
  const { t } = useTranslation();
  const bridge = useOptionalAgentRuntimeBridge();
  const target = state.navigation.appPage;
  const [reloadKey, setReloadKey] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelChatId, setPanelChatId] = useState<string | null>(null);
  const [pendingAppMessage, setPendingAppMessage] = useState<string | null>(null);
  const connection = bridge?.connection ?? null;
  const client = useMemo(
    () => (target && connection ? createAppBridgeTransport(connection, target.bridgeChatId) : null),
    [target, connection]
  );

  useEffect(() => {
    setPanelOpen(false);
    setPanelChatId(null);
    setPendingAppMessage(null);
  }, [target?.view.viewId]);

  const reload = useCallback(() => {
    if (!target) return;
    if (target.origin === "chat") {
      setReloadKey((value) => value + 1);
      return;
    }
    if (!connection) return;
    const appTarget: WebuiSessionTarget = { kind: "standalone" };
    void appsActions.openApp(connection, dispatch, { appId: target.appId, target: appTarget });
  }, [target, connection, dispatch]);

  const resolvePanelChat = useCallback(async (): Promise<string> => {
    if (panelChatId) return panelChatId;
    if (!target) throw new Error("No app selected");
    if (!connection) throw new Error("Agent gateway is not ready");
    const generation = connection.getReadyGeneration();
    if (generation === null) throw new Error("Agent gateway is not ready");
    const chatId = await ensurePanelChat({
      target,
      newChat: async () => (await connection.newChat(generation)).chatId
    });
    connection.attach(chatId);
    setPanelChatId(chatId);
    return chatId;
  }, [panelChatId, target, connection]);

  const openChat = useCallback(async (input: { message?: string }): Promise<void> => {
    if (input.message) setPendingAppMessage(input.message);
    setPanelOpen(true);
  }, []);

  const sendAppMessage = useCallback(async (chatId: string, content: string): Promise<void> => {
    if (!connection || !target) throw new Error("App host is unavailable");
    const transport = createAppBridgeTransport(connection, chatId);
    await transport.sendMessage({
      appId: target.appId,
      viewId: target.view.viewId,
      content: [{ type: "text", text: content }]
    });
  }, [connection, target]);

  const sendUserMessage = useCallback(async (chatId: string, content: string): Promise<void> => {
    if (!connection) throw new Error("Agent gateway is not ready");
    const generation = connection.getReadyGeneration();
    if (generation === null) throw new Error("Agent gateway is not ready");
    await connection.sendMessage({
      chatId,
      content,
      target: { kind: "standalone" }
    }, generation);
  }, [connection]);

  const panelChatIdForView = target?.origin === "chat" ? target.chatId ?? null : panelChatId;

  return (
    <AppFrame title={t("nav.apps")}>
      <AppPageView target={target} onReload={reload}>
        {target && client ? (
          <div className="relative h-full min-h-0 w-full">
            <AppViewHost
              key={`${target.view.viewId}:${reloadKey}`}
              view={target.view}
              chatId={target.bridgeChatId}
              client={client}
              layout="page"
              onOpenChat={openChat}
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
              onPendingAppMessageConsumed={() => setPendingAppMessage(null)}
            />
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
