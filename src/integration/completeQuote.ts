/**
 * Complete quote: DEX Aggregator + NearIntents
 */

import Big from "big.js";
import { TokenInfo, QuoteResult, DexRouter, BluechipTokensConfig } from "../types";
import {
  isNearIntentsSupportedToken,
  findBestBluechipToken,
  normalizeTokenId,
  convertSlippageToBasisPoints,
  normalizeDestinationAsset,
} from "../utils";
import { IntentsQuotationAdapter } from "../adapters/types";
import { NearSmartRouter } from "../chains/near/NearSmartRouter";

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
 * Complete quote function
 */
export async function completeQuote(
  params: CompleteQuoteParams,
  config: CompleteQuoteConfig
): Promise<CompleteQuoteResult> {
  const {
    sourceToken,
    targetToken,
    sourceChain,
    targetChain,
    amountIn,
    slippage,
    recipient,
    refundTo,
  } = params;

  const { intentsQuotationAdapter, dexRouter, bluechipTokens, configAdapter } =
    config;
  const wrapNearContractId = configAdapter.getWrapNearContractId();

  // 1. Determine if pre-swap DEX is needed
  const needsPreSwap =
    sourceChain === "near" &&
    !isNearIntentsSupportedToken(sourceToken, bluechipTokens);

  // 2. Determine bluechip token
  const bluechipToken = findBestBluechipToken(
    bluechipTokens,
    wrapNearContractId
  );

  // Validate bluechip token address
  if (!bluechipToken?.address) {
    console.error("🔍 DEX Aggregator - Failed to find bluechip token:", {
      bluechipToken,
      bluechipTokens,
    });
    throw new Error("Failed to find bluechip token address");
  }

  console.log("🔍 DEX Aggregator - Using bluechip token:", {
    address: bluechipToken.address,
    symbol: bluechipToken.symbol,
    decimals: bluechipToken.decimals,
  });

  // 3. Serial quote (pre-swap → NearIntents)
  let preSwapQuote: QuoteResult | null = null;

  // 3.1 Pre-swap quote (if needed)
  if (needsPreSwap) {
    // Validate source token address
    if (!sourceToken?.address) {
      throw new Error("Source token address is required");
    }

    console.log("🔍 DEX Aggregator - Pre-swap quote params:", {
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
      console.error("🔍 DEX Aggregator - Pre-swap quote failed:", {
        error: preSwapQuote.error,
        tokenIn: sourceToken,
        tokenOut: bluechipToken,
      });
      throw new Error(`Pre-swap quote failed: ${preSwapQuote.error}`);
    }

    // Validate pre-swap output amount
    const preSwapAmountOut = preSwapQuote.amountOut;
    if (!preSwapAmountOut || new Big(preSwapAmountOut).lte(0)) {
      console.error("🔍 DEX Aggregator - Pre-swap amountOut is invalid:", {
        amountOut: preSwapAmountOut,
        tokenIn: sourceToken,
        tokenOut: bluechipToken,
      });
      throw new Error(
        "Pre-swap returned invalid amount: amount is too small or zero"
      );
    }

    console.log("🔍 DEX Aggregator - Pre-swap quote success:", {
      amountOut: preSwapAmountOut,
      tokenOut: bluechipToken.symbol,
      decimals: bluechipToken.decimals,
    });
  }

  // 3.2 NearIntents quote
  // For pre-swap, use bluechip token's assetId (with nep141: prefix) instead of contractAddress
  let normalizedSourceAsset: string;
  if (needsPreSwap) {
    // Get bluechip token's assetId from bluechipTokens
    const bluechipTokenConfig = bluechipTokens[bluechipToken.symbol];
    if (bluechipTokenConfig?.assetId) {
      normalizedSourceAsset = bluechipTokenConfig.assetId;
      console.log("🔍 Using bluechip token assetId for NearIntents:", {
        symbol: bluechipToken.symbol,
        assetId: normalizedSourceAsset,
        contractAddress: bluechipToken.address,
      });
    } else {
      // Fallback: add nep141: prefix
      normalizedSourceAsset = `nep141:${bluechipToken.address}`;
      console.warn(
        "🔍 Bluechip token assetId not found, using contractAddress with prefix:",
        {
          symbol: bluechipToken.symbol,
          normalizedSourceAsset,
        }
      );
    }
  } else {
    // Source token is not a bluechip token, use assetId directly (if exists)
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

  // Target token: DEX Aggregator only handles tokenIn; tokenOut remains user's choice
  let normalizedTargetAsset = targetToken.address;
  if (!normalizedTargetAsset) {
    normalizedTargetAsset = normalizeTokenId(
      targetToken.address,
      wrapNearContractId
    );
  }
  // For Near-side contract addresses (e.g., usdt.tether-token.near), add nep141: prefix
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

  // Use normalizeDestinationAsset to handle target token (convert near -> wrap.near)
  normalizedTargetAsset =
    normalizeDestinationAsset(normalizedTargetAsset, wrapNearContractId) ||
    normalizedTargetAsset;

  const slippageBps = convertSlippageToBasisPoints(slippage);
  const intentsAmount = needsPreSwap ? preSwapQuote!.amountOut : amountIn;

  console.log("🔍 DEX Aggregator - Calling NearIntents quotation:", {
    originAsset: normalizedSourceAsset,
    destinationAsset: normalizedTargetAsset,
    amount: intentsAmount,
    needsPreSwap,
    preSwapAmountOut: needsPreSwap ? preSwapQuote!.amountOut : undefined,
  });

  // When using intermediate routing, swapType should be FLEX_INPUT
  const swapTypeForIntents = needsPreSwap ? "FLEX_INPUT" : undefined;

  console.log("🔍 DEX Aggregator - swapType for NearIntents:", {
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

  console.log("🔍 DEX Aggregator - NearIntents quotation result:", {
    quoteStatus: intentsQuote.quoteStatus,
    message: intentsQuote.message,
    hasDepositAddress: !!intentsQuote.quoteSuccessResult?.quote?.depositAddress,
  });

  if (intentsQuote.quoteStatus !== "success") {
    const errorMessage = intentsQuote.message || "Unknown error";
    console.error("🔍 DEX Aggregator - NearIntents quote failed:", {
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

  // 4. Build complete quote
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
