/** V2 Router implementation (Aggregate DEX Router). */

import Big from "big.js";
import {
  QuoteParams,
  QuoteResult,
  ExecuteParams,
  ExecuteResult,
  DexRouter,
  RouterCapabilities,
  requiresRecipient,
  requiresRecipientInExecute,
} from "../../types";
import {
  normalizeTokenId,
  convertSlippageToBasisPoints,
} from "../../utils";
import {
  SwapMultiDexPathAdapter,
  NearChainAdapter,
  ConfigAdapter,
} from "../../adapters/types";

export interface AggregateDexRouterConfig {
  swapMultiDexPathAdapter: SwapMultiDexPathAdapter;
  nearChainAdapter: NearChainAdapter;
  configAdapter: ConfigAdapter;
}

/**
 * V2 Router implementation for NEAR
 * Uses Aggregate DEX contract for routing
 */
export class AggregateDexRouter implements DexRouter {
  private swapMultiDexPathAdapter: SwapMultiDexPathAdapter;
  private nearChainAdapter: NearChainAdapter;
  private configAdapter: ConfigAdapter;
  private aggregateDexContractId: string;
  private wrapNearContractId: string;
  private readonly NEW_ACCOUNT_STORAGE_COST = "1250000000000000000000"; // 0.00125 NEAR in yoctoNEAR
  private readonly ONE_YOCTO_NEAR = "1";

  constructor(config: AggregateDexRouterConfig) {
    this.swapMultiDexPathAdapter = config.swapMultiDexPathAdapter;
    this.nearChainAdapter = config.nearChainAdapter;
    this.configAdapter = config.configAdapter;
    this.aggregateDexContractId =
      this.configAdapter.getAggregateDexContractId?.() || "";
    this.wrapNearContractId = this.configAdapter.getWrapNearContractId();

    if (!this.aggregateDexContractId) {
      // AGGREGATE_DEX_CONTRACT_ID not configured
    }
  }

  /**
   * Get Router capabilities
   */
  getCapabilities(): RouterCapabilities {
    return {
      requiresRecipient: true,
      requiresFinalizeQuote: false,
      requiresComplexRegistration: true,
      supportedChain: "near",
    };
  }

  getSupportedChain(): "near" {
    return "near";
  }

  /**
   * Get a swap quote from V2 Router API
   */
  async quote(params: QuoteParams): Promise<QuoteResult> {
    try {
      if (!requiresRecipient(params)) {
        return {
          success: false,
          tokenIn: params.tokenIn,
          tokenOut: params.tokenOut,
          amountIn: params.amountIn,
          amountOut: "0",
          minAmountOut: "0",
          routes: [],
          error: "Missing sender or recipient",
        };
      }

      const { tokenIn, tokenOut, amountIn, slippage, sender, recipient } = params;

      if (!sender || !recipient) {
        return {
          success: false,
          tokenIn: params.tokenIn,
          tokenOut: params.tokenOut,
          amountIn: params.amountIn,
          amountOut: "0",
          minAmountOut: "0",
          routes: [],
          error: "Missing sender or recipient",
        };
      }

      if (!tokenIn?.address || !tokenOut?.address) {
        return {
          success: false,
          tokenIn: params.tokenIn,
          tokenOut: params.tokenOut,
          amountIn: params.amountIn,
          amountOut: "0",
          minAmountOut: "0",
          routes: [],
          error: "Missing token address",
        };
      }

      const normalizedTokenIn = normalizeTokenId(
        tokenIn.address,
        this.wrapNearContractId
      );
      const normalizedTokenOut = normalizeTokenId(
        tokenOut.address,
        this.wrapNearContractId
      );

      if (!normalizedTokenIn || !normalizedTokenOut) {
        return {
          success: false,
          tokenIn: params.tokenIn,
          tokenOut: params.tokenOut,
          amountIn: params.amountIn,
          amountOut: "0",
          minAmountOut: "0",
          routes: [],
          error: "Invalid token address",
        };
      }

      const slippageBps = convertSlippageToBasisPoints(slippage);
      const slippageDecimalForApi = slippageBps / 10000;

      const response = await this.swapMultiDexPathAdapter.swapMultiDexPath({
        amountIn: String(amountIn),
        tokenIn: normalizedTokenIn,
        tokenOut: normalizedTokenOut,
        slippage: slippageDecimalForApi,
        pathDeep: 2,
        user: sender,
        receiveUser: recipient,
      });

      if (response.result_code !== 0 || !response.result_data) {
        return {
          success: false,
          tokenIn,
          tokenOut,
          amountIn,
          amountOut: "0",
          minAmountOut: "0",
          routes: [],
          error: "Failed to get quote",
        };
      }

      const {
        amount_in,
        amount_out,
        min_amount_out,
        msg,
        signature,
        tokens,
        dexs,
      } = response.result_data;

      return {
        success: true,
        tokenIn,
        tokenOut,
        amountIn: amount_in || amountIn,
        amountOut: amount_out || "0",
        minAmountOut: min_amount_out || "0",
        routes: [],
        routerMsg: msg,
        signature: signature,
        tokens: tokens || [],
        dexs: dexs || [],
        recipient: recipient,
        slippage: slippage,
      };
    } catch (error: any) {
      return {
        success: false,
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn,
        amountOut: "0",
        minAmountOut: "0",
        routes: [],
        error: "Failed to get quote",
      };
    }
  }

