import Big from "big.js";
import {
  QuoteParams,
  QuoteResult,
  ExecuteParams,
  ExecuteResult,
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
  IntentsQuotationAdapter,
} from "../../adapters/types";

export interface NearSmartRouterConfig {
  findPathAdapter: FindPathAdapter;
  swapMultiDexPathAdapter?: SwapMultiDexPathAdapter;
  nearChainAdapter: NearChainAdapter;
  configAdapter: ConfigAdapter;
  intentsQuotationAdapter?: IntentsQuotationAdapter;
}

export class NearSmartRouter implements DexRouter {
  private findPathAdapter: FindPathAdapter;
  private swapMultiDexPathAdapter?: SwapMultiDexPathAdapter;
  private nearChainAdapter: NearChainAdapter;
  private configAdapter: ConfigAdapter;
  private intentsQuotationAdapter?: IntentsQuotationAdapter;
  private wrapNearContractId: string;
  private refExchangeId: string;
  private tokenStorageDepositRead: string;
  private aggregateDexContractId?: string;

  constructor(config: NearSmartRouterConfig) {
    this.findPathAdapter = config.findPathAdapter;
    this.swapMultiDexPathAdapter = config.swapMultiDexPathAdapter;
    this.nearChainAdapter = config.nearChainAdapter;
    this.configAdapter = config.configAdapter;
    this.intentsQuotationAdapter = config.intentsQuotationAdapter;
    this.wrapNearContractId = this.configAdapter.getWrapNearContractId();
    this.refExchangeId = this.configAdapter.getRefExchangeId();
    this.tokenStorageDepositRead =
      this.configAdapter.getTokenStorageDepositRead?.() || "1250000000000000000000";
    this.aggregateDexContractId =
      this.configAdapter.getAggregateDexContractId?.() || undefined;
  }

