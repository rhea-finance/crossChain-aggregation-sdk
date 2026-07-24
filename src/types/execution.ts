import type {
  SwapBuildDataRaw,
  SwapBuildRequestRaw,
  SwapSigningRequestRaw,
} from "../api/rawTypes";
import type { AssetRef, BaseUnitAmount, ChainRef } from "./chain";

export interface EvmTx {
  to: string;
  data: string;
  value: BaseUnitAmount;
  gasLimit: BaseUnitAmount;
  chainId: number;
}

export interface EvmApproval {
  tx: EvmTx;
  spender: string;
}

export type EvmSigningRequest = SwapSigningRequestRaw;

export interface SolanaMetadata {
  addressLookupTableAddresses?: string[];
  recentBlockhash?: string;
  txValidUntil?: number;
  transactionSize?: number;
}

export interface NearTransaction {
  signerId?: string;
  receiverId: string;
  actions: unknown[];
}

export interface OrderReference {
  orderId: string;
  router: string;
  chainId?: string;
}

export interface DepositInfo {
  depositAddress: string;
  depositMemo?: string;
  orderId?: string;
  estimatedOut?: BaseUnitAmount;
  minAmountOut?: BaseUnitAmount;
  timeEstimate?: number | string;
}

export interface SwapReportContext {
  sender?: string;
  recipient?: string;
  fromHash?: string;
  depositAddress?: string;
  isCrossChain?: boolean;
  txType?: string;
  multiAddr?: string;
  swapId?: string;
}

export type SwapExecution =
  | {
      kind: "evm-transaction";
      chain: ChainRef;
      tx: EvmTx;
      approval?: EvmApproval;
    }
  | {
      kind: "evm-signature";
      chain: ChainRef;
      request: EvmSigningRequest;
      approval?: EvmApproval;
    }
  | {
      kind: "solana-transaction";
      chain: ChainRef;
      transaction: string;
      format: string;
      metadata?: SolanaMetadata;
    }
  | {
      kind: "aptos-entry-function";
      chain: ChainRef;
      function: string;
      typeArguments: string[];
      functionArguments: unknown[];
    }
  | {
      kind: "near-transaction-batch";
      chain: ChainRef;
      transactions: NearTransaction[];
    }
  | {
      kind: "tron-transfer";
      chain: ChainRef;
      amount: BaseUnitAmount;
      depositAddress: string;
      tokenAddress?: string;
      standard?: string;
    }
  | {
      kind: "bitcoin-transfer";
      chain: ChainRef;
      amount: BaseUnitAmount;
      depositAddress: string;
      feeRate?: number;
    }
  | {
      kind: "zcash-transfer";
      chain: ChainRef;
      amount: BaseUnitAmount;
      depositAddress: string;
      decimals?: number;
    }
  | {
      kind: "sui-transfer";
      chain: ChainRef;
      amount: BaseUnitAmount;
      depositAddress: string;
      coinType: string;
    };

export interface SwapBuild {
  executionId: string;
  quoteId?: string;
  isCrossChain: boolean;
  fromChain: ChainRef;
  toChain: ChainRef;
  tokenIn: AssetRef;
  tokenOut: AssetRef;
  amountIn: BaseUnitAmount;
  estimatedOut: BaseUnitAmount;
  minAmountOut: BaseUnitAmount;
  router: string;
  execution: SwapExecution;
  order?: OrderReference;
  deposit?: DepositInfo;
  reportContext?: SwapReportContext;
  request?: SwapBuildRequestRaw;
  raw: SwapBuildDataRaw;
}
