import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AppViewStore, readUiResourceUri } from "../../src/apps/view.js";

describe("AppViewStore", () => {
  it("reads nested and flat UI resource metadata", () => {
    expect(readUiResourceUri({ ui: { resourceUri: "ui://a/x" } })).toBe("ui://a/x");
    expect(readUiResourceUri({ "ui/resourceUri": "ui://a/y" })).toBe("ui://a/y");
    expect(readUiResourceUri(null)).toBeNull();
  });

  it("keeps small structured results inline", async () => {
    const store = new AppViewStore(mkdtempSync(path.join(tmpdir(), "cuby-view-")));
    const view = await store.create({
      appId: "demo", resourceUri: "ui://demo/x", toolName: "hello", title: "Hello",
      arguments: {}, result: { content: [{ type: "text", text: "hi" }], structuredContent: { ok: true } }
    });
    expect(view.initialResult.structuredContent).toEqual({ ok: true });
    expect(view.resultRef).toBeUndefined();
  });

  it("externalizes an oversized result", async () => {
    const store = new AppViewStore(mkdtempSync(path.join(tmpdir(), "cuby-view-")));
    const view = await store.create({
      appId: "demo", resourceUri: "ui://demo/x", toolName: "hello", title: "Hello",
      arguments: {}, result: { content: [{ type: "text", text: "x".repeat(300 * 1024) }] }
    });
    expect(view.resultRef).toMatch(/result\.json$/);
  });

  it("turns image content into an artifact", async () => {
    const store = new AppViewStore(mkdtempSync(path.join(tmpdir(), "cuby-view-")));
    const view = await store.create({
      appId: "demo", resourceUri: "ui://demo/x", toolName: "hello", title: "Hello",
      arguments: {}, result: { content: [{ type: "image", data: Buffer.from("png").toString("base64"), mimeType: "image/png" }] }
    });
    expect(view.artifacts?.[0]?.path).toMatch(/artifacts\//);
  });
});
