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

export interface SwapMcaSignerPayloadRaw {
  chain: string;
  identityKey: string;
}

export interface SwapMcaPayloadRaw {
  flow?: "deposit" | "withdraw";
  mcaFlow?: "deposit" | "withdraw";
  mcaAccountId?: string;
  mca_id?: string;
  signer?: SwapMcaSignerPayloadRaw;
  depositSigner?: SwapMcaSignerPayloadRaw;
  amountBurrow?: string;
  amount_with_inner_decimal?: string;
  amount_burrow?: string;
  recipientMsgSignatures?: string[];
  depositSignerProofSignatures?: string[];
  useAsCollateral?: boolean;
  needDecreaseCollateral?: boolean;
  decreaseCollateralAmountBurrow?: string;
  withdrawAll?: boolean;
  [key: string]: unknown;
}

export interface SwapMcaRelayerRequestRaw {
  mcaAccountId?: string;
  mca_id?: string;
  wallet: string | Record<string, unknown>;
  business: Record<string, unknown>;
  signature: string;
  [key: string]: unknown;
}

export interface SwapQuoteRequestRaw {
  fromChain: string;
  toChain: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippage?: number;
  quoteWaitingTimeMs?: number;
  /** Enables the confidential 1Click route. */
  confidentiality?: "basic";
  sender: string;
  recipient?: string;
  useAsCollateral?: boolean;
  mca?: SwapMcaPayloadRaw;
}

export interface SwapQuoteDataRaw {
  isCrossChain: boolean;
  chainType: string;
  bestQuote: Record<string, unknown>;
  /** Optional route alternatives. Some quote responses only return bestQuote. */
  allQuotes?: Record<string, unknown>[];
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
  mcaRelayer?: SwapMcaRelayerRequestRaw;
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
  chainId: number | string;
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
  /** Marks reports created by the confidential 1Click route. */
  confidentiality?: "basic";
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
  mode?: "confidential";
  /** Wallet-scoped token sent through the Authentication header. */
  walletToken?: string;
}

export type SwapHistoryWalletChainFamilyRaw =
  | "evm"
  | "solana"
  | "near"
  | "aptos"
  | "sui"
  | "tron"
  | "btc"
  | "zcash";

export interface SwapHistoryAuthChallengeRequestRaw {
  mcaAccountId?: string;
  chainFamily: SwapHistoryWalletChainFamilyRaw;
  chainId: string;
  walletAddress: string;
  identityKey?: string;
  bindingIdentityKey?: string;
  /** Legacy compatibility field. New callers should use walletAddress. */
  address?: string;
}

export interface SwapHistoryAuthChallengeRaw {
  challengeId: string;
  expiresAt: string;
  chainFamily: SwapHistoryWalletChainFamilyRaw;
  chainId: string;
  address: string;
  walletAddress: string;
  identityKey: string;
  principalType: "mca" | "wallet";
  queryAddress: string;
  mcaAccountId: string | null;
  signingMethod:
    | "personal_sign"
    | "signMessage"
    | "NEP-413"
    | "signPersonalMessage"
    | "signMessageV2"
    | "bip322-simple"
    | "signmessage";
  signingInput: {
    message: string;
    recipient?: string;
    nonce?: string;
    callbackUrl?: string | null;
  };
}

export type SwapHistoryAuthProofRaw = Record<string, string>;

export interface SwapHistoryAuthVerifyRequestRaw {
  challengeId: string;
  proof: SwapHistoryAuthProofRaw;
}

export interface SwapHistoryAuthTokenRaw {
  token: string;
  tokenType: "Bearer";
  expiresIn: number;
  expiresAt: string;
  principalType: "mca" | "wallet";
  queryAddress: string;
  mcaAccountId: string | null;
  scope: "swap:history:confidential:read";
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
