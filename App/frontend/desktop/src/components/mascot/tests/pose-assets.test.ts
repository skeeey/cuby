import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { poseToAsset } from "../cuby.js";

const POSES = ["wave","think","work","celebrate","shield","read","connect","sleep","neutral",
  "point","box","brain","chat","wrench","blush","peek","hum","plead","sad"] as const;
const RESERVED = ["work","point","box","wrench","peek"] as const;
const ASSET_DIR = join(import.meta.dirname, "../../../assets/mascot");

// Every artwork file the rename deleted. The guard keeps all 26 names so a
// stray `memmy-wave.png` cannot come back unnoticed.
const RETIRED_ASSETS = [
  "memmy-blush.png",
  "memmy-body-blush.png",
  "memmy-box.png",
  "memmy-brain.png",
  "memmy-celebrate.png",
  "memmy-chat.png",
  "memmy-connect.png",
  "memmy-hum.png",
  "memmy-paddle.png",
  "memmy-peek.png",
  "memmy-plead.png",
  "memmy-point.png",
  "memmy-read.png",
  "memmy-rice.png",
  "memmy-rice-poc.png",
  "memmy-rice-transparent.png",
  "memmy-rice-white.png",
  "memmy-sad.png",
  "memmy-shield.png",
  "memmy-sleep.png",
  "memmy-think.png",
  "memmy-wave.png",
  "memmy-work.png",
  "memmy-wrench.png",
  "memo-idle-alpha.webm",
  "pet-entrance.webp"
];

describe("mascot pose assets", () => {
  it("maps every pose to a non-empty asset URL", () => {
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
    for (const stale of RETIRED_ASSETS) {
      expect(existsSync(join(ASSET_DIR, stale)), stale).toBe(false);
    }
  });
});
