import { describe, expect, it, vi } from "vitest";
import { SwapClient } from "../../src/client/SwapClient";

function response(data: unknown): Response {
  return new Response(JSON.stringify({ code: 0, msg: "ok", data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SwapClient token lists", () => {
  it("normalizes from and cross-chain to tokens into one stable shape", async () => {
    const fromRow = {
      address: "nep141:base-usdc.omft.near",
      assetId: "nep141:base-usdc.omft.near",
      blockchain: "base",
      chainId: 8453,
      contractAddress: "0x1111111111111111111111111111111111111111",
      decimals: 6,
      isNative: false,
      logoURI: "https://img.example/usdc.svg",
      name: "USD Coin",
      platform: "nearIntents",
      price: "1.00",
      symbol: "USDC",
      updated_at: 1_700_000_000,
    };
    const toRow = {
      address: "nep141:base-usdc.omft.near",
      assetId: "nep141:base-usdc.omft.near",
      contractAddress: "0x1111111111111111111111111111111111111111",
      decimals: 6,
      isNative: false,
      logoURI: "https://img.example/usdc.svg",
      name: "USD Coin",
      price: 1,
      sources: ["nearintents"],
      symbol: "USDC",
      updated_at: 1_700_000_001,
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({ usdc: fromRow }))
      .mockResolvedValueOnce(response({ tokens: [toRow] }));
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      fetch,
      tokenListCacheTtlMs: 0,
    });

    const [fromTokens, toTokens] = await Promise.all([
      client.getFromTokens({ chainId: 8453 }),
      client.getCrossChainToTokens({ chainId: 8453 }),
    ]);

    expect(fromTokens).toEqual([
      {
        chain: "8453",
        address: "nep141:base-usdc.omft.near",
        symbol: "USDC",
        decimals: 6,
        isNative: false,
        tokenListChainId: 8453,
        blockchain: "base",
        assetId: "nep141:base-usdc.omft.near",
        contractAddress: "0x1111111111111111111111111111111111111111",
        coinType: null,
        name: "USD Coin",
        logoURI: "https://img.example/usdc.svg",
        price: "1.00",
        priceUpdatedAt: 1_700_000_000,
        sources: ["nearIntents"],
        raw: fromRow,
      },
    ]);
    expect(toTokens[0]).toMatchObject({
      chain: "8453",
      address: "nep141:base-usdc.omft.near",
      symbol: "USDC",
      decimals: 6,
      isNative: false,
      tokenListChainId: 8453,
      blockchain: "base",
      assetId: "nep141:base-usdc.omft.near",
      contractAddress: "0x1111111111111111111111111111111111111111",
      coinType: null,
      name: "USD Coin",
      logoURI: "https://img.example/usdc.svg",
      price: 1,
      priceUpdatedAt: 1_700_000_001,
      sources: ["nearintents"],
      raw: toRow,
    });
    expect(Object.keys(toTokens[0]!).sort()).toEqual(
      Object.keys(fromTokens[0]!).sort()
    );
    expect(fetch.mock.calls.map((call) => String(call[0])).sort()).toEqual([
      "https://swap.example/api/swap/supported_to_tokens?chain=8453",
      "https://swap.example/get_chain_prices?chain=8453",
    ]);
  });

  it("caches successful token lists without sharing mutable results", async () => {
    const row = {
      address: "0xtoken",
      decimals: 18,
      symbol: "TOK",
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => response({ token: row }));
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      fetch,
    });

    const first = await client.getFromTokens({ chainId: 1 });
    first[0]!.symbol = "MUTATED";
    first[0]!.sources.push("mutated");
    first[0]!.raw.symbol = "MUTATED";

    const second = await client.getFromTokens({ chainId: 1 });

    expect(second[0]).toMatchObject({
      symbol: "TOK",
      sources: [],
      raw: { symbol: "TOK" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refreshes a token list when its configured cache lifetime expires", async () => {
    let now = 1_000;
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      response({ token: { address: "0xtoken", decimals: 18, symbol: "TOK" } })
    );
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      fetch,
      now: () => now,
      tokenListCacheTtlMs: 100,
    });

    await client.getFromTokens({ chainId: 1 });
    now = 1_099;
    await client.getFromTokens({ chainId: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);

    now = 1_100;
    await client.getFromTokens({ chainId: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([0, -1, 1.5, Number.NaN])(
    "rejects invalid token-list chain id %s before requesting",
    async (chainId) => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      const client = new SwapClient({
        baseUrl: "https://swap.example",
        fetch,
      });

      await expect(
        client.getFromTokens({ chainId })
      ).rejects.toMatchObject({
        code: "INVALID_REQUEST",
        stage: "tokens",
      });
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it("deduplicates concurrent requests for the same direction and chain", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      fetch,
    });

    const first = client.getCrossChainToTokens({ chainId: 501 });
    const second = client.getCrossChainToTokens({ chainId: 501 });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    resolveFetch?.(
      response({
        tokens: [
          {
            address: "sol-token",
            decimals: 6,
            symbol: "SOLT",
          },
        ],
      })
    );

    const [firstTokens, secondTokens] = await Promise.all([first, second]);
    expect(firstTokens[0]).toMatchObject({
      chain: "solana",
      tokenListChainId: 501,
      blockchain: "sol",
    });
    expect(secondTokens).toEqual(firstTokens);
    expect(secondTokens).not.toBe(firstTokens);
  });

  it("skips malformed rows but rejects a wholly malformed list", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        response({
          invalid: { address: "missing-symbol", decimals: 6 },
          valid: { address: "0xvalid", decimals: "18", symbol: "VALID" },
        })
      )
      .mockResolvedValueOnce(
        response({ invalid: { address: "missing-symbol", decimals: 6 } })
      );
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      fetch,
      tokenListCacheTtlMs: 0,
    });

    await expect(
      client.getFromTokens({ chainId: 1 })
    ).resolves.toMatchObject([{ symbol: "VALID", decimals: 18 }]);
    await expect(
      client.getFromTokens({ chainId: 1 })
    ).rejects.toMatchObject({
      code: "INVALID_API_RESPONSE",
      stage: "tokens",
    });
  });

  it("does not cache a failed token-list request", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(
        response({ token: { address: "0xtoken", decimals: 18, symbol: "TOK" } })
      );
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      fetch,
      retry: { maxRetries: 0 },
    });

    try {
      await expect(
        client.getFromTokens({ chainId: 1 })
      ).rejects.toMatchObject({ code: "HTTP_ERROR", stage: "tokens" });
      await expect(
        client.getFromTokens({ chainId: 1 })
      ).resolves.toMatchObject([{ symbol: "TOK" }]);
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      consoleError.mockRestore();
    }
  });
});
