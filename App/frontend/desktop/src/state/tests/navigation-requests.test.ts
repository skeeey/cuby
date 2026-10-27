/** Cross-page navigation request tests. */
import { describe, expect, it } from "vitest";
import { appActions } from "../app-actions.js";
import { appReducer, createInitialAppState } from "../app-reducer.js";

describe("cross-page navigation requests", () => {
  it("opens the tools page with a pending skill request", () => {
    const state = appReducer(createInitialAppState(), appActions.openToolSkill("skill-1"));

    expect(state.navigation.currentPath).toBe("/tools");
    expect(state.navigation.pendingRequest).toMatchObject({
      kind: "tool-skill",
      skillId: "skill-1"
    });
  });

  it("opens the tools page without selecting a skill when only focusing the section", () => {
    const state = appReducer(createInitialAppState(), appActions.openToolSkill(null));

    expect(state.navigation.currentPath).toBe("/tools");
    expect(state.navigation.pendingRequest).toMatchObject({
      kind: "tool-skill",
      skillId: null
    });
  });

  it("opens the memory page with a pending memory reference", () => {
    const state = appReducer(createInitialAppState(), appActions.openMemoryReference("memory-policy-1", "policies"));

    expect(state.navigation.currentPath).toBe("/memory");
    expect(state.navigation.pendingRequest).toMatchObject({
      kind: "memory-reference",
      id: "memory-policy-1",
      fallbackPage: "policies"
    });
  });

  it("clears only the handled navigation request", () => {
    const pending = appReducer(createInitialAppState(), appActions.openToolSkill("skill-1"));
    const requestId = pending.navigation.pendingRequest?.requestId;

    expect(requestId).toBeTypeOf("number");
    expect(appReducer(pending, appActions.navigationRequestHandled(requestId! + 1)).navigation.pendingRequest).not.toBeNull();
    expect(appReducer(pending, appActions.navigationRequestHandled(requestId!)).navigation.pendingRequest).toBeNull();
  });
});
