// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/i18n-provider.js";
import { McpToolsSection, type McpPresetsClient } from "../mcp-tools-section.js";
import type { McpPresetsPayload } from "../../api/memmy-agent-client.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const basePreset = {
  name: "brave-search",
  display_name: "Brave Search",
  status: "not_installed",
  installed: false,
  source: "preset",
  required_fields: [{ name: "brave_api_key", label: "Brave Search API key", secret: true, required: true, configured: false }]
} as McpPresetsPayload["presets"][number];

function createClient(overrides: Partial<McpPresetsClient> = {}): McpPresetsClient {
  return {
    listMcpPresets: vi.fn(async () => ({ presets: [basePreset], installed_count: 0 })),
    enableMcpPreset: vi.fn(async () => ({ presets: [{ ...basePreset, status: "configured", installed: true }], installed_count: 1 })),
    removeMcpServer: vi.fn(async () => ({ presets: [basePreset], installed_count: 0 })),
    testMcpServer: vi.fn(async () => ({ presets: [{ ...basePreset, status: "configured", installed: true }], installed_count: 1, last_action: { ok: true, message: "Brave Search connected with 2 tools." } })),
    addCustomMcpServer: vi.fn(async () => ({ presets: [basePreset], installed_count: 0 })),
    ...overrides
  };
}

describe("McpToolsSection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  function render(client: McpPresetsClient | null) {
    return act(async () => {
      root.render(
        <I18nProvider language="en-US">
          <McpToolsSection client={client} />
        </I18nProvider>
      );
    });
  }

  it("lists presets, installs one through the modal, and updates the card", async () => {
    const client = createClient();
    await render(client);

    const card = container.querySelector<HTMLButtonElement>(".integration-card");
    expect(card?.textContent).toContain("Brave Search");

    await act(async () => card?.click());
    const input = container.querySelector<HTMLInputElement>('input[type="password"]');
    expect(input).not.toBeNull();

    await act(async () => {
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, "BSA_test");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    const install = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Install");
    await act(async () => install?.click());

    expect(client.enableMcpPreset).toHaveBeenCalledWith("brave-search", { brave_api_key: "BSA_test" });
    expect(container.textContent).toContain("Configured");
  });

  it("keeps the manage modal open and shows the test result verbatim", async () => {
    const client = createClient({
      listMcpPresets: vi.fn(async () => ({ presets: [{ ...basePreset, status: "configured", installed: true }], installed_count: 1 }))
    });
    await render(client);

    await act(async () => container.querySelector<HTMLButtonElement>(".integration-card")?.click());
    const test = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Test connection");
    await act(async () => test?.click());

    expect(container.textContent).toContain("Brave Search connected with 2 tools.");
  });

  it("surfaces a failed action's message inside the modal", async () => {
    const client = createClient({
      enableMcpPreset: vi.fn(async () => {
        throw new Error("MCP settings payload is too large");
      })
    });
    await render(client);

    await act(async () => container.querySelector<HTMLButtonElement>(".integration-card")?.click());
    const install = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Install");
    await act(async () => install?.click());

    expect(container.textContent).toContain("MCP settings payload is too large");
  });

  it("shows a section-level error when the listing fails, and loading without a client", async () => {
    await render(
      createClient({
        listMcpPresets: vi.fn(async () => {
          throw new Error("bootstrap failed");
        })
      })
    );
    expect(container.textContent).toContain("bootstrap failed");
    expect(container.textContent).not.toContain("Brave Search");

    await render(null);
    expect(container.textContent).toContain("Loading");
  });
});
