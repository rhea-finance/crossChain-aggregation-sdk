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
import { logger } from "../utils/logger";
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
  };
  finalAmountOut: string;
  totalPriceImpact?: number;
  totalFee?: number;
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
    sourceChain,
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

  const needsPreSwap =
    sourceChain === "near" &&
    !isNearIntentsSupportedToken(sourceToken, bluechipTokens);

  const bluechipToken = findBestBluechipToken(
    bluechipTokens,
    wrapNearContractId
  );

  if (!bluechipToken?.address) {
    logger.error("DEX Aggregator - Failed to find bluechip token:", {
      bluechipToken,
      bluechipTokens,
    });
    throw new Error("Failed to find bluechip token address");
  }

  logger.debug("DEX Aggregator - Using bluechip token:", {
    address: bluechipToken.address,
    symbol: bluechipToken.symbol,
    decimals: bluechipToken.decimals,
  });

  let preSwapQuote: QuoteResult | null = null;
  let bestRouter: DexRouter | null = null;

  if (needsPreSwap) {
    if (!sourceToken?.address) {
      throw new Error("Source token address is required");
    }

    logger.debug("DEX Aggregator - Pre-swap quote params:", {
      tokenIn: {
        address: sourceToken.address,
        symbol: sourceToken.symbol,
      },
      tokenOut: {
        address: bluechipToken.address,
        symbol: bluechipToken.symbol,
      },
      amountIn,
      slippage,
      routersCount: routers.length,
      userAddress,
    });

    const quotes = await Promise.allSettled(
      routers.map((router) => {
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

        return router.quote(quoteParams);
      })
    );

    const validQuotes = quotes
      .filter(
        (r): r is PromiseFulfilledResult<QuoteResult> =>
          r.status === "fulfilled" && r.value.success
      )
      .map((r) => r.value);

    if (validQuotes.length === 0) {
      const errors = quotes
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
      logger.error("DEX Aggregator - All router quotes failed:", errors);
      throw new Error(
        `All router quotes failed: ${errors.join("; ")}`
      );
    }

    const bestQuote = validQuotes.reduce((best, current) => {
      const bestAmount = new Big(best.amountOut);
      const currentAmount = new Big(current.amountOut);
      return currentAmount.gt(bestAmount) ? current : best;
    });

    const bestQuoteIndex = validQuotes.indexOf(bestQuote);
    bestRouter = routers[bestQuoteIndex];
    preSwapQuote = bestQuote;

    logger.debug("DEX Aggregator - Selected best router:", {
      routerIndex: bestQuoteIndex,
      amountOut: bestQuote.amountOut,
      routerType: bestRouter.getCapabilities().requiresRecipient
        ? "V2 (Recipient)"
        : "V1 (Simple)",
    });

    const preSwapAmountOut = preSwapQuote.amountOut;
    if (!preSwapAmountOut || new Big(preSwapAmountOut).lte(0)) {
      logger.error("DEX Aggregator - Pre-swap amountOut is invalid:", {
        amountOut: preSwapAmountOut,
        tokenIn: sourceToken,
        tokenOut: bluechipToken,
      });
      throw new Error(
        "Pre-swap returned invalid amount: amount is too small or zero"
      );
    }

    logger.debug("DEX Aggregator - Pre-swap quote success:", {
      amountOut: preSwapAmountOut,
      tokenOut: bluechipToken.symbol,
      decimals: bluechipToken.decimals,
    });
  }

  let normalizedSourceAsset: string;
  if (needsPreSwap) {
    const bluechipKey =
      bluechipToken.symbol?.toUpperCase() === "WNEAR"
        ? "NEAR"
        : bluechipToken.symbol?.toUpperCase();
    const bluechipTokenConfig =
      (bluechipKey && bluechipTokens[bluechipKey]) || undefined;
    if (bluechipTokenConfig?.assetId) {
      normalizedSourceAsset = bluechipTokenConfig.assetId;
      logger.debug("Using bluechip token assetId for NearIntents:", {
        symbol: bluechipToken.symbol,
        assetId: normalizedSourceAsset,
        contractAddress: bluechipToken.address,
      });
    } else {
      normalizedSourceAsset = `nep141:${bluechipToken.address}`;
      logger.warn(
        "Bluechip token assetId not found, using contractAddress with prefix:",
        {
          symbol: bluechipToken.symbol,
          normalizedSourceAsset,
        }
      );
    }
  } else {
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
  }

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
  const intentsAmount = needsPreSwap ? preSwapQuote!.amountOut : amountIn;

  logger.debug("DEX Aggregator - Calling NearIntents quotation:", {
    originAsset: normalizedSourceAsset,
    destinationAsset: normalizedTargetAsset,
    amount: intentsAmount,
    needsPreSwap,
    preSwapAmountOut: needsPreSwap ? preSwapQuote!.amountOut : undefined,
  });

  const swapTypeForIntents = needsPreSwap ? "FLEX_INPUT" : undefined;

  logger.debug("DEX Aggregator - swapType for NearIntents:", {
    needsPreSwap,
    swapType: swapTypeForIntents || "EXACT_INPUT (default)",
  });

  const intentsQuote = await intentsQuotationAdapter.quote({
    originAsset: normalizedSourceAsset,
    destinationAsset: normalizedTargetAsset,
    amount: intentsAmount,
    refundTo: refundTo || recipient,
    recipient,
    slippageTolerance: slippageBps,
    swapType: swapTypeForIntents,
  });

  logger.debug("DEX Aggregator - NearIntents quotation result:", {
    quoteStatus: intentsQuote.quoteStatus,
    message: intentsQuote.message,
    hasDepositAddress: !!intentsQuote.quoteSuccessResult?.quote?.depositAddress,
  });

  if (intentsQuote.quoteStatus !== "success") {
    const errorMessage = intentsQuote.message || "Unknown error";
    logger.error("DEX Aggregator - NearIntents quote failed:", {
      error: errorMessage,
      originAsset: normalizedSourceAsset,
      destinationAsset: normalizedTargetAsset,
      amount: intentsAmount,
      needsPreSwap,
      preSwapAmountOut: needsPreSwap ? preSwapQuote!.amountOut : undefined,
    });
    throw new Error(`Intents quote failed: ${errorMessage}`);
  }

  const depositAddress =
    intentsQuote.quoteSuccessResult?.quote?.depositAddress || "";

  if (!depositAddress) {
    throw new Error("Deposit address not found in intents quote");
  }

  // executeSwap will automatically fetch final quote using receiveUser (depositAddress)
  const finalQuote = preSwapQuote;

  return {
    intents: {
      quote: intentsQuote,
      depositAddress,
    },
    preSwap: needsPreSwap && finalQuote && bestRouter
      ? {
          quote: finalQuote,
          tokenIn: sourceToken,
          tokenOut: bluechipToken,
          executor: bestRouter,
        }
      : undefined,
    finalAmountOut: intentsQuote.quoteSuccessResult?.quote?.amountOut || "0",
  };
}
