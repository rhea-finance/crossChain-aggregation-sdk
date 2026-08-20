import { describe, expect, it, vi } from "vitest";
import { SwapClient } from "../../src/client/SwapClient";
import { normalizeOrderStatus } from "../../src/core/lifecycle";
import type { ChainExecutor } from "../../src/core/registry";
import { normalizeBuild } from "../../src/normalizers/build";
import { normalizeQuote } from "../../src/normalizers/quote";
import type { QuoteRequest } from "../../src/types/quote";
import { buildFixtures } from "../fixtures/builds";

function response(data: unknown): Response {
  return new Response(JSON.stringify({ code: 0, msg: "ok", data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const request: QuoteRequest = {
  fromChain: "btc",
  toChain: "near",
  tokenIn: {
    chain: "btc",
    address: "btc",
    symbol: "BTC",
    decimals: 8,
    isNative: true,
  },
  tokenOut: {
    chain: "near",
    address: "wrap.near",
    symbol: "wNEAR",
    decimals: 24,
  },
  amountIn: "1000",
  slippageBps: 50,
  sender: "bc1sender",
  recipient: "receiver.near",
};

const quoteRaw = {
  isCrossChain: true,
  chainType: "cross-chain",
  bestQuote: {
    router: "nearintents",
    estimatedOut: "900",
    minAmountOut: "890",
    preSwap: null,
    bridge: { route: "bridge" },
    quoteId: "quote-1",
  },
  allQuotes: [],
};

describe("SwapClient quote and build", () => {
  it("quotes and builds without invoking an executor", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(quoteRaw))
      .mockResolvedValueOnce(response(buildFixtures.bitcoin));
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      fetch,
      executors: [],
    });

    const quote = await client.quote(request);
    expect(quote.buildContext.router).toBe("nearintents");
    expect(
      JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))
    ).toMatchObject({
      quoteWaitingTimeMs: 3000,
    });

    const build = await client.buildSwap({ quote });
    expect(build.execution.kind).toBe("bitcoin-transfer");
    expect(fetch).toHaveBeenCalledTimes(2);

    const buildRequest = JSON.parse(
      String(fetch.mock.calls[1]?.[1]?.body)
    ) as Record<string, unknown>;
    expect(buildRequest).toMatchObject({
      router: "nearintents",
      expectedOut: "900",
      minAmountOut: "890",
      quoteId: "quote-1",
    });
  });

  it("carries confidentiality from quote through build", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(quoteRaw))
      .mockResolvedValueOnce(response(buildFixtures.bitcoin));
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      fetch,
    });

    const quote = await client.quote({
      ...request,
      confidentiality: "basic",
    });
    await client.buildSwap({ quote });

    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      confidentiality: "basic",
    });
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toMatchObject({
      confidentiality: "basic",
    });
  });

  it("rejects a stale quote before requesting a build", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response(quoteRaw));
    let now = 1_000;
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      fetch,
      maxQuoteAgeMs: 30_000,
      now: () => now,
    });

    const quote = await client.quote(request);
    now = 31_001;

    await expect(client.buildSwap({ quote })).rejects.toMatchObject({
      code: "QUOTE_EXPIRED",
      stage: "build",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("allows disabling the client-side quote age check", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(quoteRaw))
      .mockResolvedValueOnce(response(buildFixtures.bitcoin));
    let now = 1_000;
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      fetch,
      maxQuoteAgeMs: null,
      now: () => now,
    });

    const quote = await client.quote(request);
    now = 1_000_000;

    await expect(client.buildSwap({ quote })).resolves.toMatchObject({
      execution: { kind: "bitcoin-transfer" },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("forwards a build idempotency key", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response(buildFixtures.bitcoin));
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      fetch,
    });
    const quote = normalizeQuote(request, quoteRaw, Date.now());

    await client.buildSwap({ quote, idempotencyKey: "exec-build-1" });

    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      "Idempotency-Key": "exec-build-1",
    });
  });

  it("exposes raw quote and build calls", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(quoteRaw))
      .mockResolvedValueOnce(response(buildFixtures.bitcoin));
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      fetch,
    });

    await expect(
      client.quoteRaw({
        fromChain: "btc",
        toChain: "near",
        tokenIn: "btc",
        tokenOut: "wrap.near",
        amountIn: "1000",
        sender: "bc1sender",
      })
    ).resolves.toEqual(quoteRaw);

    await expect(
      client.buildRaw({
        fromChain: "btc",
        toChain: "near",
        tokenIn: "btc",
        tokenOut: "wrap.near",
        amountIn: "1000",
        sender: "bc1sender",
        router: "nearintents",
        expectedOut: "900",
        minAmountOut: "890",
        preSwap: null,
        bridge: null,
      })
    ).resolves.toEqual(buildFixtures.bitcoin);
  });
});

