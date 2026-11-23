import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function readUi() {
  return readFileSync(path.join(here, "ui", "index.html"), "utf8");
}

const server = new Server(
  { name: "cuby-fixture-app", version: "0.0.1" },
  { capabilities: { tools: {}, resources: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "hello",
      description: "Say hello",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
      _meta: { ui: { resourceUri: "ui://fixture/hello" } },
    },
    {
      name: "echo",
      description: "Echo text",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = request.params.arguments ?? {};
  if (request.params.name === "hello") {
    const greeting = `Hello, ${args.name ?? "world"}`;
    return {
      content: [{ type: "text", text: greeting }],
      structuredContent: { greeting },
    };
  }
  if (request.params.name === "echo") {
    return {
      content: [{ type: "text", text: `echo: ${args.text ?? ""}` }],
    };
  }
  return {
    isError: true,
    content: [{ type: "text", text: `unknown tool: ${request.params.name}` }],
  };
});

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    { uri: "ui://fixture/hello", name: "hello-ui", mimeType: "text/html;profile=mcp-app" },
    { uri: "ui://fixture/extra", name: "extra-ui", mimeType: "text/html;profile=mcp-app" },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => ({
  contents: [{
    uri: request.params.uri,
    mimeType: "text/html;profile=mcp-app",
    text: readUi(),
  }],
}));

await server.connect(new StdioServerTransport());
