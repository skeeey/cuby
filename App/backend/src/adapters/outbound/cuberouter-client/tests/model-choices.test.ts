/** Cuberouter model-choice reads (balance, models, my keys). */
import { describe, expect, it, vi } from "vitest";
import { createHttpCuberouterClient } from "../index.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function clientWith(fetchImpl: typeof fetch) {
  return createHttpCuberouterClient({ baseUrl: "http://127.0.0.1:3000", timeoutMs: 1000, fetchImpl });
}

describe("cuberouter self and models", () => {
  it("reads the member's own quota and used quota", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, message: "", data: { quota: 1234567, used_quota: 4200 } })
    );

    await expect(
      clientWith(fetchImpl as unknown as typeof fetch).getSelf("jwt-1")
    ).resolves.toEqual({ quota: 1234567, usedQuota: 4200 });

    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/api/user/self");
  });

  it("reads a flat deduped model name list, dropping blank and non-string rows", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, message: "", data: ["deepseek-v4.1-flash", "  ", 7, "gpt-oss-120b"] })
    );

    await expect(
      clientWith(fetchImpl as unknown as typeof fetch).getUserModels("jwt-1")
    ).resolves.toEqual(["deepseek-v4.1-flash", "gpt-oss-120b"]);
  });
});

describe("cuberouter my tokens", () => {
  it("lists every personal token page row, masked, with its status", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: true,
        message: "",
        data: {
          items: [
            { id: 41, name: "cuby-desktop-alice", key: "sk-****wxyz", status: 1 },
            { id: 42, name: "my-old-key", status: 2 }
          ],
          total: 2
        }
      })
    );

    await expect(
      clientWith(fetchImpl as unknown as typeof fetch).listPersonalTokens("jwt-1")
    ).resolves.toEqual([
      { id: 41, name: "cuby-desktop-alice", status: 1 },
      { id: 42, name: "my-old-key", status: 2 }
    ]);

    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/api/token/?page_size=100");
  });

  it("asks for the organization tokens of one member, with all statuses", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: true,
        message: "",
        data: {
          items: [
            { id: 11, name: "cuby-desktop-alice", key: "sk-org", status: 1, responsible_user_id: 7 },
            { id: 12, name: "admin-gifted", key: "sk-gift", status: 2, responsible_user_id: 7 }
          ],
          total: 2
        }
      })
    );

    await expect(
      clientWith(fetchImpl as unknown as typeof fetch).listMyOrganizationTokens("jwt-1", "5", 7)
    ).resolves.toEqual([
      { id: 11, name: "cuby-desktop-alice", key: "sk-org", status: 1, responsibleUserId: 7 },
      { id: 12, name: "admin-gifted", key: "sk-gift", status: 2, responsibleUserId: 7 }
    ]);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/api/organizations/5/tokens?responsible_user_id=7&page_size=100");
    expect(init.headers).toMatchObject({
      "X-Account-Context-Type": "organization",
      "X-Account-Context-Id": "5"
    });
  });
});

describe("cuberouter organizations", () => {
  it("carries the organization pool the row reports, and omits it when absent", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: true,
        message: "",
        data: [
          { id: 5, name: "yeebo", quota: 100000, used_quota: 2500 },
          { id: 3, name: "Research" }
        ]
      })
    );

    await expect(
      clientWith(fetchImpl as unknown as typeof fetch).listOrganizations("jwt-1")
    ).resolves.toEqual([
      { id: "5", name: "yeebo", quota: 100000, usedQuota: 2500 },
      { id: "3", name: "Research" }
    ]);
  });
});
