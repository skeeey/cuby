import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildApps } from "../../scripts/apps/build-apps.mjs";

it("stages the selected app and writes a registry", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "cuby-build-"));
  const app = path.join(root, "apps", "demo");
  mkdirSync(path.join(app, "ui", "dist"), { recursive: true });
  writeFileSync(path.join(app, "ui", "dist", "index.html"), "<html>ok</html>");
  writeFileSync(path.join(app, "app.json"), JSON.stringify({
    schemaVersion: 1, id: "demo", name: "Demo", version: "1.0.0",
    engines: { cuby: ">=0.0.1" },
    server: { transport: "stdio", command: "node", args: ["server.mjs"] },
    ui: { resources: [{ uri: "ui://demo/x", entry: "ui/dist/index.html" }] },
    capabilities: { appToolCalls: [], appMessages: false }
  }));
  const result = await buildApps({ rootDir: root, outDir: path.join(root, "dist", "apps"), selection: ["demo"] });
  expect(result.apps).toEqual([expect.objectContaining({ id: "demo", version: "1.0.0" })]);
  expect(readFileSync(path.join(root, "dist", "apps", "registry.json"), "utf8")).toContain('"demo"');
});

it("skips an app whose platform command is missing", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "cuby-build-"));
  const app = path.join(root, "apps", "demo");
  mkdirSync(app, { recursive: true });
  writeFileSync(path.join(app, "app.json"), JSON.stringify({
    schemaVersion: 1, id: "demo", name: "Demo", version: "1.0.0",
    engines: { cuby: ">=0.0.1" },
    server: { transport: "stdio", command: {} },
    capabilities: { appToolCalls: [], appMessages: false }
  }));
  const result = await buildApps({ rootDir: root, outDir: path.join(root, "dist", "apps"), selection: ["demo"] });
  expect(result.apps).toEqual([]);
  expect(result.skipped[0]).toMatchObject({ id: "demo" });
});