  /**
   * 核心报价逻辑：并行比价 -> 获取 Intent 地址 -> SmartX 二次修正
   */
  async quote(params: QuoteParams): Promise<QuoteResult> {
    try {
      const { tokenIn, tokenOut, amountIn, slippage, recipient, refundTo } = params;

      if (!tokenIn?.address || !tokenOut?.address) {
        throw new Error("Missing token address");
      }

      const normalizedTokenIn = normalizeTokenId(tokenIn.address, this.wrapNearContractId);
      const normalizedTokenOut = normalizeTokenId(tokenOut.address, this.wrapNearContractId);
      const currentUser = refundTo || "";
      const slippageBps = convertSlippageToBasisPoints(slippage);
      const slippageDecimal = slippageBps / 10000;

      // --- 1. 并行调用初步比价 (SmartX 第一次调用：receiveUser = currentUser) ---
      const [findPathResp, smartxInitialResp] = await Promise.all([
        this.findPathAdapter.findPath({
          tokenIn: normalizedTokenIn,
          tokenOut: normalizedTokenOut,
          amountIn: String(amountIn),
          slippage: slippageDecimal,
          supportLedger: false,
        }),
        this.swapMultiDexPathAdapter
          ? this.swapMultiDexPathAdapter.swapMultiDexPath({
              amountIn: String(amountIn),
              tokenIn: normalizedTokenIn,
              tokenOut: normalizedTokenOut,
              slippage: slippageDecimal,
              pathDeep: 2,
              chainId: 0,
              routerCount: 1,
              skipUnwrapNativeToken: false,
              user: currentUser,
              receiveUser: currentUser,
            })
          : Promise.resolve(null),
      ]);

      const findPathAmount = new Big(findPathResp?.result_data?.amount_out || 0);
      const smartxAmount = new Big(smartxInitialResp?.result_data?.amount_out || 0);

      let bestSource: "findPath" | "smartx" = "findPath";
      let bestAmountOut = findPathAmount;

      if (smartxAmount.gt(findPathAmount)) {
        bestSource = "smartx";
        bestAmountOut = smartxAmount;
      }

      if (bestAmountOut.eq(0)) {
        return { success: false, tokenIn, tokenOut, amountIn, amountOut: "0", minAmountOut: "0", routes: [], error: "No route found" };
      }

      // --- 2. 拿着当前最佳报价去请求 Intents 获取 depositAddress ---
      // Allow depositAddress to be provided via params, or fetch from intents
      let depositAddress = params.depositAddress || "";
      if (!depositAddress && this.intentsQuotationAdapter) {
        const originAsset = normalizedTokenIn.startsWith("nep141:") ? normalizedTokenIn : `nep141:${normalizedTokenIn}`;
        const destinationAsset = normalizedTokenOut.startsWith("nep141:") ? normalizedTokenOut : `nep141:${normalizedTokenOut}`;

        logger.debug("SmartRouter - Calling intents to get depositAddress:", {
          originAsset,
          destinationAsset,
          amount: String(amountIn),
          bestSource,
          currentUser,
        });

        // For intents: refundTo should be NEAR account, recipient should be destination chain address
        const intentsQuote = await this.intentsQuotationAdapter.quote({
          originAsset,
          destinationAsset,
          amount: String(amountIn),
          refundTo: refundTo || "",
          recipient: recipient || "",
          slippageTolerance: slippageBps,
          swapType: "EXACT_INPUT",
        });

        logger.debug("SmartRouter - Intents quote response:", {
          quoteStatus: intentsQuote.quoteStatus,
          message: intentsQuote.message,
          hasDepositAddress: !!intentsQuote.quoteSuccessResult?.quote?.depositAddress,
        });

        if (intentsQuote.quoteStatus === "success") {
          depositAddress = intentsQuote.quoteSuccessResult?.quote?.depositAddress || "";
          logger.debug("SmartRouter - Got depositAddress from intents:", {
            depositAddress,
            hasDepositAddress: !!depositAddress,
          });
        } else {
          logger.warn("SmartRouter - Intents quote failed:", {
            status: intentsQuote.quoteStatus,
            message: intentsQuote.message,
          });
        }
      } else {
        logger.debug("SmartRouter - No intentsQuotationAdapter configured, skipping intents call");
      }

      // --- 3. 如果 SmartX 胜出且有 depositAddress，重新调用以修正签名 ---
      let finalSmartxResult = smartxInitialResp?.result_data;
      
      logger.debug("SmartRouter - Checking conditions for SmartX second call:", {
        bestSource,
        hasDepositAddress: !!depositAddress,
        depositAddress,
        hasSwapMultiDexPathAdapter: !!this.swapMultiDexPathAdapter,
        willCall: bestSource === "smartx" && depositAddress && this.swapMultiDexPathAdapter,
      });

      if (bestSource === "smartx" && depositAddress && this.swapMultiDexPathAdapter) {
        logger.debug("SmartRouter - Re-calling SmartX with depositAddress:", {
          user: currentUser,
          receiveUser: depositAddress,
          tokenIn: normalizedTokenIn,
          tokenOut: normalizedTokenOut,
          amountIn: String(amountIn),
        });

        const smartxSecondResp = await this.swapMultiDexPathAdapter.swapMultiDexPath({
          amountIn: String(amountIn),
          tokenIn: normalizedTokenIn,
          tokenOut: normalizedTokenOut,
          slippage: slippageDecimal,
          pathDeep: 2,
          chainId: 0,
          routerCount: 1,
          skipUnwrapNativeToken: false,
          user: currentUser,
          receiveUser: depositAddress, // 关键：替换为 intent 存款地址
        });

        logger.debug("SmartRouter - SmartX second call response:", {
          result_code: smartxSecondResp?.result_code,
          result_message: smartxSecondResp?.result_message,
          hasData: !!smartxSecondResp?.result_data,
        });

        if (smartxSecondResp?.result_code === 0 && smartxSecondResp?.result_data) {
          finalSmartxResult = smartxSecondResp.result_data;
          bestAmountOut = new Big(finalSmartxResult.amount_out || 0);
          logger.debug("SmartRouter - SmartX second call succeeded, updated amountOut:", {
            newAmountOut: bestAmountOut.toFixed(0),
          });
        } else {
          logger.warn("SmartRouter - SmartX second call failed, using initial result:", {
            result_code: smartxSecondResp?.result_code,
            result_message: smartxSecondResp?.result_message,
          });
        }
      } else {
        logger.debug("SmartRouter - Skipping SmartX second call:", {
          reason: !bestSource ? "bestSource is not smartx" : !depositAddress ? "no depositAddress" : "no swapMultiDexPathAdapter",
          bestSource,
          depositAddress: depositAddress || "empty",
          hasAdapter: !!this.swapMultiDexPathAdapter,
        });
      }

      // --- 4. 封装返回结果 ---
      const commonResult = {
        success: true,
        tokenIn,
        tokenOut,
        amountIn: String(amountIn),
        amountOut: bestAmountOut.toFixed(0),
        depositAddress, // 透传给执行阶段
      };

      if (bestSource === "smartx") {
        if (!finalSmartxResult) {
          return { success: false, tokenIn, tokenOut, amountIn, amountOut: "0", minAmountOut: "0", routes: [], error: "SmartX result data missing" };
        }
        return {
          ...commonResult,
          minAmountOut: String(finalSmartxResult.min_amount_out || "0"),
          routes: [],
          quoteSource: "smartx",
          smartxResult: {
            amountIn: String(finalSmartxResult.amount_in || amountIn),
            amountOut: String(finalSmartxResult.amount_out || "0"),
            minAmountOut: String(finalSmartxResult.min_amount_out || "0"),
            dexs: finalSmartxResult.dexs,
            msg: finalSmartxResult.msg,
            signature: finalSmartxResult.signature,
            tokens: finalSmartxResult.tokens,
          },
        };
      }

      // FindPath 结果处理
      if (!findPathResp?.result_data) {
        return { success: false, tokenIn, tokenOut, amountIn, amountOut: "0", minAmountOut: "0", routes: [], error: "FindPath result data missing" };
      }
      const { routes: serverRoutes, amount_out } = findPathResp.result_data;
      const minAmountOut = new Big(amount_out).mul(new Big(1).minus(slippageDecimal)).toFixed(0, Big.roundDown);

      return {
        ...commonResult,
        minAmountOut,
        routes: serverRoutes.map((r: any) => ({
          pools: r.pools.map((p: any) => ({ ...p, pool_id: Number(p.pool_id) })),
          amountIn,
          amountOut: r.amount_out || amount_out,
        })),
        rawRoutes: serverRoutes,
        quoteSource: "findPath",
      };
    } catch (error: any) {
      logger.error("SmartRouter quote error:", error);
      return { success: false, tokenIn: params.tokenIn, tokenOut: params.tokenOut, amountIn: params.amountIn, amountOut: "0", minAmountOut: "0", routes: [], error: error.message };
    }
  }

