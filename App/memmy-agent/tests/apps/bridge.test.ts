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
    apps: { callTool, canAppMessage: vi.fn(), canAppCallTool: () => true } as any,
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

it("rejects tools outside the app allowlist", async () => {
  const callTool = vi.fn();
  const ack = vi.fn();
  const msg = new InboundMessage({
    channel: "system", chatId: "runtime", content: "appBridge",
    metadata: {
      runtimeControl: "appBridge", ack, appId: "demo", viewId: "v1", chatId: "chat-1", method: "tools/call",
      params: { name: "secret_tool", arguments: {} }
    }
  });
  await handleAppRuntimeControl({
    apps: { callTool, canAppMessage: vi.fn(), canAppCallTool: () => false } as any,
    msg,
    publishInbound: vi.fn()
  });
  expect(callTool).not.toHaveBeenCalled();
  expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
});

it("fails closed when the app manager has no tool allowlist check", async () => {
  const callTool = vi.fn();
  const ack = vi.fn();
  const msg = new InboundMessage({
    channel: "system", chatId: "runtime", content: "appBridge",
    metadata: {
      runtimeControl: "appBridge", ack, appId: "demo", viewId: "v1", chatId: "chat-1", method: "tools/call",
      params: { name: "hello", arguments: {} }
    }
  });
  await handleAppRuntimeControl({
    apps: { callTool, canAppMessage: vi.fn() } as any,
    msg,
    publishInbound: vi.fn()
  });
  expect(callTool).not.toHaveBeenCalled();
  expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
});

it("rate limits app messages per view", async () => {
  const ack = vi.fn();
  const publishInbound = vi.fn(async () => undefined);
  const apps = { callTool: vi.fn(), canAppMessage: () => true, canAppCallTool: () => true } as any;
  for (let index = 0; index < 11; index += 1) {
    const msg = new InboundMessage({
      channel: "system", chatId: "runtime", content: "appBridge",
      metadata: {
        runtimeControl: "appBridge", ack, appId: "rate-app", viewId: "rate-view", chatId: "chat-1",
        method: "ui/message", params: { content: [{ type: "text", text: `message ${index}` }] }
      }
    });
    await handleAppRuntimeControl({ apps, msg, publishInbound });
  }
  expect(publishInbound).toHaveBeenCalledTimes(10);
  expect(ack).toHaveBeenLastCalledWith(expect.objectContaining({ ok: false }));
});

it("routes app messages with the derived session key", async () => {
  const ack = vi.fn();
  const published: InboundMessage[] = [];
  const msg = new InboundMessage({
    channel: "system", chatId: "runtime", content: "appBridge",
    metadata: {
      runtimeControl: "appBridge", ack, appId: "session-app", viewId: "session-view", chatId: "chat-1",
      sessionKey: "websocket:canonical", method: "ui/message",
      params: { content: [{ type: "text", text: "hello" }] }
    }
  });
  await handleAppRuntimeControl({
    apps: { callTool: vi.fn(), canAppMessage: () => true, canAppCallTool: () => true } as any,
    msg,
    publishInbound: async (message) => { published.push(message); },
  });
  expect(published[0]?.sessionKey).toBe("websocket:canonical");
  expect(published[0]?.metadata).toMatchObject({ source: "mcp-app", appId: "session-app", viewId: "session-view", appControlled: true });
});
