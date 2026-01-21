/** NEAR DEX router implementation (FindPath for routing + REF for execution). */

import Big from "big.js";
import {
  QuoteParams,
  QuoteResult,
  ExecuteParams,
  ExecuteResult,
  Route,
  DexRouter,
} from "../../types";
import {
  normalizeTokenId,
  convertSlippageToBasisPoints,
} from "../../utils";
import { logger } from "../../utils/logger";
import {
  FindPathAdapter,
  NearChainAdapter,
  ConfigAdapter,
  SwapMultiDexPathAdapter,
} from "../../adapters/types";

export interface NearSmartRouterConfig {
  findPathAdapter: FindPathAdapter;
  /** Optional: SmartX quote adapter. When provided, quote() will compare results and return the best. */
  swapMultiDexPathAdapter?: SwapMultiDexPathAdapter;
  nearChainAdapter: NearChainAdapter;
  configAdapter: ConfigAdapter;
}

export class NearSmartRouter implements DexRouter {
  private findPathAdapter: FindPathAdapter;
  private swapMultiDexPathAdapter?: SwapMultiDexPathAdapter;
  private nearChainAdapter: NearChainAdapter;
  private configAdapter: ConfigAdapter;
  private wrapNearContractId: string;
  private refExchangeId: string;
  private tokenStorageDepositRead: string;
  private aggregateDexContractId?: string;

  constructor(config: NearSmartRouterConfig) {
    this.findPathAdapter = config.findPathAdapter;
    this.swapMultiDexPathAdapter = config.swapMultiDexPathAdapter;
    this.nearChainAdapter = config.nearChainAdapter;
    this.configAdapter = config.configAdapter;
    this.wrapNearContractId = this.configAdapter.getWrapNearContractId();
    this.refExchangeId = this.configAdapter.getRefExchangeId();
    this.tokenStorageDepositRead =
      this.configAdapter.getTokenStorageDepositRead?.() || "1250000000000000000000";
    this.aggregateDexContractId =
      this.configAdapter.getAggregateDexContractId?.() || undefined;
  }

