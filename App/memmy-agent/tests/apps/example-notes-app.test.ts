import path from "node:path";
import { describe, expect, it } from "vitest";
import { connectMcpServer } from "../../src/core/agent-runtime/tools/mcp.js";

describe("example notes app", () => {
  it("lists, adds, deletes notes, and serves the UI resource", async () => {
    const appDir = path.resolve("../../apps/example-notes");
    const connection = await connectMcpServer("example-notes", {
      transport: "stdio",
      command: process.execPath,
      args: [path.join(appDir, "server.mjs")],
      cwd: appDir,
    });

    try {
      expect(connection.tools.map((tool) => tool.name))
        .toEqual(expect.arrayContaining(["list_notes", "add_note", "delete_note"]));

      const initial = await connection.session.callTool("list_notes", {}, 30);
      expect(initial.structuredContent.notes).toEqual([]);

      const added = await connection.session.callTool("add_note", { text: "buy milk" }, 30);
      expect(added.structuredContent.notes).toEqual([
        expect.objectContaining({ id: "1", text: "buy milk" }),
      ]);

      const listed = await connection.session.callTool("list_notes", {}, 30);
      expect(listed.structuredContent.notes).toHaveLength(1);

      const deleted = await connection.session.callTool("delete_note", { id: "1" }, 30);
      expect(deleted.structuredContent.notes).toEqual([]);

      const resource = await connection.session.readResource("ui://example-notes/home", 30);
      expect(resource.contents[0].text).toContain("Cuby example app");
    } finally {
      await connection.close();
    }
  });
});
