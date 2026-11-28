import { MemmyAgentRequestError, type MemmyAgentClient, type WebuiSessionTarget } from "../api/memmy-agent-client.js";
import { agentActions, createAgentOperationError, type AppAction } from "../state/app-actions.js";
import type { AgentTaskView } from "../state/agent-chat-slice.js";

export interface TaskOpenInAppRequest {
  appId: string;
  chatId: string;
  target: WebuiSessionTarget;
  openPanel: true;
}

let historyRequestCounter = 0;

function nextHistoryRequestId(chatId: string): string {
  historyRequestCounter += 1;
  return `${chatId}-${historyRequestCounter}`;
}

/** Builds the apps_open request that reuses an app-origin chat. */
export function taskOpenInAppRequest(task: AgentTaskView): TaskOpenInAppRequest | null {
  if (!task.appId) return null;
  return {
    appId: task.appId,
    chatId: task.chatId,
    target: task.projectId ? { kind: "project", projectId: task.projectId } : { kind: "standalone" },
    openPanel: true
  };
}

/** Resolves the badge label: app list name, then the persisted panel label, then the id. */
export function resolveTaskAppDisplayName(
  apps: Array<{ id: string; name: string }>,
  task: AgentTaskView
): string | null {
  if (!task.appId) return null;
  return apps.find((app) => app.id === task.appId)?.name ?? task.appName ?? task.appId;
}

/**
 * Selects and hydrates the chat so the app panel can show its history and
 * receive live events through the bridge's current-chat subscription.
 */
export function loadTaskChatForPanel(
  client: Pick<MemmyAgentClient, "readWebuiThread"> | null,
  dispatch: (action: AppAction) => void,
  task: AgentTaskView
): void {
  if (!client) return;
  const requestId = nextHistoryRequestId(task.chatId);
  dispatch(agentActions.historyLoading(task.sessionKey, task.chatId, requestId));
  void client.readWebuiThread(task.sessionKey)
    .then((thread) => dispatch(agentActions.historyLoaded(thread, requestId)))
    .catch((error) => {
      if (error instanceof MemmyAgentRequestError && error.status === 404) {
        dispatch(agentActions.historyOpenMissing(task.sessionKey, task.chatId, requestId));
        return;
      }
      dispatch(agentActions.historyOpenFailed(task.chatId, requestId, createAgentOperationError({
        source: "history",
        message: error instanceof Error ? error.message : String(error),
        chatId: task.chatId
      })));
    });
}
