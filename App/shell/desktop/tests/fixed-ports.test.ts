import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PACKAGED_RENDERER_DEFAULT_PORT } from "../src/main/window-mode.js";

const MEMMY_ERA_PORTS = /(\b18960\b|\b18970\b|\b18980\b|\b18990\b|\b19100\b)/;

function sourceFiles(root: string, out: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(root, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("fixed ports never revert to the Memmy era", () => {
  it("packaged renderer uses 29100", () => {
    expect(PACKAGED_RENDERER_DEFAULT_PORT).toBe(29100);
  });

  it("no desktop source file still binds a Memmy-era fixed port", () => {
    const offenders = sourceFiles(join(import.meta.dirname, "..", "src"))
      .filter((file) => MEMMY_ERA_PORTS.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
