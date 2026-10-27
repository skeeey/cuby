// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppProviders } from "../../app/providers.js";
import { appActions } from "../../state/app-actions.js";
import { useAppState } from "../../state/app-state.js";
import { MemoryPage } from "../memory-page.js";

describe("MemoryPage reference navigation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    window.sessionStorage.clear();
  });

  it("consumes a pending memory reference and selects its sub-page", async () => {
    await act(async () => {
      root.render(
        <AppProviders>
          <MemoryReferenceHarness id="memory-policy-1" />
        </AppProviders>
      );
    });

    expect(container.querySelector("[data-pending-request]")?.getAttribute("data-pending-request")).toBe("none");
    expect(container.querySelector('[data-memory-page="policies"].app-frame-nav-button--active')).not.toBeNull();
  });

  it("redirects a skill reference to the tools page", async () => {
    await act(async () => {
      root.render(
        <AppProviders>
          <MemoryReferenceHarness id="skill-1" />
        </AppProviders>
      );
    });

    const probe = container.querySelector("[data-navigation-probe]");
    expect(probe?.getAttribute("data-path")).toBe("/tools");
    expect(probe?.getAttribute("data-pending")).toBe("tool-skill");
    expect(probe?.getAttribute("data-skill-id")).toBe("skill-1");
  });
});

function MemoryReferenceHarness(props: { id: string }) {
  const { state, dispatch } = useAppState();
  const pending = state.navigation.pendingRequest;

  useEffect(() => {
    dispatch(appActions.openMemoryReference(props.id, "policies"));
  }, [dispatch, props.id]);

  return (
    <>
      <span
        data-navigation-probe
        data-path={state.navigation.currentPath}
        data-pending={pending?.kind ?? "none"}
        data-skill-id={pending?.kind === "tool-skill" ? pending.skillId ?? "none" : ""}
      />
      <span data-pending-request={pending?.kind ?? "none"} />
      <MemoryPage />
    </>
  );
}
