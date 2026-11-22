import path from "node:path";
import { describe, expect, it } from "vitest";
import { connectMcpServer } from "../../src/core/agent-runtime/tools/mcp.js";

describe("fixture app", () => {
  it("starts the fixture app and exposes its tool and resource", async () => {
    const fixture = path.resolve("../../apps/fixture");
    const connection = await connectMcpServer("fixture", {
      transport: "stdio",
      command: process.execPath,
      args: [path.join(fixture, "server.mjs")],
      cwd: fixture,
    });
    expect(connection.tools.map((tool) => tool.name)).toContain("hello");
    expect(connection.resources.map((resource) => resource.uri)).toContain("ui://fixture/hello");
    await connection.close();
  });
});
