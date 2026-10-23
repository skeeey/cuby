/** Cuberouter key selection record tests. */
import { describe, expect, it } from "vitest";
import {
  CUBEROUTER_KEY_SELECTION_STORAGE_KEY,
  clearCuberouterKeySelection,
  defaultCuberouterKey,
  desktopTokenName,
  readCuberouterKeySelection,
  writeCuberouterKeySelection
} from "../cuberouter-key-selection.js";

const CN = "https://cuberouter.cn/v1";
const COM = "https://cuberouter.com/v1";

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
  it("round-trips one selection per account", () => {
    const storage = memoryStorage();
    writeCuberouterKeySelection(CN, { username: "alice@a.com", scope: "personal", id: 41, name: "my-key" }, storage);
    writeCuberouterKeySelection(CN, { username: "bob@a.com", scope: "organization", id: 11, name: "cuby-desktop-bob" }, storage);

    expect(readCuberouterKeySelection(CN, "alice@a.com", storage)).toEqual({
      username: "alice@a.com",
      scope: "personal",
      id: 41,
      name: "my-key"
    });
    expect(readCuberouterKeySelection(CN, "bob@a.com", storage)).toEqual({
      username: "bob@a.com",
      scope: "organization",
      id: 11,
      name: "cuby-desktop-bob"
    });
    expect(readCuberouterKeySelection(CN, "carol@a.com", storage)).toBeNull();
  });

  it("keeps the same username on two nodes apart", () => {
    const storage = memoryStorage();
    writeCuberouterKeySelection(CN, { username: "alice@a.com", scope: "personal", id: 41, name: "cn-key" }, storage);
    writeCuberouterKeySelection(COM, { username: "alice@a.com", scope: "personal", id: 9, name: "com-key" }, storage);

    expect(readCuberouterKeySelection(CN, "alice@a.com", storage)?.name).toBe("cn-key");
    expect(readCuberouterKeySelection(COM, "alice@a.com", storage)?.name).toBe("com-key");
  });

  it("ignores a corrupted record instead of throwing", () => {
    const storage = memoryStorage();
    storage.raw.set(CUBEROUTER_KEY_SELECTION_STORAGE_KEY, "{not json");

    expect(readCuberouterKeySelection(CN, "alice@a.com", storage)).toBeNull();
  });

  it("clears only the named account", () => {
    const storage = memoryStorage();
    writeCuberouterKeySelection(CN, { username: "alice@a.com", scope: "personal", id: 41, name: "my-key" }, storage);
    writeCuberouterKeySelection(CN, { username: "bob@a.com", scope: "personal", id: 42, name: "bobs-key" }, storage);
    writeCuberouterKeySelection(COM, { username: "alice@a.com", scope: "personal", id: 9, name: "com-key" }, storage);

    clearCuberouterKeySelection(CN, "alice@a.com", storage);

    expect(readCuberouterKeySelection(CN, "alice@a.com", storage)).toBeNull();
    expect(readCuberouterKeySelection(CN, "bob@a.com", storage)?.name).toBe("bobs-key");
    expect(readCuberouterKeySelection(COM, "alice@a.com", storage)?.name).toBe("com-key");
  });

  it("derives the provisioned key name exactly as the backend does", () => {
    expect(desktopTokenName("alice@a.com")).toBe("cuby-desktop-alice");
    expect(desktopTokenName("Liang.YT@yeebo.com.cn")).toBe("cuby-desktop-Liang.YT");
    expect(desktopTokenName("liangyt")).toBe("cuby-desktop-liangyt");
    expect(desktopTokenName("  alice@a.com  ")).toBe("cuby-desktop-alice");
    expect(desktopTokenName("@yeebo.com.cn")).toBe("cuby-desktop-@yeebo.com.cn");
  });

  it("defaults to the provisioned key, preferring the organization row", () => {
    const personal = { scope: "personal" as const, name: "cuby-desktop-alice", usable: true };
    const organization = { scope: "organization" as const, name: "cuby-desktop-alice", usable: true };
    const other = { scope: "organization" as const, name: "cuby-desktop-bob", usable: true };

    expect(defaultCuberouterKey([personal, other, organization], "alice@a.com")).toBe(organization);
    expect(defaultCuberouterKey([personal], "alice@a.com")).toBe(personal);
    expect(defaultCuberouterKey([other], "alice@a.com")).toBeNull();
    expect(defaultCuberouterKey([
      { ...organization, usable: false }
    ], "alice@a.com")).toBeNull();
  });
});
