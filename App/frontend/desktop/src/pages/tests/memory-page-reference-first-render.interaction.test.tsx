// @vitest-environment happy-dom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "../../app/providers.js";
import { appActions } from "../../state/app-actions.js";
import { useAppState } from "../../state/app-state.js";
import { MemoryPage } from "../memory-page.js";

const renderedPages = vi.hoisted(() => [] as string[]);

vi.mock("../memory/memories-sub-page.js", () => ({
  MemoriesSubPage: () => {
    renderedPages.push("memories");
    return <div data-page="memories" />;
  }
}));

vi.mock("../memory/policies-sub-page.js", () => ({
  PoliciesSubPage: () => {
    renderedPages.push("policies");
    return <div data-page="policies" />;
  }
}));

describe("MemoryPage pending reference first render", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    renderedPages.length = 0;
    window.sessionStorage.clear();
    window.sessionStorage.setItem("memmy.memorySubPage", "memories");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    window.sessionStorage.clear();
  });

  it("selects the referenced sub-page before the first commit", async () => {
    await act(async () => {
      root.render(
        <AppProviders>
          <MemoryReferenceHarness />
        </AppProviders>
      );
    });

    expect(renderedPages).toContain("policies");
    expect(renderedPages).not.toContain("memories");
    expect(container.querySelector('[data-page="policies"]')).not.toBeNull();
  });
});

function MemoryReferenceHarness() {
  const { dispatch } = useAppState();
  const [navigated, setNavigated] = useState(false);

  useEffect(() => {
    dispatch(appActions.openMemoryReference("memory-policy-1", "policies"));
    setNavigated(true);
  }, [dispatch]);

  return navigated ? <MemoryPage /> : null;
}