  /**
   * 执行逻辑：基于 quote 准备好的数据进行分发
   */
  async executeSwap(params: ExecuteParams): Promise<ExecuteResult> {
    try {
      const { quote, recipient, depositAddress } = params;
      // 优先使用 quote 中的 depositAddress（来自第二次 SmartX 调用），否则使用 params 中的
      const finalRecipient = quote.depositAddress || depositAddress || recipient;

      logger.debug("SmartRouter - executeSwap:", {
        quoteSource: quote.quoteSource,
        quoteDepositAddress: quote.depositAddress,
        paramsDepositAddress: depositAddress,
        recipient,
        finalRecipient,
      });

      if (quote.quoteSource === "smartx") {
        return await this.executeSmartX(quote, finalRecipient);
      } else {
        return await this.executeRef(quote, finalRecipient);
      }
    } catch (error: any) {
      return { success: false, error: error?.message || "Execute failed" };
    }
  }

  private async executeSmartX(quote: QuoteResult, depositAddress: string): Promise<ExecuteResult> {
    const smartx = quote.smartxResult;
    const aggDexId = this.aggregateDexContractId;
    if (!smartx?.msg || !smartx?.signature || !aggDexId) {
      return { success: false, error: "SmartX data missing" };
    }

    const tokens = Array.from(new Set([...(smartx.tokens || []), quote.tokenIn.address]));
    const transactions: any[] = [];

    // 批量检查存储注册 (针对 depositAddress 和聚合合约)
    for (const token of tokens) {
      for (const target of [depositAddress, aggDexId]) {
        const isRegistered = await this.checkRegistration(token, target);
        if (!isRegistered) {
          transactions.push({
            contractId: token,
            methodName: "storage_deposit",
            args: { account_id: target, registration_only: true },
            gas: "50",
            expandDeposit: this.tokenStorageDepositRead,
          });
        }
      }
    }

    transactions.push({
      contractId: quote.tokenIn.address,
      methodName: "ft_transfer_call",
      args: {
        receiver_id: aggDexId,
        amount: quote.amountIn,
        msg: JSON.stringify({ msg: smartx.msg, signature: smartx.signature }),
      },
      gas: "300",
      expandDeposit: "1",
    });

    const result = await this.nearChainAdapter.call({ transactions });
    return this.handleCallResult(result);
  }

  private async executeRef(quote: QuoteResult, depositAddress: string): Promise<ExecuteResult> {
    const transactions: any[] = [];
    const routesToUse = quote.rawRoutes || quote.routes;
    const actions = routesToUse.flatMap((r: any) => 
      r.pools.map((p: any) => ({
        pool_id: Number(p.pool_id),
        token_in: p.token_in,
        token_out: p.token_out,
        amount_in: p.amount_in || undefined,
        amount_out: p.amount_out,
        fee: Number(p.fee)
      }))
    );

    // 注册输出代币
    if (depositAddress && quote.tokenOut?.address) {
      const isRegistered = await this.checkRegistration(quote.tokenOut.address, depositAddress);
      if (!isRegistered) {
        transactions.push({
          contractId: quote.tokenOut.address,
          methodName: "storage_deposit",
          args: { account_id: depositAddress, registration_only: true },
          gas: "50",
          expandDeposit: this.tokenStorageDepositRead,
        });
      }
    }

    transactions.push({
      contractId: quote.tokenIn.address,
      methodName: "ft_transfer_call",
      args: {
        receiver_id: this.refExchangeId,
        amount: quote.amountIn,
        msg: JSON.stringify({ force: 0, actions, swap_out_recipient: depositAddress }),
      },
      gas: "250",
      expandDeposit: "1",
    });

    const result = await this.nearChainAdapter.call({ transactions });
    return this.handleCallResult(result);
  }

  private async checkRegistration(token: string, accountId: string): Promise<boolean> {
    try {
      const balance = await this.nearChainAdapter.view({
        contractId: token,
        methodName: "storage_balance_of",
        args: { account_id: accountId },
      });
      return !!balance;
    } catch {
      return false;
    }
  }

  private handleCallResult(result: any): ExecuteResult {
    if (result.status === "success") {
      return { success: true, txHash: result.txHash, txHashArray: result.txHashArr || [result.txHash] };
    }
    return { success: false, error: result.message || "Transaction failed" };
  }

  getSupportedChain(): "near" { return "near"; }
}