import { describe, expect, it } from "vitest";
import type { SwapQuoteDataRaw } from "../../src/api/rawTypes";
import {
  normalizeQuote,
  serializeQuoteRequest,
} from "../../src/normalizers/quote";
import type { QuoteRequest } from "../../src/types/quote";

const request: QuoteRequest = {
  fromChain: "eip155:1",
  toChain: "near:mainnet",
  tokenIn: {
    chain: "eip155:1",
    address: "0x0000000000000000000000000000000000000000",
    symbol: "ETH",
    decimals: 18,
    isNative: true,
  },
  tokenOut: {
    chain: "near:mainnet",
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
      sender: "0xsender",
      recipient: "receiver.near",
    });
  });

  it("normalizes the best route and preserves immutable build context", () => {
    const quote = normalizeQuote(request, raw, 1_000);

    expect(quote).toMatchObject({
      id: "quote-1",
      fromChain: "eip155:1",
      toChain: "near:mainnet",
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
});
