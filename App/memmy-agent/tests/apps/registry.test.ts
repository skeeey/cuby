import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadAppRegistry } from "../../src/apps/registry.js";
import { resolveAppRoots } from "../../src/apps/roots.js";

function writeApp(root: string, id: string, version = "1.0.0") {
  const dir = path.join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "app.json"), JSON.stringify({
    schemaVersion: 1, id, name: id, version,
    engines: { cuby: ">=0.0.1" },
    server: { transport: "stdio", command: "node", args: ["server.mjs"] },
    capabilities: { appToolCalls: [], appMessages: false }
  }));
  return dir;
}

describe("app registry", () => {
  it("loads dev apps and lets them override bundled apps", () => {
    const root = mkdtempSync(path.join(tmpdir(), "cuby-apps-"));
    const bundled = writeApp(path.join(root, "bundled"), "demo", "1.0.0");
    const dev = writeApp(path.join(root, "dev"), "demo", "2.0.0");
    mkdirSync(path.join(root, "user"), { recursive: true });
    mkdirSync(path.join(root, "data"), { recursive: true });
    writeFileSync(path.join(root, "bundled", "registry.json"), JSON.stringify({
      schemaVersion: 1, apps: [{ id: "demo", version: "1.0.0", path: bundled }]
    }));

    const roots = resolveAppRoots({
      CUBY_BUNDLED_APPS_DIR: path.join(root, "bundled"),
      CUBY_USER_APPS_DIR: path.join(root, "user"),
      CUBY_APP_DATA_DIR: path.join(root, "data"),
      CUBY_DEV_APPS: dev
    });
    const { entries, errors } = loadAppRegistry(roots);
    expect(errors).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: "demo", version: "2.0.0", source: "dev" });
  });

  it("reports an invalid dev manifest without throwing", () => {
    const root = mkdtempSync(path.join(tmpdir(), "cuby-apps-"));
    const bad = path.join(root, "bad");
    mkdirSync(bad);
    writeFileSync(path.join(bad, "app.json"), "{ nope");
    const roots = resolveAppRoots({ CUBY_DEV_APPS: bad });
    const { entries, errors } = loadAppRegistry(roots);
    expect(entries).toEqual([]);
    expect(errors[0]?.path).toBe(bad);
  });
});
