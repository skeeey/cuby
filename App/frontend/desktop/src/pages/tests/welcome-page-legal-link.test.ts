/** Welcome page legal link tests. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const authPanelSourcePath = fileURLToPath(new URL("../../components/account-auth-panel.tsx", import.meta.url));

describe("WelcomePage 协议入口", () => {
  it("服务协议入口打开应用内本地协议", () => {
    const source = readSource(authPanelSourcePath);
    expect(source).toContain('appActions.openLegalDocument("terms")');
    expect(source).not.toContain("getLegalLinkUrl");
    expect(source).not.toContain("openExternalUrl");
  });

  it("数据协议入口打开应用内本地协议", () => {
    const source = readSource(authPanelSourcePath);
    expect(source).toContain('appActions.openLegalDocument("data")');
  });

  it("协议入口不导航到应用内 /terms 或 /data-use 路由", () => {
    const source = readSource(authPanelSourcePath);
    expect(source).not.toContain('appActions.navigate("/terms")');
    expect(source).not.toContain('appActions.navigate("/data-use")');
  });
});

function readSource(path: string): string {
  return readFileSync(path, "utf8");
}
