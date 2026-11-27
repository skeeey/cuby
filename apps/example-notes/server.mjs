import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

// A dependency-free MCP stdio server. It reads one JSON-RPC message per line
// from stdin and writes one JSON-RPC response per line to stdout. Diagnostics
// go to stderr so they never corrupt the protocol stream.

const here = path.dirname(fileURLToPath(import.meta.url));
const uiHtml = readFileSync(path.join(here, "ui", "index.html"), "utf8");

let nextNoteId = 1;
const notes = [];

const tools = [
  {
    name: "list_notes",
    description: "List the notes in this example app",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    _meta: { ui: { resourceUri: "ui://example-notes/home" } },
  },
  {
    name: "add_note",
    description: "Add a note",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_note",
    description: "Delete a note by id",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
];

function notesPayload() {
  return { notes: notes.map(({ id, text, createdAt }) => ({ id, text, createdAt })) };
}

function textResult(text, structuredContent) {
  return {
    content: [{ type: "text", text }],
    ...(structuredContent ? { structuredContent } : {}),
  };
}

function callTool(name, args) {
  if (name === "list_notes") {
    const payload = notesPayload();
    const text = payload.notes.length
      ? payload.notes.map((note) => `- ${note.text}`).join("\n")
      : "(no notes yet)";
    return textResult(text, payload);
  }
  if (name === "add_note") {
    const text = String(args?.text ?? "").trim();
    if (!text) {
      return { isError: true, content: [{ type: "text", text: "note text is required" }] };
    }
    const note = { id: String(nextNoteId++), text, createdAt: new Date().toISOString() };
    notes.push(note);
    return textResult(`Added note ${note.id}`, notesPayload());
  }
  if (name === "delete_note") {
    const id = String(args?.id ?? "");
    const index = notes.findIndex((note) => note.id === id);
    if (index < 0) {
      return { isError: true, content: [{ type: "text", text: `note not found: ${id}` }] };
    }
    notes.splice(index, 1);
    return textResult(`Deleted note ${id}`, notesPayload());
  }
  return { isError: true, content: [{ type: "text", text: `unknown tool: ${name}` }] };
}

function write(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

function respond(id, result) {
  write({ id, result });
}

function respondError(id, code, message) {
  write({ id, error: { code, message } });
}

function handle(message) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return;
  const { id, method, params } = message;
  if (method === "initialize") {
    respond(id, {
      protocolVersion: params?.protocolVersion ?? "2026-01-26",
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: "example-notes", version: "0.1.0" },
    });
    return;
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") return;
  if (method === "ping") {
    respond(id, {});
    return;
  }
  if (method === "tools/list") {
    respond(id, { tools });
    return;
  }
  if (method === "resources/list") {
    respond(id, {
      resources: [{
        uri: "ui://example-notes/home",
        name: "home",
        mimeType: "text/html;profile=mcp-app",
      }],
    });
    return;
  }
  if (method === "resources/read") {
    const uri = params?.uri;
    if (uri !== "ui://example-notes/home") {
      respondError(id, -32602, `unknown resource: ${String(uri)}`);
      return;
    }
    respond(id, {
      contents: [{
        uri,
        mimeType: "text/html;profile=mcp-app",
        text: uiHtml,
      }],
    });
    return;
  }
  if (method === "tools/call") {
    respond(id, callTool(String(params?.name ?? ""), params?.arguments ?? {}));
    return;
  }
  if (id !== undefined) respondError(id, -32601, `unknown method: ${method}`);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    handle(JSON.parse(trimmed));
  } catch (error) {
    process.stderr.write(`[example-notes] ${error instanceof Error ? error.message : String(error)}\n`);
  }
});

process.stderr.write("[example-notes] ready\n");
