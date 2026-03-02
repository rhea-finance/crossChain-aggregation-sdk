/**
 * Cross-chain DEX aggregation SDK core type definitions
 */

export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
  chain: string;
  /** Optional: Intents assetId (e.g., nep245:..., nep141:...) provided by backend */
  assetId?: string;
  /** Optional: Platform identifier ("nearIntents" | "okx" | "bitget") */
  platform?: string;
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

/**
 * Base quote parameters (common to all routers)
 */
export interface BaseQuoteParams {
  tokenIn: TokenInfo;
  tokenOut: TokenInfo;
  amountIn: string;
  /** Slippage tolerance in bps (e.g. 50 = 0.5%). */
  slippage: number;
  swapType?: "EXACT_INPUT" | "EXACT_OUTPUT";
  recipient?: string;
}

/**
 * Simple quote parameters (V1 NEAR, etc., no recipient required)
 */
export interface SimpleQuoteParams extends BaseQuoteParams {
}

/**
 * Recipient quote parameters (V2 NEAR, EVM, etc., recipient required)
 */
export interface RecipientQuoteParams extends BaseQuoteParams {
  /** Sender address (current user) */
  sender: string;
  /** Recipient address (equals sender during quote, equals depositAddress during execution) */
  recipient: string;
}

/**
 * Unified quote parameters (union type)
 * Supports both simple and recipient modes
 */
export type QuoteParams = SimpleQuoteParams | RecipientQuoteParams;

/**
 * Type guard: check if recipient parameters are required
 */
export function requiresRecipient(
  params: QuoteParams
): params is RecipientQuoteParams {
  return "sender" in params && "recipient" in params;
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
  priceImpact?: number;
  avgFee?: number;
  estimatedGas?: string;
  error?: string;
  
  // V2 Router specific fields (NEAR, EVM, etc.)
  routerMsg?: string;
  signature?: string;
  tokens?: string[];
  dexs?: string[];
  recipient?: string;
  slippage?: number;
  
  // EVM-specific fields (future extension)
  transactionData?: string;
  gasEstimate?: string;
}

/**
 * Base execute parameters (common to all routers)
 */
export interface BaseExecuteParams {
  quote: QuoteResult;
  recipient: string;
  depositAddress?: string;
  deadline?: number;
  /** Optional sender address (for native NEAR wrap operations) */
  sender?: string;
}

/**
 * Recipient execute parameters (V2 NEAR, EVM, etc.)
 */
export interface RecipientExecuteParams extends BaseExecuteParams {
  /** Sender address (current user) */
  sender: string;
  /** Recipient address (usually depositAddress) */
  receiveUser: string;
}

/**
 * Unified execute parameters (union type)
 * Supports both simple and recipient modes
 */
export type ExecuteParams = BaseExecuteParams | RecipientExecuteParams;

/**
 * Type guard: check if execute parameters require recipient
 */
export function requiresRecipientInExecute(
  params: ExecuteParams
): params is RecipientExecuteParams {
  return "sender" in params && "receiveUser" in params;
}

export interface ExecuteResult {
  success: boolean;
  txHash?: string;
  txHashArray?: string[];
  error?: string;
}

export type SupportedChain = "near" | "evm" | "solana";

/**
 * Router capabilities
 * Used to declare router features and requirements
 */
export interface RouterCapabilities {
  /** Whether recipient parameters (sender/recipient) are required */
  requiresRecipient: boolean;
  /** Whether two API calls are needed (quote + finalize) */
  requiresFinalizeQuote: boolean;
  /** Whether complex token registration is required */
  requiresComplexRegistration: boolean;
  /** Supported chain */
  supportedChain: SupportedChain | string;
}

/**
 * DEX aggregator router abstract interface
 * Each chain/aggregator implements its own quote/executeSwap
 * 
 * Extended to support common architecture:
 * - Capabilities (RouterCapabilities)
 * - Optional finalize quote method (finalizeQuote)
 * - Unified parameter interface (supports both simple and recipient modes)
 */
export interface DexRouter {
  getCapabilities(): RouterCapabilities;
  
  getSupportedChain(): SupportedChain | string;
  
  /**
   * Quote method
   * - Simple router: only needs BaseQuoteParams
   * - Recipient router: needs RecipientQuoteParams
   */
  quote(params: QuoteParams): Promise<QuoteResult>;
  
  /**
   * Execute swap
   * - Simple router: only needs BaseExecuteParams
   * - Recipient router: needs RecipientExecuteParams
   */
  executeSwap(params: ExecuteParams): Promise<ExecuteResult>;
  
  /**
   * Finalize quote (if two API calls are needed)
   * - Only implemented when requiresFinalizeQuote = true
   * - Used to call API again after getting depositAddress
   */
  finalizeQuote?(
    params: QuoteParams,
    depositAddress: string
  ): Promise<QuoteResult>;
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
