import { describe, expect, it, vi } from "vitest";
import { handleAppHostRuntimeControl } from "../../src/apps/host-control.js";
import { InboundMessage } from "../../src/core/runtime-messages/events.js";

it("lists app summaries through an ack", async () => {
  const ack = vi.fn();
  const apps = { summaries: vi.fn(() => [{ id: "demo" }]), openEntryPoint: vi.fn() } as any;
  const msg = new InboundMessage({
    channel: "system", chatId: "runtime", content: "apps",
    metadata: { runtimeControl: "apps", action: "list", ack },
  });
  expect(await handleAppHostRuntimeControl({ apps, msg })).toBe(true);
  expect(ack).toHaveBeenCalledWith({ ok: true, result: { apps: [{ id: "demo" }] } });
});

it("opens an entry point through an ack", async () => {
  const ack = vi.fn();
  const view = { viewId: "v1" };
  const openEntryPoint = vi.fn(async () => view);
  const msg = new InboundMessage({
    channel: "system", chatId: "runtime", content: "apps",
    metadata: {
      runtimeControl: "apps", action: "open", ack,
      appId: "demo", sessionKey: "websocket:app-1", workspace: "/tmp/ws",
    },
  });
  await handleAppHostRuntimeControl({ apps: { summaries: vi.fn(), openEntryPoint } as any, msg });
  expect(openEntryPoint).toHaveBeenCalledWith("demo", { sessionKey: "websocket:app-1", workspace: "/tmp/ws" });
  expect(ack).toHaveBeenCalledWith({ ok: true, result: { view } });
});

it("fails closed for unknown actions and missing apps", async () => {
  const ack = vi.fn();
  const msg = new InboundMessage({
    channel: "system", chatId: "runtime", content: "apps",
    metadata: { runtimeControl: "apps", action: "nope", ack },
  });
  await handleAppHostRuntimeControl({ apps: null, msg });
  expect(ack).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
});

it("ignores other runtime controls", async () => {
  const ack = vi.fn();
  const msg = new InboundMessage({
    channel: "system", chatId: "runtime", content: "appBridge",
    metadata: { runtimeControl: "appBridge", ack },
  });
  expect(await handleAppHostRuntimeControl({ apps: null, msg })).toBe(false);
  expect(ack).not.toHaveBeenCalled();
});
