import type {
  SwapQuoteDataRaw,
  SwapQuoteRequestRaw,
} from "../api/rawTypes";
import type { AssetRef, BaseUnitAmount, ChainRef } from "./chain";

export interface QuoteRequest {
  fromChain: ChainRef;
  toChain: ChainRef;
  tokenIn: AssetRef;
  tokenOut: AssetRef;
  amountIn: BaseUnitAmount;
  slippageBps: number;
  /**
   * Frontend-configurable Near Intents route-quote wait in milliseconds.
   * Must be a non-negative integer. Defaults to 3000 when omitted.
   * This is not an HTTP, wallet, settlement, or order-polling timeout.
   */
  quoteWaitingTimeMs?: number;
  sender: string;
  recipient?: string;
  extensions?: Record<string, unknown>;
}

export interface RouteSummary {
  router: string;
  market?: string;
  amountOut: BaseUnitAmount;
  minAmountOut: BaseUnitAmount;
  raw: Record<string, unknown>;
}

export interface BuildContext {
  readonly request: SwapQuoteRequestRaw;
  readonly router: string;
  readonly market?: string;
  readonly expectedOut: BaseUnitAmount;
  readonly minAmountOut: BaseUnitAmount;
  readonly preSwap: unknown | null;
  readonly bridge: unknown | null;
  readonly quoteId?: string;
}

export interface Quote {
  id?: string;
  fromChain: ChainRef;
  toChain: ChainRef;
  tokenIn: AssetRef;
  tokenOut: AssetRef;
  amountIn: BaseUnitAmount;
  estimatedOut: BaseUnitAmount;
  minAmountOut: BaseUnitAmount;
  route: RouteSummary;
  alternatives: RouteSummary[];
  receivedAt: number;
  expiresAt?: number;
  buildContext: Readonly<BuildContext>;
  raw: SwapQuoteDataRaw;
}
