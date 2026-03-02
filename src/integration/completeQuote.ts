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
import { ErrorMessages, formatErrorMessage as sdkFormatErrorMessage } from "../utils/errorMessages";

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
  /** Optional function to format error messages (for consistency with frontend error handling) */
  formatErrorMessage?: (params: {
    error?: any;
    fallbackMessage?: string;
    originAsset?: string;
    friendly?: boolean;
  }) => string;
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
  // Allow routers to be empty (non-Bitget/OKX supported chains direct Intents)
  // Ensure isTokenIntentsSupported is true

  const userAddress = currentUserAddress || recipient;
  if (!userAddress) {
    throw new Error(ErrorMessages.QUOTE_FAILED);
  }

  // Check if token address is undefined (not provided)
  // Note: Empty string "" is valid for native tokens (ETH), so we only check for undefined
  if (sourceToken?.address === undefined) {
    throw new Error(ErrorMessages.QUOTE_FAILED);
  }
  if (targetToken?.address === undefined) {
    throw new Error(ErrorMessages.QUOTE_FAILED);
  }

  // 判断是否是 EVM 链：优先使用 evmChainId，其次检查 chain 字段
  const isEvmChain =
    evmChainId !== undefined ||
    sourceToken.chain === "evm" ||
    sourceChain === "evm";

  // 判断是否支持 Intents
  // 对于 EVM 链：优先使用 platform 字段（仅 EVM token list 有 platform 字段）
  // 对于 NEAR 链：使用原有的判断逻辑
  const isTokenIntentsSupported =
    (isEvmChain && sourceToken.platform === "nearIntents") ||
    (customIsIntentsSupportedToken
      ? customIsIntentsSupportedToken(sourceToken)
      : isEvmChain
        ? isEvmIntentsSupportedToken(sourceToken, bluechipTokens)
        : isNearIntentsSupportedToken(sourceToken, bluechipTokens));

  const bluechipToken = isEvmChain
    ? findBestEvmBluechipToken(
        bluechipTokens,
        configAdapter.getEvmNativeWrappedTokenAddress?.()
      )
    : findBestBluechipToken(bluechipTokens, wrapNearContractId);

  if (!bluechipToken?.address) {
    throw new Error(ErrorMessages.QUOTE_FAILED);
  }

  /**
   * Quote with retry for rate limit errors
   * Uses exponential backoff strategy for 429 errors
   */
  async function quoteWithRetry(
    router: DexRouter,
    quoteParams: QuoteParams,
    routerType: string,
    routerName: string,
    maxRetries: number = 2,
    initialDelay: number = 1000
  ): Promise<QuoteResult | null> {
    let lastError: any = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const quote = await router.quote(quoteParams);
        
        if (quote.success) {
          return quote;
        }
        
      const isRateLimit =
        quote.error?.includes("429") ||
        quote.error?.toLowerCase().includes("rate limit") ||
        quote.error?.toLowerCase().includes("too many requests");

      if (!isRateLimit || attempt === maxRetries) {
        return quote;
      }

      const baseDelay = isRateLimit ? 2000 : initialDelay;
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
        
        lastError = quote;
      } catch (error: any) {
        const errorMessage = error?.message || String(error);
        const isRateLimit =
          errorMessage?.includes("429") ||
          errorMessage?.toLowerCase().includes("rate limit") ||
          errorMessage?.toLowerCase().includes("too many requests");

        if (!isRateLimit || attempt === maxRetries) {
          throw error;
        }

        const baseDelay = isRateLimit ? 2000 : initialDelay;
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        
        lastError = error;
      }
    }
    
    return null;
  }

  const preSwapQuotePromises = routers.map(async (router, index) => {
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

    const routerName = router.getSupportedChain() === "evm" 
      ? (`EVM-${(router as any).getChainId?.() || "unknown"}`)
      : "NEAR";
    
    const routerType = (router as any).okxAdapter ? "OKX" : 
                       (router as any).bitgetAdapter ? "Bitget" : 
                       routerName;

    try {
      const preSwapQuote = await quoteWithRetry(
        router,
        quoteParams,
        routerType,
        routerName,
        2,
        1000
      );
      
      if (!preSwapQuote || !preSwapQuote.success) {
        return null;
      }

      return {
        type: routeType,
        router,
        preSwapQuote,
      };
    } catch (error: any) {
      return null;
    }
  });

  const preSwapQuoteResults = await Promise.allSettled(preSwapQuotePromises);
  
  const validPreSwapQuotes: Array<{
    type: "v1" | "v2" | "evm";
    router: DexRouter;
    preSwapQuote: QuoteResult;
  }> = [];

  preSwapQuoteResults.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value !== null) {
      validPreSwapQuotes.push(result.value);
    }
  });

  let bestPreSwapQuote: {
    type: "v1" | "v2" | "evm";
    router: DexRouter;
    preSwapQuote: QuoteResult;
  } | null = null;

  if (validPreSwapQuotes.length > 0) {
    bestPreSwapQuote = validPreSwapQuotes.reduce((best, current) => {
      const bestAmount = new Big(best.preSwapQuote.amountOut);
      const currentAmount = new Big(current.preSwapQuote.amountOut);
      return currentAmount.gt(bestAmount) ? current : best;
    });
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

  if (bestPreSwapQuote) {
    const { router, preSwapQuote, type: routeType } = bestPreSwapQuote;

    let normalizedSourceAsset: string;
    // Priority 1: Use assetId from bluechipToken if provided (backend returns Intents assetId for bluechip tokens)
    if (
      bluechipToken.assetId &&
      (bluechipToken.assetId.startsWith("nep245:") ||
        bluechipToken.assetId.startsWith("nep141:") ||
        bluechipToken.assetId.startsWith("1cs_v1:"))
    ) {
      normalizedSourceAsset = bluechipToken.assetId;
    }
    // Priority 2: Fallback to config (only if backend didn't provide assetId)
    else if (isEvmChain) {
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

    let normalizedTargetAsset: string;
    // Priority 1: Use assetId from targetToken if provided (backend returns Intents assetId)
    if (
      targetToken.assetId &&
      (targetToken.assetId.startsWith("nep245:") ||
        targetToken.assetId.startsWith("nep141:") ||
        targetToken.assetId.startsWith("1cs_v1:"))
    ) {
      normalizedTargetAsset = targetToken.assetId;
    }
    // Priority 2: Fallback to existing normalization logic (only if backend didn't provide assetId)
    else {
      normalizedTargetAsset = targetToken.address;
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
    }

    const slippageBps = convertSlippageToBasisPoints(slippage);
    const formattedAmountOut = preSwapQuote.amountOut;
    
    quotePaths.push({
      type: routeType,
      router,
      promise: (async () => {
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
            const formatError = config.formatErrorMessage || sdkFormatErrorMessage;
            const errorMessage = formatError({
              error: intentsQuote.messageOriginal || intentsQuote.message,
              originAsset: normalizedSourceAsset,
              fallbackMessage: ErrorMessages.QUOTE_FAILED,
            });
            throw new Error(errorMessage);
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
  }

  if (isTokenIntentsSupported) {
    quotePaths.push({
      type: "intents",
      promise: (async () => {
        let normalizedSourceAsset: string;
        // Priority 1: Use assetId from token if platform === "nearIntents" (EVM token only)
        if (
          isEvmChain &&
          sourceToken.platform === "nearIntents" &&
          sourceToken.assetId
        ) {
          normalizedSourceAsset = sourceToken.assetId;
        }
        // Priority 2: Use assetId if it's Intents format
        else if (
          sourceToken.assetId &&
          (sourceToken.assetId.startsWith("nep245:") ||
            sourceToken.assetId.startsWith("nep141:") ||
            sourceToken.assetId.startsWith("1cs_v1:"))
        ) {
          normalizedSourceAsset = sourceToken.assetId;
        }
        // Priority 2: Fallback to config (only if backend didn't provide assetId)
        else if (isEvmChain) {
          const sourceKey = sourceToken.symbol?.toUpperCase();
          const sourceTokenConfig = sourceKey ? bluechipTokens[sourceKey] : undefined;
          if (sourceTokenConfig?.assetId) {
            normalizedSourceAsset = sourceTokenConfig.assetId;
          } else if (sourceToken.address === "") {
            // Native token (ETH) - use symbol-based assetId or fallback
            normalizedSourceAsset = `evm-${sourceChain}-native`;
          } else {
            // Last resort fallback (should not happen if backend provides assetId)
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

        let normalizedTargetAsset: string;
        // Priority 1: Use assetId from token if platform === "nearIntents" (EVM token only)
        if (
          isEvmChain &&
          targetToken.platform === "nearIntents" &&
          targetToken.assetId
        ) {
          normalizedTargetAsset = targetToken.assetId;
        }
        // Priority 2: Use assetId if it's Intents format
        else if (
          targetToken.assetId &&
          (targetToken.assetId.startsWith("nep245:") ||
            targetToken.assetId.startsWith("nep141:") ||
            targetToken.assetId.startsWith("1cs_v1:"))
        ) {
          normalizedTargetAsset = targetToken.assetId;
        }
        // Priority 2: Fallback to existing normalization logic (only if backend didn't provide assetId)
        else {
          normalizedTargetAsset = targetToken.address;
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
          // Use formatErrorMessage if provided, otherwise use SDK's formatErrorMessage
          const formatError = config.formatErrorMessage || sdkFormatErrorMessage;
          const errorMessage = formatError({
            error: intentsQuote.messageOriginal || intentsQuote.message,
            originAsset: normalizedSourceAsset,
            fallbackMessage: ErrorMessages.QUOTE_FAILED,
          });
          throw new Error(errorMessage);
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

  // Collect error messages from failed paths
  const errorMessages: string[] = [];

  pathResults.forEach((result, index) => {
    const pathType = quotePaths[index].type;
    if (result.status === "fulfilled") {
      validPaths.push({
        type: pathType,
        ...result.value,
      });
    } else if (result.status === "rejected") {
      // Collect error messages from rejected promises
      const error = result.reason;
      if (error instanceof Error) {
        errorMessages.push(error.message);
      } else if (typeof error === "string") {
        errorMessages.push(error);
      } else {
        errorMessages.push(String(error));
      }
    }
  });

  if (validPaths.length === 0) {
    // Use the most detailed error message available, or fallback to generic error
    // Prefer intents error messages (usually more detailed)
    const intentsError = errorMessages.find(msg => 
      msg && msg !== ErrorMessages.QUOTE_FAILED && 
      (msg.toLowerCase().includes("bridge") || 
       msg.toLowerCase().includes("amount") ||
       msg.toLowerCase().includes("low") ||
       msg.toLowerCase().includes("minimum"))
    );
    const bestError = intentsError || errorMessages[0] || ErrorMessages.QUOTE_FAILED;
    
    // Apply formatErrorMessage (use provided or SDK's default)
    const formatError = config.formatErrorMessage || sdkFormatErrorMessage;
    const formattedError = formatError({
      error: bestError,
      fallbackMessage: ErrorMessages.QUOTE_FAILED,
    });
    
    throw new Error(formattedError);
  }

  const bestPath = validPaths.reduce((best, current) => {
    const bestAmount = new Big(best.finalAmountOut);
    const currentAmount = new Big(current.finalAmountOut);
    return currentAmount.gt(bestAmount) ? current : best;
  });

  const depositAddress =
    bestPath.intentsQuote.quoteSuccessResult?.quote?.depositAddress || "";

  if (!depositAddress) {
    throw new Error(ErrorMessages.QUOTE_FAILED);
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
