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

  it("honours CUBY_CONFIG", () => {
    process.env.CUBY_CONFIG = "/tmp/cuby-config.yaml";
    expect(defaultConfigPaths()[0]).toBe("/tmp/cuby-config.yaml");
  });

  it("no longer reads MEMMY_CONFIG", () => {
    process.env.MEMMY_CONFIG = "/tmp/memmy-config.yaml";
    expect(defaultConfigPaths().join("\n")).not.toContain("memmy-config.yaml");
  });
});
