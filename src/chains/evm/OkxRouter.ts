import { ethers } from "ethers";
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
import { convertSlippageToBasisPoints } from "../../utils";
import {
  OkxAdapter,
  EvmChainAdapter,
} from "../../adapters/types";
import { logger } from "../../utils/logger";
import {
  createQuoteError,
  createExecuteError,
  getGasPriceEstimate,
  estimateGasLimit,
  getEip1559FeeData,
  isEip1559Chain,
  MAX_APPROVAL_RETRIES,
  APPROVAL_RETRY_DELAY_MS,
} from "../../utils/bitgetUtils";
import { ErrorMessages, normalizeError } from "../../utils/errorMessages";

export interface OkxRouterConfig {
  okxAdapter: OkxAdapter;
  evmChainAdapter: EvmChainAdapter;
  chainId: number; // EVM chain ID (e.g., 1 for Ethereum, 56 for BSC)
}

/**
 * OKX Router implementation for EVM chains
 */
export class OkxRouter implements DexRouter {
  private okxAdapter: OkxAdapter;
  private evmChainAdapter: EvmChainAdapter;
  private chainId: number;

  constructor(config: OkxRouterConfig) {
    this.okxAdapter = config.okxAdapter;
    this.evmChainAdapter = config.evmChainAdapter;
    this.chainId = config.chainId;
  }

  getCapabilities(): RouterCapabilities {
    return {
      requiresRecipient: true,
      requiresFinalizeQuote: false,
      requiresComplexRegistration: false,
      supportedChain: "evm",
    };
  }

  getSupportedChain(): "evm" {
    return "evm";
  }

  getChainId(): number {
    return this.chainId;
  }

  async quote(params: QuoteParams): Promise<QuoteResult> {
    try {
      if (!requiresRecipient(params)) {
        return createQuoteError(params, "OKX quote failed: Router requires recipient address");
      }

      const { tokenIn, tokenOut, amountIn, slippage, sender, recipient } = params;

      if (!sender || !recipient) {
        return createQuoteError(params, "OKX quote failed: Sender and recipient addresses are required");
      }

      if (tokenIn?.address === undefined || tokenOut?.address === undefined) {
        return createQuoteError(params, "OKX quote failed: Token addresses are required");
      }

      const normalizedTokenIn = tokenIn.address === "" 
        ? "" 
        : this.normalizeEvmAddress(tokenIn.address);
      const normalizedTokenOut = tokenOut.address === ""
        ? ""
        : this.normalizeEvmAddress(tokenOut.address);

      const slippageBps = convertSlippageToBasisPoints(slippage);
      const slippageDecimal = slippageBps / 10000;

      const response = await this.okxAdapter.quote({
        chainId: this.chainId,
        tokenIn: normalizedTokenIn,
        tokenOut: normalizedTokenOut,
        amountIn: String(amountIn),
        slippage: slippageDecimal,
        userAddress: sender,
        tokenInSymbol: tokenIn.symbol,
        tokenInDecimals: tokenIn.decimals,
        tokenOutSymbol: tokenOut.symbol,
        tokenOutDecimals: tokenOut.decimals,
      });

      const is429Error =
        response.code === "429" ||
        response.code === 429 ||
        (response.msg && response.msg.toLowerCase().includes("rate limit"));

      if (is429Error) {
        return {
          success: false,
          tokenIn: params.tokenIn,
          tokenOut: params.tokenOut,
          amountIn: params.amountIn,
          amountOut: "0",
          minAmountOut: "0",
          routes: [],
          error: "Rate limit exceeded",
        };
      }
      
      if (
        response.code !== "0" &&
        response.code !== 0 &&
        response.code !== undefined
      ) {
        const errorCode = response.code;
        const errorMsg = response.msg || "Unknown error";

        logger.error("OKX quote API error", {
          code: errorCode,
          msg: errorMsg,
          tokenIn: params.tokenIn.symbol,
          tokenOut: params.tokenOut.symbol,
          amountIn: params.amountIn,
          fullResponse: response,
        });

        return createQuoteError(params, `OKX API error (${errorCode}): ${errorMsg}`);
      }

      if (!response.data || response.data.length === 0) {
        logger.error("OKX quote empty data", {
          code: response.code,
          msg: response.msg,
          hasData: !!response.data,
          dataLength: response.data?.length || 0,
          tokenIn: params.tokenIn.symbol,
          tokenOut: params.tokenOut.symbol,
          fullResponse: response,
        });

        return createQuoteError(
          params,
          response.msg || "OKX API returned empty data"
        );
      }

      const quoteData = response.data[0];
      
      const fromTokenAmount = quoteData.fromTokenAmount || quoteData.fromAmount;
      const toTokenAmount = quoteData.toTokenAmount || quoteData.toAmount;
      const estimateGasFee = quoteData.estimateGasFee || quoteData.estimatedGas;
      
      let minToAmount: string;
      
      if (toTokenAmount) {
        const toAmountBN = ethers.BigNumber.from(toTokenAmount);
        const slippageAmount = toAmountBN.mul(Math.floor(slippageDecimal * 10000)).div(10000);
        minToAmount = toAmountBN.sub(slippageAmount).toString();
      } else {
        minToAmount = "0";
      }

      const formattedAmountOut = toTokenAmount
        ? ethers.BigNumber.from(toTokenAmount).toString()
        : "0";
      const formattedMinAmountOut = minToAmount || formattedAmountOut;

      return {
        success: true,
        tokenIn,
        tokenOut,
        amountIn: fromTokenAmount || String(amountIn),
        amountOut: formattedAmountOut,
        minAmountOut: formattedMinAmountOut,
        routes: [],
        gasEstimate: estimateGasFee,
        routerMsg: JSON.stringify({
          chainId: this.chainId,
          adapter: "okx",
        }),
        recipient,
        slippage,
      };
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      const isRateLimit = errorMessage?.includes("429") ||
                         errorMessage?.toLowerCase().includes("rate limit") ||
                         errorMessage?.toLowerCase().includes("too many requests");

      logger.error("OKX quote exception", {
        error: errorMessage,
        isRateLimit,
        tokenIn: params.tokenIn.symbol,
        tokenOut: params.tokenOut.symbol,
        amountIn: params.amountIn,
        errorStack: error?.stack,
        fullError: error,
      });

      const detailedError = isRateLimit
        ? `OKX API rate limit error: ${errorMessage}. Please try again later.`
        : `OKX quote failed: ${errorMessage}`;

      return createQuoteError(params, detailedError);
    }
  }

