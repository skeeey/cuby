/** Cuberouter key selection record tests. */
import { describe, expect, it } from "vitest";
import {
  CUBEROUTER_KEY_SELECTION_STORAGE_KEY,
  clearCuberouterKeySelection,
  readCuberouterKeySelection,
  writeCuberouterKeySelection
} from "../cuberouter-key-selection.js";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    raw: map
  };
}

describe("cuberouter key selection", () => {
  it("round-trips one selection per username", () => {
    const storage = memoryStorage();
    writeCuberouterKeySelection({ username: "alice@a.com", scope: "personal", id: 41, name: "my-key" }, storage);
    writeCuberouterKeySelection({ username: "bob@a.com", scope: "organization", id: 11, name: "cuby-desktop-bob" }, storage);

    expect(readCuberouterKeySelection("alice@a.com", storage)).toEqual({
      username: "alice@a.com",
      scope: "personal",
      id: 41,
      name: "my-key"
    });
    expect(readCuberouterKeySelection("bob@a.com", storage)).toEqual({
      username: "bob@a.com",
      scope: "organization",
      id: 11,
      name: "cuby-desktop-bob"
    });
    expect(readCuberouterKeySelection("carol@a.com", storage)).toBeNull();
  });

  it("ignores a corrupted record instead of throwing", () => {
    const storage = memoryStorage();
    storage.raw.set(CUBEROUTER_KEY_SELECTION_STORAGE_KEY, "{not json");

    expect(readCuberouterKeySelection("alice@a.com", storage)).toBeNull();
  });

  it("clears only the named username", () => {
    const storage = memoryStorage();
    writeCuberouterKeySelection({ username: "alice@a.com", scope: "personal", id: 41, name: "my-key" }, storage);
    writeCuberouterKeySelection({ username: "bob@a.com", scope: "personal", id: 42, name: "bobs-key" }, storage);

    clearCuberouterKeySelection("alice@a.com", storage);

    expect(readCuberouterKeySelection("alice@a.com", storage)).toBeNull();
    expect(readCuberouterKeySelection("bob@a.com", storage)?.name).toBe("bobs-key");
  });
});
