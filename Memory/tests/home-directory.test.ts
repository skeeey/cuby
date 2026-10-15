import { afterEach, describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { defaultConfigPaths } from "../src/cli/config.js";

describe("default config paths", () => {
  afterEach(() => {
    delete process.env.CUBY_CONFIG;
    delete process.env.MEMMY_CONFIG;
  });

  it("falls back to ~/.cuby/config.yaml", () => {
    expect(defaultConfigPaths()).toEqual([join(homedir(), ".cuby", "config.yaml")]);
  });

  it("never references the Memmy era path", () => {
    expect(defaultConfigPaths().join("\n")).not.toContain(".memmy");
  });
});
