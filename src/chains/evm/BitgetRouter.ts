
import Big from "big.js";
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
  BitgetAdapter,
  EvmChainAdapter,
} from "../../adapters/types";
import { logger } from "../../utils/logger";
import {
  isBitgetResponseSuccess,
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

export interface BitgetRouterConfig {
  bitgetAdapter: BitgetAdapter;
  evmChainAdapter: EvmChainAdapter;
  chainId: number; // EVM chain ID (e.g., 1 for Ethereum, 56 for BSC)
}

/**
 * Bitget Router implementation for EVM chains
 */
export class BitgetRouter implements DexRouter {
  private bitgetAdapter: BitgetAdapter;
  private evmChainAdapter: EvmChainAdapter;
  private chainId: number;

  constructor(config: BitgetRouterConfig) {
    this.bitgetAdapter = config.bitgetAdapter;
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
        return {
          success: false,
          tokenIn: params.tokenIn,
          tokenOut: params.tokenOut,
          amountIn: params.amountIn,
          amountOut: "0",
          minAmountOut: "0",
          routes: [],
          error: "Bitget quote failed: Router requires recipient address",
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
          error: "Bitget quote failed: Sender and recipient addresses are required",
        };
      }

      if (tokenIn?.address === undefined || tokenOut?.address === undefined) {
        return {
          success: false,
          tokenIn: params.tokenIn,
          tokenOut: params.tokenOut,
          amountIn: params.amountIn,
          amountOut: "0",
          minAmountOut: "0",
          routes: [],
          error: "Bitget quote failed: Token addresses are required",
        };
      }

      const normalizedTokenIn = tokenIn.address === "" 
        ? "" 
        : this.normalizeEvmAddress(tokenIn.address);
      const normalizedTokenOut = tokenOut.address === ""
        ? ""
        : this.normalizeEvmAddress(tokenOut.address);

      const slippageBps = convertSlippageToBasisPoints(slippage);
      const slippageDecimalForApi = slippageBps / 10000;

      const response = await this.bitgetAdapter.quote({
        chainId: this.chainId,
        tokenIn: normalizedTokenIn,
        tokenOut: normalizedTokenOut,
        amountIn: String(amountIn),
        slippage: slippageDecimalForApi,
        userAddress: sender,
        tokenInSymbol: tokenIn.symbol,
        tokenInDecimals: tokenIn.decimals,
        tokenOutSymbol: tokenOut.symbol,
        tokenOutDecimals: tokenOut.decimals,
      });

      if (!isBitgetResponseSuccess(response) || !response.data) {
        return createQuoteError(
          params,
          response.msg || "Bitget API error: Failed to get quote"
        );
      }

      const {
        inAmount,
        outAmount,
        toAmount,
        minOutAmount,
        toMinAmount,
        data,
        to,
        value,
        gas,
        market,
      } = response.data;

      const readableOutAmount = outAmount || toAmount || "0";
      const readableMinOutAmount = minOutAmount || toMinAmount || "0";
      
      let formattedOutAmount = readableOutAmount;
      let formattedMinOutAmount = readableMinOutAmount;
      
      if (readableOutAmount !== "0" && tokenOut.decimals !== undefined) {
        try {
          const readableAmount = new Big(readableOutAmount);
          const multiplier = new Big(10).pow(tokenOut.decimals);
          formattedOutAmount = readableAmount.mul(multiplier).toFixed(0);
          
          if (readableMinOutAmount !== "0") {
            const readableMinAmount = new Big(readableMinOutAmount);
            formattedMinOutAmount = readableMinAmount.mul(multiplier).toFixed(0);
          }
        } catch (error: any) {
          formattedOutAmount = readableOutAmount;
          formattedMinOutAmount = readableMinOutAmount;
        }
      }

      let formattedInAmount = inAmount || amountIn;
      if (inAmount && tokenIn.decimals !== undefined && inAmount.includes(".")) {
        try {
          const readableAmount = new Big(inAmount);
          const multiplier = new Big(10).pow(tokenIn.decimals);
          formattedInAmount = readableAmount.mul(multiplier).toFixed(0);
        } catch (error: any) {
          formattedInAmount = inAmount;
        }
      }

      return {
        success: true,
        tokenIn,
        tokenOut,
        amountIn: formattedInAmount,
        amountOut: formattedOutAmount,
        minAmountOut: formattedMinOutAmount,
        routes: [],
        transactionData: data,
        gasEstimate: gas,
        routerMsg: JSON.stringify({
          to,
          data,
          value: value || "0",
          gas,
          market: market || "",
        }),
        recipient,
        slippage,
      };
    } catch (error: any) {
      return createQuoteError(
        params,
        error?.message || "Bitget quote failed: Unknown error"
      );
    }
  }

  async executeSwap(params: ExecuteParams): Promise<ExecuteResult> {
    try {
      if (!requiresRecipientInExecute(params)) {
        return createExecuteError("Bitget swap failed: Router requires recipient address");
      }

      const { quote, sender, receiveUser } = params;

      if (!quote.success) {
        return createExecuteError(
          quote.error || "Bitget swap failed: Invalid quote"
        );
      }

      if (!receiveUser || receiveUser.trim() === "") {
        return createExecuteError("Bitget swap failed: Recipient address is required");
      }

      let market: string;
      try {
        if (quote.routerMsg) {
          const routerMsg = JSON.parse(quote.routerMsg);
          market = routerMsg.market || "";
        } else {
          return createExecuteError("Bitget swap failed: Missing router message data");
        }
      } catch (error) {
        return createExecuteError("Bitget swap failed: Invalid router message format");
      }

      if (!market) {
        return createExecuteError("Bitget swap failed: Market information is required");
      }

      const normalizedTokenIn = this.normalizeEvmAddress(
        quote.tokenIn.address
      );
      const normalizedTokenOut = this.normalizeEvmAddress(
        quote.tokenOut.address
      );

      const slippageBps = convertSlippageToBasisPoints(quote.slippage || 0.5);
      const executionSlippage = slippageBps / 10000;
      
      const reQuoteResponse = await this.bitgetAdapter.quote({
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

      if (!isBitgetResponseSuccess(reQuoteResponse) || !reQuoteResponse.data) {
        const errorMsg = reQuoteResponse.msg || "Bitget re-quote failed: No data returned";
        return createExecuteError(errorMsg);
      }

      market = reQuoteResponse.data?.market || market;

      const swapResponse = await this.bitgetAdapter.swap({
        chainId: this.chainId,
        tokenIn: normalizedTokenIn,
        tokenOut: normalizedTokenOut,
        amountIn: quote.amountIn,
        slippage: executionSlippage,
        fromAddress: sender,
        toAddress: receiveUser,
        market: market,
        tokenInSymbol: quote.tokenIn.symbol,
        tokenInDecimals: quote.tokenIn.decimals,
        tokenOutSymbol: quote.tokenOut.symbol,
        tokenOutDecimals: quote.tokenOut.decimals,
      });

      if (!isBitgetResponseSuccess(swapResponse) || !swapResponse.data) {
        return createExecuteError(
          swapResponse.msg || "Bitget swap failed: No transaction data"
        );
      }

      if (swapResponse.data?.estimateRevert === true) {
        return createExecuteError(
          swapResponse.msg || "Bitget swap failed: Transaction would revert (slippage or price impact too high)"
        );
      }

      let transactionData = swapResponse.data?.calldata || swapResponse.data?.data;
      const to = swapResponse.data?.contract || swapResponse.data?.to;
      let value = swapResponse.data?.value || "0";
      
      if (transactionData && !transactionData.startsWith("0x")) {
        transactionData = "0x" + transactionData;
      }
      
      const isNativeTokenIn = !normalizedTokenIn || normalizedTokenIn === "";
      if (isNativeTokenIn) {
        value = quote.amountIn;
      }
      
      const gas = swapResponse.data?.gas || 
        (swapResponse.data?.computeUnits !== undefined 
          ? String(swapResponse.data.computeUnits) 
          : undefined);

      if (!to || !transactionData) {
        return createExecuteError(
          swapResponse.msg || "Bitget swap failed: Missing transaction data or recipient address"
        );
      }
      
      if (transactionData.length < 10 || !/^0x[0-9a-fA-F]+$/.test(transactionData)) { 
        return createExecuteError(
          swapResponse.msg || "Bitget swap failed: Invalid transaction data format"
        );
      }

      // Check balance and approval for ERC20 tokens
      if (normalizedTokenIn && normalizedTokenIn !== "") {
        if (!this.evmChainAdapter.getBalance) {
          return createExecuteError("Bitget swap failed: Balance check not supported");
        }
        const tokenBalanceFormatted = await this.evmChainAdapter.getBalance({
          address: sender,
          tokenAddress: normalizedTokenIn,
        });
        
        const tokenDecimals = quote.tokenIn.decimals || 18;
        const balanceBN = ethers.utils.parseUnits(tokenBalanceFormatted || "0", tokenDecimals);
        const amountInBN = ethers.BigNumber.from(quote.amountIn);
        
        if (balanceBN.lt(amountInBN)) {
          return createExecuteError("Bitget swap failed: Insufficient token balance");
        }

        const currentAllowance = await this.evmChainAdapter.getAllowance({
          tokenAddress: normalizedTokenIn,
          owner: sender,
          spender: to,
        });

        const allowanceBN = ethers.BigNumber.from(currentAllowance);

        if (allowanceBN.lt(amountInBN)) {
          try {
            await this.evmChainAdapter.approve({
              tokenAddress: normalizedTokenIn,
              spender: to,
              amount: ethers.constants.MaxUint256.toString(),
            });
            
            let retryCount = 0;
            let newAllowanceBN = ethers.BigNumber.from("0");

            while (retryCount < MAX_APPROVAL_RETRIES) {
              await new Promise((resolve) =>
                setTimeout(resolve, APPROVAL_RETRY_DELAY_MS * (retryCount + 1))
              );
              
              const newAllowance = await this.evmChainAdapter.getAllowance({
                tokenAddress: normalizedTokenIn,
                owner: sender,
                spender: to,
              });
              
              newAllowanceBN = ethers.BigNumber.from(newAllowance);
              
              if (newAllowanceBN.gte(amountInBN)) {
                break;
              }
              
              retryCount++;
            }
            
            if (newAllowanceBN.lt(amountInBN)) {
              return createExecuteError("Bitget swap failed: Token approval failed or insufficient");
            }
          } catch (error: any) {
            return createExecuteError(
              error?.message || "Bitget approval check failed"
            );
          }
        }
      } else {
        // Check native token balance (including gas)
        if (!this.evmChainAdapter.getBalance) {
          return createExecuteError("Bitget swap failed: Balance check not supported");
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
          return createExecuteError("Bitget swap failed: Insufficient balance (including gas fee)");
        }
      }

      if (normalizedTokenIn && normalizedTokenIn !== "") {
        const finalAllowanceCheck = await this.evmChainAdapter.getAllowance({
          tokenAddress: normalizedTokenIn,
          owner: sender,
          spender: to,
        });
        const finalAllowanceBN = ethers.BigNumber.from(finalAllowanceCheck);
        const amountInBN = ethers.BigNumber.from(quote.amountIn);
        
        if (finalAllowanceBN.lt(amountInBN)) {
          return createExecuteError("Bitget swap failed: Insufficient token allowance");
        }
      }

      const [estimatedGasLimit, hasReliableEstimate, rpcEstimateError] = await estimateGasLimit(
        gas,
        to,
        transactionData,
        value,
        sender,
        this.chainId,
        this.evmChainAdapter
      );

      if (rpcEstimateError) {
        const isUnpredictableGasLimit = 
          rpcEstimateError.code === "UNPREDICTABLE_GAS_LIMIT" ||
          (rpcEstimateError.message && rpcEstimateError.message.includes("UNPREDICTABLE_GAS_LIMIT")) ||
          (rpcEstimateError.reason && rpcEstimateError.reason.includes("execution reverted"));
        
        if (isUnpredictableGasLimit) {
          logger.warn("Blocking transaction due to RPC gas estimation failure", {
            chainId: this.chainId,
            tokenIn: quote.tokenIn.symbol,
            tokenOut: quote.tokenOut.symbol,
            rpcError: rpcEstimateError,
          });
          const errorMsg = rpcEstimateError?.message || rpcEstimateError?.reason || "";
          return createExecuteError(
            errorMsg || "Bitget swap failed: Transaction would revert (slippage or price impact too high)"
          );
        }

        if (!gas || gas === "0") {
          return createExecuteError("Bitget swap failed: Invalid gas estimate from Bitget");
        }

        logger.warn("RPC gas estimation failed, using Bitget estimate", {
          chainId: this.chainId,
          tokenIn: quote.tokenIn.symbol,
          tokenOut: quote.tokenOut.symbol,
          estimatedGasLimit: estimatedGasLimit.toString(),
          bitgetGas: gas || "not provided",
          rpcError: rpcEstimateError,
        });
      } else if (!hasReliableEstimate) {
        // No RPC error but also no reliable estimate
        logger.warn("Gas estimation unreliable, using conservative default", {
          chainId: this.chainId,
          tokenIn: quote.tokenIn.symbol,
          tokenOut: quote.tokenOut.symbol,
          estimatedGasLimit: estimatedGasLimit.toString(),
          bitgetGas: gas || "not provided",
        });
      }

      const supportsEip1559 = isEip1559Chain(this.chainId);
      
      let gasPriceEstimate: ethers.BigNumber | undefined;
      const getCachedGasPrice = async () => {
        if (!gasPriceEstimate) {
          gasPriceEstimate = await getGasPriceEstimate(this.chainId, this.evmChainAdapter);
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
            return createExecuteError("Bitget swap failed: Unable to get valid gas price");
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
            return createExecuteError("Bitget swap failed: Unable to get valid gas price");
          }
          feeData.gasPrice = cachedGasPrice;
        }
      }

      // Final validation before building transaction
      if (!to || !ethers.utils.isAddress(to)) {
        return createExecuteError("Bitget swap failed: Invalid recipient address");
      }

      if (!transactionData || transactionData.length < 10) {
        return createExecuteError("Bitget swap failed: Invalid transaction data");
      }

      // Validate gas limit
      if (!estimatedGasLimit || estimatedGasLimit.lte(0)) {
        return createExecuteError("Bitget swap failed: Invalid gas limit");
      }

      // Validate fee data based on chain type
      if (supportsEip1559) {
        if (!feeData.maxFeePerGas || !feeData.maxPriorityFeePerGas ||
            feeData.maxFeePerGas.lte(0) || feeData.maxPriorityFeePerGas.lte(0)) {
          return createExecuteError("Bitget swap failed: Invalid gas fee data (EIP-1559)");
        }
      } else {
        if (!feeData.gasPrice || feeData.gasPrice.lte(0)) {
          return createExecuteError("Bitget swap failed: Invalid gas price");
        }
      }

      const txParams: Parameters<EvmChainAdapter["sendTransaction"]>[0] = {
        to,
        data: transactionData,
        value: value || "0",
        gasLimit: estimatedGasLimit.toString(),
      };

      if (supportsEip1559 && feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
        txParams.type = 2;
        txParams.maxFeePerGas = feeData.maxFeePerGas.toString();
        txParams.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas.toString();
      } else if (feeData.gasPrice) {
        txParams.gasPrice = feeData.gasPrice.toString();
      }

      const result = await this.evmChainAdapter.sendTransaction(txParams);

      if (result.status === "success") {
        return {
          success: true,
          txHash: result.txHash,
          txHashArray: result.txHash ? [result.txHash] : [],
        };
      } else {
        return createExecuteError(normalizeError(result.message) || ErrorMessages.EXECUTE_FAILED);
      }
    } catch (error: any) {
      return createExecuteError(normalizeError(error?.message) || ErrorMessages.EXECUTE_FAILED);
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
