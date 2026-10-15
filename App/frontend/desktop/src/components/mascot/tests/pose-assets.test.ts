import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { poseToAsset } from "../cuby.js";

const POSES = ["wave","think","work","celebrate","shield","read","connect","sleep","neutral",
  "point","box","brain","chat","wrench","blush","peek","hum","plead","sad"] as const;
const RESERVED = ["work","point","box","wrench","peek"] as const;
const ASSET_DIR = join(import.meta.dirname, "../../../assets/mascot");

describe("mascot pose assets", () => {
  it("maps every pose to an existing file", () => {
    for (const pose of POSES) {
      const url = poseToAsset[pose];
      expect(url, `pose ${pose}`).toBeTruthy();
    }
  });

  it("falls the five reserved poses back to neutral", () => {
    for (const pose of RESERVED) {
      expect(poseToAsset[pose], `pose ${pose}`).toBe(poseToAsset.neutral);
    }
  });

  it("ships no Memmy-era artwork", () => {
    for (const stale of ["memo-idle-alpha.webm", "pet-entrance.webp", "memmy-rice.png"]) {
      expect(existsSync(join(ASSET_DIR, stale)), stale).toBe(false);
    }
  });
});
