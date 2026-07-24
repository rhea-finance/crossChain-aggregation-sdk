import { z } from "zod";
import type {
  SwapHistoryDataRaw,
  SwapHistoryRecordRaw,
} from "../api/rawTypes";
import { SwapSdkError } from "../core/errors";
import type { AssetRef, ChainRef } from "../types/chain";
import type {
  HistoryStatus,
  SwapHistoryItem,
  SwapHistoryPage,
} from "../types/history";
import { fromApiChain } from "./chain";
import { decimalStringSchema } from "./schemas";

const historyRecordSchema = z
  .object({
    id: z.number().int(),
    sender: z.string(),
    recipient: z.unknown().optional(),
    from_hash: z.string(),
    to_hash: z.string().nullable().optional(),
    deposit_address: z.string().optional(),
    from_token: z.string(),
    to_token: z.string(),
    from_chain: z.string(),
    to_chain: z.string(),
    amount_in: decimalStringSchema.optional(),
    estimated_out: decimalStringSchema.optional(),
    actual_out: decimalStringSchema.nullable().optional(),
    router: z.string().optional(),
    status: z.string().optional(),
    swap_id: z.string().nullable().optional(),
    status_response: z.record(z.string(), z.unknown()).optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();

const historyPageSchema = z.object({
  record_list: z.array(historyRecordSchema),
  page_number: z.number().int().nonnegative(),
  page_size: z.number().int().nonnegative(),
  total_page: z.number().int().nonnegative(),
  total_size: z.number().int().nonnegative(),
});

const HISTORY_STATUS_MAP: Record<string, HistoryStatus> = {
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

const NATIVE_ASSET_IDS: Partial<Record<ChainRef, readonly string[]>> = {
  solana: [
    "sol",
    "So11111111111111111111111111111111111111112",
  ],
  aptos: ["0xa", "0x1::aptos_coin::AptosCoin"],
  near: ["near", "wrap.near"],
  tron: ["trx"],
  btc: ["btc", "bitcoin"],
  zcash: ["zec", "zcash", "nep141:zec.omft.near"],
  sui: ["0x2::sui::SUI"],
};

export function normalizeHistory(raw: SwapHistoryDataRaw): SwapHistoryPage {
  const parsed = historyPageSchema.safeParse(raw);
  if (!parsed.success) {
    throw new SwapSdkError(
      "INVALID_API_RESPONSE",
      "history",
      "Invalid swap history response",
      {
        details: {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      }
    );
  }

  return {
    items: raw.record_list.map(normalizeHistoryItem),
    page: raw.page_number,
    pageSize: raw.page_size,
    totalPages: raw.total_page,
    totalItems: raw.total_size,
  };
}

export function normalizeHistoryStatus(status: unknown): HistoryStatus {
  if (typeof status !== "string") return "unknown";
  return HISTORY_STATUS_MAP[status.trim().toUpperCase()] ?? "unknown";
}

function normalizeHistoryItem(raw: SwapHistoryRecordRaw): SwapHistoryItem {
  const fromChain = fromApiChain(raw.from_chain);
  const toChain = fromApiChain(raw.to_chain);
  const createdAt = normalizeTimestamp(raw.created_at);
  const updatedAt = normalizeTimestamp(raw.updated_at);

  return {
    id: String(raw.id),
    sender: raw.sender,
    ...(typeof raw.recipient === "string" && raw.recipient
      ? { recipient: raw.recipient }
      : {}),
    fromChain,
    toChain,
    tokenIn: normalizeHistoryAsset(fromChain, raw.from_token),
    tokenOut: normalizeHistoryAsset(toChain, raw.to_token),
    ...(raw.amount_in !== undefined ? { amountIn: raw.amount_in } : {}),
    ...(raw.estimated_out !== undefined
      ? { estimatedOut: raw.estimated_out }
      : {}),
    ...(raw.actual_out !== undefined && raw.actual_out !== null
      ? { actualOut: raw.actual_out }
      : {}),
    ...(raw.from_hash ? { sourceTxHash: raw.from_hash } : {}),
    ...(raw.to_hash ? { destinationTxHash: raw.to_hash } : {}),
    ...(raw.swap_id ? { orderId: raw.swap_id } : {}),
    ...(raw.deposit_address ? { depositAddress: raw.deposit_address } : {}),
    ...(raw.router ? { router: raw.router } : {}),
    status: normalizeHistoryStatus(raw.status),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(raw.status_response ? { statusResponse: raw.status_response } : {}),
    raw,
  };
}

function normalizeHistoryAsset(chain: ChainRef, address: string): AssetRef {
  return {
    chain,
    address,
    ...(isNativeAsset(chain, address) ? { isNative: true } : {}),
  };
}

function isNativeAsset(chain: ChainRef, address: string): boolean {
  const normalized = address.trim().toLowerCase();
  if (
    /^[1-9]\d*$/.test(chain) &&
    (normalized === "0x0000000000000000000000000000000000000000" ||
      normalized === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee")
  ) {
    return true;
  }
  return (NATIVE_ASSET_IDS[chain] ?? []).some(
    (candidate) => candidate.toLowerCase() === normalized
  );
}

function normalizeTimestamp(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(
    trimmed
  )
    ? `${trimmed.replace(" ", "T")}Z`
    : trimmed;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
