/**
 * Cross-chain DEX aggregation SDK core type definitions
 */

export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
  chain: string;
}

export interface Route {
  pools: PoolInfo[];
  amountIn: string;
  amountOut: string;
}

export interface PoolInfo {
  pool_id: number;
  token_in: string;
  token_out: string;
  amount_in?: string;
  amount_out?: string;
  fee?: number;
}

export interface QuoteParams {
  tokenIn: TokenInfo;
  tokenOut: TokenInfo;
  amountIn: string;
  /** Slippage tolerance in bps (e.g. 50 = 0.5%). */
  slippage: number;
  swapType?: "EXACT_INPUT" | "EXACT_OUTPUT";
  recipient?: string;
  /** Caller's NEAR account ID (used as fallback for SmartX user/receiveUser when recipient is not available). */
  accountId?: string;
}

export interface QuoteResult {
  success: boolean;
  tokenIn: TokenInfo;
  tokenOut: TokenInfo;
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  routes: Route[];
  /**
   * Optional: Raw route data returned by chain router/aggregator
   * - Used for scenarios where aggregator-specific fields need to be passed through in executeSwap
   * - Kept optional to avoid tightly coupling implementation details into core logic
   */
  rawRoutes?: any[];
  /** Quote source identifier (used when multiple quote backends are supported). */
  quoteSource?: "findPath" | "smartx";
  /** SmartX quote payload (present when quoteSource === "smartx"). */
  smartxResult?: {
    amountIn: string;
    amountOut: string;
    minAmountOut: string;
    dexs?: string[];
    msg?: string;
    signature?: string;
    tokens?: string[];
  };
  priceImpact?: number;
  avgFee?: number;
  estimatedGas?: string;
  error?: string;
}

export interface ExecuteParams {
  quote: QuoteResult;
  recipient: string;
  depositAddress?: string;
  deadline?: number;
}

export interface ExecuteResult {
  success: boolean;
  txHash?: string;
  txHashArray?: string[];
  error?: string;
}

export type SupportedChain = "near" | "evm" | "solana";

/**
 * DEX aggregator router abstract interface
 * Each chain/aggregator implements its own quote/executeSwap
 */
export interface DexRouter {
  /** Router's chain (near/evm/solana...) */
  getSupportedChain(): SupportedChain | string;
  quote(params: QuoteParams): Promise<QuoteResult>;
  executeSwap(params: ExecuteParams): Promise<ExecuteResult>;
}

/**
 * Bluechip token configuration
 */
export interface BluechipTokenConfig {
  address: string;
  symbol: string;
  decimals: number;
  assetId?: string; // AssetId for NearIntents (may include nep141: prefix)
}

/**
 * Bluechip tokens list configuration
 */
export interface BluechipTokensConfig {
  USDT?: BluechipTokenConfig;
  USDC?: BluechipTokenConfig;
  NEAR?: BluechipTokenConfig;
  [key: string]: BluechipTokenConfig | undefined;
}
