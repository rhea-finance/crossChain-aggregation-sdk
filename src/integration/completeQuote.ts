/** Composite quote: optional NEAR DEX pre-swap + NearIntents quote. */

import Big from "big.js";
import { TokenInfo, QuoteResult, DexRouter, BluechipTokensConfig } from "../types";
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
  dexRouter: DexRouter;
  bluechipTokens: BluechipTokensConfig;
  configAdapter: {
    getWrapNearContractId(): string;
  };
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

  const { intentsQuotationAdapter, dexRouter, bluechipTokens, configAdapter } =
    config;
  const wrapNearContractId = configAdapter.getWrapNearContractId();

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
    });

    if (!dexRouter) {
      throw new Error(
        `No DEX router registered for sourceChain=${sourceChain}`
      );
    }
    preSwapQuote = await dexRouter.quote({
      tokenIn: sourceToken,
      tokenOut: bluechipToken,
      amountIn,
      slippage,
      swapType: "EXACT_INPUT",
    });

    if (!preSwapQuote.success) {
      logger.error("DEX Aggregator - Pre-swap quote failed:", {
        error: preSwapQuote.error,
        tokenIn: sourceToken,
        tokenOut: bluechipToken,
      });
      throw new Error(`Pre-swap quote failed: ${preSwapQuote.error}`);
    }

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
    const bluechipTokenConfig = bluechipTokens[bluechipToken.symbol];
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
      const sourceTokenConfig = bluechipTokens[sourceToken.symbol];
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
  if (!normalizedTargetAsset) {
    normalizedTargetAsset = normalizeTokenId(
      targetToken.address,
      wrapNearContractId
    );
  }
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

  return {
    intents: {
      quote: intentsQuote,
      depositAddress,
    },
    preSwap: needsPreSwap
      ? {
          quote: preSwapQuote!,
          tokenIn: sourceToken,
          tokenOut: bluechipToken,
          executor: dexRouter,
        }
      : undefined,
    finalAmountOut: intentsQuote.quoteSuccessResult?.quote?.amountOut || "0",
  };
}
