/** NEAR DEX router implementation (FindPath for routing + REF for execution). */

import Big from "big.js";
import {
  QuoteParams,
  QuoteResult,
  ExecuteParams,
  ExecuteResult,
  Route,
  DexRouter,
  RouterCapabilities,
} from "../../types";
import {
  normalizeTokenId,
  convertSlippageToBasisPoints,
} from "../../utils";
import {
  FindPathAdapter,
  NearChainAdapter,
  ConfigAdapter,
} from "../../adapters/types";

export interface NearSmartRouterConfig {
  findPathAdapter: FindPathAdapter;
  nearChainAdapter: NearChainAdapter;
  configAdapter: ConfigAdapter;
}

export class NearSmartRouter implements DexRouter {
  private findPathAdapter: FindPathAdapter;
  private nearChainAdapter: NearChainAdapter;
  private configAdapter: ConfigAdapter;
  private wrapNearContractId: string;
  private refExchangeId: string;
  private tokenStorageDepositRead: string;

  constructor(config: NearSmartRouterConfig) {
    this.findPathAdapter = config.findPathAdapter;
    this.nearChainAdapter = config.nearChainAdapter;
    this.configAdapter = config.configAdapter;
    this.wrapNearContractId = this.configAdapter.getWrapNearContractId();
    this.refExchangeId = this.configAdapter.getRefExchangeId();
    this.tokenStorageDepositRead =
      this.configAdapter.getTokenStorageDepositRead?.() || "1250000000000000000000";
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

      const response = await this.findPathAdapter.findPath({
        tokenIn: normalizedTokenIn,
        tokenOut: normalizedTokenOut,
        amountIn: String(amountIn),
        slippage: slippageDecimalForApi,
        supportLedger: false,
      });

      if (
        response?.result_code !== 0 ||
        !response?.result_data?.routes?.length
      ) {
        return {
          success: false,
          tokenIn,
          tokenOut,
          amountIn,
          amountOut: "0",
          minAmountOut: "0",
          routes: [],
          error: response?.result_msg || response?.result_message || "No route found",
        };
      }

      const { routes: serverRoutes, amount_out } = response.result_data;
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

      return {
        success: true,
        tokenIn,
        tokenOut,
        amountIn,
        amountOut: amountOut.toFixed(0),
        minAmountOut,
        routes,
        // Save raw serverRoutes data for executeSwap
        rawRoutes: serverRoutes,
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
   * Get Router capabilities
   */
  getCapabilities(): RouterCapabilities {
    return {
      requiresRecipient: false,
      requiresFinalizeQuote: false,
      requiresComplexRegistration: false,
      supportedChain: "near",
    };
  }

  /**
   * Get supported chain
   */
  getSupportedChain(): "near" {
    return "near";
  }
}
