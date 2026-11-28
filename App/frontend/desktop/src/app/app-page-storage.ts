import type { AppPageTarget } from "../state/apps-slice.js";

export const APP_PAGE_TARGET_STORAGE_KEY = "memmy.appPageTarget";

function isAppPageTarget(value: unknown): value is AppPageTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, any>;
  return typeof record.appId === "string"
    && typeof record.bridgeChatId === "string"
    && (record.origin === "entry" || record.origin === "chat")
    && (record.chatId == null || typeof record.chatId === "string")
    && (
      record.target == null
      || record.target.kind === "standalone"
      || (record.target.kind === "project" && typeof record.target.projectId === "string")
    )
    && Boolean(record.view)
    && typeof record.view === "object"
    && !Array.isArray(record.view)
    && typeof record.view.viewId === "string";
}

export function readStoredAppPageTarget(storage: Storage | undefined): AppPageTarget | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(APP_PAGE_TARGET_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isAppPageTarget(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeStoredAppPageTarget(storage: Storage | undefined, target: AppPageTarget): boolean {
  if (!storage) return false;
  try {
    const { openPanel: _openPanel, ...persisted } = target;
    storage.setItem(APP_PAGE_TARGET_STORAGE_KEY, JSON.stringify(persisted));
    return true;
  } catch {
    return false;
  }
}

export function clearStoredAppPageTarget(storage: Storage | undefined): void {
  if (!storage) return;
  try {
    storage.removeItem(APP_PAGE_TARGET_STORAGE_KEY);
  } catch {
    // Storage may be unavailable; losing the hint is non-fatal.
  }
}
