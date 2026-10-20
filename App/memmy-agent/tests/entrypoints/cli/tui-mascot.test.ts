/** Cuby mascot raster tests. */
import { describe, expect, it } from "vitest";
import { MASCOT_TONE_COLOR } from "../../../src/entrypoints/cli/tui.js";

describe("CLI mascot raster", () => {
  it("paints the hero logo in the Cuby palette", () => {
    // The palette the designer delivered with the Cuby head raster. A key appearing here is
    // the mascot changing on screen, so it should never move without the artwork moving too.
    expect(MASCOT_TONE_COLOR).toEqual({
      antenna: "#FF9F43",
      body: "#5A6CF0",
      face: "#16142B",
      eye: "#FFFFFF",
      pupil: "#101018",
      blush: "#FF8FA3"
    });
  });

  it("keeps no trace of the retired rice-and-spoon mascot", () => {
    // These were the tone names the old half-block rice character was drawn with. Its raster
    // shipped for as long as the Cuby ASCII artwork was outstanding.
    for (const retired of ["rice0", "rice1", "rice2", "spoon0", "spoon1", "spoon2"]) {
      expect(MASCOT_TONE_COLOR, retired).not.toHaveProperty(retired);
    }
  });
});