  /**
   * @deprecated No longer needed. Kept for interface compatibility only.
   */
  async finalizeQuote(
    params: QuoteParams,
    depositAddress: string
  ): Promise<QuoteResult> {
    if (!requiresRecipient(params)) {
      throw new Error("V2 Router requires recipient parameters");
    }

    return await this.quote({
      ...params,
      recipient: depositAddress,
    });
  }

  private async reFetchQuoteWithBalance(
    quoteParams: QuoteParams,
    actualBalance: string,
    _context: string
  ): Promise<QuoteResult> {
    const balanceBig = new Big(actualBalance);
    const adjustedParams: QuoteParams = {
      ...quoteParams,
      amountIn: balanceBig.toFixed(0),
    };


    const adjustedQuote = await this.quote(adjustedParams);
    if (adjustedQuote.success && adjustedQuote.routerMsg && adjustedQuote.signature) {
      return adjustedQuote;
    } else {
      throw new Error("Failed to get quote");
    }
  }

  private async ensureQuoteAmountWithinBalance(
    quoteParams: QuoteParams,
    actualBalance: string,
    context: string
  ): Promise<QuoteResult> {
    const requestedAmountBig = new Big(quoteParams.amountIn);
    const balanceBig = new Big(actualBalance);

    // Check if tokenIn is native NEAR
    // We need to reserve gas for native NEAR transactions because they include multiple storage_deposits
    // and the transfer itself requires gas.
    const isNativeNear =
      (quoteParams.tokenIn.symbol === "NEAR" ||
        quoteParams.tokenIn.address === "near" ||
        (!quoteParams.tokenIn.address && quoteParams.tokenIn.symbol === "NEAR")) &&
      quoteParams.tokenIn.address !== this.wrapNearContractId;

    let effectiveBalanceBig = balanceBig;
    let effectiveBalanceStr = actualBalance;

    // Reserve 0.05 NEAR for gas and storage costs for native NEAR
    if (isNativeNear) {
      const reserveAmount = new Big("50000000000000000000000"); 
      if (balanceBig.gt(reserveAmount)) {
        effectiveBalanceBig = balanceBig.minus(reserveAmount);
        effectiveBalanceStr = effectiveBalanceBig.toFixed(0);
      } else {
        effectiveBalanceBig = new Big(0);
        effectiveBalanceStr = "0";
      }
    }

    if (requestedAmountBig.gt(effectiveBalanceBig) && balanceBig.gt(0)) {
      return await this.reFetchQuoteWithBalance(quoteParams, effectiveBalanceStr, context);
    }

    if (balanceBig.gt(0) && requestedAmountBig.lt(balanceBig)) {
      const diff = balanceBig.minus(requestedAmountBig);
      const diffPercent = diff.div(balanceBig).times(100);
      const isMaxSwap = diffPercent.lt(0.1) || diff.lt(1000);
      
      if (isMaxSwap) {
        return await this.reFetchQuoteWithBalance(quoteParams, effectiveBalanceStr, context);
      }
    }
    const quote = await this.quote(quoteParams);
    if (!quote.success) {
      throw new Error("Failed to get quote");
    }

    if (quote.amountIn !== quoteParams.amountIn) {
      const apiAmountBig = new Big(quote.amountIn);
      if (apiAmountBig.gt(effectiveBalanceBig) && balanceBig.gt(0)) {
        return await this.reFetchQuoteWithBalance(quoteParams, effectiveBalanceStr, context);
      }
      
      if (apiAmountBig.lt(balanceBig) && balanceBig.gt(0)) {
        const diff = balanceBig.minus(apiAmountBig);
        const diffPercent = diff.div(balanceBig).times(100);
        const isMaxSwap = diffPercent.lt(0.1) || diff.lt(1000);
        
        if (isMaxSwap) {
          return await this.reFetchQuoteWithBalance(quoteParams, effectiveBalanceStr, context);
        }
      }
    }

    return quote;
  }

