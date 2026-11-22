import { describe, expect, it } from "vitest";
import { AppManifestError, parseAppManifest } from "@memmy/local-api-contracts";

const valid = {
  schemaVersion: 1,
  id: "financebuddy",
  name: "FinanceBuddy",
  version: "0.5.1",
  engines: { cuby: ">=2.1.0" },
  server: {
    scope: "session",
    transport: "stdio",
    command: { "linux-x64": "runtime/linux-x64/bin/python3" },
    args: ["server/main.py", "--config", "${APP_DATA}/config.json"],
    cwd: "${APP_ROOT}",
    env: { FINANCEBUDDY_WORKSPACE: "${APP_DATA}/workspace" }
  },
  ui: {
    resources: [{ uri: "ui://financebuddy/reader", entry: "ui/dist/index.html" }],
    defaultResourceUri: "ui://financebuddy/reader",
    prefersBorder: true,
    csp: { connectDomains: [], resourceDomains: [] }
  },
  capabilities: {
    appToolCalls: ["read_consistency_review"],
    appMessages: "allow",
    workspace: "none"
  }
};

describe("parseAppManifest", () => {
  it("accepts a valid manifest", () => {
    const parsed = parseAppManifest(valid);
    expect(parsed.id).toBe("financebuddy");
    expect(parsed.server.scope).toBe("session");
  });

  it("rejects an unknown placeholder", () => {
    expect(() => parseAppManifest({
      ...valid,
      server: { ...valid.server, args: ["${SECRET_DIR}/x"] }
    })).toThrow(AppManifestError);
  });

  it("rejects SESSION_WORKSPACE without session scope", () => {
    expect(() => parseAppManifest({
      ...valid,
      server: { ...valid.server, scope: "global", args: ["${SESSION_WORKSPACE}"] }
    })).toThrow(AppManifestError);
  });

  it("rejects duplicate UI resource URIs", () => {
    expect(() => parseAppManifest({
      ...valid,
      ui: { resources: [
        { uri: "ui://a/x", entry: "a.html" },
        { uri: "ui://a/x", entry: "b.html" }
      ] }
    })).toThrow(AppManifestError);
  });

  it("rejects plaintext secrets in server.env", () => {
    expect(() => parseAppManifest({
      ...valid,
      server: { ...valid.server, env: { API_KEY: "sk-live-1234567890" } }
    })).toThrow(AppManifestError);
  });
});
