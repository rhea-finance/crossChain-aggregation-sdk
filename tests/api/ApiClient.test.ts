import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../src/api/ApiClient";
import type { SdkLogger } from "../../src/core/logger";

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
      "https://swap.example/api/v2/swap/quote",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer token" }),
      })
    );
  });

  it("invokes a browser-compatible fetch with the global receiver", async () => {
    const fetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) {
        throw new TypeError(
          "Failed to execute 'fetch' on 'Window': Illegal invocation"
        );
      }
      return Promise.resolve(
        jsonResponse({ code: 0, msg: "ok", data: { bestQuote: {} } })
      );
    }) as typeof globalThis.fetch;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const client = new ApiClient({
      baseUrl: "https://swap.example",
      fetch,
    });

    try {
      await expect(client.quote({} as never)).resolves.toEqual({
        bestQuote: {},
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("maps a non-zero API code", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ code: 4001, msg: "no route", data: null })
    );
    const client = new ApiClient({
      baseUrl: "https://swap.example",
      fetch: fetch as typeof globalThis.fetch,
    });

    await expect(client.quote({} as never)).rejects.toMatchObject({
      code: "API_ERROR",
      stage: "quote",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("maps error envelopes that omit data as API_ERROR", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ code: -1, msg: "Cross-chain quote failed" })
    );
    const client = new ApiClient({
      baseUrl: "https://swap.example",
      fetch: fetch as typeof globalThis.fetch,
    });

    await expect(client.quote({} as never)).rejects.toMatchObject({
      code: "API_ERROR",
      message: "Cross-chain quote failed",
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

  it("uses separate API and wallet authorization headers for confidential history", async () => {
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
      apiKey: "api-token",
      fetch: fetch as typeof globalThis.fetch,
    });

    await client.getHistory({
      sender: "alice",
      mode: "confidential",
      walletToken: "wallet-token",
    });

    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://swap.example/api/swap/history?sender=alice&mode=confidential"
    );
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer api-token",
      Authentication: "Bearer wallet-token",
    });
  });

  it("fails a quote on the first retryable network error", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new Error("offline"));
    const client = new ApiClient({
      baseUrl: "https://swap.example",
      fetch,
    });

    try {
      await expect(client.quote({} as never)).rejects.toMatchObject({
        code: "HTTP_ERROR",
        stage: "quote",
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("prints safe network failure details and enriches the SDK error", async () => {
    const cause = new TypeError(
      "Failed to fetch https://swap.example/api/v2/swap/quote?secret=query"
    );
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(cause);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const client = new ApiClient({
      baseUrl: "https://swap.example",
      apiKey: "private-api-token",
      fetch,
    });

    try {
      await expect(
        client.quote({
          fromChain: "1",
          toChain: "near",
          tokenIn: "private-token-in",
          tokenOut: "private-token-out",
          amountIn: "1000000",
          sender: "private-sender",
        })
      ).rejects.toMatchObject({
        code: "HTTP_ERROR",
        stage: "quote",
        message:
          "Network request failed: TypeError: Failed to fetch https://swap.example/api/v2/swap/quote?[redacted]",
        cause,
        details: {
          method: "POST",
          path: "/api/v2/swap/quote",
          causeName: "TypeError",
          causeMessage:
            "Failed to fetch https://swap.example/api/v2/swap/quote?[redacted]",
        },
      });

      expect(consoleError).toHaveBeenCalledWith(
        "SDK network request failed",
        {
          method: "POST",
          path: "/api/v2/swap/quote",
          stage: "quote",
          causeName: "TypeError",
          causeMessage:
            "Failed to fetch https://swap.example/api/v2/swap/quote?[redacted]",
        }
      );
      const output = JSON.stringify(consoleError.mock.calls);
      expect(output).not.toContain("private-api-token");
      expect(output).not.toContain("private-sender");
      expect(output).not.toContain("private-token-in");
      expect(output).not.toContain("private-token-out");
      expect(output).not.toContain("secret=query");
    } finally {
      consoleError.mockRestore();
    }
  });

  it("surfaces rate limiting without retrying", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(jsonResponse({ msg: "slow down" }, 429));
    const client = new ApiClient({
      baseUrl: "https://swap.example",
      fetch,
    });

    await expect(client.getHistory({ sender: "alice" })).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("never retries a build automatically", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(jsonResponse({ msg: "unavailable" }, 503));
    const client = new ApiClient({
      baseUrl: "https://swap.example",
      fetch,
    });

    await expect(client.build({} as never)).rejects.toMatchObject({
      code: "HTTP_ERROR",
      retryable: true,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sends an explicit idempotency key without logging secrets", async () => {
    const logger: SdkLogger = { log: vi.fn() };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse({
        code: 0,
        msg: "ok",
        data: { router: "r", tx: {}, tokenIn: {}, tokenOut: {} },
      })
    );
    const client = new ApiClient({
      baseUrl: "https://swap.example",
      apiKey: "super-secret-token",
      fetch,
      logger,
    });

    await client.build(
      { sender: "private-sender" } as never,
      { idempotencyKey: "build-exec-1" }
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://swap.example/api/v2/swap/swap",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer super-secret-token",
          "Idempotency-Key": "build-exec-1",
        }),
      })
    );
    const logs = JSON.stringify(vi.mocked(logger.log).mock.calls);
    expect(logs).not.toContain("super-secret-token");
    expect(logs).not.toContain("private-sender");
    expect(logs).not.toContain("build-exec-1");
  });

  it("logs request metadata without request payloads", async () => {
    const logger: SdkLogger = { log: vi.fn() };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse({ code: 0, msg: "ok", data: { bestQuote: {} } })
    );
    const client = new ApiClient({
      baseUrl: "https://swap.example",
      fetch,
      logger,
    });

    await client.quote({ sender: "private-sender" } as never);

    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "debug",
        event: "api.request",
        stage: "quote",
        path: "/api/v2/swap/quote",
      })
    );
    expect(JSON.stringify(vi.mocked(logger.log).mock.calls)).not.toContain(
      "private-sender"
    );
  });

  it("queries order status by report record id", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ code: 0, msg: "ok", data: { status: "SUCCESS" } })
    );
    const client = new ApiClient({
      baseUrl: "https://swap.example",
      fetch: fetch as typeof globalThis.fetch,
    });

    await client.getOrderStatus({ recordId: 15 });

    expect(fetch).toHaveBeenCalledWith(
      "https://swap.example/api/swap/order-status?recordId=15",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("does not send an already-aborted request", async () => {
    const controller = new AbortController();
    controller.abort("cancelled");
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new ApiClient({
      baseUrl: "https://swap.example",
      fetch,
    });

    await expect(
      client.quote({} as never, { signal: controller.signal })
    ).rejects.toMatchObject({ code: "REQUEST_ABORTED", retryable: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails once on read timeouts and preserves the timeout error", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn<typeof globalThis.fetch>((_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true }
          );
        })
      );
      const client = new ApiClient({
        baseUrl: "https://swap.example",
        fetch,
        timeoutMs: 10,
      });
      const result = client.getOrderStatus({
        orderId: "order-timeout",
        router: "router",
      });

      const assertion = expect(result).rejects.toMatchObject({
        code: "REQUEST_TIMEOUT",
        retryable: true,
      });
      await vi.runAllTimersAsync();
      await assertion;
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
