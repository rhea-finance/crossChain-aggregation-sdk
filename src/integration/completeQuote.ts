/** Composite quote: optional NEAR DEX pre-swap + NearIntents quote. */

import Big from "big.js";
import {
  TokenInfo,
  QuoteResult,
  DexRouter,
  BluechipTokensConfig,
  QuoteParams,
} from "../types";
import {
  isNearIntentsSupportedToken,
  findBestBluechipToken,
  normalizeTokenId,
  convertSlippageToBasisPoints,
  normalizeDestinationAsset,
} from "../utils";
import { IntentsQuotationAdapter } from "../adapters/types";

export interface CompleteQuoteParams {
  sourceToken: TokenInfo;
  targetToken: TokenInfo;
  sourceChain: string;
  targetChain: string;
  amountIn: string;
  slippage: number;
  recipient: string;
  refundTo?: string;
}

export interface CompleteQuoteResult {
  intents: {
    /** Raw NearIntents response (passed through). */
    quote: any; // IntentsQuoteResult
    depositAddress: string;
  };
  preSwap?: {
    quote: QuoteResult;
    tokenIn: TokenInfo;
    tokenOut: TokenInfo;
    executor: DexRouter;
    routeType?: "v1" | "v2";
  };
  finalAmountOut: string;
  totalPriceImpact?: number;
  totalFee?: number;
  routeType?: "v1" | "v2" | "intents"; // Route type used
}

export interface CompleteQuoteConfig {
  intentsQuotationAdapter: IntentsQuotationAdapter;
  dexRouters?: DexRouter[];
  dexRouter?: DexRouter;
  bluechipTokens: BluechipTokensConfig;
  configAdapter: {
    getWrapNearContractId(): string;
  };
  currentUserAddress?: string;
  /** Optional function to check if token supports Intents (beyond bluechip tokens) */
  isIntentsSupportedToken?: (token: TokenInfo) => boolean;
}

/**
 * Build a "complete quote":
 * - If `sourceToken` is not NearIntents-supported, pre-swap to a bluechip token on NEAR DEX.
 * - Quote NearIntents using (pre-swap output) or `amountIn`.
 *
 * Notes:
 * - Prefer `slippage` in bps (e.g. 50 = 0.5%); we also accept percent/decimal inputs.
 * - `targetChain` is currently reserved for future use.
 */
