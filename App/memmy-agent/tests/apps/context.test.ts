import { describe, expect, it } from "vitest";
import { appContextRuntimeLines } from "../../src/apps/context.js";

describe("app context runtime lines", () => {
  it("describes the active app and its tool prefix", () => {
    const lines = appContextRuntimeLines({
      webui_app_context: { appId: "example-notes", name: "Example Notes" },
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Example Notes");
    expect(lines[0]).toContain("example-notes");
    expect(lines[0]).toContain("mcp_example-notes_");
  });

  it("ignores missing or malformed context", () => {
    expect(appContextRuntimeLines(null)).toEqual([]);
    expect(appContextRuntimeLines({})).toEqual([]);
    expect(appContextRuntimeLines({ webui_app_context: { appId: "" } })).toEqual([]);
  });
});
