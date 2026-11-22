import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "mcp-echo-fixture", version: "1.0.0" },
  { capabilities: { tools: {}, resources: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: "echo",
    description: "Echo text",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
    _meta: { ui: { resourceUri: "ui://fixture/echo" } },
  }],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [{
    type: "text",
    text: `echo: ${request.params.arguments?.text ?? ""}`,
  }],
}));

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [{
    uri: "ui://fixture/echo",
    name: "echo-ui",
    mimeType: "text/html;profile=mcp-app",
  }],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => ({
  contents: [{
    uri: request.params.uri,
    mimeType: "text/html;profile=mcp-app",
    text: "<html><body>echo</body></html>",
  }],
}));

await server.connect(new StdioServerTransport());
