/** MCP tools section tests. */
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../i18n/i18n-provider.js";
import { McpToolsSectionView, mcpStatusKey, type McpToolsSectionViewProps } from "../mcp-tools-section.js";
import type { McpPresetPayload } from "../../api/memmy-agent-client.js";

function preset(overrides: Partial<McpPresetPayload> & Pick<McpPresetPayload, "name" | "display_name" | "status">): McpPresetPayload {
  return {
    installed: overrides.status === "configured",
    source: "preset",
    required_fields: [],
    ...overrides
  } as McpPresetPayload;
}

const noop = () => undefined;

function renderView(overrides: Partial<McpToolsSectionViewProps> = {}): string {
  return renderToString(
    <I18nProvider language="en-US">
      <McpToolsSectionView
        status="ready"
        presets={[
          preset({ name: "exa", display_name: "Exa", status: "not_installed" }),
          preset({ name: "brave-search", display_name: "Brave Search", status: "configured" }),
          preset({ name: "docker-thing", display_name: "Docker Thing", status: "missing_dependency" }),
          preset({ name: "figma", display_name: "Figma", status: "not_installed", group: "dev" })
        ]}
        modal={{ kind: "closed" }}
        busy={false}
        modalError=""
        testResult={null}
        onOpenInstall={noop}
        onOpenManage={noop}
        onOpenCustom={noop}
        onCloseModal={noop}
        onSubmitInstall={noop}
        onTestServer={noop}
        onRemoveServer={noop}
        onSubmitCustom={noop}
        {...overrides}
      />
    </I18nProvider>
  );
}

describe("McpToolsSectionView", () => {
  it("renders the general presets with status labels", () => {
    const html = renderView();

    expect(html).toContain("MCP servers");
    expect(html).toContain("Exa");
    expect(html).toContain("Brave Search");
    expect(html).toContain("Configured");
    expect(html).toContain("Not installed");
    expect(html).toContain("Missing dependency");
  });

  it("folds the developer presets behind a collapsed group", () => {
    const html = renderView();

    expect(html).toContain("Developer tools");
    expect(html).not.toContain("Figma");
  });

  it("shows the load failure message instead of the grid", () => {
    const html = renderView({ status: "error", message: "boom" });

    expect(html).toContain("boom");
    expect(html).not.toContain("Brave Search");
  });

  it("renders the install modal with declared fields", () => {
    const html = renderView({
      modal: {
        kind: "install",
        preset: preset({
          name: "brave-search",
          display_name: "Brave Search",
          status: "not_installed",
          requires: "Node.js, npx, and Brave Search API key",
          required_fields: [{ name: "brave_api_key", label: "Brave Search API key", secret: true, required: true, configured: false }]
        })
      }
    });

    expect(html).toContain("Install Brave Search");
    expect(html).toContain("Brave Search API key");
    expect(html).toContain("Requirements: Node.js, npx, and Brave Search API key");
  });

  it("renders the manage modal with test, remove, and the last action", () => {
    const html = renderView({
      modal: { kind: "manage", preset: preset({ name: "exa", display_name: "Exa", status: "configured" }) },
      testResult: { ok: true, message: "Exa connected with 3 tools.", tool_names: ["a", "b", "c"] }
    });

    expect(html).toContain("Manage Exa");
    expect(html).toContain("Test connection");
    expect(html).toContain("Remove");
    expect(html).toContain("Exa connected with 3 tools.");
  });

  it("maps every server status to its label key", () => {
    expect(mcpStatusKey("not_installed")).toBe("tools.mcp.status.notInstalled");
    expect(mcpStatusKey("configured")).toBe("tools.mcp.status.configured");
    expect(mcpStatusKey("missing_credentials")).toBe("tools.mcp.status.missingCredentials");
    expect(mcpStatusKey("missing_dependency")).toBe("tools.mcp.status.missingDependency");
    expect(mcpStatusKey("coming_soon")).toBe("tools.mcp.status.comingSoon");
  });
});
