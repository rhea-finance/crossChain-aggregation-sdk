/**
 * FindPath API response format
 */
export interface FindPathResponse {
  result_code: number;
  result_msg?: string;
  result_message?: string;
  result_data: {
    routes: any[];
    amount_out: string;
  } | null;
}

/**
 * FindPath API adapter
 * Used to query DEX routes
 */
export interface FindPathAdapter {
  findPath(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    slippage: number;
    supportLedger?: boolean;
  }): Promise<FindPathResponse>;
}

/**
 * NearIntents quote result
 */
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

/**
 * NearIntents quotation adapter
 */
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

/**
 * Near chain interaction adapter
 */
export interface NearChainAdapter {
  /**
   * Call Near contract method
   */
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

  /**
   * View Near contract state
   */
  view(params: {
    contractId: string;
    methodName: string;
    args?: any;
  }): Promise<any>;
}

/**
 * Configuration adapter
 * Provides chain-specific configuration information
 */
export interface ConfigAdapter {
  /**
   * Get REF Exchange contract address
   */
  getRefExchangeId(): string;

  /**
   * Get WRAP NEAR contract address
   */
  getWrapNearContractId(): string;

  /**
   * Get FindPath API URL
   */
  getFindPathUrl(): string;

  /**
   * Get storage deposit constant (for storage_deposit)
   */
  getTokenStorageDepositRead?(): string;
}
