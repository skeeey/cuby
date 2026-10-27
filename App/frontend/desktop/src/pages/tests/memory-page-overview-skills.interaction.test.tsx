// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "../../app/providers.js";
import { useAppState } from "../../state/app-state.js";
import { MemoryPage } from "../memory-page.js";

vi.mock("../memory/overview-sub-page.js", () => ({
  OverviewSubPage: (props: { onOpenToolsSkills?: () => void }) => (
    <button type="button" data-overview-skills onClick={props.onOpenToolsSkills}>
      skills
    </button>
  )
}));

describe("MemoryPage overview skills card", () => {
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

  it("navigates to the tools skills section", async () => {
    await act(async () => {
      root.render(
        <AppProviders>
          <MemoryPageProbeHarness />
        </AppProviders>
      );
    });

    act(() => container.querySelector<HTMLButtonElement>("[data-overview-skills]")?.click());

    const probe = container.querySelector("[data-navigation-probe]");
    expect(probe?.getAttribute("data-path")).toBe("/tools");
    expect(probe?.getAttribute("data-pending")).toBe("tool-skill");
    expect(probe?.getAttribute("data-skill-id")).toBe("none");
  });
});

function MemoryPageProbeHarness() {
  const { state } = useAppState();
  const pending = state.navigation.pendingRequest;

  return (
    <>
      <span
        data-navigation-probe
        data-path={state.navigation.currentPath}
        data-pending={pending?.kind ?? "none"}
        data-skill-id={pending?.kind === "tool-skill" ? pending.skillId ?? "none" : ""}
      />
      <MemoryPage />
    </>
  );
}
