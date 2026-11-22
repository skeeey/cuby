import { describe, expect, it, vi } from "vitest";
import { handleAppRuntimeControl } from "../../src/apps/bridge.js";
import { InboundMessage } from "../../src/core/runtime-messages/events.js";

it("routes tools/call to the app manager", async () => {
  const callTool = vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));
  const ack = vi.fn();
  const msg = new InboundMessage({
    channel: "system", chatId: "runtime", content: "appBridge",
    metadata: {
      runtimeControl: "appBridge", ack,
      appId: "demo", viewId: "v1", chatId: "chat-1", sessionKey: "websocket:chat-1", method: "tools/call",
      params: { name: "hello", arguments: { x: 1 } }
    }
  });
  const handled = await handleAppRuntimeControl({
    apps: { callTool, canAppMessage: vi.fn() } as any,
    msg,
    publishInbound: vi.fn()
  });
  expect(handled).toBe(true);
  expect(callTool).toHaveBeenCalledWith("demo", "hello", { x: 1 }, expect.objectContaining({ sessionKey: "websocket:chat-1" }));
  expect(ack).toHaveBeenCalledWith({ ok: true, result: expect.anything() });
});

it("rejects ui/message when the app has no message capability", async () => {
  const ack = vi.fn();
  const msg = new InboundMessage({
    channel: "system", chatId: "runtime", content: "appBridge",
    metadata: { runtimeControl: "appBridge", ack, appId: "demo", viewId: "v1", chatId: "chat-1", method: "ui/message", params: { content: [] } }
  });
  await handleAppRuntimeControl({ apps: { callTool: vi.fn(), canAppMessage: () => false } as any, msg, publishInbound: vi.fn() });
  expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
});