  async executeSwap(params: ExecuteParams): Promise<ExecuteResult> {
    try {
      if (!requiresRecipientInExecute(params)) {
        return {
          success: false,
          error: "Missing sender or receiveUser",
        };
      }

      const { quote, sender, receiveUser } = params;

      if (!quote.success) {
        return {
          success: false,
          error: "Invalid quote",
        };
      }

      if (!receiveUser || receiveUser.trim() === "") {
        return {
          success: false,
          error: "Missing receiveUser",
        };
      }

      if (receiveUser.startsWith("0x") && receiveUser.length === 42) {
        return {
          success: false,
          error: "Invalid receiveUser address",
        };
      }

      const slippage = quote.slippage || 0.005;
      
      let tokenBalanceAtExecution = "0";
      try {
        const balanceResult = await this.nearChainAdapter.view({
          contractId: quote.tokenIn.address,
          methodName: "ft_balance_of",
          args: { account_id: sender },
        });
        tokenBalanceAtExecution = balanceResult || "0";
      } catch (e) {
        // Ignore balance fetch errors
      }
      
      const finalQuoteParams: QuoteParams = {
        tokenIn: quote.tokenIn,
        tokenOut: quote.tokenOut,
        amountIn: quote.amountIn,
        slippage: slippage,
        sender: sender,
        recipient: receiveUser,
      };

      let finalQuote: QuoteResult;
      try {
        finalQuote = await this.ensureQuoteAmountWithinBalance(
          finalQuoteParams,
          tokenBalanceAtExecution,
          "Re-fetching quote with receiveUser"
        );
      } catch (error: any) {
        return {
          success: false,
          error: "Failed to get quote",
        };
      }

      const routerMsg = finalQuote.routerMsg;
      const signature = finalQuote.signature;

      if (!routerMsg || !signature) {
        return {
          success: false,
          error: "Failed to get quote",
        };
      }

      const tokens = finalQuote.tokens || [];
      const dexs = finalQuote.dexs || [];

      const transactions: Array<{
        contractId: string;
        methodName: string;
        args: any;
        gas?: string;
        expandDeposit?: string;
      }> = [];

      const getStorageBalance = async (
        tokenId: string,
        accountId: string
      ): Promise<any> => {
        try {
          return await this.nearChainAdapter.view({
            contractId: tokenId,
            methodName: "storage_balance_of",
            args: { account_id: accountId },
          });
        } catch (error) {
          return null;
        }
      };

      // 1. Convert NEAR to wNEAR if tokenIn is native NEAR
      const isNativeNear =
        (finalQuote.tokenIn.symbol === "NEAR" ||
          finalQuote.tokenIn.address === "near" ||
          (!finalQuote.tokenIn.address && finalQuote.tokenIn.symbol === "NEAR")) &&
        finalQuote.tokenIn.address !== this.wrapNearContractId;

      if (isNativeNear) {
        const wrapNearStorageBalance = await getStorageBalance(
          this.wrapNearContractId,
          sender
        ).catch(() => null);

        if (!wrapNearStorageBalance) {
          transactions.push({
            contractId: this.wrapNearContractId,
            methodName: "storage_deposit",
            args: {
              account_id: sender,
              registration_only: true,
            },
            gas: "50000000000000",
            expandDeposit: this.NEW_ACCOUNT_STORAGE_COST,
          });
        }

        transactions.push({
          contractId: this.wrapNearContractId,
          methodName: "near_deposit",
          args: {},
          gas: "50000000000000",
          expandDeposit: finalQuote.amountIn,
        });
      }

      // 2. Check if user is registered in each token
      const tokensToCheck = dexs.length > 1 ? tokens : [finalQuote.tokenOut.address];
      const tokenStorageBalances = await Promise.all(
        tokensToCheck.map((tokenId) =>
          getStorageBalance(tokenId, sender).catch(() => null)
        )
      );

      tokensToCheck.forEach((tokenId, index) => {
        if (!tokenStorageBalances[index]) {
          transactions.push({
            contractId: tokenId,
            methodName: "storage_deposit",
            args: {
              account_id: sender,
              registration_only: true,
            },
            gas: "50000000000000",
            expandDeposit: this.NEW_ACCOUNT_STORAGE_COST,
          });
        }
      });

      // 3. Check if receiveUser is registered in tokenOut
      if (receiveUser && receiveUser !== sender) {
        const receiveUserStorageBalance = await getStorageBalance(
          finalQuote.tokenOut.address,
          receiveUser
        ).catch(() => null);

        if (!receiveUserStorageBalance) {
          transactions.push({
            contractId: finalQuote.tokenOut.address,
            methodName: "storage_deposit",
            args: {
              account_id: receiveUser,
              registration_only: true,
            },
            gas: "50000000000000",
            expandDeposit: this.NEW_ACCOUNT_STORAGE_COST,
          });
        }
      }

      // 4. Check if AGGREGATE_DEX_CONTRACT_ID is registered in each token
      const aggregateDexStorageBalances = await Promise.all(
        tokens.map((tokenId) =>
          getStorageBalance(tokenId, this.aggregateDexContractId).catch(
            () => null
          )
        )
      );

      tokens.forEach((tokenId, index) => {
        if (!aggregateDexStorageBalances[index]) {
          transactions.push({
            contractId: tokenId,
            methodName: "storage_deposit",
            args: {
              account_id: this.aggregateDexContractId,
              registration_only: true,
            },
            gas: "50000000000000",
            expandDeposit: this.NEW_ACCOUNT_STORAGE_COST,
          });
        }
      });

      // 5. Check if tokens are registered in aggregate dex (only for sender, not receiveUser)
      if (tokens.length > 0) {
        const registeredStatus = await this.queryUserTokensRegistered({
          user: sender,
          tokens,
        });

        const unregisteredTokens = tokens.filter(
          (_, index) => !registeredStatus[index]
        );

        if (unregisteredTokens.length > 0) {
          const depositPerToken = new Big("0.005").mul(
            new Big("1000000000000000000000000")
          );
          const totalDeposit = depositPerToken.mul(unregisteredTokens.length);

          transactions.push({
            contractId: this.aggregateDexContractId,
            methodName: "tokens_storage_deposit",
            args: {
              user: sender,
              tokens: unregisteredTokens,
            },
            gas: "30000000000000",
            expandDeposit: totalDeposit.toFixed(0),
          });
        }
      }

      // 6. Main swap transaction
      // Re-fetch balance right before execution (may have changed due to registration fees)
      try {
        const balanceResult = await this.nearChainAdapter.view({
          contractId: finalQuote.tokenIn.address,
          methodName: "ft_balance_of",
          args: { account_id: sender },
        });
        tokenBalanceAtExecution = balanceResult || "0";
      } catch (e) {
        // Ignore balance fetch errors
      }
      const finalBalanceQuoteParams: QuoteParams = {
        tokenIn: finalQuote.tokenIn,
        tokenOut: finalQuote.tokenOut,
        amountIn: finalQuote.amountIn,
        slippage: slippage,
        sender: sender,
        recipient: receiveUser,
      };

      let finalQuoteForExecution: QuoteResult;
      try {
        finalQuoteForExecution = await this.ensureQuoteAmountWithinBalance(
          finalBalanceQuoteParams,
          tokenBalanceAtExecution,
          "Final balance check before execution"
        );
      } catch (error: any) {
        return {
          success: false,
          error: "Failed to get quote",
        };
      }

      const finalAmountToTransfer = finalQuoteForExecution.amountIn;
      const finalMsgString = JSON.stringify({
        msg: finalQuoteForExecution.routerMsg,
        signature: finalQuoteForExecution.signature,
      });

      transactions.push({
        contractId: finalQuote.tokenIn.address,
        methodName: "ft_transfer_call",
        args: {
          receiver_id: this.aggregateDexContractId,
          amount: finalAmountToTransfer,
          msg: finalMsgString,
        },
        gas: "300000000000000",
        expandDeposit: this.ONE_YOCTO_NEAR,
      });

      const result = await this.nearChainAdapter.call({
        transactions,
      });

      if (result.status === "success") {
        return {
          success: true,
          txHash: result.txHash,
          txHashArray:
            result.txHashArr || (result.txHash ? [result.txHash] : []),
        };
      } else {
        return {
          success: false,
          error: "Execute swap failed",
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error: "Execute swap failed",
      };
    }
  }


  private async queryUserTokensRegistered({
    user,
    tokens,
  }: {
    user: string;
    tokens: string[];
  }): Promise<boolean[]> {
    try {
      return await this.nearChainAdapter.view({
        contractId: this.aggregateDexContractId,
        methodName: "query_user_tokens_registered",
        args: {
          user,
          tokens,
        },
      });
    } catch (error) {
      return tokens.map(() => false);
    }
  }
}
