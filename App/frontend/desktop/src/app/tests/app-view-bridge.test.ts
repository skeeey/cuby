import { describe, expect, it, vi } from "vitest";
import { AppViewBridge } from "../app-view-bridge.js";

function makeBridge() {
  const postMessage = vi.fn();
  const callTool = vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));
  const bridge = new AppViewBridge({
    iframe: { contentWindow: { postMessage } },
    view: { viewId: "v1", appId: "demo", resourceUri: "ui://demo/x", toolName: "hello", title: "Hello", displayMode: "inline", protocol: "mcp-apps/2026-01-26" },
    hostContext: () => ({ theme: "light", displayMode: "inline" }),
    transport: { callTool, readResource: vi.fn(), sendMessage: vi.fn(), readViewResult: vi.fn() },
    openLink: vi.fn(),
    downloadFile: vi.fn()
  });
  bridge.start();
  return { bridge, postMessage, callTool };
}

function makeChatBridge(capability: "allow" | "ask", onOpenChat = vi.fn(async () => undefined)) {
  const postMessage = vi.fn();
  const sendMessage = vi.fn(async () => ({ ok: true }));
  const bridge = new AppViewBridge({
    iframe: { contentWindow: { postMessage } },
    view: {
      viewId: "v1",
      appId: "demo",
      resourceUri: "ui://demo/x",
      toolName: "hello",
      title: "Hello",
      displayMode: "inline",
      protocol: "mcp-apps/2026-01-26",
      capabilities: { appMessages: capability }
    },
    hostContext: () => ({}),
    transport: { callTool: vi.fn(), readResource: vi.fn(), sendMessage, readViewResult: vi.fn() },
    layout: "page",
    onOpenChat
  });
  return { bridge, postMessage, sendMessage, onOpenChat };
}

describe("AppViewBridge", () => {
  it("answers ui/initialize with host capabilities and context", async () => {
    const { bridge, postMessage } = makeBridge();
    await bridge.handleMessage({
      source: (bridge as any).iframeWindow,
      data: { jsonrpc: "2.0", id: 1, method: "ui/initialize", params: { protocolVersion: "2026-01-26", appCapabilities: {}, appInfo: { name: "demo", version: "1" } } }
    });
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      jsonrpc: "2.0", id: 1,
      result: expect.objectContaining({
        protocolVersion: "2026-01-26",
        hostCapabilities: expect.objectContaining({ openLinks: {}, downloadFile: {} }),
        hostContext: expect.objectContaining({ theme: "light" })
      })
    }), "*");
  });

  it("forwards tools/call to the transport", async () => {
    const { bridge, postMessage, callTool } = makeBridge();
    await bridge.handleMessage({
      source: (bridge as any).iframeWindow,
      data: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "read_consistency_page", arguments: { page: 1 } } }
    });
    expect(callTool).toHaveBeenCalledWith({ appId: "demo", viewId: "v1", tool: "read_consistency_page", arguments: { page: 1 }, timeoutMs: 30000 });
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 2, result: expect.anything() }), "*");
  });

  it("rejects non-http open-link URLs", async () => {
    const openLink = vi.fn();
    const postMessage = vi.fn();
    const bridge = new AppViewBridge({
      iframe: { contentWindow: { postMessage } },
      view: { viewId: "v1", appId: "demo", resourceUri: "ui://demo/x", toolName: "hello", title: "Hello", displayMode: "inline", protocol: "mcp-apps/2026-01-26" },
      hostContext: () => ({}),
      transport: { callTool: vi.fn(), readResource: vi.fn(), sendMessage: vi.fn(), readViewResult: vi.fn() },
      openLink
    });
    await bridge.handleMessage({
      source: (bridge as any).iframeWindow,
      data: { jsonrpc: "2.0", id: 3, method: "ui/open-link", params: { url: "javascript:alert(1)" } }
    });
    expect(openLink).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 3, error: expect.anything() }), "*");
  });

  it("does not advertise openLinks or downloadFile without callbacks", async () => {
    const postMessage = vi.fn();
    const bridge = new AppViewBridge({
      iframe: { contentWindow: { postMessage } },
      view: { viewId: "v1", appId: "demo", resourceUri: "ui://demo/x", toolName: "hello", title: "Hello", displayMode: "inline", protocol: "mcp-apps/2026-01-26" },
      hostContext: () => ({}),
      transport: { callTool: vi.fn(), readResource: vi.fn(), sendMessage: vi.fn(), readViewResult: vi.fn() }
    });
    await bridge.handleMessage({
      source: (bridge as any).iframeWindow,
      data: { jsonrpc: "2.0", id: 4, method: "ui/initialize", params: { protocolVersion: "2026-01-26", appCapabilities: {}, appInfo: { name: "demo", version: "1" } } }
    });
    const response = postMessage.mock.calls[0]?.[0];
    expect(response.result.hostCapabilities.openLinks).toBeUndefined();
    expect(response.result.hostCapabilities.downloadFile).toBeUndefined();
  });

  it("rejects open-link when no capability callback is configured", async () => {
    const postMessage = vi.fn();
    const bridge = new AppViewBridge({
      iframe: { contentWindow: { postMessage } },
      view: { viewId: "v1", appId: "demo", resourceUri: "ui://demo/x", toolName: "hello", title: "Hello", displayMode: "inline", protocol: "mcp-apps/2026-01-26" },
      hostContext: () => ({}),
      transport: { callTool: vi.fn(), readResource: vi.fn(), sendMessage: vi.fn(), readViewResult: vi.fn() }
    });
    await bridge.handleMessage({
      source: (bridge as any).iframeWindow,
      data: { jsonrpc: "2.0", id: 5, method: "ui/open-link", params: { url: "https://example.com" } }
    });
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 5, error: expect.anything() }), "*");
  });

  it("rejects ui/open-chat unless appMessages is allow", async () => {
    const { bridge, postMessage, onOpenChat } = makeChatBridge("ask");
    await bridge.handleMessage({
      source: (bridge as any).iframeWindow,
      data: { jsonrpc: "2.0", id: 1, method: "ui/open-chat", params: { message: "hi" } }
    });
    expect(onOpenChat).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, error: expect.anything() }),
      "*"
    );
  });

  it("routes ui/open-chat when appMessages is allow", async () => {
    const { bridge, onOpenChat } = makeChatBridge("allow");
    await bridge.handleMessage({
      source: (bridge as any).iframeWindow,
      data: { jsonrpc: "2.0", id: 1, method: "ui/open-chat", params: { message: "hi" } }
    });
    expect(onOpenChat).toHaveBeenCalledWith({ message: "hi" });
  });

  it("routes page-mode ui/message to the chat panel", async () => {
    const { bridge, sendMessage, onOpenChat } = makeChatBridge("allow");
    await bridge.handleMessage({
      source: (bridge as any).iframeWindow,
      data: {
        jsonrpc: "2.0",
        id: 2,
        method: "ui/message",
        params: { content: [{ type: "text", text: "hi" }] }
      }
    });
    expect(onOpenChat).toHaveBeenCalledWith({ message: "hi" });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
