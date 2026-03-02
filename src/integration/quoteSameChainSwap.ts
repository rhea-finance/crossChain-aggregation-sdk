/**
 * Same-chain swap quote (NEAR -> NEAR)
 * Queries V1 and V2 routers in parallel and selects the best route based on maximum amountOut
 */

import { TokenInfo, QuoteParams, QuoteResult, DexRouter } from "../types";
import { selectBestQuote } from "../utils";
import { ErrorMessages } from "../utils/errorMessages";

export interface QuoteSameChainSwapParams {
  tokenIn: TokenInfo;
  tokenOut: TokenInfo;
  amountIn: string;
  slippage: number;
  recipient: string;
  currentUserAddress: string;
}

export interface QuoteSameChainSwapResult {
  quote: QuoteResult;
  router: DexRouter;
}

/**
 * Quote same-chain swap (NEAR -> NEAR) by querying V1 and V2 routers in parallel
 * and selecting the best route based on maximum amountOut
 */
export async function quoteSameChainSwap(
  params: QuoteSameChainSwapParams,
  dexRouters: DexRouter[]
): Promise<QuoteSameChainSwapResult> {
  const {
    tokenIn,
    tokenOut,
    amountIn,
    slippage,
    recipient,
    currentUserAddress,
  } = params;

  // Query all routers in parallel
  const quoteResults = await Promise.allSettled(
    dexRouters.map((router) => {
      const capabilities = router.getCapabilities();
      const quoteParams: QuoteParams = capabilities.requiresRecipient
        ? {
            tokenIn,
            tokenOut,
            amountIn,
            slippage,
            swapType: "EXACT_INPUT",
            sender: currentUserAddress,
            recipient,
          }
        : {
            tokenIn,
            tokenOut,
            amountIn,
            slippage,
            swapType: "EXACT_INPUT",
            recipient,
          };
      return router.quote(quoteParams);
    })
  );

  const fulfilledResults = quoteResults
    .filter(
      (r): r is PromiseFulfilledResult<QuoteResult> => r.status === "fulfilled"
    )
    .map((r, index) => ({
      result: r.value,
      router: dexRouters[index],
      index,
    }));

  const validQuotes = fulfilledResults
    .filter((r) => r.result.success)
    .map((r) => ({
      quote: r.result,
      router: r.router,
    }));

  if (validQuotes.length > 0) {
    return selectBestQuote(validQuotes);
  }

  const errors = fulfilledResults
    .filter((r) => !r.result.success)
    .map((r) => {
      const error = r.result.error || "";
      const is429 =
        error.includes("429") ||
        error.toLowerCase().includes("rate limit") ||
        error.toLowerCase().includes("too many requests");
      return is429 ? null : `Router ${r.index}: ${error}`;
    })
    .filter(Boolean) as string[];

  if (errors.length === 0) {
    throw new Error("All liquidity providers are busy. Please try again later.");
  }

  const errorMessage =
    errors.length > 0
      ? `${ErrorMessages.QUOTE_FAILED}: ${errors.join("; ")}`
      : ErrorMessages.QUOTE_FAILED;
  throw new Error(errorMessage);
}