  async executeSwap(params: ExecuteParams): Promise<ExecuteResult> {
    try {
      if (!requiresRecipientInExecute(params)) {
        return createExecuteError("OKX swap failed: Router requires recipient address");
      }

      const { quote, sender, receiveUser } = params;

      if (!quote.success) {
        return createExecuteError(
          quote.error || "OKX swap failed: Invalid quote"
        );
      }

      if (!receiveUser || receiveUser.trim() === "") {
        return createExecuteError("OKX swap failed: Recipient address is required");
      }

      const normalizedTokenIn = this.normalizeEvmAddress(quote.tokenIn.address);
      const normalizedTokenOut = this.normalizeEvmAddress(
        quote.tokenOut.address
      );

      const slippageBps = convertSlippageToBasisPoints(quote.slippage || 0.005);
      const executionSlippage = slippageBps / 10000;

      const reQuoteResponse = await this.okxAdapter.quote({
        chainId: this.chainId,
        tokenIn: normalizedTokenIn,
        tokenOut: normalizedTokenOut,
        amountIn: quote.amountIn,
        slippage: executionSlippage,
        userAddress: receiveUser,
        tokenInSymbol: quote.tokenIn.symbol,
        tokenInDecimals: quote.tokenIn.decimals,
        tokenOutSymbol: quote.tokenOut.symbol,
        tokenOutDecimals: quote.tokenOut.decimals,
      });

      if (
        reQuoteResponse.code !== "0" &&
        reQuoteResponse.code !== 0 &&
        reQuoteResponse.code !== undefined
      ) {
        const errorMsg = reQuoteResponse.msg || `OKX re-quote failed: Error code ${reQuoteResponse.code}`;
        return createExecuteError(errorMsg);
      }

      if (!reQuoteResponse.data || reQuoteResponse.data.length === 0) {
        const errorMsg = reQuoteResponse.msg || "OKX re-quote failed: No data returned";
        return createExecuteError(errorMsg);
      }

      const reQuoteData = reQuoteResponse.data[0];
      const toTokenAmount = reQuoteData.toTokenAmount || reQuoteData.toAmount;
      const okxEstimateGasFee = reQuoteData.estimateGasFee || reQuoteData.estimatedGas;
      
      const isCrossChain = receiveUser.toLowerCase() !== sender.toLowerCase();
      
      let minAmountOut: string;
      
      if (reQuoteData.minToAmount && reQuoteData.minToAmount !== "0") {
        minAmountOut = reQuoteData.minToAmount;
        
        if (isCrossChain) {
          logger.info("OKX swap: Using API minToAmount for cross-chain swap", {
            minToAmount: minAmountOut,
            toTokenAmount,
          });
        }
      } else if (toTokenAmount) {
        const toAmountBN = ethers.BigNumber.from(toTokenAmount);
        
        const effectiveSlippage = isCrossChain 
          ? executionSlippage + 0.02
          : executionSlippage;
        
        const slippageBps = ethers.BigNumber.from(Math.floor(effectiveSlippage * 10000));
        const slippageAmount = toAmountBN.mul(slippageBps).div(10000);
        minAmountOut = toAmountBN.sub(slippageAmount).toString();
        
        if (isCrossChain) {
          logger.info("OKX swap: Calculated minAmountOut for cross-chain swap", {
            toTokenAmount,
            executionSlippage,
            effectiveSlippage,
            slippageBps: slippageBps.toString(),
            slippageAmount: slippageAmount.toString(),
            minAmountOut,
          });
        }
      } else {
        minAmountOut = "0";
      }

      logger.info("OKX swap: calling swap API", {
        chainId: this.chainId,
        tokenIn: normalizedTokenIn,
        tokenOut: normalizedTokenOut,
        amountIn: quote.amountIn,
        minAmountOut,
        fromAddress: sender,
        toAddress: receiveUser,
        receiveUser,
        tokenInSymbol: quote.tokenIn.symbol,
        tokenInDecimals: quote.tokenIn.decimals,
        tokenOutSymbol: quote.tokenOut.symbol,
        tokenOutDecimals: quote.tokenOut.decimals,
      });

      const swapResponse = await this.okxAdapter.swap({
        chainId: this.chainId,
        tokenIn: normalizedTokenIn,
        tokenOut: normalizedTokenOut,
        amountIn: quote.amountIn,
        minAmountOut,
        slippage: executionSlippage,
        fromAddress: sender,
        toAddress: receiveUser,
        tokenInSymbol: quote.tokenIn.symbol,
        tokenInDecimals: quote.tokenIn.decimals,
        tokenOutSymbol: quote.tokenOut.symbol,
        tokenOutDecimals: quote.tokenOut.decimals,
      });

      if (
        swapResponse.code !== "0" &&
        swapResponse.code !== 0 &&
        swapResponse.code !== undefined
      ) {
        return createExecuteError(
          swapResponse.msg || `OKX swap failed: Error code ${swapResponse.code}`
        );
      }

      if (!swapResponse.data) {
        return createExecuteError(
          swapResponse.msg || "OKX swap failed: No transaction data"
        );
      }

      let txData: any = null;
      if (Array.isArray(swapResponse.data) && swapResponse.data.length > 0) {
        const firstItem = swapResponse.data[0] as any;
        txData = firstItem?.tx || firstItem;
      } else if (swapResponse.data && !Array.isArray(swapResponse.data)) {
        const data = swapResponse.data as any;
        if (data.tx) {
          txData = data.tx;
        } else if (data.transaction) {
          txData = data.transaction;
        } else {
          txData = data;
        }
      }

      if (!txData) {
        logger.error("OKX swap response: no txData found", {
          swapResponse: swapResponse,
        });
        return createExecuteError(
          swapResponse.msg || "OKX swap failed: No transaction data in response"
        );
      }

      const dataObj = Array.isArray(swapResponse.data) 
        ? (swapResponse.data[0] as any) 
        : (swapResponse.data as any);
      if (dataObj?.estimateRevert === true || txData?.estimateRevert === true) {
        logger.error("OKX swap: estimateRevert is true, transaction would fail", {
          swapResponse: swapResponse,
          txData,
        });
        return createExecuteError(
          swapResponse.msg || "OKX swap failed: Transaction would revert (slippage or price impact too high)"
        );
      }

      let transactionData = txData.data || "";
      const to = txData.to || "";
      let value = txData.value || "0";

      if (transactionData && !transactionData.startsWith("0x")) {
        transactionData = "0x" + transactionData;
      }

      const isNativeTokenIn =
        !normalizedTokenIn ||
        normalizedTokenIn === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
      if (isNativeTokenIn) {
        value = quote.amountIn;
      }

      const gas =
        txData.gas ||
        txData.gasPrice ||
        okxEstimateGasFee ||
        undefined;

      if (!to || !transactionData) {
        logger.error("OKX swap response: missing to or transactionData", {
          to,
          hasTransactionData: !!transactionData,
          txData,
        });
        return createExecuteError(
          swapResponse.msg || "OKX swap failed: Missing transaction data or recipient address"
        );
      }

      if (
        transactionData.length < 10 ||
        !/^0x[0-9a-fA-F]+$/.test(transactionData)
      ) {
        logger.error("OKX swap: invalid transaction data format", {
          transactionDataLength: transactionData.length,
          transactionDataPrefix: transactionData.substring(0, 20),
        });
        return createExecuteError(
          swapResponse.msg || "OKX swap failed: Invalid transaction data format"
        );
      }

      logger.info("OKX swap: starting balance and allowance checks");

      let dexContractAddress: string | undefined;

      if (normalizedTokenIn && normalizedTokenIn !== "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE") {
        logger.info("OKX swap: checking ERC20 token balance and allowance", {
          tokenIn: normalizedTokenIn,
          sender,
          to,
        });
        if (!this.evmChainAdapter.getBalance) {
          return createExecuteError("OKX swap failed: Balance check not supported");
        }
        const tokenBalanceFormatted = await this.evmChainAdapter.getBalance({
          address: sender,
          tokenAddress: normalizedTokenIn,
        });

        const tokenDecimals = quote.tokenIn.decimals || 18;
        const balanceBN = ethers.utils.parseUnits(
          tokenBalanceFormatted || "0",
          tokenDecimals
        );
        const amountInBN = ethers.BigNumber.from(quote.amountIn);

        logger.info("OKX swap: token balance check", {
          balance: balanceBN.toString(),
          amountIn: amountInBN.toString(),
          hasEnoughBalance: balanceBN.gte(amountInBN),
        });

        if (balanceBN.lt(amountInBN)) {
          logger.error("OKX swap: insufficient token balance", {
            balance: balanceBN.toString(),
            amountIn: amountInBN.toString(),
          });
          return createExecuteError("OKX swap failed: Insufficient token balance");
        }

        logger.info("OKX swap: getting approve transaction to find dexContractAddress", {
          tokenIn: normalizedTokenIn,
          amountIn: quote.amountIn,
        });

        const approveResponse = await this.okxAdapter.getApproveTransaction({
          chainId: this.chainId,
          tokenAddress: normalizedTokenIn,
          approveAmount: quote.amountIn,
        });

        if (approveResponse.code !== "0" && approveResponse.code !== 0) {
          logger.error("OKX swap: failed to get approve transaction", {
            code: approveResponse.code,
            msg: approveResponse.msg,
          });
          return createExecuteError(
            approveResponse.msg || "Failed to get OKX approve transaction"
          );
        }

        dexContractAddress = approveResponse.data?.dexContractAddress;
        if (!dexContractAddress) {
          logger.error("OKX swap: no dexContractAddress in approve response");
          return createExecuteError("Failed to get OKX DEX contract address");
        }

        logger.info("OKX swap: checking token allowance", {
          tokenIn: normalizedTokenIn,
          owner: sender,
          spender: dexContractAddress,
        });

        const currentAllowance = await this.evmChainAdapter.getAllowance({
          tokenAddress: normalizedTokenIn,
          owner: sender,
          spender: dexContractAddress,
        });

        const allowanceBN = ethers.BigNumber.from(currentAllowance);
        
        logger.info("OKX swap: token allowance check", {
          allowance: allowanceBN.toString(),
          amountIn: amountInBN.toString(),
          hasEnoughAllowance: allowanceBN.gte(amountInBN),
          dexContractAddress,
          sender,
          tokenIn: normalizedTokenIn,
        });

        if (allowanceBN.lt(amountInBN)) {
          logger.warn("OKX swap: insufficient token allowance, need to approve", {
            allowance: allowanceBN.toString(),
            amountIn: amountInBN.toString(),
            dexContractAddress,
            sender,
            tokenIn: normalizedTokenIn,
          });

          if (!approveResponse.data?.data) {
            logger.error("OKX swap: no approve transaction data");
            return createExecuteError("Failed to get OKX approve transaction data");
          }

          try {
            const [estimatedGasLimit, hasReliableEstimate] = await estimateGasLimit(
              approveResponse.data.gasLimit,
              normalizedTokenIn,
              approveResponse.data.data,
              "0",
              sender,
              this.chainId,
              this.evmChainAdapter
            );

            const approveTxParams: Parameters<EvmChainAdapter["sendTransaction"]>[0] = {
              to: normalizedTokenIn,
              data: approveResponse.data.data,
              value: "0",
              gasLimit: estimatedGasLimit.toString(),
            };

            if (isEip1559Chain(this.chainId)) {
              const feeData = await getEip1559FeeData(this.chainId, this.evmChainAdapter);
              if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
                approveTxParams.type = 2;
                approveTxParams.maxFeePerGas = feeData.maxFeePerGas.toString();
                approveTxParams.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas.toString();
              } else {
                if (approveResponse.data.gasPrice) {
                  approveTxParams.gasPrice = approveResponse.data.gasPrice;
                }
              }
            } else {
              if (approveResponse.data.gasPrice) {
                approveTxParams.gasPrice = approveResponse.data.gasPrice;
              } else {
                const estimatedGasPrice = await getGasPriceEstimate(
                  this.chainId,
                  this.evmChainAdapter
                );
                approveTxParams.gasPrice = estimatedGasPrice.toString();
              }
            }

            logger.info("OKX swap: sending approve transaction", {
              to: normalizedTokenIn,
              tokenIn: normalizedTokenIn,
              dexContractAddress,
              hasData: !!approveResponse.data.data,
              gasLimit: estimatedGasLimit.toString(),
              okxGasLimit: approveResponse.data.gasLimit,
              hasReliableEstimate,
            });

            const approveResult = await this.evmChainAdapter.sendTransaction(approveTxParams);

            if (approveResult.status !== "success") {
              logger.error("OKX swap: approve transaction failed", {
                status: approveResult.status,
                message: approveResult.message,
              });
              return createExecuteError(
                approveResult.message || "Approve transaction failed"
              );
            }

            logger.info("OKX swap: approve transaction successful", {
              txHash: approveResult.txHash,
            });

            let retryCount = 0;

            while (retryCount < MAX_APPROVAL_RETRIES) {
              await new Promise((resolve) =>
                setTimeout(resolve, APPROVAL_RETRY_DELAY_MS * (retryCount + 1))
              );

              const newAllowance = await this.evmChainAdapter.getAllowance({
                tokenAddress: normalizedTokenIn,
                owner: sender,
                spender: dexContractAddress,
              });

              const newAllowanceBN = ethers.BigNumber.from(newAllowance);

              logger.info("OKX swap: checking approval status", {
                retryCount,
                allowance: newAllowanceBN.toString(),
                amountIn: amountInBN.toString(),
                hasEnoughAllowance: newAllowanceBN.gte(amountInBN),
              });

              if (newAllowanceBN.gte(amountInBN)) {
                logger.info("OKX swap: approval confirmed");
                break;
              }

              retryCount++;
            }

            const finalAllowance = await this.evmChainAdapter.getAllowance({
              tokenAddress: normalizedTokenIn,
              owner: sender,
              spender: dexContractAddress,
            });

            const finalAllowanceBN = ethers.BigNumber.from(finalAllowance);

            if (finalAllowanceBN.lt(amountInBN)) {
              logger.error("OKX swap: approval still insufficient after retries", {
                allowance: finalAllowanceBN.toString(),
                amountIn: amountInBN.toString(),
              });
              return createExecuteError("Token approval failed or insufficient");
            }
          } catch (error: any) {
            logger.error("OKX swap: approve transaction error", {
              error: error?.message,
            });
            return createExecuteError(
              normalizeError(error?.message) || "Approve transaction failed"
            );
          }
        }
      } else {
        if (!this.evmChainAdapter.getBalance) {
          return createExecuteError("OKX swap failed: Balance check not supported");
        }
        const nativeBalanceFormatted = await this.evmChainAdapter.getBalance({
          address: sender,
          tokenAddress: undefined,
        });
        const balanceBN = ethers.utils.parseEther(nativeBalanceFormatted || "0");
        const amountInBN = ethers.BigNumber.from(quote.amountIn);

        const gasPriceEstimate = await getGasPriceEstimate(
          this.chainId,
          this.evmChainAdapter
        );

        const [estimatedGasLimitForBalance] = await estimateGasLimit(
          gas,
          to,
          transactionData,
          value,
          sender,
          this.chainId,
          this.evmChainAdapter
        );

        const gasCostEstimate = estimatedGasLimitForBalance.mul(gasPriceEstimate);
        const totalRequired = amountInBN.add(gasCostEstimate);

        if (balanceBN.lt(totalRequired)) {
          return createExecuteError("OKX swap failed: Insufficient balance (including gas fee)");
        }
      }

      if (normalizedTokenIn && normalizedTokenIn !== "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" && dexContractAddress) {
        const finalAllowanceCheck = await this.evmChainAdapter.getAllowance({
          tokenAddress: normalizedTokenIn,
          owner: sender,
          spender: dexContractAddress,
        });
        const finalAllowanceBN = ethers.BigNumber.from(finalAllowanceCheck);
        const amountInBN = ethers.BigNumber.from(quote.amountIn);
        
        if (finalAllowanceBN.lt(amountInBN)) {
          logger.error("OKX swap: final allowance check failed", {
            allowance: finalAllowanceBN.toString(),
            amountIn: amountInBN.toString(),
            dexContractAddress,
          });
          return createExecuteError("OKX swap failed: Insufficient token allowance");
        }
      }

      const [rpcEstimatedGasLimit, hasReliableRpcEstimate, rpcEstimateError] =
        await estimateGasLimit(
          undefined,
          to,
          transactionData,
          value,
          sender,
          this.chainId,
          this.evmChainAdapter
        );

      let finalGasLimit: ethers.BigNumber;

      const MAX_REASONABLE_GAS_LIMIT = ethers.BigNumber.from("500000");
      const okxGasBN = gas ? ethers.BigNumber.from(gas) : null;
      const okxEstimateGasFeeBN = okxEstimateGasFee 
        ? ethers.BigNumber.from(okxEstimateGasFee) 
        : null;

      if (rpcEstimateError) {
        const isUnpredictableGasLimit =
          rpcEstimateError.code === "UNPREDICTABLE_GAS_LIMIT" ||
          (rpcEstimateError.message &&
            rpcEstimateError.message.includes("UNPREDICTABLE_GAS_LIMIT")) ||
          (rpcEstimateError.reason &&
            rpcEstimateError.reason.includes("execution reverted"));

        if (isUnpredictableGasLimit) {
          logger.warn("Blocking transaction due to RPC gas estimation failure", {
            chainId: this.chainId,
            tokenIn: quote.tokenIn.symbol,
            tokenOut: quote.tokenOut.symbol,
            rpcError: rpcEstimateError,
          });
          const errorMsg = rpcEstimateError?.message || rpcEstimateError?.reason || "";
          return createExecuteError(
            errorMsg || "OKX swap failed: Transaction would revert (slippage or price impact too high)"
          );
        }

        if (okxEstimateGasFeeBN && okxEstimateGasFeeBN.gt(0)) {
          finalGasLimit = okxEstimateGasFeeBN.gt(MAX_REASONABLE_GAS_LIMIT)
            ? MAX_REASONABLE_GAS_LIMIT
            : okxEstimateGasFeeBN;
          logger.warn("RPC gas estimation failed, using OKX estimateGasFee (capped)", {
            chainId: this.chainId,
            tokenIn: quote.tokenIn.symbol,
            tokenOut: quote.tokenOut.symbol,
            okxEstimateGasFee: okxEstimateGasFeeBN.toString(),
            finalGasLimit: finalGasLimit.toString(),
            rpcError: rpcEstimateError,
          });
        } else if (okxGasBN && okxGasBN.gt(0)) {
          finalGasLimit = okxGasBN.gt(MAX_REASONABLE_GAS_LIMIT)
            ? MAX_REASONABLE_GAS_LIMIT
            : okxGasBN;
          logger.warn("RPC gas estimation failed, using OKX gas from swap (capped)", {
            chainId: this.chainId,
            tokenIn: quote.tokenIn.symbol,
            tokenOut: quote.tokenOut.symbol,
            okxGas: okxGasBN.toString(),
            finalGasLimit: finalGasLimit.toString(),
            rpcError: rpcEstimateError,
          });
        } else {
          return createExecuteError("OKX swap failed: Unable to determine gas limit");
        }
      } else if (hasReliableRpcEstimate && rpcEstimatedGasLimit.gt(0)) {
        finalGasLimit = rpcEstimatedGasLimit;
        
        if (okxGasBN && okxGasBN.gt(rpcEstimatedGasLimit.mul(2))) {
          logger.warn("OKX gas estimate is much higher than RPC estimate, using RPC estimate", {
            chainId: this.chainId,
            tokenIn: quote.tokenIn.symbol,
            tokenOut: quote.tokenOut.symbol,
            rpcEstimate: rpcEstimatedGasLimit.toString(),
            okxGas: okxGasBN.toString(),
            finalGasLimit: finalGasLimit.toString(),
          });
        } else {
          logger.info("Using RPC gas estimate for swap transaction", {
            chainId: this.chainId,
            tokenIn: quote.tokenIn.symbol,
            tokenOut: quote.tokenOut.symbol,
            rpcEstimate: rpcEstimatedGasLimit.toString(),
            okxGas: okxGasBN?.toString() || "not provided",
            finalGasLimit: finalGasLimit.toString(),
          });
        }
      } else {
        if (okxEstimateGasFeeBN && okxEstimateGasFeeBN.gt(0)) {
          finalGasLimit = okxEstimateGasFeeBN.gt(MAX_REASONABLE_GAS_LIMIT)
            ? MAX_REASONABLE_GAS_LIMIT
            : okxEstimateGasFeeBN;
        } else if (okxGasBN && okxGasBN.gt(0)) {
          finalGasLimit = okxGasBN.gt(MAX_REASONABLE_GAS_LIMIT)
            ? MAX_REASONABLE_GAS_LIMIT
            : okxGasBN;
        } else if (rpcEstimatedGasLimit.gt(0)) {
          finalGasLimit = rpcEstimatedGasLimit;
        } else {
          return createExecuteError("OKX swap failed: Unable to determine gas limit");
        }
        
        logger.warn("Gas estimation unreliable, using fallback (capped)", {
          chainId: this.chainId,
          tokenIn: quote.tokenIn.symbol,
          tokenOut: quote.tokenOut.symbol,
          finalGasLimit: finalGasLimit.toString(),
          okxGas: okxGasBN?.toString() || "not provided",
          okxEstimateGasFee: okxEstimateGasFeeBN?.toString() || "not provided",
        });
      }

      const supportsEip1559 = isEip1559Chain(this.chainId);

      let gasPriceEstimate: ethers.BigNumber | undefined;
      const getCachedGasPrice = async () => {
        if (!gasPriceEstimate) {
          gasPriceEstimate = await getGasPriceEstimate(
            this.chainId,
            this.evmChainAdapter
          );
        }
        return gasPriceEstimate;
      };

      let feeData: { maxFeePerGas?: ethers.BigNumber; maxPriorityFeePerGas?: ethers.BigNumber; gasPrice?: ethers.BigNumber } = {};
      
      if (supportsEip1559) {
        feeData = await getEip1559FeeData(this.chainId, this.evmChainAdapter);
        
        // Validate and ensure we have valid fee data
        if (!feeData.maxFeePerGas || !feeData.maxPriorityFeePerGas || 
            feeData.maxFeePerGas.lte(0) || feeData.maxPriorityFeePerGas.lte(0)) {
          const cachedGasPrice = await getCachedGasPrice();
          if (!cachedGasPrice || cachedGasPrice.lte(0)) {
            return createExecuteError("OKX swap failed: Unable to get valid gas price");
          }
          feeData.maxFeePerGas = cachedGasPrice;
          feeData.maxPriorityFeePerGas = cachedGasPrice.div(10);
          const minPriorityFee = ethers.utils.parseUnits("1", "gwei");
          if (feeData.maxPriorityFeePerGas.lt(minPriorityFee)) {
            feeData.maxPriorityFeePerGas = minPriorityFee;
          }
        }
      } else {
        try {
          const signer = await this.evmChainAdapter.getSigner?.();
          if (signer?.provider) {
            const providerFeeData = await signer.provider.getFeeData();
            if (providerFeeData.gasPrice && providerFeeData.gasPrice.gt(0)) {
              feeData.gasPrice = providerFeeData.gasPrice;
            } else {
              const cachedGasPrice = await getCachedGasPrice();
              if (!cachedGasPrice || cachedGasPrice.lte(0)) {
                return createExecuteError("Failed to get valid gas price. Please try again.");
              }
              feeData.gasPrice = cachedGasPrice;
            }
          } else {
            const cachedGasPrice = await getCachedGasPrice();
            if (!cachedGasPrice || cachedGasPrice.lte(0)) {
              return createExecuteError("Failed to get valid gas price. Please try again.");
            }
            feeData.gasPrice = cachedGasPrice;
          }
        } catch (error) {
          const cachedGasPrice = await getCachedGasPrice();
          if (!cachedGasPrice || cachedGasPrice.lte(0)) {
            return createExecuteError("OKX swap failed: Unable to get valid gas price");
          }
          feeData.gasPrice = cachedGasPrice;
        }
      }

      // Final validation before building transaction
      if (!to || !ethers.utils.isAddress(to)) {
        return createExecuteError("OKX swap failed: Invalid recipient address");
      }

      if (!transactionData || transactionData.length < 10) {
        return createExecuteError("OKX swap failed: Invalid transaction data");
      }

      // Validate gas limit
      if (!finalGasLimit || finalGasLimit.lte(0)) {
        return createExecuteError("OKX swap failed: Invalid gas limit");
      }

      // Validate fee data based on chain type
      if (supportsEip1559) {
        if (!feeData.maxFeePerGas || !feeData.maxPriorityFeePerGas ||
            feeData.maxFeePerGas.lte(0) || feeData.maxPriorityFeePerGas.lte(0)) {
          return createExecuteError("OKX swap failed: Invalid gas fee data (EIP-1559)");
        }
      } else {
        if (!feeData.gasPrice || feeData.gasPrice.lte(0)) {
          return createExecuteError("OKX swap failed: Invalid gas price");
        }
      }

      const txParams: Parameters<EvmChainAdapter["sendTransaction"]>[0] = {
        to,
        data: transactionData,
        value: value || "0",
        gasLimit: finalGasLimit.toString(),
      };

      if (supportsEip1559 && feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        txParams.type = 2;
        txParams.maxFeePerGas = feeData.maxFeePerGas.toString();
        txParams.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas.toString();
      } else if (feeData.gasPrice) {
        txParams.gasPrice = feeData.gasPrice.toString();
      }

      logger.info("OKX sending transaction to wallet", {
        to,
        hasData: !!transactionData,
        dataLength: transactionData?.length,
        value,
        gasLimit: finalGasLimit.toString(),
        supportsEip1559,
        feeData: supportsEip1559
          ? {
              maxFeePerGas: feeData.maxFeePerGas?.toString(),
              maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString(),
            }
          : { gasPrice: feeData.gasPrice?.toString() },
      });

      const result = await this.evmChainAdapter.sendTransaction(txParams);

      logger.info("OKX transaction result", {
        status: result.status,
        txHash: result.txHash,
        message: result.message,
      });

      if (result.status === "success") {
        return {
          success: true,
          txHash: result.txHash,
          txHashArray: result.txHash ? [result.txHash] : [],
        };
      } else {
        logger.error("OKX transaction failed", {
          status: result.status,
          txHash: result.txHash,
          message: result.message,
        });
        return createExecuteError(
          normalizeError(result.message) || ErrorMessages.EXECUTE_FAILED
        );
      }
    } catch (error: any) {
      logger.error("OKX execute swap error:", error);
      return createExecuteError(
        normalizeError(error?.message) || ErrorMessages.EXECUTE_FAILED
      );
    }
  }

  private normalizeEvmAddress(address: string): string {
    if (!address) return address;
    try {
      return ethers.utils.getAddress(address);
    } catch (e) {
      const addr = address.startsWith("0x") ? address.slice(2) : address;
      return "0x" + addr.toLowerCase();
    }
  }
}
