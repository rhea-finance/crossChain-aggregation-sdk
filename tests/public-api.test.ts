import { describe, expect, it } from "vitest";
import * as sdk from "../src";
import {
  ApiClient,
  ExecutorRegistry,
  SwapClient,
  SwapSdkError,
  normalizeBuild,
  normalizeHistory,
  normalizeQuote,
  formatUnits,
  parseUnits,
  serializeMcaQuoteRequest,
  normalizeMcaQuote,
  resolveMcaWithdrawPolicy,
  formatMcaWallet,
  selectMcaSigner,
  serializeQuoteRequest,
  buildNearMcaWithdrawTransactions,
  buildMcaWithdrawRelayerRequest,
} from "../src";
import type { QuoteRequest } from "../src";

describe("public API", () => {
  it("exports the core SDK without touching browser globals", () => {
    expect(ApiClient).toBeTypeOf("function");
    expect(ExecutorRegistry).toBeTypeOf("function");
    expect(SwapClient).toBeTypeOf("function");
    expect(SwapSdkError).toBeTypeOf("function");
    expect(normalizeBuild).toBeTypeOf("function");
    expect(normalizeHistory).toBeTypeOf("function");
    expect(normalizeQuote).toBeTypeOf("function");
    expect(parseUnits).toBeTypeOf("function");
    expect(formatUnits).toBeTypeOf("function");
    expect(serializeMcaQuoteRequest).toBeTypeOf("function");
    expect(normalizeMcaQuote).toBeTypeOf("function");
    expect(resolveMcaWithdrawPolicy).toBeTypeOf("function");
    expect(formatMcaWallet).toBeTypeOf("function");
    expect(selectMcaSigner).toBeTypeOf("function");
    expect(buildNearMcaWithdrawTransactions).toBeTypeOf("function");
    expect(buildMcaWithdrawRelayerRequest).toBeTypeOf("function");
    expect("McaSwapService" in sdk).toBe(false);

    const client = new SwapClient({
      baseUrl: "https://swap.example",
      fetch: (() => Promise.reject(new Error("not called"))) as typeof fetch,
    });
    expect("mca" in client).toBe(false);
  });

  it("accepts direct chain ids through the public quote surface", () => {
    const request = {
      fromChain: "8453",
      toChain: "solana",
      tokenIn: {
        chain: "8453",
        address: "0xusdc",
        decimals: 6,
      },
      tokenOut: {
        chain: "solana",
        address: "sol-usdc",
        decimals: 6,
      },
      amountIn: "1000000",
      slippageBps: 50,
      sender: "0xsender",
    } satisfies QuoteRequest;

    expect(serializeQuoteRequest(request)).toMatchObject({
      fromChain: "8453",
      toChain: "solana",
    });
  });
});
