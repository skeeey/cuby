// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/i18n-provider.js";
import { TaskRow } from "../app-frame.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const task = {
  sessionKey: "websocket:chat-app",
  chatId: "chat-app",
  title: "Notes chat",
  preview: "",
  updatedAt: null,
  runStartedAt: null,
  completedUnseen: false,
  pinned: false,
  archived: false,
  tags: [],
  projectId: null,
  groupProjectId: null,
  cwd: "/tmp",
  missingProject: false,
  appId: "example-notes",
  appName: "Example Notes",
};

describe("TaskRow app action", () => {
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

  it("opens the app from the hover action", async () => {
    const onOpenInApp = vi.fn();
    await act(async () => {
      root.render(
        <I18nProvider language="zh-CN">
          <TaskRow
            task={task}
            appDisplayName="Example Notes"
            isCurrent={false}
            showPreview={false}
            onOpen={() => undefined}
            onContextMenu={() => undefined}
            onPin={() => undefined}
            archiveConfirming={false}
            onRequestArchive={() => undefined}
            onConfirmArchive={() => undefined}
            onUnarchive={() => undefined}
            onDeleteArchived={() => undefined}
            onOpenInApp={onOpenInApp}
          />
        </I18nProvider>
      );
    });

    const row = container.querySelector(".app-frame-task-row");
    await act(async () => {
      row?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });

    const button = container.querySelector('[aria-label="在 app 中打开"]');
    expect(button).not.toBeNull();
    await act(async () => {
      (button as HTMLButtonElement).click();
    });
    expect(onOpenInApp).toHaveBeenCalledTimes(1);
  });
});
