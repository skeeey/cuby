import { describe, expect, it } from "vitest";
import { skillSummaryFromContent } from "../../../src/service/read-model/display-fields.js";

describe("skillSummaryFromContent", () => {
  it("reads a frontmatter description", () => {
    expect(skillSummaryFromContent([
      "---",
      "name: memmy-resume",
      "description: Search Cuby L1 episodes and continue a selected prior task.",
      "disable-model-invocation: true",
      "---",
      "",
      "# Cuby Resume",
    ].join("\n"))).toBe("Search Cuby L1 episodes and continue a selected prior task.");
  });

  it("unquotes a quoted frontmatter description", () => {
    expect(skillSummaryFromContent([
      "---",
      'name: "imagegen"',
      'description: "Generate or edit raster images."',
      "---",
    ].join("\n"))).toBe("Generate or edit raster images.");
  });

  it("falls back to the first paragraph line when there is no frontmatter", () => {
    expect(skillSummaryFromContent([
      "# archify_code_flow_diagram",
      "",
      "Use when someone asks to sketch a code path as a diagram.",
      "",
      "## Procedure",
    ].join("\n"))).toBe("Use when someone asks to sketch a code path as a diagram.");
  });

  it("returns undefined when the content has no readable line", () => {
    expect(skillSummaryFromContent("---\nname: empty\n---\n")).toBeUndefined();
  });
});