describe("SwapClient execution lifecycle", () => {
  const rawBuildRequest = {
    fromChain: "btc",
    toChain: "near",
    tokenIn: "btc",
    tokenOut: "wrap.near",
    amountIn: "1000",
    slippage: 50,
    sender: "bc1sender",
    recipient: "receiver.near",
    router: "nearintents",
    expectedOut: "900",
    minAmountOut: "890",
    preSwap: null,
    bridge: null,
  };

  it("applies explicit report context without changing ordinary reports", async () => {
    const executor: ChainExecutor<"bitcoin-transfer"> = {
      kinds: ["bitcoin-transfer"],
      validate: async () => undefined,
      execute: async () => ({ status: "submitted", txHash: "mca-hash" }),
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({ id: 1, from_hash: "mca-hash" }));
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      executors: [executor],
      fetch,
    });
    const build = {
      ...normalizeBuild(buildFixtures.bitcoin, "exec-mca-report", rawBuildRequest),
      reportContext: {
        txType: "mca-withdraw-near",
        multiAddr: "mca.near",
        depositAddress: "deposit.near",
        recipient: "alice.near",
        isCrossChain: true,
      },
    };

    await client.executeSwap({ build });

    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      recipient: "alice.near",
      deposit_address: "deposit.near",
      is_cross_chain: true,
      tx_type: "mca-withdraw-near",
      multi_addr: "mca.near",
    });
  });

  it("returns submitted when report fails and emits a warning", async () => {
    const events: string[] = [];
    const executor: ChainExecutor<"bitcoin-transfer"> = {
      kinds: ["bitcoin-transfer"],
      validate: vi.fn(async () => undefined),
      execute: vi.fn(async () => ({
        status: "submitted",
        txHash: "btc-hash",
      })),
    };
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      executors: [executor],
      onEvent: (event) => events.push(event.type),
      fetch: (async () =>
        response(undefined).constructor === Response
          ? new Response(
              JSON.stringify({ code: 5001, msg: "report down", data: null }),
              { status: 200 }
            )
          : response(undefined)) as typeof globalThis.fetch,
    });
    const build = normalizeBuild(
      buildFixtures.bitcoin,
      "exec-report",
      rawBuildRequest
    );

    const result = await client.executeSwap({ build });

    expect(result).toMatchObject({
      executionId: "exec-report",
      status: "submitted",
      txHash: "btc-hash",
      report: { status: "failed" },
    });
    expect(events).toEqual(["signing-requested", "submitted", "warning"]);
  });

  it("uses signingRequest submit params when submitting a signature order", async () => {
    const executor: ChainExecutor<"evm-signature"> = {
      kinds: ["evm-signature"],
      validate: async () => undefined,
      execute: async () => ({
        status: "submitted",
        signature: "0xsigned",
      }),
    };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response({ router: "cow", orderId: "order-1", chainId: 56 })
    );
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      executors: [executor],
      reportMode: "manual",
      fetch,
    });
    const build = normalizeBuild(
      {
        ...buildFixtures.evmSignature,
        signingRequest: {
          ...buildFixtures.evmSignature.signingRequest!,
          submit: {
            endpoint: "/api/swap/order-submit",
            method: "POST",
            params: {
              router: "cow-submit",
              quoteId: "quote-submit",
              signingScheme: "eip712-submit",
            },
          },
        },
      },
      "exec-signature",
      {
        ...rawBuildRequest,
        fromChain: "56",
        sender: "0xsender",
        tokenIn: "0xtoken",
        quoteId: "quote-1",
      }
    );

    const result = await client.executeSwap({ build });

    expect(result.orderId).toBe("order-1");
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      router: "cow-submit",
      quoteId: "quote-submit",
      signingScheme: "eip712-submit",
      signature: "0xsigned",
    });
  });

  it("polls a submitted signature order with the submit response router", async () => {
    const executor: ChainExecutor<"evm-signature"> = {
      kinds: ["evm-signature"],
      validate: async () => undefined,
      execute: async () => ({
        status: "submitted",
        signature: "0xsigned",
      }),
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response({ router: "cow-status", orderId: "order-1", chainId: 56 })
      )
      .mockResolvedValueOnce(response({ status: "SUCCESS" }));
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      executors: [executor],
      reportMode: "disabled",
      fetch,
    });
    const waitForOrder = vi.spyOn(client, "waitForOrder");
    const build = normalizeBuild(
      {
        ...buildFixtures.evmSignature,
        router: "aggregate-router",
      },
      "exec-signature-status",
      {
        ...rawBuildRequest,
        fromChain: "56",
        sender: "0xsender",
        tokenIn: "0xtoken",
        quoteId: "quote-1",
      }
    );

    await expect(
      client.executeSwap({
        build,
        waitFor: "completed",
        orderPolling: { intervalMs: 123, timeoutMs: 456 },
      })
    ).resolves.toMatchObject({ status: "completed", orderId: "order-1" });

    expect(waitForOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        intervalMs: 123,
        timeoutMs: 456,
      })
    );
    expect(String(fetch.mock.calls[1]?.[0])).toBe(
      "https://swap.example/api/swap/order-status?orderId=order-1&router=cow-status&chainId=56"
    );
  });

  it("reports the default ordinary swap transaction type", async () => {
    const executor: ChainExecutor<"bitcoin-transfer"> = {
      kinds: ["bitcoin-transfer"],
      validate: async () => undefined,
      execute: async () => ({ status: "submitted", txHash: "btc-hash" }),
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({ id: 1, from_hash: "btc-hash" }));
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      executors: [executor],
      fetch,
    });
    const build = normalizeBuild(
      buildFixtures.bitcoin,
      "exec-ordinary-report",
      rawBuildRequest
    );

    await client.executeSwap({ build });

    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      tx_type: "cross-chain",
    });
  });

  it("propagates confidential quote metadata to automatic reports", async () => {
    const executor: ChainExecutor<"bitcoin-transfer"> = {
      kinds: ["bitcoin-transfer"],
      validate: async () => undefined,
      execute: async () => ({ status: "submitted", txHash: "private-hash" }),
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({ id: 1, from_hash: "private-hash" }));
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      executors: [executor],
      fetch,
    });
    const build = normalizeBuild(
      buildFixtures.bitcoin,
      "exec-confidential-report",
      { ...rawBuildRequest, confidentiality: "basic" }
    );

    await client.executeSwap({ build });

    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      confidentiality: "basic",
    });
  });

  it("normalizes explicit order statuses", () => {
    expect(normalizeOrderStatus({ status: "SUCCESS" })).toBe("completed");
    expect(normalizeOrderStatus({ state: "FAILED" })).toBe("failed");
    expect(normalizeOrderStatus({ status: "REFUNDED" })).toBe("refunded");
    expect(normalizeOrderStatus({ status: "EXPIRED" })).toBe("expired");
    expect(normalizeOrderStatus({ status: "mystery" })).toBe("unknown");
  });

  it("gets a normalized order status", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({ status: "PROCESSING" }));
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      fetch,
    });

    await expect(
      client.getOrderStatus({ orderId: "order-1", router: "nearintents" })
    ).resolves.toMatchObject({
      orderId: "order-1",
      router: "nearintents",
      status: "processing",
    });
  });

  it("validates before executing", async () => {
    const calls: string[] = [];
    const executor: ChainExecutor<"bitcoin-transfer"> = {
      kinds: ["bitcoin-transfer"],
      validate: async () => {
        calls.push("validate");
      },
      execute: async () => {
        calls.push("execute");
        return { status: "submitted", txHash: "btc-hash" };
      },
    };
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      executors: [executor],
      reportMode: "disabled",
    });

    await client.executeSwap({
      build: normalizeBuild(buildFixtures.bitcoin, "exec-order"),
    });
    expect(calls).toEqual(["validate", "execute"]);
  });

  it("emits source-confirmed after a confirmed executor result", async () => {
    const events: string[] = [];
    const executor: ChainExecutor<"bitcoin-transfer"> = {
      kinds: ["bitcoin-transfer"],
      validate: async () => undefined,
      execute: async () => ({
        status: "source-confirmed",
        txHash: "btc-hash",
      }),
    };
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      executors: [executor],
      reportMode: "disabled",
      onEvent: (event) => events.push(event.type),
    });

    await expect(
      client.executeSwap({
        build: normalizeBuild(buildFixtures.bitcoin, "exec-confirmed"),
        waitFor: "source-confirmed",
      })
    ).resolves.toMatchObject({ status: "source-confirmed" });
    expect(events).toEqual([
      "signing-requested",
      "submitted",
      "source-confirmed",
    ]);
  });

  it("rejects an execution id that is already in flight", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const executor: ChainExecutor<"bitcoin-transfer"> = {
      kinds: ["bitcoin-transfer"],
      validate: async () => undefined,
      execute: async () => {
        await pending;
        return { status: "submitted", txHash: "btc-hash" };
      },
    };
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      executors: [executor],
      reportMode: "disabled",
    });
    const build = normalizeBuild(buildFixtures.bitcoin, "exec-duplicate");
    const first = client.executeSwap({ build });
    await vi.waitFor(() => expect(executor.execute).not.toBeUndefined());

    await expect(client.executeSwap({ build })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      stage: "sign",
    });
    finish();
    await first;
  });

  it.each([
    ["SUCCESS", "completed"],
    ["FAILED", "failed"],
    ["REFUNDED", "refunded"],
    ["EXPIRED", "expired"],
  ] as const)("waits for terminal order status %s", async (rawStatus, status) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({ status: rawStatus }));
    const client = new SwapClient({ baseUrl: "https://swap.example", fetch });

    await expect(
      client.waitForOrder({
        orderId: "order-terminal",
        router: "nearintents",
        intervalMs: 0,
        timeoutMs: 100,
      })
    ).resolves.toMatchObject({ status });
  });

  it("polls indefinitely by default when timeoutMs is omitted", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({ status: "PROCESSING" }))
      .mockResolvedValueOnce(response({ status: "SUCCESS" }));
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(300_000);
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      fetch,
      now,
    });

    await expect(
      client.waitForOrder({
        orderId: "order-no-timeout",
        router: "nearintents",
        intervalMs: 0,
      })
    ).resolves.toMatchObject({ status: "completed" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("honors an explicit order polling timeout", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({ status: "PROCESSING" }));
    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(101);
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      fetch,
      now,
    });

    await expect(
      client.waitForOrder({
        orderId: "order-timeout",
        router: "nearintents",
        intervalMs: 0,
        timeoutMs: 100,
      })
    ).rejects.toMatchObject({
      code: "ORDER_TIMEOUT",
      stage: "status",
    });
  });

  it("stops order polling when aborted", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response({ status: "PROCESSING" }));
    const client = new SwapClient({ baseUrl: "https://swap.example", fetch });
    const controller = new AbortController();
    const waiting = client.waitForOrder({
      orderId: "order-abort",
      router: "nearintents",
      intervalMs: 10_000,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(waiting).rejects.toMatchObject({
      code: "REQUEST_ABORTED",
      stage: "status",
    });
  });

  it("builds and executes swap without requesting another quote", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response(buildFixtures.bitcoin));
    const executor: ChainExecutor<"bitcoin-transfer"> = {
      kinds: ["bitcoin-transfer"],
      validate: async () => undefined,
      execute: async () => ({ status: "submitted", txHash: "btc-hash" }),
    };
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      fetch,
      executors: [executor],
      reportMode: "disabled",
    });
    const quote = normalizeQuote(request, quoteRaw, Date.now());

    await expect(client.swap({ quote })).resolves.toMatchObject({
      status: "submitted",
      txHash: "btc-hash",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "https://swap.example/api/swap/swap"
    );
  });
});

