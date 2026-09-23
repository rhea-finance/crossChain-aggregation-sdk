import type { SwapOrderStatusParamsRaw } from "../api/rawTypes";
import { SwapSdkError } from "../core/errors";
import type { WaitMode } from "../core/lifecycle";
import type { OrderReference } from "../types/execution";
import type { SwapHistoryItem } from "../types/history";

/** Poll order-status after a report id, or for tracked swaps that wait past broadcast. */
export function shouldPollSwapOrderStatus(input: {
  waitFor?: WaitMode;
  isCrossChain: boolean;
  confidentiality?: string;
  /** Present when POST /api/swap/report returned a history row id. */
  reportRecordId?: string;
}): boolean {
  if (String(input.reportRecordId ?? "").trim()) return true;
  const waitMode = input.waitFor ?? "submitted";
  const requiresOrderStatus =
    input.isCrossChain || input.confidentiality === "basic";
  return requiresOrderStatus && waitMode !== "submitted";
}

export function resolveSwapReportRecordId(reportData: unknown): string {
  if (!reportData || typeof reportData !== "object") return "";
  const record = reportData as Record<string, unknown>;
  for (const key of ["id", "recordId", "record_id"] as const) {
    const value = record[key];
    if (value !== undefined && value !== null) {
      const normalized = String(value).trim();
      if (normalized) return normalized;
    }
  }
  return "";
}

export type OrderStatusLookup = OrderReference;

/**
 * Status queries use the report id as `recordId`, plus the swap response `router`.
 */
export function buildOrderStatusQuery(
  params: SwapOrderStatusParamsRaw
): Record<string, string | number> {
  const reportId = String(params.recordId ?? "").trim();
  if (reportId) {
    const query: Record<string, string | number> = { recordId: reportId };
    const router = params.router?.trim();
    if (router) query.router = router;
    return query;
  }

  const orderId = params.orderId?.trim();
  if (!orderId) return {};

  const query: Record<string, string | number> = { orderId };
  const router = params.router?.trim();
  if (router) query.router = router;
  const chainId = params.chainId;
  if (
    chainId !== undefined &&
    chainId !== null &&
    String(chainId).trim() !== ""
  ) {
    query.chainId = chainId;
  }
  return query;
}

export function resolveOrderStatusLookup(input: {
  recordId?: string | number;
  orderId?: string;
  txHash?: string;
  router?: string;
  chainId?: string | number;
}): OrderReference | undefined {
  const reportId = String(input.recordId ?? "").trim();
  const router = input.router?.trim();
  if (reportId) {
    return {
      recordId: reportId,
      ...(router ? { router } : {}),
    };
  }

  const orderId = input.orderId?.trim();
  if (!orderId) return undefined;

  const chainId =
    input.chainId !== undefined &&
    input.chainId !== null &&
    String(input.chainId).trim() !== ""
      ? String(input.chainId).trim()
      : undefined;

  return {
    orderId,
    ...(router ? { router } : {}),
    ...(chainId ? { chainId } : {}),
  };
}

export function assertOrderStatusParams(
  params: SwapOrderStatusParamsRaw | OrderReference
): OrderReference {
  const lookup = resolveOrderStatusLookup(params);
  if (!lookup) {
    throw new SwapSdkError(
      "INVALID_REQUEST",
      "status",
      "Order status requires recordId or orderId"
    );
  }
  return lookup;
}

export function orderStatusParamsFromHistoryItem(
  item: Pick<
    SwapHistoryItem,
    "id" | "orderId" | "router" | "sourceTxHash"
  >
): OrderReference {
  const reportId = String(item.id ?? "").trim();
  if (reportId) {
    return {
      recordId: reportId,
      ...(item.router ? { router: item.router } : {}),
    };
  }
  return {
    ...(item.orderId ? { orderId: item.orderId } : {}),
    ...(item.router ? { router: item.router } : {}),
  };
}

export function resolveSourceTxHash(input: {
  txHash?: string;
  txHashes?: string[];
}): string | undefined {
  const direct = input.txHash?.trim();
  if (direct) return direct;
  const last = input.txHashes?.[input.txHashes.length - 1]?.trim();
  return last || undefined;
}
