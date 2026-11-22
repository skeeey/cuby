import { describe, expect, it } from "vitest";
import { cubyHostContext } from "../app-theme.js";

describe("cubyHostContext", () => {
  it("maps Cuby tokens to MCP Apps style variables", () => {
    const context = cubyHostContext({
      displayMode: "inline", container: { width: 800, maxHeight: 480 }, locale: "zh-CN", theme: "light",
      readToken: (name) => `value-of-${name}`
    });
    expect(context).toMatchObject({
      theme: "light",
      displayMode: "inline",
      locale: "zh-CN",
      containerDimensions: { width: 800, maxHeight: 480 },
      styles: { variables: expect.objectContaining({
        "--color-background-primary": expect.any(String),
        "--color-text-primary": expect.any(String),
        "--font-sans": expect.any(String)
      }) }
    });
  });
});
