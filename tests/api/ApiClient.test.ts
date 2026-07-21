import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../src/api/ApiClient";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ApiClient", () => {
  it("posts quote with a dynamic bearer token and unwraps data", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ code: 0, msg: "ok", data: { bestQuote: { router: "r" } } })
    );
    const client = new ApiClient({
      baseUrl: "https://swap.example/",
      getAccessToken: async () => "token",
      fetch: fetch as typeof globalThis.fetch,
    });

    const data = await client.quote({
      fromChain: "1",
      toChain: "near",
      tokenIn: "0x0000000000000000000000000000000000000000",
      tokenOut: "wrap.near",
      amountIn: "1",
      sender: "0xsender",
    });

    expect(data.bestQuote).toEqual({ router: "r" });
    expect(fetch).toHaveBeenCalledWith(
      "https://swap.example/api/swap/quote",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer token" }),
      })
    );
  });

  it("maps a non-zero API code", async () => {
    const client = new ApiClient({
      baseUrl: "https://swap.example",
      fetch: (async () =>
        jsonResponse({ code: 4001, msg: "no route", data: null })) as typeof globalThis.fetch,
    });

    await expect(client.quote({} as never)).rejects.toMatchObject({
      code: "API_ERROR",
      stage: "quote",
    });
  });

  it("serializes history query without undefined values", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        code: 0,
        msg: "ok",
        data: {
          record_list: [],
          page_number: 1,
          page_size: 20,
          total_page: 0,
          total_size: 0,
        },
      })
    );
    const client = new ApiClient({
      baseUrl: "https://swap.example",
      fetch: fetch as typeof globalThis.fetch,
    });

    await client.getHistory({ sender: "alice", pageNumber: 1 });

    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://swap.example/api/swap/history?sender=alice&pageNumber=1"
    );
  });
});
