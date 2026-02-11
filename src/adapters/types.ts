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

/** V2 Router API response. */
export interface SwapMultiDexPathResponse {
  result_code: number;
  result_message?: string;
  result_data: {
    amount_in: string;
    amount_out: string;
    min_amount_out: string;
    msg: string;
    signature: string;
    tokens: string[];
    dexs: string[];
  } | null;
}

/** Adapter for V2 Router API (swapMultiDexPath). */
export interface SwapMultiDexPathAdapter {
  swapMultiDexPath(params: {
    amountIn: string;
    tokenIn: string;
    tokenOut: string;
    slippage: number;
    pathDeep?: number;
    chainId?: number;
    routerCount?: number;
    user: string;
    receiveUser: string;
    skipUnwrapNativeToken?: boolean;
  }): Promise<SwapMultiDexPathResponse>;
}

/** Chain-specific configuration provider. */
export interface ConfigAdapter {
  getRefExchangeId(): string;

  getWrapNearContractId(): string;

  getFindPathUrl(): string;

  /** Storage deposit amount (yoctoNEAR) for `storage_deposit` when needed. */
  getTokenStorageDepositRead?(): string;
  
  getAggregateDexContractId?(): string;
  getSmartxUrl?(): string;
}

/** Bitget DEX Aggregator API response. */
export interface BitgetQuoteResponse {
  code?: string; // May not be present, use error_code or status instead
  error_code?: number; // 0 means success
  status?: number; // 0 means success
  msg: string;
  data?: {
    inAmount?: string;
    outAmount?: string;
    toAmount?: string;
    minOutAmount?: string;
    toMinAmount?: string;
    data?: string; // Transaction data (may be present but not final)
    to?: string; // Contract address
    value?: string; // Native token value (for ETH)
    gas?: string;
    gasPrice?: string;
    market?: string; // Optimal channel/market (required for swap API)
    [key: string]: any;
  };
}

/** Bitget Swap API response (calldata). */
export interface BitgetSwapResponse {
  code?: string; // May not be present, use error_code or status instead
  error_code?: number; // 0 means success
  status?: number; // 0 means success
  msg: string;
  data?: {
    // Bitget API returns calldata and contract, not data and to
    calldata?: string; // Final transaction calldata (Bitget API format)
    contract?: string; // Contract address (Bitget API format)
    data?: string; // Alternative field name for calldata
    to?: string; // Alternative field name for contract
    value?: string; // Native token value (for ETH)
    gas?: string;
    gasPrice?: string;
    computeUnits?: number; // Gas in compute units (Bitget API format)
    deadline?: number;
    id?: string;
    market?: string;
    estimateRevert?: boolean;
    toAmount?: string;
    slippage?: string;
    [key: string]: any;
  };
}

/** Adapter for Bitget DEX Aggregator API. */
export interface BitgetAdapter {
  quote(params: {
    chainId: number;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    slippage: number;
    userAddress: string;
    // Optional: token metadata for API request
    tokenInSymbol?: string;
    tokenInDecimals?: number;
    tokenOutSymbol?: string;
    tokenOutDecimals?: number;
  }): Promise<BitgetQuoteResponse>;

  /**
   * Get final calldata for swap execution
   * This should be called during executeSwap with the depositAddress as toAddress
   */
  swap(params: {
    chainId: number;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    minAmountOut?: string;
    slippage: number;
    fromAddress: string;
    toAddress: string; // Recipient address (depositAddress during execution)
    market: string; // Optimal channel from quote response
    tokenInSymbol?: string;
    tokenInDecimals?: number;
    tokenOutSymbol?: string;
    tokenOutDecimals?: number;
  }): Promise<BitgetSwapResponse>;
}

/** EVM Chain adapter for executing transactions. */
export interface EvmChainAdapter {
  /**
   * Send transaction to EVM chain
   * If EIP-1559 parameters (type, maxFeePerGas, maxPriorityFeePerGas) are provided,
   * they will be used directly to avoid parameter inconsistency
   */
  sendTransaction(params: {
    to: string;
    data: string;
    value?: string;
    gasLimit?: string;
    gasPrice?: string;
    // EIP-1559 parameters (optional, but if provided will be used directly)
    type?: number;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
  }): Promise<{
    status: "success" | "failed";
    txHash: string;
    message?: string;
  }>;

  /**
   * Check ERC20 token allowance
   * @returns Current allowance amount as string
   */
  getAllowance(params: {
    tokenAddress: string;
    owner: string;
    spender: string;
  }): Promise<string>;

  /**
   * Execute ERC20 token approval
   * @returns Transaction hash
   */
  approve(params: {
    tokenAddress: string;
    spender: string;
    amount: string; // Use MaxUint256 for unlimited approval
  }): Promise<{
    txHash: string;
  }>;

  /**
   * Get native token or ERC20 token balance (optional, for UI display)
   * @param tokenAddress If undefined, get native token balance
   * @returns Balance as string (formatted)
   */
  getBalance?(params: {
    address: string;
    tokenAddress?: string;
  }): Promise<string>;
  
  /**
   * Get signer for gas estimation (optional)
   * @returns Ethers signer instance
   */
  getSigner?(): Promise<any>;
}
