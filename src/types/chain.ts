import { SwapSdkError } from "../core/errors";

export type ChainRef =
  | `${number}`
  | "solana"
  | "aptos"
  | "near"
  | "tron"
  | "btc"
  | "zcash"
  | "sui";

export type BaseUnitAmount = string;

export interface AssetRef {
  chain: ChainRef;
  address: string;
  symbol?: string;
  decimals?: number;
  isNative?: boolean;
}

const BASE_UNIT_AMOUNT = /^(0|[1-9]\d*)$/;

export function assertBaseUnitAmount(value: string): BaseUnitAmount {
  if (!BASE_UNIT_AMOUNT.test(value)) {
    throw new SwapSdkError(
      "INVALID_REQUEST",
      "quote",
      `Invalid base-unit amount: ${value}`
    );
  }

  return value;
}
