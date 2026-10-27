// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "../../app/providers.js";
import { useAppState } from "../../state/app-state.js";
import { ToolsPage } from "../tools-page.js";

vi.mock("../tools/skills-section.js", () => ({
  SkillsSection: (props: { onOpenMemoryReference: (id: string, fallbackPage: string) => void }) => (
    <section data-tools-skills-section>
      <button
        type="button"
        data-skill-reference
        onClick={() => props.onOpenMemoryReference("skill-1", "memories")}
      >
        skill reference
      </button>
    </section>
  )
}));

describe("ToolsPage skill references", () => {
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
  });

  it("keeps a skill reference inside the tools page", async () => {
    await act(async () => {
      root.render(
        <AppProviders>
          <ToolsPageProbeHarness />
        </AppProviders>
      );
    });

    act(() => container.querySelector<HTMLButtonElement>("[data-skill-reference]")?.click());

    const probe = container.querySelector("[data-navigation-probe]");
    expect(probe?.getAttribute("data-path")).toBe("/tools");
    expect(probe?.getAttribute("data-pending")).toBe("tool-skill");
    expect(probe?.getAttribute("data-skill-id")).toBe("skill-1");
  });
});

function ToolsPageProbeHarness() {
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
      <ToolsPage />
    </>
  );
}
