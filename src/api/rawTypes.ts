export interface SwapApiResponse<T> {
  code: number;
  msg: string;
  data: T;
}

export interface SwapApiTokenMetaRaw {
  address: string;
  symbol: string;
  decimals: number;
}

export interface SwapQuoteRequestRaw {
  fromChain: string;
  toChain: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippage?: number;
  sender: string;
  recipient?: string;
  useAsCollateral?: boolean;
  mca?: Record<string, unknown>;
}

export interface SwapQuoteDataRaw {
  isCrossChain: boolean;
  chainType: string;
  bestQuote: Record<string, unknown>;
  allQuotes: Record<string, unknown>[];
  errors?: unknown;
  nearDepositTx?: unknown;
  nearDepositTxError?: string;
  nearMcaWithdrawTx?: unknown;
  nearMcaWithdrawTxError?: string;
  nearMcaWithdraw?: Record<string, unknown>;
  mcaContext?: Record<string, unknown>;
  mcaWithdrawToIntents?: unknown;
  [key: string]: unknown;
}

export interface SwapBuildRequestRaw extends SwapQuoteRequestRaw {
  router: string;
  market?: string;
  expectedOut: string;
  minAmountOut: string;
  preSwap: unknown | null;
  bridge: unknown | null;
  nearMcaWithdrawTx?: unknown;
  mcaRelayer?: Record<string, unknown>;
  deposit_address?: string;
  is_cross_chain?: boolean;
  tx_type?: string;
  multi_addr?: string;
  quoteId?: string;
  [key: string]: unknown;
}

export interface SwapSigningRequestRaw {
  type: string;
  router: string;
  quoteId: string;
  chainId: number;
  signingScheme?: string;
  typedData: {
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  };
  submit?: {
    endpoint: string;
    method: string;
    params: Record<string, string>;
  };
}

export interface SwapBuildApproveRaw {
  tx: Record<string, unknown>;
  spender: string;
}

export interface SwapBuildDataRaw {
  isCrossChain: boolean;
  chainType: string;
  router: string;
  fromChain: string;
  toChain: string;
  tokenIn: SwapApiTokenMetaRaw;
  tokenOut: SwapApiTokenMetaRaw;
  amountIn: string;
  estimatedOut: string;
  minAmountOut: string;
  executionType?: "transaction" | "signature";
  signingRequest?: SwapSigningRequestRaw | null;
  needsApprove?: boolean;
  tx: unknown;
  approve: SwapBuildApproveRaw | null;
  orderId?: string;
  statusRouter?: string;
  deposit?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SwapOrderSubmitRequestRaw {
  router: string;
  quoteId: string;
  signature: string;
  signingScheme?: string;
}

export interface SwapOrderSubmitDataRaw {
  router: string;
  orderId: string;
  chainId?: number;
  raw?: Record<string, unknown>;
}

export interface SwapOrderStatusParamsRaw {
  orderId: string;
  router: string;
  chainId?: string | number;
}

export type SwapOrderStatusDataRaw = Record<string, unknown> & {
  status?: string;
  state?: string;
};

export interface SwapReportRequestRaw {
  sender: string;
  recipient: string;
  from_hash: string;
  from_token: string;
  to_token: string;
  deposit_address: string;
  from_chain?: string;
  to_chain?: string;
  is_cross_chain?: boolean;
  amount_in?: string;
  estimated_out?: string;
  router?: string;
  tx_type?: string;
  multi_addr?: string;
  swap_id?: string;
  swapId?: string;
  extra?: Record<string, unknown>;
}

export interface SwapReportDataRaw {
  id: number;
  from_hash: string;
}

export interface SwapHistoryParamsRaw {
  sender: string;
  pageNumber?: number;
  pageSize?: number;
}

export interface SwapHistoryRecordRaw {
  id: number;
  sender: string;
  recipient?: unknown;
  from_hash: string;
  to_hash?: string | null;
  deposit_address?: string;
  from_token: string;
  to_token: string;
  from_chain: string;
  to_chain: string;
  amount_in?: string;
  estimated_out?: string;
  actual_out?: string | null;
  router?: string;
  tx_type?: string;
  is_cross_chain?: number;
  status?: string;
  multi_addr?: string | null;
  swap_id?: string | null;
  extra?: Record<string, unknown>;
  status_response?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface SwapHistoryDataRaw {
  record_list: SwapHistoryRecordRaw[];
  page_number: number;
  page_size: number;
  total_page: number;
  total_size: number;
}
