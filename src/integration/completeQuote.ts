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
  isEvmIntentsSupportedToken,
  findBestBluechipToken,
  findBestEvmBluechipToken,
  normalizeTokenId,
  normalizeEvmAddress,
  convertSlippageToBasisPoints,
  normalizeDestinationAsset,
} from "../utils";
import { IntentsQuotationAdapter } from "../adapters/types";
import { ErrorMessages } from "../utils/errorMessages";

export interface CompleteQuoteParams {
  sourceToken: TokenInfo;
  targetToken: TokenInfo;
  sourceChain: string;
  targetChain: string;
  amountIn: string;
  slippage: number;
  recipient: string;
  refundTo?: string;
  customRecipientMsg?: string;
  appFees?: Array<{ recipient: string; fee: number }>;
  /** Optional: EVM chain ID for precise chain identification (e.g., 1 for Ethereum, 56 for BSC) */
  evmChainId?: number;
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
    routeType?: "v1" | "v2" | "evm";
  };
  finalAmountOut: string;
  totalPriceImpact?: number;
  totalFee?: number;
  routeType?: "v1" | "v2" | "evm" | "intents"; // Route type used
}

export interface CompleteQuoteConfig {
  intentsQuotationAdapter: IntentsQuotationAdapter;
  dexRouters?: DexRouter[];
  dexRouter?: DexRouter;
  bluechipTokens: BluechipTokensConfig;
  configAdapter: {
    getWrapNearContractId(): string;
    /** Optional: Get native wrapped token address for EVM chains (e.g., WETH) */
    getEvmNativeWrappedTokenAddress?(): string;
  };
  currentUserAddress?: string;
  /** Optional function to check if token supports Intents (beyond bluechip tokens) */
  isIntentsSupportedToken?: (token: TokenInfo) => boolean;
}

