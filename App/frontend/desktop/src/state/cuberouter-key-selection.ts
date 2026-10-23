/**
 * Which cuberouter key this machine last selected for its model config, per username. The model
 * config itself only holds the secret; this record is what lets the panel name the selected key
 * and the login flow keep it instead of re-provisioning over it.
 */
import type { CuberouterKeyOption } from "@memmy/local-api-contracts";

export const CUBEROUTER_KEY_SELECTION_STORAGE_KEY = "memmy.cuberouterKeySelection.v2";

/** Mirrors the backend's `DESKTOP_TOKEN_NAME`: the prefix of the key the login flow provisions. */
const DESKTOP_KEY_NAME_PREFIX = "cuby-desktop";

export interface CuberouterKeySelection {
  username: string;
  scope: "organization" | "personal";
  id: number;
  name: string;
}

/**
 * The key name the login flow provisions for this username. Mirrors `toDesktopTokenName` in
 * `cuberouter-account-service.ts`; keep the two in step.
 */
export function desktopTokenName(username: string): string {
  const trimmed = username.trim();
  const domain = trimmed.indexOf("@");
  const local = domain > 0 ? trimmed.slice(0, domain) : trimmed;
  return `${DESKTOP_KEY_NAME_PREFIX}-${local.trim()}`;
}

type SelectableKey = Pick<CuberouterKeyOption, "scope" | "name" | "usable">;

/**
 * The key a login uses when this machine has no remembered choice: the provisioned
 * `cuby-desktop-*` key, organization first (the backend provisions there whenever the account
 * belongs to an organization), then personal. Null when the key list does not carry it.
 */
export function defaultCuberouterKey<T extends SelectableKey>(
  keys: readonly T[],
  username: string
): T | null {
  const name = desktopTokenName(username);
  const matching = keys.filter((key) => key.name === name && key.usable);
  return matching.find((key) => key.scope === "organization")
    ?? matching.find((key) => key.scope === "personal")
    ?? null;
}

type StoredSelections = Record<string, CuberouterKeySelection>;

/** One record per account: the same username on two nodes is two accounts. */
function selectionKey(apiBase: string, username: string): string {
  return `${apiBase.trim().replace(/\/+$/, "")}\n${username.trim()}`;
}

export function readCuberouterKeySelection(
  apiBase: string,
  username: string,
  storage?: Pick<Storage, "getItem">
): CuberouterKeySelection | null {
  return readSelections(storage)[selectionKey(apiBase, username)] ?? null;
}

export function writeCuberouterKeySelection(
  apiBase: string,
  selection: CuberouterKeySelection,
  storage?: Pick<Storage, "getItem" | "setItem">
): void {
  if (!storage) return;
  const selections = readSelections(storage);
  const username = selection.username.trim();
  selections[selectionKey(apiBase, username)] = { ...selection, username };
  try {
    storage.setItem(CUBEROUTER_KEY_SELECTION_STORAGE_KEY, JSON.stringify(selections));
  } catch {
    // Losing the record costs a re-provision at the next login; it must never block a save.
  }
}

export function clearCuberouterKeySelection(
  apiBase: string,
  username: string,
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">
): void {
  if (!storage) return;
  const selections = readSelections(storage);
  const key = selectionKey(apiBase, username);
  if (!(key in selections)) return;
  delete selections[key];
  try {
    if (Object.keys(selections).length > 0) {
      storage.setItem(CUBEROUTER_KEY_SELECTION_STORAGE_KEY, JSON.stringify(selections));
    } else {
      storage.removeItem(CUBEROUTER_KEY_SELECTION_STORAGE_KEY);
    }
  } catch {
    // Same as above: the record is an optimization, not state the app depends on.
  }
}

/** The renderer's localStorage, or undefined when unavailable (tests, private windows). */
export function cuberouterKeySelectionStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function readSelections(storage?: Pick<Storage, "getItem">): StoredSelections {
  try {
    const raw = storage?.getItem(CUBEROUTER_KEY_SELECTION_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([username, value]) => (
      isSelection(value) ? [[username, value as CuberouterKeySelection]] : []
    )));
  } catch {
    return {};
  }
}

function isSelection(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<CuberouterKeySelection>;
  return typeof candidate.username === "string"
    && (candidate.scope === "organization" || candidate.scope === "personal")
    && typeof candidate.id === "number"
    && typeof candidate.name === "string";
}
