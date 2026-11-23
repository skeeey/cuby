/** Legal modal mount source tests. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routerSource = readFileSync(fileURLToPath(new URL("../router.tsx", import.meta.url)), "utf8");

describe("AppRouter legal modal", () => {
  it("mounts the legal modal at the router root", () => {
    expect(routerSource).toContain("<LegalDocumentModal");
    expect(routerSource).toContain("kind={state.legalDocument}");
    expect(routerSource).toContain("appActions.closeLegalDocument()");
  });
});
