import { describe, expect, it } from "vitest";
import type { SwapQuoteDataRaw } from "../../src/api/rawTypes";
import {
  normalizeQuote,
  serializeQuoteRequest,
} from "../../src/normalizers/quote";
import type { QuoteRequest } from "../../src/types/quote";

const request: QuoteRequest = {
  fromChain: "1",
  toChain: "near",
  tokenIn: {
    chain: "1",
    address: "0x0000000000000000000000000000000000000000",
    symbol: "ETH",
    decimals: 18,
    isNative: true,
  },
  tokenOut: {
    chain: "near",
    address: "wrap.near",
    symbol: "wNEAR",
    decimals: 24,
  },
  amountIn: "100",
  slippageBps: 50,
  sender: "0xsender",
  recipient: "receiver.near",
};

const raw: SwapQuoteDataRaw = {
  isCrossChain: true,
  chainType: "cross-chain",
  bestQuote: {
    router: "nearintents",
    market: "best",
    estimatedOut: "90",
    minAmountOut: "89",
    preSwap: { router: "dex" },
    bridge: { router: "bridge" },
    quoteId: "quote-1",
  },
  allQuotes: [
    {
      router: "alternative",
      amountOut: "88",
      minAmountOut: "87",
    },
  ],
};

describe("quote normalization", () => {
  it("serializes a standard request to the API shape", () => {
    expect(serializeQuoteRequest(request)).toEqual({
      fromChain: "1",
      toChain: "near",
      tokenIn: "0x0000000000000000000000000000000000000000",
      tokenOut: "wrap.near",
      amountIn: "100",
      slippage: 50,
      quoteWaitingTimeMs: 3000,
      sender: "0xsender",
      recipient: "receiver.near",
    });
  });

  it("preserves a custom quote waiting time", () => {
    expect(
      serializeQuoteRequest({
        ...request,
        quoteWaitingTimeMs: 5000,
      })
    ).toMatchObject({
      quoteWaitingTimeMs: 5000,
    });
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid quote waiting time %s",
    (quoteWaitingTimeMs) => {
      expect(() =>
        serializeQuoteRequest({
          ...request,
          quoteWaitingTimeMs,
        })
      ).toThrowError(
        expect.objectContaining({
          code: "INVALID_REQUEST",
          stage: "quote",
        })
      );
    }
  );

  it("normalizes the best route and preserves immutable build context", () => {
    const quote = normalizeQuote(request, raw, 1_000);

    expect(quote).toMatchObject({
      id: "quote-1",
      fromChain: "1",
      toChain: "near",
      amountIn: "100",
      estimatedOut: "90",
      minAmountOut: "89",
      route: { router: "nearintents", market: "best" },
      receivedAt: 1_000,
      buildContext: {
        router: "nearintents",
        expectedOut: "90",
        minAmountOut: "89",
        quoteId: "quote-1",
      },
      raw,
    });
    expect(quote.alternatives).toHaveLength(1);
    expect(Object.isFrozen(quote.buildContext)).toBe(true);
  });

  it("rejects a quote without a router", () => {
    expect(() =>
      normalizeQuote(request, { ...raw, bestQuote: { estimatedOut: "90" } })
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_API_RESPONSE",
        stage: "quote",
      })
    );
  });

  it("rejects invalid output amounts", () => {
    expect(() =>
      normalizeQuote(request, {
        ...raw,
        bestQuote: { ...raw.bestQuote, estimatedOut: "1.2" },
      })
    ).toThrowError(expect.objectContaining({ code: "INVALID_API_RESPONSE" }));
  });

  it.each(["eip155:1", "near:mainnet"])(
    "rejects legacy public chain id %s",
    (chain) => {
      expect(() =>
        serializeQuoteRequest({
          ...request,
          fromChain: chain as never,
          tokenIn: { ...request.tokenIn, chain: chain as never },
        })
      ).toThrowError(
        expect.objectContaining({
          code: "UNSUPPORTED_CHAIN",
          stage: "quote",
        })
      );
    }
  );
});
