/** FindPath API response. */
export interface FindPathResponse {
  result_code: number;
  result_msg?: string;
  result_message?: string;
  result_data: {
    routes: any[];
    amount_out: string;
  } | null;
}

/** Adapter for querying DEX routes (FindPath). */
export interface FindPathAdapter {
  findPath(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    slippage: number;
    supportLedger?: boolean;
  }): Promise<FindPathResponse>;
}

/** NearIntents quote result. */
export interface IntentsQuoteResult {
  quoteStatus: "success" | "error";
  message?: string;
  quoteSuccessResult?: {
    quote: {
      amountOut: string;
      depositAddress: string;
      [key: string]: any;
    };
    [key: string]: any;
  };
  [key: string]: any;
}

/** Adapter for fetching NearIntents quotes. */
export interface IntentsQuotationAdapter {
  quote(params: {
    originAsset: string;
    destinationAsset: string;
    amount: string;
    refundTo: string;
    recipient: string;
    slippageTolerance: number;
    swapType?: "EXACT_INPUT" | "EXACT_OUTPUT" | "FLEX_INPUT";
    [key: string]: any;
  }): Promise<IntentsQuoteResult>;
}

/** Adapter for interacting with NEAR (call/view). */
export interface NearChainAdapter {
  call(params: {
    transactions: Array<{
      contractId: string;
      methodName: string;
      args: any;
      gas?: string;
      expandDeposit?: string;
    }>;
  }): Promise<{
    status: "success" | "error";
    txHash?: string;
    txHashArr?: string[];
    message?: string;
  }>;

  view(params: {
    contractId: string;
    methodName: string;
    args?: any;
  }): Promise<any>;
}

/** Chain-specific configuration provider. */
export interface ConfigAdapter {
  getRefExchangeId(): string;

  getWrapNearContractId(): string;

  getFindPathUrl(): string;

  /** Storage deposit amount (yoctoNEAR) for `storage_deposit` when needed. */
  getTokenStorageDepositRead?(): string;
}
