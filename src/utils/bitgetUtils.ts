import { ethers } from "ethers";
import type {
  BitgetQuoteResponse,
  BitgetSwapResponse,
  EvmChainAdapter,
} from "../adapters/types";
import type { QuoteParams, QuoteResult, ExecuteResult } from "../types";

export const EIP1559_CHAINS = [8453, 1, 42161, 10, 137] as const;
export type Eip1559ChainId = typeof EIP1559_CHAINS[number];
export const BASE_CHAIN_ID = 8453;

export function isEip1559Chain(chainId: number): chainId is Eip1559ChainId {
  return (EIP1559_CHAINS as readonly number[]).includes(chainId);
}

export const DEFAULT_GAS_LIMIT = "800000";
export const CONSERVATIVE_GAS_LIMIT = "1000000";
export const APPROVAL_RETRY_DELAY_MS = 1000;
export const MAX_APPROVAL_RETRIES = 5;

export const BASE_MAX_FEE_PER_GAS = "0.1";
export const BASE_MAX_PRIORITY_FEE_PER_GAS = "0.01";
export const BASE_MAX_FEE_CAP = "1";
export const BASE_PRIORITY_FEE_CAP = "0.1";
export const DEFAULT_MAX_FEE_PER_GAS = "20";
export const ETH_MAX_FEE_PER_GAS = "50";
export const POLYGON_MAX_FEE_PER_GAS = "200";
export const DEFAULT_MAX_FEE_PER_GAS_OTHER = "100";
export const MAX_PRIORITY_FEE_CAP = "2";

export const BASE_GAS_BUFFER = 105;
export const DEFAULT_GAS_BUFFER = 110;

export function isBitgetResponseSuccess(
  response: BitgetQuoteResponse | BitgetSwapResponse
): boolean {
  return (
    response.code === "00000" ||
    response.error_code === 0 ||
    response.status === 0
  );
}

export function createQuoteError(
  params: QuoteParams,
  error: string
): QuoteResult {
  return {
    success: false,
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    amountIn: params.amountIn,
    amountOut: "0",
    minAmountOut: "0",
    routes: [],
    error,
  };
}

export function createExecuteError(error: string): ExecuteResult {
  return {
    success: false,
    error,
  };
}

export function getGasBuffer(chainId: number): number {
  return chainId === BASE_CHAIN_ID ? BASE_GAS_BUFFER : DEFAULT_GAS_BUFFER;
}

export function getMaxFeePerGas(chainId: number): string {
  if (chainId === 1) return ETH_MAX_FEE_PER_GAS;
  if (chainId === 137) return POLYGON_MAX_FEE_PER_GAS;
  return DEFAULT_MAX_FEE_PER_GAS_OTHER;
}

export async function getGasPriceEstimate(
  chainId: number,
  evmChainAdapter: EvmChainAdapter
): Promise<ethers.BigNumber> {
  const isBase = chainId === BASE_CHAIN_ID;

  try {
    const signer = await evmChainAdapter.getSigner?.();
    if (signer?.provider) {
      const feeData = await signer.provider.getFeeData();
      if (isBase) {
        const baseMaxFeePerGas = ethers.utils.parseUnits(
          BASE_MAX_FEE_PER_GAS,
          "gwei"
        );
        return feeData.maxFeePerGas &&
          feeData.maxFeePerGas.lte(ethers.utils.parseUnits(BASE_MAX_FEE_CAP, "gwei"))
          ? feeData.maxFeePerGas
          : baseMaxFeePerGas;
      } else {
        return (
          feeData.maxFeePerGas ||
          feeData.gasPrice ||
          ethers.utils.parseUnits(DEFAULT_MAX_FEE_PER_GAS, "gwei")
        );
      }
    }
  } catch (error) {
  }

  return ethers.utils.parseUnits(
    isBase ? BASE_MAX_FEE_PER_GAS : DEFAULT_MAX_FEE_PER_GAS,
    "gwei"
  );
}