export async function completeQuote(
  params: CompleteQuoteParams,
  config: CompleteQuoteConfig
): Promise<CompleteQuoteResult> {
  const {
    sourceToken,
    targetToken,
    sourceChain: _sourceChain, // Reserved for future use
    targetChain: _targetChain, // Reserved for future use
    amountIn,
    slippage,
    recipient,
    refundTo,
  } = params;

  const {
    intentsQuotationAdapter,
    dexRouters,
    dexRouter,
    bluechipTokens,
    configAdapter,
    currentUserAddress,
    isIntentsSupportedToken: customIsIntentsSupportedToken,
  } = config;
  const wrapNearContractId = configAdapter.getWrapNearContractId();

  const routers = dexRouters || (dexRouter ? [dexRouter] : []);
  if (routers.length === 0) {
    throw new Error("At least one DEX router is required");
  }

  const userAddress = currentUserAddress || recipient;
  if (!userAddress) {
    throw new Error("currentUserAddress or recipient is required for V2 Router");
  }

  if (!sourceToken?.address) {
    throw new Error("Source token address is required");
  }
  if (!targetToken?.address) {
    throw new Error("Target token address is required");
  }

  // Check if token supports Intents:
  // 1. Custom checker (e.g., from nearTokenInList)
  // 2. Bluechip token checker (fallback)
  const isTokenIntentsSupported = customIsIntentsSupportedToken
    ? customIsIntentsSupportedToken(sourceToken)
    : isNearIntentsSupportedToken(sourceToken, bluechipTokens);

  const bluechipToken = findBestBluechipToken(
    bluechipTokens,
    wrapNearContractId
  );

  if (!bluechipToken?.address) {
    throw new Error("Failed to find bluechip token address");
  }

  // Prepare all quote paths for parallel execution
  // If token supports Intents, we have 3 paths: V1+Intents, V2+Intents, Direct Intents
  // If token doesn't support Intents, we have 2 paths: V1+Intents, V2+Intents
  const quotePaths: Array<{
    type: "v1" | "v2" | "intents";
    promise: Promise<{
      intentsQuote: any;
      preSwapQuote?: QuoteResult;
      router?: DexRouter;
      finalAmountOut: string;
    }>;
    router?: DexRouter;
  }> = [];

  // Path 1 & 2: V1/V2 Router + Intents (always available)
  routers.forEach((router, index) => {
    const routeType: "v1" | "v2" = index === 0 ? "v1" : "v2";
    const capabilities = router.getCapabilities();

    const quoteParams: QuoteParams = capabilities.requiresRecipient
      ? {
          tokenIn: sourceToken,
          tokenOut: bluechipToken,
          amountIn,
          slippage,
          swapType: "EXACT_INPUT",
          sender: userAddress,
          recipient: userAddress,
        }
      : {
          tokenIn: sourceToken,
          tokenOut: bluechipToken,
          amountIn,
          slippage,
          swapType: "EXACT_INPUT",
        };

    quotePaths.push({
      type: routeType,
      router,
      promise: (async () => {
        // Step 1: Get pre-swap quote
        const preSwapQuote = await router.quote(quoteParams);
        if (!preSwapQuote.success) {
          throw new Error("Failed to get quote");
        }

        // Step 2: Get Intents quote with pre-swap output
        const bluechipKey =
          bluechipToken.symbol?.toUpperCase() === "WNEAR"
            ? "NEAR"
            : bluechipToken.symbol?.toUpperCase();
        const bluechipTokenConfig =
          (bluechipKey && bluechipTokens[bluechipKey]) || undefined;
        const normalizedSourceAsset = bluechipTokenConfig?.assetId
          ? bluechipTokenConfig.assetId
          : `nep141:${bluechipToken.address}`;

        let normalizedTargetAsset = targetToken.address;
        if (
          normalizedTargetAsset &&
          !normalizedTargetAsset.startsWith("nep141:") &&
          !normalizedTargetAsset.startsWith("nep245:") &&
          normalizedTargetAsset.includes(".")
        ) {
          normalizedTargetAsset = `nep141:${normalizeTokenId(
            normalizedTargetAsset,
            wrapNearContractId
          )}`;
        }
        normalizedTargetAsset =
          normalizeDestinationAsset(normalizedTargetAsset, wrapNearContractId) ||
          normalizedTargetAsset;

        const slippageBps = convertSlippageToBasisPoints(slippage);
        const intentsQuote = await intentsQuotationAdapter.quote({
          originAsset: normalizedSourceAsset,
          destinationAsset: normalizedTargetAsset,
          amount: preSwapQuote.amountOut,
          refundTo: refundTo || recipient,
          recipient,
          slippageTolerance: slippageBps,
          swapType: "FLEX_INPUT",
        });

        if (intentsQuote.quoteStatus !== "success") {
          throw new Error("Failed to get quote");
        }

        return {
          intentsQuote,
          preSwapQuote,
          router,
          finalAmountOut:
            intentsQuote.quoteSuccessResult?.quote?.amountOut || "0",
        };
      })(),
    });
  });

  // Path 3: Direct Intents (only if token supports Intents)
  if (isTokenIntentsSupported) {
    quotePaths.push({
      type: "intents",
      promise: (async () => {
        // Normalize source asset
        let normalizedSourceAsset: string;
        if (sourceToken.symbol) {
          const sourceKey = sourceToken.symbol.toUpperCase();
          const sourceTokenConfig = bluechipTokens[sourceKey];
          if (sourceTokenConfig?.assetId) {
            normalizedSourceAsset = sourceTokenConfig.assetId;
          } else {
            normalizedSourceAsset = normalizeTokenId(
              sourceToken.address,
              wrapNearContractId
            );
            if (!normalizedSourceAsset.startsWith("nep141:")) {
              normalizedSourceAsset = `nep141:${normalizedSourceAsset}`;
            }
          }
        } else {
          normalizedSourceAsset = normalizeTokenId(
            sourceToken.address,
            wrapNearContractId
          );
          if (!normalizedSourceAsset.startsWith("nep141:")) {
            normalizedSourceAsset = `nep141:${normalizedSourceAsset}`;
          }
        }

        // Normalize target asset
        let normalizedTargetAsset = targetToken.address;
        if (
          normalizedTargetAsset &&
          !normalizedTargetAsset.startsWith("nep141:") &&
          !normalizedTargetAsset.startsWith("nep245:") &&
          normalizedTargetAsset.includes(".")
        ) {
          normalizedTargetAsset = `nep141:${normalizeTokenId(
            normalizedTargetAsset,
            wrapNearContractId
          )}`;
        }
        normalizedTargetAsset =
          normalizeDestinationAsset(normalizedTargetAsset, wrapNearContractId) ||
          normalizedTargetAsset;

        const slippageBps = convertSlippageToBasisPoints(slippage);
        const intentsQuote = await intentsQuotationAdapter.quote({
          originAsset: normalizedSourceAsset,
          destinationAsset: normalizedTargetAsset,
          amount: amountIn,
          refundTo: refundTo || recipient,
          recipient,
          slippageTolerance: slippageBps,
          swapType: "EXACT_INPUT",
        });

        if (intentsQuote.quoteStatus !== "success") {
          throw new Error("Failed to get quote");
        }

        return {
          intentsQuote,
          finalAmountOut:
            intentsQuote.quoteSuccessResult?.quote?.amountOut || "0",
        };
      })(),
    });
  }

  // Execute all paths in parallel
  const pathResults = await Promise.allSettled(
    quotePaths.map((p) => p.promise)
  );

  // Process results
  const validPaths: Array<{
    type: "v1" | "v2" | "intents";
    intentsQuote: any;
    preSwapQuote?: QuoteResult;
    router?: DexRouter;
    finalAmountOut: string;
  }> = [];

  pathResults.forEach((result, index) => {
    const pathType = quotePaths[index].type;
    if (result.status === "fulfilled") {
      validPaths.push({
        type: pathType,
        ...result.value,
      });
    }
  });

  if (validPaths.length === 0) {
    throw new Error("Failed to get quote");
  }

  // Select path with maximum finalAmountOut
  const bestPath = validPaths.reduce((best, current) => {
    const bestAmount = new Big(best.finalAmountOut);
    const currentAmount = new Big(current.finalAmountOut);
    return currentAmount.gt(bestAmount) ? current : best;
  });


  const depositAddress =
    bestPath.intentsQuote.quoteSuccessResult?.quote?.depositAddress || "";

  if (!depositAddress) {
    throw new Error("Deposit address not found in intents quote");
  }

  return {
    intents: {
      quote: bestPath.intentsQuote,
      depositAddress,
    },
    preSwap:
      bestPath.preSwapQuote && bestPath.router
        ? {
            quote: bestPath.preSwapQuote,
            tokenIn: sourceToken,
            tokenOut: bluechipToken,
            executor: bestPath.router,
            routeType: bestPath.type as "v1" | "v2",
          }
        : undefined,
    finalAmountOut: bestPath.finalAmountOut,
    routeType: bestPath.type,
  };
}
