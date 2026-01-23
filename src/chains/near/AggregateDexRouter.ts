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
import { logger } from "../../utils/logger";
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
      logger.error(
        "AggregateDexRouter - AGGREGATE_DEX_CONTRACT_ID not configured"
      );
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
          error: "V2 Router requires sender and recipient parameters",
        };
      }

      const { tokenIn, tokenOut, amountIn, slippage, sender, recipient } = params;

      if (!sender || !recipient) {
        logger.error("AggregateDexRouter quote - Missing sender or recipient:", {
          sender,
          recipient,
        });
        return {
          success: false,
          tokenIn: params.tokenIn,
          tokenOut: params.tokenOut,
          amountIn: params.amountIn,
          amountOut: "0",
          minAmountOut: "0",
          routes: [],
          error: `V2 Router requires non-empty sender and recipient. Got sender="${sender}", recipient="${recipient}"`,
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
        logger.error("AggregateDexRouter quote - Invalid token addresses:", {
          tokenIn: {
            original: tokenIn.address,
            normalized: normalizedTokenIn,
          },
          tokenOut: {
            original: tokenOut.address,
            normalized: normalizedTokenOut,
          },
        });
        return {
          success: false,
          tokenIn: params.tokenIn,
          tokenOut: params.tokenOut,
          amountIn: params.amountIn,
          amountOut: "0",
          minAmountOut: "0",
          routes: [],
          error: `Invalid token address: tokenIn=${
            normalizedTokenIn || "empty"
          }, tokenOut=${normalizedTokenOut || "empty"}`,
        };
      }

      const slippageBps = convertSlippageToBasisPoints(slippage);
      const slippageDecimalForApi = slippageBps / 10000;

      logger.debug("AggregateDexRouter quote - Calling swapMultiDexPath:", {
        tokenIn: normalizedTokenIn,
        tokenOut: normalizedTokenOut,
        amountIn,
        slippage: slippageDecimalForApi,
        sender,
        recipient,
      });

      const response = await this.swapMultiDexPathAdapter.swapMultiDexPath({
        amountIn: String(amountIn),
        tokenIn: normalizedTokenIn,
        tokenOut: normalizedTokenOut,
        slippage: slippageDecimalForApi,
        pathDeep: 2,
        user: sender,
        receiveUser: recipient,
      });

      logger.debug("AggregateDexRouter quote - swapMultiDexPath response:", {
        result_code: response?.result_code,
        result_message: response?.result_message,
        hasData: !!response?.result_data,
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
          error:
            response.result_message ||
            "V2 Router API call failed",
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
      logger.error("AggregateDexRouter quote - Error:", error);
      return {
        success: false,
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn,
        amountOut: "0",
        minAmountOut: "0",
        routes: [],
        error: error?.message || "Quote failed",
      };
    }
  }

  /**
   * Finalize quote with depositAddress (deprecated)
   * 
   * @deprecated No longer needed. executeSwap automatically fetches final quote using receiveUser (depositAddress).
   * Kept for interface compatibility only.
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

  /**
   * Execute swap with V2 Router
   * Automatically fetches final quote using receiveUser (depositAddress) to ensure correct routerMsg and signature.
   */
  async executeSwap(params: ExecuteParams): Promise<ExecuteResult> {
    try {
      if (!requiresRecipientInExecute(params)) {
        return {
          success: false,
          error: "V2 Router requires sender and receiveUser parameters",
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
          error: "receiveUser (depositAddress) is required",
        };
      }

      if (receiveUser.startsWith("0x") && receiveUser.length === 42) {
        return {
          success: false,
          error: `receiveUser appears to be an EVM address (${receiveUser}). For NEAR chain swaps, depositAddress must be a NEAR account (64 hex chars or .near format)`,
        };
      }

      logger.debug("AggregateDexRouter - executeSwap params:", {
        sender,
        receiveUser,
        tokenIn: quote.tokenIn.address,
        tokenOut: quote.tokenOut.address,
        amountIn: quote.amountIn,
        tokens: quote.tokens,
        dexs: quote.dexs,
      });

      // Always fetch fresh quote with receiveUser (depositAddress) to ensure correct routerMsg and signature
      const slippage = quote.slippage || 0.005;
      
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
        finalQuote = await this.quote(finalQuoteParams);
        
        if (!finalQuote.success) {
          return {
            success: false,
            error: `Failed to fetch quote with receiveUser="${receiveUser}": ${finalQuote.error}`,
          };
        }
      } catch (error: any) {
        logger.error("AggregateDexRouter - Failed to fetch quote with receiveUser:", error);
        return {
          success: false,
          error: `Failed to fetch quote with receiveUser="${receiveUser}": ${error?.message || "Unknown error"}`,
        };
      }

      const routerMsg = finalQuote.routerMsg;
      const signature = finalQuote.signature;

      if (!routerMsg || !signature) {
        return {
          success: false,
          error: `Quote fetched with receiveUser="${receiveUser}" is missing routerMsg or signature.`,
        };
      }

      logger.debug("AggregateDexRouter - Successfully fetched final quote:", {
        receiveUser,
        quoteRecipient: finalQuote.recipient,
        routerMsgLength: routerMsg.length,
        signatureLength: signature.length,
      });

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

      // 1. Convert NEAR to wNEAR if tokenIn is NEAR
      const isNativeNear =
        finalQuote.tokenIn.symbol === "NEAR" ||
        finalQuote.tokenIn.address === "near" ||
        (!finalQuote.tokenIn.address && finalQuote.tokenIn.symbol === "NEAR");

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
      // Required: receiveUser must be registered in tokenOut contract for the aggregate contract to send tokens
      if (receiveUser && receiveUser !== sender) {
        logger.debug("AggregateDexRouter - Checking receiveUser registration in tokenOut:", {
          receiveUser,
          tokenOut: finalQuote.tokenOut.address,
          tokenOutSymbol: finalQuote.tokenOut.symbol,
        });

        const receiveUserStorageBalance = await getStorageBalance(
          finalQuote.tokenOut.address,
          receiveUser
        ).catch((error) => {
          logger.warn("AggregateDexRouter - Failed to check receiveUser storage balance:", {
            receiveUser,
            tokenOut: finalQuote.tokenOut.address,
            error: error?.message,
          });
          return null;
        });

        if (!receiveUserStorageBalance) {
          logger.debug("AggregateDexRouter - receiveUser not registered in tokenOut, adding registration transaction:", {
            receiveUser,
            tokenOut: finalQuote.tokenOut.address,
            tokenOutSymbol: finalQuote.tokenOut.symbol,
            storageCost: this.NEW_ACCOUNT_STORAGE_COST,
          });

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
          // Each token requires 0.005 NEAR storage fee
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
      const msgString = JSON.stringify({
        msg: routerMsg,
        signature: signature,
      });

      transactions.push({
        contractId: finalQuote.tokenIn.address,
        methodName: "ft_transfer_call",
        args: {
          receiver_id: this.aggregateDexContractId,
          amount: finalQuote.amountIn,
          msg: msgString,
        },
        gas: "300000000000000",
        expandDeposit: this.ONE_YOCTO_NEAR,
      });

      const totalDeposit = transactions.reduce((sum, tx) => {
        if (tx.expandDeposit) {
          return sum.plus(tx.expandDeposit);
        }
        return sum;
      }, new Big(0));

      logger.debug("AggregateDexRouter - Executing swap (following mature codebase logic):", {
        contractId: finalQuote.tokenIn.address,
        receiver_id: this.aggregateDexContractId,
        amount: finalQuote.amountIn,
        transactionsCount: transactions.length,
        sender,
        receiveUser,
        tokens: tokens.length,
        dexs: dexs.length,
        totalDepositYocto: totalDeposit.toFixed(0),
        totalDepositNEAR: totalDeposit.div(new Big("1000000000000000000000000")).toFixed(6),
        transactions: transactions.map((tx, idx) => ({
          index: idx,
          contractId: tx.contractId,
          methodName: tx.methodName,
          expandDeposit: tx.expandDeposit,
          expandDepositNEAR: tx.expandDeposit
            ? new Big(tx.expandDeposit)
                .div(new Big("1000000000000000000000000"))
                .toFixed(6)
            : "0",
        })),
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
          error: result.message || "Execute swap failed",
        };
      }
    } catch (error: any) {
      logger.error("AggregateDexRouter executeSwap - Error:", error);
      return {
        success: false,
        error: error?.message || "Execute swap failed",
      };
    }
  }


  /**
   * Query user token registration status in AGGREGATE_DEX contract
   */
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
      logger.error(
        "AggregateDexRouter - Failed to query user tokens registered:",
        error
      );
      return tokens.map(() => false);
    }
  }
}
