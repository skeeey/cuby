// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppProviders } from "../../app/providers.js";
import { appActions } from "../../state/app-actions.js";
import { useAppState } from "../../state/app-state.js";
import { ToolsPage } from "../tools-page.js";

describe("ToolsPage skill navigation", () => {
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

  it("consumes a pending skill navigation request", async () => {
    await act(async () => {
      root.render(
        <AppProviders>
          <SkillNavigationHarness />
        </AppProviders>
      );
    });

    expect(container.querySelector("[data-pending-request]")?.getAttribute("data-pending-request")).toBe("none");
    expect(container.querySelector("[data-tools-skills-section]")).not.toBeNull();
  });
});

function SkillNavigationHarness() {
  const { state, dispatch } = useAppState();

  useEffect(() => {
    dispatch(appActions.openToolSkill("skill-1"));
  }, [dispatch]);

  return (
    <>
      <span data-pending-request={state.navigation.pendingRequest?.kind ?? "none"} />
      <ToolsPage />
    </>
  );
}