describe("SwapClient history", () => {
  const historyRaw = {
    record_list: [
      {
        id: 1,
        sender: "alice",
        from_hash: "source-hash",
        from_token: "btc",
        to_token: "wrap.near",
        from_chain: "btc",
        to_chain: "near",
        status: "SUCCESS",
      },
      {
        id: 2,
        sender: "alice",
        from_hash: "source-hash-2",
        from_token: "btc",
        to_token: "wrap.near",
        from_chain: "btc",
        to_chain: "near",
        status: "FAILED",
      },
    ],
    page_number: 2,
    page_size: 10,
    total_page: 4,
    total_size: 32,
  };

  it("exposes raw history and serializes pagination", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response(historyRaw));
    const client = new SwapClient({ baseUrl: "https://swap.example", fetch });

    await expect(
      client.getHistoryRaw({ sender: "alice", pageNumber: 2, pageSize: 10 })
    ).resolves.toEqual(historyRaw);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "https://swap.example/api/swap/history?sender=alice&pageNumber=2&pageSize=10"
    );
  });

  it("filters normalized history locally while retaining server totals", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(response(historyRaw));
    const client = new SwapClient({ baseUrl: "https://swap.example", fetch });

    await expect(
      client.getHistory({
        sender: "alice",
        page: 2,
        pageSize: 10,
        status: ["failed"],
      })
    ).resolves.toMatchObject({
      items: [{ id: "2", status: "failed" }],
      page: 2,
      pageSize: 10,
      totalPages: 4,
      totalItems: 32,
      filteredLocally: true,
    });
  });

  it("authorizes and queries confidential history", async () => {
    const challenge = {
      challengeId: "challenge-1",
      expiresAt: "2026-08-20T12:00:00.000Z",
      chainFamily: "evm" as const,
      chainId: "1",
      address: "0xAbC",
      walletAddress: "0xAbC",
      identityKey: "",
      principalType: "wallet" as const,
      queryAddress: "0xAbC",
      mcaAccountId: null,
      signingMethod: "personal_sign" as const,
      signingInput: { message: "Authorize confidential history" },
    };
    const token = {
      token: "wallet-token",
      tokenType: "Bearer" as const,
      expiresIn: 300,
      expiresAt: "2026-08-20T12:05:00.000Z",
      principalType: "wallet" as const,
      queryAddress: "0xAbC",
      mcaAccountId: null,
      scope: "swap:history:confidential:read" as const,
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(challenge))
      .mockResolvedValueOnce(response(token))
      .mockResolvedValueOnce(response(historyRaw));
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      apiKey: "api-token",
      fetch,
    });
    const signChallenge = vi.fn(async () => ({ signature: "0xsigned" }));

    const authorization = await client.authorizeConfidentialHistory(
      {
        chainFamily: "evm",
        chainId: "1",
        walletAddress: "0xabc",
      },
      signChallenge
    );
    await client.getHistory({
      sender: authorization.queryAddress,
      mode: "confidential",
      walletToken: authorization.token,
    });

    expect(signChallenge).toHaveBeenCalledWith(challenge);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "https://swap.example/api/swap/history/auth/challenge"
    );
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      challengeId: "challenge-1",
      proof: { signature: "0xsigned" },
    });
    expect(String(fetch.mock.calls[2]?.[0])).toBe(
      "https://swap.example/api/swap/history?sender=0xAbC&mode=confidential"
    );
    expect(fetch.mock.calls[2]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer api-token",
      Authentication: "Bearer wallet-token",
    });
  });

  it("rejects a confidential history challenge for a different wallet", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response({
        challengeId: "challenge-1",
        expiresAt: "2026-08-20T12:00:00.000Z",
        chainFamily: "evm",
        chainId: "1",
        address: "0xdef",
        walletAddress: "0xdef",
        identityKey: "",
        principalType: "wallet",
        queryAddress: "0xdef",
        mcaAccountId: null,
        signingMethod: "personal_sign",
        signingInput: { message: "Do not sign" },
      })
    );
    const client = new SwapClient({ baseUrl: "https://swap.example", fetch });
    const signChallenge = vi.fn(async () => ({ signature: "0xsigned" }));

    await expect(
      client.authorizeConfidentialHistory(
        {
          chainFamily: "evm",
          chainId: "1",
          walletAddress: "0xabc",
        },
        signChallenge
      )
    ).rejects.toMatchObject({
      code: "INVALID_API_RESPONSE",
      stage: "history",
    });
    expect(signChallenge).not.toHaveBeenCalled();
  });
});