  /**
   * Get a swap quote (normalizes token ids and queries FindPath for routes).
   */
  async quote(params: QuoteParams): Promise<QuoteResult> {
    try {
      const {
        tokenIn,
        tokenOut,
        amountIn,
        slippage,
        swapType: _swapType = "EXACT_INPUT", // Currently not used, reserved for future use
        recipient,
      } = params;

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
        logger.error("SmartRouter quote - Invalid token addresses:", {
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

      // SmartX 依赖 user/receiveUser，确保存在
      if (this.swapMultiDexPathAdapter && !recipient) {
        return {
          success: false,
          tokenIn,
          tokenOut,
          amountIn,
          amountOut: "0",
          minAmountOut: "0",
          routes: [],
          error: "recipient is required when SmartX adapter is enabled",
        };
      }

      logger.debug("SmartRouter quote - Calling quote backends:", {
        tokenIn: normalizedTokenIn,
        tokenOut: normalizedTokenOut,
        amountIn,
        slippage: slippageDecimalForApi,
        slippageBps,
        hasSmartX: !!this.swapMultiDexPathAdapter,
      });

      const [findPathResp, smartxResp] = await Promise.all([
        this.findPathAdapter.findPath({
          tokenIn: normalizedTokenIn,
          tokenOut: normalizedTokenOut,
          amountIn: String(amountIn),
          slippage: slippageDecimalForApi,
          // v1 requires pathDeep=3 (handled by adapter implementation)
          supportLedger: false,
        }),
        this.swapMultiDexPathAdapter
          ? this.swapMultiDexPathAdapter.swapMultiDexPath({
              amountIn: String(amountIn),
              tokenIn: normalizedTokenIn,
              tokenOut: normalizedTokenOut,
              slippage: slippageDecimalForApi,
              pathDeep: 2,
              chainId: 0,
              routerCount: 1,
              skipUnwrapNativeToken: false,
              user: recipient || "",
              receiveUser: recipient || "",
            })
          : Promise.resolve(null),
      ]);

      logger.debug("SmartRouter quote - findPath response:", {
        result_code: findPathResp?.result_code,
        result_msg: findPathResp?.result_msg || findPathResp?.result_message,
        hasRoutes: !!findPathResp?.result_data?.routes?.length,
      });
      if (smartxResp) {
        logger.debug("SmartRouter quote - SmartX response:", {
          result_code: smartxResp?.result_code,
          result_msg: smartxResp?.result_message,
          hasData: !!smartxResp?.result_data,
        });
      }

      if (
        findPathResp?.result_code !== 0 ||
        !findPathResp?.result_data?.routes?.length
      ) {
        // If v1 fails but SmartX succeeds, still return SmartX quote (quote-only; executeSwap is not supported yet).
        const smartxData =
          smartxResp?.result_code === 0 ? smartxResp?.result_data : null;
        if (smartxData?.amount_out) {
          const smartxAmt = new Big(smartxData.amount_out || 0);
          const smartxMin = new Big(smartxData.min_amount_out || 0);
          if (smartxAmt.lte(0) || smartxMin.lt(0)) {
            // treat as failure
            return {
              success: false,
              tokenIn,
              tokenOut,
              amountIn,
              amountOut: "0",
              minAmountOut: "0",
              routes: [],
              error:
                findPathResp?.result_msg ||
                findPathResp?.result_message ||
                "No route found",
            };
          }
          return {
            success: true,
            tokenIn,
            tokenOut,
            amountIn,
            amountOut: String(smartxData.amount_out),
            minAmountOut: String(smartxData.min_amount_out || "0"),
            routes: [],
            quoteSource: "smartx",
            smartxResult: {
              amountIn: String(smartxData.amount_in || amountIn),
              amountOut: String(smartxData.amount_out),
              minAmountOut: String(smartxData.min_amount_out || "0"),
              dexs: smartxData.dexs,
              msg: smartxData.msg,
              signature: smartxData.signature,
              tokens: smartxData.tokens,
            },
          };
        }

        return {
          success: false,
          tokenIn,
          tokenOut,
          amountIn,
          amountOut: "0",
          minAmountOut: "0",
          routes: [],
          error:
            findPathResp?.result_msg ||
            findPathResp?.result_message ||
            "No route found",
        };
      }

      const { routes: serverRoutes, amount_out } = findPathResp.result_data;
      const slippageDecimal = new Big(slippageBps).div(10000);

      const routes: Route[] = serverRoutes.map((route: any) => ({
        pools: route.pools.map((pool: any) => ({
          pool_id: Number(pool.pool_id),
          token_in: pool.token_in || normalizedTokenIn,
          token_out: pool.token_out || normalizedTokenOut,
          amount_in: pool.amount_in,
          amount_out: pool.amount_out,
          fee: pool.fee,
        })),
        amountIn: amountIn,
        amountOut: route.amount_out || amount_out || "0",
      }));

      const amountOut = new Big(amount_out || 0);
      const minAmountOut = amountOut
        .mul(new Big(1).minus(slippageDecimal))
        .toFixed(0, Big.roundDown);

      const findPathQuote: QuoteResult = {
        success: true,
        tokenIn,
        tokenOut,
        amountIn,
        amountOut: amountOut.toFixed(0),
        minAmountOut,
        routes,
        // Save raw serverRoutes data for executeSwap
        rawRoutes: serverRoutes,
        quoteSource: "findPath",
      };

      // Compare with SmartX (if available) and return best amountOut. If SmartX wins, return quote-only result.
      const smartxData =
        smartxResp?.result_code === 0 ? smartxResp?.result_data : null;
      if (smartxData?.amount_out) {
        const smartxAmountOut = new Big(smartxData.amount_out || 0);
        const smartxMin = new Big(smartxData.min_amount_out || 0);
        if (smartxAmountOut.gt(0) && smartxMin.gte(0) && smartxAmountOut.gt(amountOut)) {
          return {
            success: true,
            tokenIn,
            tokenOut,
            amountIn,
            amountOut: String(smartxData.amount_out),
            minAmountOut: String(smartxData.min_amount_out || "0"),
            routes: [],
            quoteSource: "smartx",
            smartxResult: {
              amountIn: String(smartxData.amount_in || amountIn),
              amountOut: String(smartxData.amount_out),
              minAmountOut: String(smartxData.min_amount_out || "0"),
              dexs: smartxData.dexs,
              msg: smartxData.msg,
              signature: smartxData.signature,
              tokens: smartxData.tokens,
            },
          };
        }
      }

      return findPathQuote;
    } catch (error: any) {
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
   * Execute a swap: optionally adds `storage_deposit` for the recipient, then calls REF via `ft_transfer_call`.
   */
  async executeSwap(params: ExecuteParams): Promise<ExecuteResult> {
    try {
      const { quote, recipient, depositAddress } = params;

      if (quote.quoteSource === "smartx") {
        const smartx = quote.smartxResult;
        const aggDexId = this.aggregateDexContractId;
        if (!smartx || !aggDexId) {
          return {
            success: false,
            error:
              "SmartX quote missing execution context (smartxResult or aggregateDexContractId).",
          };
        }

        if (!quote.tokenIn?.address) {
          return { success: false, error: "tokenIn address is required" };
        }

        const transactions: any[] = [];
        const finalRecipient = depositAddress || recipient;

        if (!finalRecipient) {
          return { success: false, error: "recipient is required for SmartX execution" };
        }

        // Collect tokens to check storage: SmartX tokens + tokenIn + tokenOut (if present)
        // SmartX tokens may include intermediate tokens used in the swap path
        const tokensToCheck = Array.from(
          new Set(
            [
              ...(smartx.tokens || []),
              quote.tokenIn.address || "",
              quote.tokenOut?.address || "",
            ].filter(Boolean)
          )
        );

        if (tokensToCheck.length === 0) {
          return {
            success: false,
            error: "SmartX tokens list is empty, cannot proceed with execution",
          };
        }

        const targets = [finalRecipient, aggDexId];

        // storage_deposit for each (token, target) if not registered
        // Check all tokens for both recipient and aggregate contract
        for (const token of tokensToCheck) {
          for (const target of targets) {
            if (!token || !target) continue;
            let isRegistered = false;
            try {
              const storageBalance = await this.nearChainAdapter.view({
                contractId: token,
                methodName: "storage_balance_of",
                args: {
                  account_id: target,
                },
              });
              isRegistered = !!storageBalance;
            } catch (err) {
              // View call failure typically means not registered
              logger.debug(
                `Storage check failed for ${token} -> ${target}, assuming not registered:`,
                err
              );
              isRegistered = false;
            }

            if (!isRegistered) {
              transactions.push({
                contractId: token,
                methodName: "storage_deposit",
                args: {
                  account_id: target,
                  registration_only: true,
                },
                gas: "50",
                expandDeposit: this.tokenStorageDepositRead,
              });
            }
          }
        }

        const routerMsg = smartx.msg;
        const signature = smartx.signature;
        if (!routerMsg || !signature) {
          return {
            success: false,
            error: "SmartX smartxResult missing msg or signature.",
          };
        }

        // Build ft_transfer_call to aggregate dex contract
        const swapMsg = {
          msg: routerMsg,
          signature: signature,
        };

        transactions.push({
          contractId: quote.tokenIn.address,
          methodName: "ft_transfer_call",
          args: {
            receiver_id: aggDexId,
            amount: quote.amountIn,
            msg: JSON.stringify(swapMsg),
          },
          gas: "300000000000000", // ~300 Tgas as参考
          expandDeposit: "1", // 1 yoctoNEAR
        });

        const result = await this.nearChainAdapter.call({ transactions });
        if (result.status === "success") {
          return {
            success: true,
            txHash: result.txHash,
            txHashArray: result.txHashArr || (result.txHash ? [result.txHash] : []),
          };
        }
        return { success: false, error: result.message || "Execute swap failed" };
      }

      if (!quote.success || !quote.routes.length) {
        return {
          success: false,
          error: "Invalid quote",
        };
      }

      const swapActions: any[] = [];

      const routesToUse = quote.rawRoutes || quote.routes;

      routesToUse.forEach((route: any) => {
        const pools = route.pools || [];
        pools.forEach((pool: any) => {
          const poolCopy = { ...pool };

          if (+(poolCopy?.amount_in || 0) == 0) {
            delete poolCopy.amount_in;
          }

          poolCopy.pool_id = Number(poolCopy.pool_id);

          swapActions.push(poolCopy);
        });
      });

      if (!swapActions.length) {
        return {
          success: false,
          error: "No swap actions",
        };
      }

      const finalRecipient = depositAddress || recipient;

      const transactions: any[] = [];

      if (finalRecipient && quote.tokenOut?.address) {
        let isRegistered = false;
        try {
          const storageBalance = await this.nearChainAdapter.view({
            contractId: quote.tokenOut.address,
            methodName: "storage_balance_of",
            args: {
              account_id: finalRecipient,
            },
          });
          isRegistered = !!storageBalance;
        } catch (err) {
          isRegistered = false;
        }

        if (!isRegistered) {
          logger.debug("SmartRouter - Registering recipient account:", {
            contractId: quote.tokenOut.address,
            accountId: finalRecipient,
          });

          transactions.push({
            contractId: quote.tokenOut.address,
            methodName: "storage_deposit",
            args: {
              account_id: finalRecipient,
              registration_only: true,
            },
            gas: "50",
            expandDeposit: this.tokenStorageDepositRead,
          });
        }
      }

      const swapMsg: any = {
        force: 0,
        actions: swapActions,
        skip_unwrap_near: false,
      };

      if (finalRecipient) {
        swapMsg.swap_out_recipient = finalRecipient;
      }

      logger.debug("SmartRouter - Executing swap:", {
        contractId: quote.tokenIn.address,
        receiver_id: this.refExchangeId,
        amount: quote.amountIn,
        swapMsg,
        swapActionsCount: swapActions.length,
        recipient: finalRecipient,
        tokenOut: quote.tokenOut?.address,
      });

      transactions.push({
        contractId: quote.tokenIn.address,
        methodName: "ft_transfer_call",
        args: {
          receiver_id: this.refExchangeId,
          amount: quote.amountIn,
          msg: JSON.stringify(swapMsg),
        },
        gas: "250",
        // NEP-141 requires attaching 1 yoctoNEAR for certain calls.
        expandDeposit: "1",
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
      return {
        success: false,
        error: error?.message || "Execute swap failed",
      };
    }
  }

  /**
   * Get supported chain
   */
  getSupportedChain(): "near" {
    return "near";
  }
}
