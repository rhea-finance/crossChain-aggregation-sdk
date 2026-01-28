/**
 * Same-chain swap quote (NEAR -> NEAR)
 * Queries V1 and V2 routers in parallel and selects the best route based on maximum amountOut
 */

import { TokenInfo, QuoteParams, QuoteResult, DexRouter } from "../types";
import { selectBestQuote } from "../utils";

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

  // Filter valid quotes
  const validQuotes = quoteResults
    .filter(
      (r): r is PromiseFulfilledResult<QuoteResult> =>
        r.status === "fulfilled" && r.value.success
    )
    .map((r, index) => ({
      quote: r.value,
      router: dexRouters[index],
    }));

  if (validQuotes.length === 0) {
    const errors = quoteResults
      .map((r, index) => {
        if (r.status === "rejected") {
          return `Router ${index}: ${r.reason}`;
        }
        if (r.status === "fulfilled" && !r.value.success) {
          return `Router ${index}: ${r.value.error}`;
        }
        return null;
      })
      .filter(Boolean);
    throw new Error(`All router quotes failed: ${errors.join("; ")}`);
  }

  // Select best quote (maximum amountOut)
  return selectBestQuote(validQuotes);
}

