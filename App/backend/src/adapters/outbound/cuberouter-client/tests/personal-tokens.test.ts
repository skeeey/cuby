/** Cuberouter personal token tests. */
import { describe, expect, it, vi } from "vitest";
import { createHttpCuberouterClient } from "../index.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function clientWith(fetchImpl: typeof fetch) {
  return createHttpCuberouterClient({
    baseUrl: "http://127.0.0.1:3000",
    timeoutMs: 1000,
    fetchImpl
  });
}

describe("cuberouter personal tokens", () => {
  it("searches by exact name and maps id/name, never the masked key", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: true,
        message: "",
        data: {
          items: [{ id: 41, name: "cuby-desktop-alice", key: "sk-abcd**********wxyz" }],
          total: 1,
          page_size: 100
        }
      })
    );

    await expect(
      clientWith(fetchImpl as unknown as typeof fetch).searchPersonalTokens("jwt-1", "cuby-desktop-alice")
    ).resolves.toEqual([{ id: 41, name: "cuby-desktop-alice" }]);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/api/token/search?keyword=cuby-desktop-alice&page_size=100");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer jwt-1");
  });

  it("drops rows the search returned without a usable id or name", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: true,
        message: "",
        data: { items: [{ id: 1 }, { name: "no-id" }, { id: 2, name: "kept" }], total: 3 }
      })
    );

    await expect(
      clientWith(fetchImpl as unknown as typeof fetch).searchPersonalTokens("jwt-1", "kept")
    ).resolves.toEqual([{ id: 2, name: "kept" }]);
  });

  it("creates with unlimited quota and never-expiring, because a stored 0 would be expired", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, message: "", data: {} }));

    await clientWith(fetchImpl as unknown as typeof fetch).createPersonalToken("jwt-1", {
      name: "cuby-desktop-alice"
    });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/api/token/");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      name: "cuby-desktop-alice",
      unlimited_quota: true,
      expired_time: -1
    });
  });

  it("reads the plaintext key of one personal token", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, message: "", data: { key: "sk-personal-secret" } })
    );

    await expect(
      clientWith(fetchImpl as unknown as typeof fetch).getPersonalTokenKey("jwt-1", 41)
    ).resolves.toBe("sk-personal-secret");

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3000/api/token/41/key");
    expect(init.method).toBe("POST");
  });

  it("refuses a key read that came back without a secret", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, message: "", data: {} }));

    await expect(
      clientWith(fetchImpl as unknown as typeof fetch).getPersonalTokenKey("jwt-1", 41)
    ).rejects.toMatchObject({ code: "rejected", message: "cuberouter 未返回个人密钥的明文" });
  });
});
