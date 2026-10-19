/**
 * Which cuberouter key this machine last selected for its model config, per username. The model
 * config itself only holds the secret; this record is what lets the panel name the selected key
 * and the login flow keep it instead of re-provisioning over it.
 */

export const CUBEROUTER_KEY_SELECTION_STORAGE_KEY = "memmy.cuberouterKeySelection.v1";

export interface CuberouterKeySelection {
  username: string;
  scope: "organization" | "personal";
  id: number;
  name: string;
}

type StoredSelections = Record<string, CuberouterKeySelection>;

export function readCuberouterKeySelection(
  username: string,
  storage?: Pick<Storage, "getItem">
): CuberouterKeySelection | null {
  return readSelections(storage)[username.trim()] ?? null;
}

export function writeCuberouterKeySelection(
  selection: CuberouterKeySelection,
  storage?: Pick<Storage, "getItem" | "setItem">
): void {
  if (!storage) return;
  const selections = readSelections(storage);
  selections[selection.username.trim()] = { ...selection, username: selection.username.trim() };
  try {
    storage.setItem(CUBEROUTER_KEY_SELECTION_STORAGE_KEY, JSON.stringify(selections));
  } catch {
    // Losing the record costs a re-provision at the next login; it must never block a save.
  }
}

export function clearCuberouterKeySelection(
  username: string,
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">
): void {
  if (!storage) return;
  const selections = readSelections(storage);
  if (!(username.trim() in selections)) return;
  delete selections[username.trim()];
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
