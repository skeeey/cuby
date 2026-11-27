import type { AppHostSummary } from "@memmy/local-api-contracts";
import type { WebuiSessionTarget } from "../api/memmy-agent-client.js";
import type { AgentAppView } from "./agent-tool-traces.js";

export type AppsStatus = "idle" | "loading" | "ready" | "error";

export interface AppsState {
  status: AppsStatus;
  items: AppHostSummary[];
  error: string | null;
}

export const initialAppsState: AppsState = {
  status: "idle",
  items: [],
  error: null
};

export type AppPageOrigin = "entry" | "chat";

export interface AppPageTarget {
  appId: string;
  bridgeChatId: string;
  origin: AppPageOrigin;
  chatId?: string;
  target?: WebuiSessionTarget;
  view: AgentAppView;
}

export interface AppPageError {
  appId: string;
  target?: WebuiSessionTarget;
  error: string;
}

export type AppsAction =
  | { type: "apps/loadStarted" }
  | { type: "apps/loadSucceeded"; items: AppHostSummary[] }
  | { type: "apps/loadFailed"; error: string };

export function appsReducer(state: AppsState, action: AppsAction): AppsState {
  switch (action.type) {
    case "apps/loadStarted":
      return { ...state, status: "loading", error: null };
    case "apps/loadSucceeded":
      return { ...state, status: "ready", items: action.items, error: null };
    case "apps/loadFailed":
      return { ...state, status: "error", error: action.error };
    default:
      return state;
  }
}