/**
 * Build a complete quote with optional pre-swap
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
    customRecipientMsg,
    appFees,
    evmChainId,
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
  // Allow routers to be empty (non-Bitget supported chains direct Intents)
  // Ensure isTokenIntentsSupported is true

  const userAddress = currentUserAddress || recipient;
  if (!userAddress) {
    throw new Error(ErrorMessages.MISSING_USER_ADDRESS);
  }

  // Check if token address is undefined (not provided)
  // Note: Empty string "" is valid for native tokens (ETH), so we only check for undefined
  if (sourceToken?.address === undefined) {
    throw new Error(ErrorMessages.MISSING_TOKEN_ADDRESS);
  }
  if (targetToken?.address === undefined) {
    throw new Error(ErrorMessages.MISSING_TOKEN_ADDRESS);
  }

  const isEvmChain = evmChainId !== undefined ||
                     sourceChain === "evm" || 
                     sourceChain === "ethereum" || 
                     sourceChain === "bsc" || 
                     sourceChain === "polygon" ||
                     sourceChain === "base" ||
                     sourceChain === "monad" ||
                     sourceToken.chain === "evm";

  const isTokenIntentsSupported = customIsIntentsSupportedToken
    ? customIsIntentsSupportedToken(sourceToken)
    : isEvmChain
    ? isEvmIntentsSupportedToken(sourceToken, bluechipTokens)
    : isNearIntentsSupportedToken(sourceToken, bluechipTokens);

  const bluechipToken = isEvmChain
    ? findBestEvmBluechipToken(
        bluechipTokens,
        configAdapter.getEvmNativeWrappedTokenAddress?.()
      )
    : findBestBluechipToken(bluechipTokens, wrapNearContractId);

  if (!bluechipToken?.address) {
    throw new Error(ErrorMessages.QUOTE_FAILED);
  }

  const quotePaths: Array<{
    type: "v1" | "v2" | "evm" | "intents";
    promise: Promise<{
      intentsQuote: any;
      preSwapQuote?: QuoteResult;
      router?: DexRouter;
      finalAmountOut: string;
    }>;
    router?: DexRouter;
  }> = [];

  routers.forEach((router, index) => {
    const supportedChain = router.getSupportedChain();
    const isEvmRouter = supportedChain === "evm";
    
    let routeType: "v1" | "v2" | "evm";
    if (isEvmRouter) {
      routeType = "evm";
    } else {
      routeType = index === 0 ? "v1" : "v2";
    }
    
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
        const preSwapQuote = await router.quote(quoteParams);
        if (!preSwapQuote.success) {
          throw new Error(ErrorMessages.QUOTE_FAILED);
        }

        let normalizedSourceAsset: string;
        if (isEvmChain) {
          const bluechipKey = bluechipToken.symbol?.toUpperCase();
          const bluechipTokenConfig =
            (bluechipKey && bluechipTokens[bluechipKey]) || undefined;
          normalizedSourceAsset = bluechipTokenConfig?.assetId
            ? bluechipTokenConfig.assetId
            : `evm:${normalizeEvmAddress(bluechipToken.address)}`;
        } else {
          const bluechipKey =
            bluechipToken.symbol?.toUpperCase() === "WNEAR"
              ? "NEAR"
              : bluechipToken.symbol?.toUpperCase();
          const bluechipTokenConfig =
            (bluechipKey && bluechipTokens[bluechipKey]) || undefined;
          normalizedSourceAsset = bluechipTokenConfig?.assetId
            ? bluechipTokenConfig.assetId
            : `nep141:${bluechipToken.address}`;
        }

        let normalizedTargetAsset = targetToken.address;
        if (normalizedTargetAsset?.startsWith("1cs_v1:")) {
          // Keep 1cs_v1 format
        } else if (
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
        if (!normalizedTargetAsset?.startsWith("1cs_v1:")) {
          normalizedTargetAsset =
            normalizeDestinationAsset(normalizedTargetAsset, wrapNearContractId) ||
            normalizedTargetAsset;
        }

        const slippageBps = convertSlippageToBasisPoints(slippage);
        
        let formattedAmountOut = preSwapQuote.amountOut;
        if (isEvmChain && bluechipToken.decimals !== undefined) {
          try {
            const amountBN = new Big(preSwapQuote.amountOut);
            if (amountBN.lte(0)) {
              throw new Error(ErrorMessages.QUOTE_INVALID);
            }
            formattedAmountOut = amountBN.toFixed(0, Big.roundDown);
          } catch (error: any) {
            throw new Error(ErrorMessages.QUOTE_FAILED);
          }
        }
        
        try {
          const intentsQuote = await intentsQuotationAdapter.quote({
            originAsset: normalizedSourceAsset,
            destinationAsset: normalizedTargetAsset,
            amount: formattedAmountOut,
            refundTo: refundTo || recipient,
            recipient,
            slippageTolerance: slippageBps,
            swapType: "FLEX_INPUT",
            ...(customRecipientMsg ? { customRecipientMsg } : {}),
            ...(appFees ? { appFees } : {}),
          });
            
        if (intentsQuote.quoteStatus !== "success") {
          throw new Error(ErrorMessages.QUOTE_FAILED);
        }
          
          return {
            intentsQuote,
            preSwapQuote,
            router,
            finalAmountOut: intentsQuote.quoteSuccessResult?.quote?.amountOut || "0",
          };
        } catch (error: any) {
          throw error;
        }
      })(),
    });
  });

  if (isTokenIntentsSupported) {
    quotePaths.push({
      type: "intents",
      promise: (async () => {
        let normalizedSourceAsset: string;
        if (isEvmChain) {
          const sourceKey = sourceToken.symbol?.toUpperCase();
          const sourceTokenConfig = sourceKey ? bluechipTokens[sourceKey] : undefined;
          // Handle native token (empty address)
          if (sourceTokenConfig?.assetId) {
            normalizedSourceAsset = sourceTokenConfig.assetId;
          } else if (sourceToken.address === "") {
            // Native token (ETH) - use symbol-based assetId or fallback
            normalizedSourceAsset = `evm-${sourceChain}-native`;
          } else {
            normalizedSourceAsset = `evm:${normalizeEvmAddress(sourceToken.address)}`;
          }
        } else {
          const sourceKey = sourceToken.symbol?.toUpperCase();
          const sourceTokenConfig = sourceKey ? bluechipTokens[sourceKey] : undefined;
          if (sourceTokenConfig?.assetId) {
            normalizedSourceAsset = sourceTokenConfig.assetId;
          } else {
            normalizedSourceAsset = normalizeTokenId(sourceToken.address, wrapNearContractId);
            if (!normalizedSourceAsset.startsWith("nep141:")) {
              normalizedSourceAsset = `nep141:${normalizedSourceAsset}`;
            }
          }
        }

        let normalizedTargetAsset = targetToken.address;
        if (normalizedTargetAsset?.startsWith("1cs_v1:")) {
          // Keep 1cs_v1 format
        } else if (
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
        if (!normalizedTargetAsset?.startsWith("1cs_v1:")) {
          normalizedTargetAsset =
            normalizeDestinationAsset(normalizedTargetAsset, wrapNearContractId) ||
            normalizedTargetAsset;
        }

        const slippageBps = convertSlippageToBasisPoints(slippage);
        const intentsQuote = await intentsQuotationAdapter.quote({
          originAsset: normalizedSourceAsset,
          destinationAsset: normalizedTargetAsset,
          amount: amountIn,
          refundTo: refundTo || recipient,
          recipient,
          slippageTolerance: slippageBps,
          swapType: "EXACT_INPUT",
          ...(customRecipientMsg ? { customRecipientMsg } : {}),
        });

        if (intentsQuote.quoteStatus !== "success") {
          throw new Error(ErrorMessages.QUOTE_FAILED);
        }

        return {
          intentsQuote,
          finalAmountOut:
            intentsQuote.quoteSuccessResult?.quote?.amountOut || "0",
        };
      })(),
    });
  }

  const pathResults = await Promise.allSettled(
    quotePaths.map((p) => p.promise)
  );

  const validPaths: Array<{
    type: "v1" | "v2" | "evm" | "intents";
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
    throw new Error(ErrorMessages.QUOTE_FAILED);
  }

  const bestPath = validPaths.reduce((best, current) => {
    const bestAmount = new Big(best.finalAmountOut);
    const currentAmount = new Big(current.finalAmountOut);
    return currentAmount.gt(bestAmount) ? current : best;
  });

  const depositAddress =
    bestPath.intentsQuote.quoteSuccessResult?.quote?.depositAddress || "";

  if (!depositAddress) {
    throw new Error(ErrorMessages.QUOTE_INVALID);
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
            routeType: bestPath.type as "v1" | "v2" | "evm",
          }
        : undefined,
    finalAmountOut: bestPath.finalAmountOut,
    routeType: bestPath.type,
  };
}
