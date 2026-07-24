import type { SwapHistoryRecordRaw } from "../api/rawTypes";
import type { AssetRef, BaseUnitAmount, ChainRef } from "./chain";

export type HistoryStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "refunded"
  | "expired"
  | "unknown";

export interface HistoryRequest {
  sender: string;
  page?: number;
  pageSize?: number;
  status?: HistoryStatus[];
}

export interface SwapHistoryPage {
  items: SwapHistoryItem[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  filteredLocally?: boolean;
}

export interface SwapHistoryItem {
  id: string;
  sender: string;
  recipient?: string;
  fromChain: ChainRef;
  toChain: ChainRef;
  tokenIn: AssetRef;
  tokenOut: AssetRef;
  amountIn?: BaseUnitAmount;
  estimatedOut?: BaseUnitAmount;
  actualOut?: BaseUnitAmount;
  sourceTxHash?: string;
  destinationTxHash?: string;
  orderId?: string;
  depositAddress?: string;
  router?: string;
  status: HistoryStatus;
  createdAt?: string;
  updatedAt?: string;
  statusResponse?: Record<string, unknown>;
  raw: SwapHistoryRecordRaw;
}
