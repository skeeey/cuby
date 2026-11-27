import { describe, expect, it } from "vitest";
import {
  APP_PAGE_TARGET_STORAGE_KEY,
  clearStoredAppPageTarget,
  readStoredAppPageTarget,
  writeStoredAppPageTarget
} from "../app-page-storage.js";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    clear: () => { map.clear(); },
    key: (index) => [...map.keys()][index] ?? null,
    get length() { return map.size; }
  } as Storage;
}

const target = {
  appId: "demo",
  bridgeChatId: "app-1",
  origin: "entry" as const,
  view: {
    viewId: "v1",
    appId: "demo",
    resourceUri: "ui://demo/home",
    toolName: "hello",
    title: "Demo",
    displayMode: "inline" as const,
    protocol: "mcp-apps/2026-01-26" as const,
    arguments: {},
    initialResult: { content: [] }
  }
};

describe("app page storage", () => {
  it("round-trips an app page target", () => {
    const storage = memoryStorage();
    expect(writeStoredAppPageTarget(storage, target)).toBe(true);
    expect(readStoredAppPageTarget(storage)).toEqual(target);
  });

  it("returns null for invalid JSON and clears", () => {
    const storage = memoryStorage();
    storage.setItem(APP_PAGE_TARGET_STORAGE_KEY, "{bad");
    expect(readStoredAppPageTarget(storage)).toBeNull();
    clearStoredAppPageTarget(storage);
    expect(storage.getItem(APP_PAGE_TARGET_STORAGE_KEY)).toBeNull();
  });

  it("returns null for an invalid target shape", () => {
    const storage = memoryStorage();
    storage.setItem(APP_PAGE_TARGET_STORAGE_KEY, JSON.stringify({ appId: "demo" }));
    expect(readStoredAppPageTarget(storage)).toBeNull();
  });

  it("reports quota failures without throwing", () => {
    const storage = {
      setItem: () => { throw new Error("quota"); },
      getItem: () => null,
      removeItem: () => undefined
    } as any;
    expect(writeStoredAppPageTarget(storage, target)).toBe(false);
  });
});
