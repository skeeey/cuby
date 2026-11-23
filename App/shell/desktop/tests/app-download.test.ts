import { describe, expect, it } from "vitest";
import { decodeAppDownloadContents } from "../src/main/app-download.js";

describe("decodeAppDownloadContents", () => {
  it("accepts embedded resources and rejects non-data content", () => {
    const bytes = Buffer.from("pdf").toString("base64");
    expect(decodeAppDownloadContents([{ type: "resource", resource: { uri: "file://x.pdf", mimeType: "application/pdf", blob: bytes } }]))
      .toEqual([{ name: "x.pdf", mime: "application/pdf", data: expect.any(Uint8Array) }]);
    expect(() => decodeAppDownloadContents([{ type: "text", text: "no" }])).toThrow();
  });

  it("rejects unresolved resource links", () => {
    expect(() => decodeAppDownloadContents([{ type: "resource_link", uri: "file://x.pdf" }])).toThrow();
  });
});
