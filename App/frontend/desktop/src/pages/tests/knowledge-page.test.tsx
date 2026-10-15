/** Knowledge page guard tests. */
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "../../app/providers.js";
import { appActions } from "../../state/app-actions.js";
import { appReducer, createInitialAppState, type AppState } from "../../state/app-reducer.js";
import { KnowledgePage } from "../knowledge-page.js";

const mocks = vi.hoisted(() => ({
  state: null as AppState | null
}));

vi.mock("../../state/app-state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../state/app-state.js")>();
  return { ...actual, useAppState: () => ({ state: mocks.state, dispatch: vi.fn() }) };
});

const knowledgeUnavailableText = "知识库需要 Cuby 云账号，当前账号不可用。";

beforeEach(() => {
  mocks.state = createInitialAppState();
});

function stateWithIdentity(identityProvider: "memmy_cloud" | "cuberouter"): AppState {
  return appReducer(createInitialAppState(), appActions.accountUpdated({ identityProvider }));
}

describe("KnowledgePage identity gate", () => {
  it("shows the cloud requirement notice instead of the workspace for a cuberouter identity", () => {
    mocks.state = stateWithIdentity("cuberouter");
    const html = renderToString(
      <AppProviders>
        <KnowledgePage />
      </AppProviders>
    );

    expect(html).toContain(knowledgeUnavailableText);
    expect(html).not.toContain("登录 Cuby");
  });

  it("keeps rendering the workspace shell for a memmy cloud identity", () => {
    mocks.state = stateWithIdentity("memmy_cloud");
    const html = renderToString(
      <AppProviders>
        <KnowledgePage />
      </AppProviders>
    );

    expect(html).not.toContain(knowledgeUnavailableText);
  });
});
