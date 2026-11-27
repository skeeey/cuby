// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "../../app/providers.js";
import { AppChatPanel, ensurePanelChat, panelMessageMeta } from "../app-chat-panel.js";

describe("AppChatPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("creates a visible chat only when the panel opens", async () => {
    const ensureChat = vi.fn(async () => "chat-1");
    const renderPanel = async (open: boolean) => {
      await act(async () => {
        root.render(
          <AppProviders>
            <AppChatPanel
              open={open}
              appName="Demo"
              chatId={null}
              onClose={vi.fn()}
              onEnsureChat={ensureChat}
              onAppMessage={vi.fn()}
            />
          </AppProviders>
        );
      });
    };

    await renderPanel(false);
    expect(ensureChat).not.toHaveBeenCalled();
    await renderPanel(true);
    await vi.waitFor(() => expect(ensureChat).toHaveBeenCalledTimes(1));
  });

  it("sends the pending app message after opening", async () => {
    const onAppMessage = vi.fn(async () => undefined);
    const onPendingAppMessageConsumed = vi.fn();
    await act(async () => {
      root.render(
        <AppProviders>
          <AppChatPanel
            open
            appName="Demo"
            chatId="chat-1"
            pendingAppMessage="hi"
            onClose={vi.fn()}
            onEnsureChat={async () => "chat-1"}
            onAppMessage={onAppMessage}
            onPendingAppMessageConsumed={onPendingAppMessageConsumed}
          />
        </AppProviders>
      );
    });

    await vi.waitFor(() => expect(onAppMessage).toHaveBeenCalledWith("chat-1", "hi"));
    await vi.waitFor(() => expect(onPendingAppMessageConsumed).toHaveBeenCalledTimes(1));
  });

  it("reuses a chat-origin chat without creating a new one", async () => {
    const newChat = vi.fn(async () => "chat-new");
    await expect(ensurePanelChat({ target: { origin: "chat", chatId: "chat-1" }, newChat }))
      .resolves.toBe("chat-1");
    expect(newChat).not.toHaveBeenCalled();
  });

  it("sends a pending app message only once across callback identity changes", async () => {
    const onAppMessage = vi.fn(async () => undefined);
    const renderPanel = async (onConsumed: () => void) => {
      await act(async () => {
        root.render(
          <AppProviders>
            <AppChatPanel
              open
              appName="Demo"
              chatId="chat-1"
              pendingAppMessage="hi"
              onClose={vi.fn()}
              onEnsureChat={async () => "chat-1"}
              onAppMessage={onAppMessage}
              onPendingAppMessageConsumed={onConsumed}
            />
          </AppProviders>
        );
      });
    };

    await renderPanel(vi.fn());
    await vi.waitFor(() => expect(onAppMessage).toHaveBeenCalledTimes(1));
    await renderPanel(vi.fn());
    await act(async () => { await Promise.resolve(); });
    expect(onAppMessage).toHaveBeenCalledTimes(1);
  });

  it("labels app-originated messages with the app id", () => {
    expect(panelMessageMeta({ role: "user", appId: "demo", appControlled: true }))
      .toBe("user · demo");
    expect(panelMessageMeta({ role: "user" })).toBe("user");
  });
});