// Returns [gasLimit, hasReliableEstimate, rpcEstimateError]
// rpcEstimateError: null if no error, or error object if RPC estimation failed
export async function estimateGasLimit(
  gas: string | undefined,
  to: string,
  transactionData: string,
  value: string,
  sender: string,
  chainId: number,
  evmChainAdapter: EvmChainAdapter
): Promise<[ethers.BigNumber, boolean, { code?: string; reason?: string; message?: string } | null]> {
  const bufferPercent = getGasBuffer(chainId);
  let estimatedGasLimit: ethers.BigNumber | undefined;
  let hasReliableEstimate = false;
  let rpcEstimateError: { code?: string; reason?: string; message?: string } | null = null;

  if (gas) {
    try {
      const gasBN = ethers.BigNumber.from(gas);
      if (gasBN.gt(0)) {
        estimatedGasLimit = gasBN.mul(bufferPercent).div(100);
        hasReliableEstimate = true;
      }
    } catch (error) {
    }
  }

  try {
    const signer = await evmChainAdapter.getSigner?.();
    if (signer?.provider) {
      try {
        const rpcEstimatedGas = await signer.provider.estimateGas({
          to,
          data: transactionData,
          value: value || "0",
          from: sender,
        });

        if (rpcEstimatedGas && rpcEstimatedGas.gt(0)) {
          const rpcGasWithBuffer = rpcEstimatedGas.mul(bufferPercent).div(100);

          if (!estimatedGasLimit || rpcGasWithBuffer.gt(estimatedGasLimit)) {
            estimatedGasLimit = rpcGasWithBuffer;
          }
          hasReliableEstimate = true;
        }
      } catch (estimateError: any) {
        // Capture RPC estimation error details
        rpcEstimateError = {
          code: estimateError?.code,
          reason: estimateError?.reason,
          message: estimateError?.message || String(estimateError),
        };
        console.warn("RPC gas estimate failed:", {
          error: estimateError?.message || String(estimateError),
          code: estimateError?.code,
          reason: estimateError?.reason,
        });
      }
    }
  } catch (error: any) {
    console.warn("Gas estimation error:", {
      error: error?.message || String(error),
    });
  }

  if (estimatedGasLimit && estimatedGasLimit.gt(0) && hasReliableEstimate) {
    return [estimatedGasLimit, true, rpcEstimateError];
  }

  if (estimatedGasLimit && estimatedGasLimit.gt(0)) {
    return [estimatedGasLimit, false, rpcEstimateError];
  }

  return [ethers.BigNumber.from(CONSERVATIVE_GAS_LIMIT), false, rpcEstimateError];
}

export async function getEip1559FeeData(
  chainId: number,
  evmChainAdapter: EvmChainAdapter
): Promise<{
  maxFeePerGas?: ethers.BigNumber;
  maxPriorityFeePerGas?: ethers.BigNumber;
  gasPrice?: ethers.BigNumber;
}> {
  const feeData: {
    maxFeePerGas?: ethers.BigNumber;
    maxPriorityFeePerGas?: ethers.BigNumber;
    gasPrice?: ethers.BigNumber;
  } = {};

  try {
    const signer = await evmChainAdapter.getSigner?.();
    if (signer?.provider) {
      const providerFeeData = await signer.provider.getFeeData();

      if (chainId === BASE_CHAIN_ID) {
        const baseMaxFeePerGas = ethers.utils.parseUnits(BASE_MAX_FEE_PER_GAS, "gwei");
        const baseMaxPriorityFeePerGas = ethers.utils.parseUnits(
          BASE_MAX_PRIORITY_FEE_PER_GAS,
          "gwei"
        );

        feeData.maxFeePerGas =
          providerFeeData.maxFeePerGas &&
          providerFeeData.maxFeePerGas.gt(0) &&
          providerFeeData.maxFeePerGas.lte(ethers.utils.parseUnits(BASE_MAX_FEE_CAP, "gwei"))
            ? providerFeeData.maxFeePerGas
            : baseMaxFeePerGas;

        feeData.maxPriorityFeePerGas =
          providerFeeData.maxPriorityFeePerGas &&
          providerFeeData.maxPriorityFeePerGas.gt(0) &&
          providerFeeData.maxPriorityFeePerGas.lte(
            ethers.utils.parseUnits(BASE_PRIORITY_FEE_CAP, "gwei")
          )
            ? providerFeeData.maxPriorityFeePerGas
            : baseMaxPriorityFeePerGas;
      } else {
        if (
          providerFeeData.maxFeePerGas &&
          providerFeeData.maxPriorityFeePerGas &&
          providerFeeData.maxFeePerGas.gt(0) &&
          providerFeeData.maxPriorityFeePerGas.gt(0)
        ) {
          const maxAllowedFeePerGas = ethers.utils.parseUnits(
            getMaxFeePerGas(chainId),
            "gwei"
          );

          feeData.maxFeePerGas = providerFeeData.maxFeePerGas.gt(maxAllowedFeePerGas)
            ? maxAllowedFeePerGas
            : providerFeeData.maxFeePerGas;

          if (feeData.maxFeePerGas) {
            const maxPriorityFeeCap = feeData.maxFeePerGas
              .div(10)
              .gt(ethers.utils.parseUnits(MAX_PRIORITY_FEE_CAP, "gwei"))
              ? ethers.utils.parseUnits(MAX_PRIORITY_FEE_CAP, "gwei")
              : feeData.maxFeePerGas.div(10);

            feeData.maxPriorityFeePerGas =
              providerFeeData.maxPriorityFeePerGas.gt(maxPriorityFeeCap)
                ? maxPriorityFeeCap
                : providerFeeData.maxPriorityFeePerGas;
          }
        }
      }
    }
  } catch (error) {
  }

  if (!feeData.maxFeePerGas || feeData.maxFeePerGas.lte(0)) {
    feeData.maxFeePerGas = ethers.utils.parseUnits(
      chainId === BASE_CHAIN_ID ? BASE_MAX_FEE_PER_GAS : DEFAULT_MAX_FEE_PER_GAS,
      "gwei"
    );
  }

  if (!feeData.maxPriorityFeePerGas || feeData.maxPriorityFeePerGas.lte(0)) {
    feeData.maxPriorityFeePerGas = feeData.maxFeePerGas.div(10);
  }

  return feeData;
}
