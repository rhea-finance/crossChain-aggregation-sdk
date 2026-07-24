import type { SwapOrderStatusDataRaw } from "../api/rawTypes";
import type { ChainRef } from "../types/chain";
import type {
  OrderReference,
  SwapBuild,
} from "../types/execution";
import type { Quote } from "../types/quote";

export type WaitMode = "submitted" | "source-confirmed" | "completed";

export interface SwapWarning {
  code: "REPORT_FAILED";
  message: string;
  cause?: unknown;
}

export interface SignRequestPreview {
  chain: ChainRef;
  kind: string;
  summary: Record<string, unknown>;
}

export type OrderStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "refunded"
  | "expired"
  | "unknown";

export type SwapLifecycleEvent =
  | { type: "build-started"; executionId: string }
  | { type: "build-completed"; executionId: string }
  | { type: "approval-requested"; executionId: string }
  | { type: "approval-submitted"; executionId: string; txHash: string }
  | { type: "signing-requested"; executionId: string }
  | {
      type: "submitted";
      executionId: string;
      txHash?: string;
      orderId?: string;
    }
  | { type: "source-confirmed"; executionId: string }
  | { type: "order-status"; executionId: string; status: OrderStatus }
  | { type: "completed"; executionId: string }
  | { type: "warning"; executionId: string; warning: SwapWarning }
  | { type: "failed"; executionId: string; error: Error };

export interface SwapExecutionResult {
  executionId: string;
  status:
    | "submitted"
    | "source-confirmed"
    | "processing"
    | "completed"
    | "failed"
    | "refunded"
    | "expired";
  router: string;
  txHash?: string;
  txHashes?: string[];
  orderId?: string;
  depositAddress?: string;
  report?: {
    status: "reported" | "failed" | "skipped";
    warning?: SwapWarning;
  };
  raw: unknown;
}

export interface ExecuteSwapInput {
  build: SwapBuild;
  waitFor?: WaitMode;
  signal?: AbortSignal;
  onEvent?: (event: SwapLifecycleEvent) => void;
  beforeSign?: (preview: SignRequestPreview) => void | Promise<void>;
}

export interface SwapInput extends Omit<ExecuteSwapInput, "build"> {
  quote: Quote;
  idempotencyKey?: string;
}

export interface OrderStatusResult {
  orderId: string;
  router: string;
  status: OrderStatus;
  raw: SwapOrderStatusDataRaw;
}

export interface WaitForOrderInput extends OrderReference {
  signal?: AbortSignal;
  intervalMs?: number;
  timeoutMs?: number;
}

const ORDER_STATUS_MAP: Record<string, OrderStatus> = {
  PENDING: "pending",
  CREATED: "pending",
  PROCESSING: "processing",
  IN_PROGRESS: "processing",
  SUCCESS: "completed",
  COMPLETED: "completed",
  FILLED: "completed",
  FAILED: "failed",
  REFUNDED: "refunded",
  EXPIRED: "expired",
};

export function normalizeOrderStatus(
  raw: SwapOrderStatusDataRaw
): OrderStatus {
  const value = raw.status ?? raw.state;
  if (typeof value !== "string") return "unknown";
  return ORDER_STATUS_MAP[value.trim().toUpperCase()] ?? "unknown";
}
