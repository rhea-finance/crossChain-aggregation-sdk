import type {
  SwapMcaPayloadRaw,
  SwapQuoteDataRaw,
} from "../api/rawTypes";
import type { SwapExecutionResult, WaitMode } from "../core/lifecycle";
import type { Quote, QuoteRequest } from "../types/quote";

export type McaFlow = "deposit" | "withdraw";

export type McaSignerChain =
  | "evm"
  | "solana"
  | "btc"
  | "near"
  | "aptos"
  | "sui"
  | "zcash"
  | "tron";

export interface McaSignerIdentity {
  chain: McaSignerChain;
  identityKey: string;
  accountId?: string;
}

export interface McaDepositCollateral {
  useAsCollateral: boolean;
}

export interface McaWithdrawCollateral {
  needDecrease: boolean;
  decreaseAmountBurrow: string;
  withdrawAll?: boolean;
}

interface McaQuoteRequestBase extends QuoteRequest {
  mcaAccountId: string;
  signerChain: McaSignerChain;
  recipientMsgSignatures?: string[];
  depositSignerProofSignatures?: string[];
}

export interface McaDepositQuoteRequest extends McaQuoteRequestBase {
  flow: "deposit";
  collateral: McaDepositCollateral;
}

export interface McaWithdrawQuoteRequest extends McaQuoteRequestBase {
  flow: "withdraw";
  collateral: McaWithdrawCollateral;
  executionPreference?: "auto" | "near" | "relayer";
  boundNearAccountId?: string;
}

export type McaQuoteRequest =
  | McaDepositQuoteRequest
  | McaWithdrawQuoteRequest;

interface McaQuoteBase extends Quote {
  flow: McaFlow;
  mcaAccountId: string;
  signer: Readonly<McaSignerIdentity>;
  request: McaQuoteRequest;
  mca: Readonly<SwapMcaPayloadRaw>;
  raw: SwapQuoteDataRaw;
}

export interface McaDepositQuote extends McaQuoteBase {
  flow: "deposit";
  executionMode: "deposit";
  request: McaDepositQuoteRequest;
  nearDepositTx?: unknown;
}

export interface McaWithdrawNearQuote extends McaQuoteBase {
  flow: "withdraw";
  executionMode: "withdraw-near";
  request: McaWithdrawQuoteRequest;
  preview: Record<string, unknown>;
}

export interface McaWithdrawRelayerQuote extends McaQuoteBase {
  flow: "withdraw";
  executionMode: "withdraw-relayer";
  request: McaWithdrawQuoteRequest;
  preview: Record<string, unknown>;
}

export type McaQuote =
  | McaDepositQuote
  | McaWithdrawNearQuote
  | McaWithdrawRelayerQuote;

export interface McaSwapInput {
  quote: McaQuote;
  waitFor?: WaitMode;
  signal?: AbortSignal;
  idempotencyKey?: string;
  onEvent?: (event: import("../core/lifecycle").SwapLifecycleEvent) => void;
  beforeSign?: (preview: {
    chain: McaSignerChain;
    identityKey: string;
    message: string;
    business: Readonly<Record<string, unknown>>;
  }) => void | Promise<void>;
}

export type McaSwapResult = SwapExecutionResult;
