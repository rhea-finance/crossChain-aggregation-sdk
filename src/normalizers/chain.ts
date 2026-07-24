import { SwapSdkError } from "../core/errors";
import type { AssetRef, ChainRef } from "../types/chain";

const CANONICAL_NON_EVM_CHAINS = new Set<ChainRef>([
  "solana",
  "aptos",
  "near",
  "tron",
  "btc",
  "zcash",
  "sui",
]);

const RAW_API_ALIASES = new Map<string, ChainRef>([
  ["sol", "solana"],
  ["501", "solana"],
  ["637", "aptos"],
  ["trx", "tron"],
  ["bitcoin", "btc"],
  ["zec", "zcash"],
]);

const NATIVE_ADDRESSES = new Map<ChainRef, string>([
  ["solana", "So11111111111111111111111111111111111111112"],
  ["aptos", "0xa"],
  ["near", "wrap.near"],
  ["tron", "trx"],
  ["btc", "btc"],
  ["zcash", "nep141:zec.omft.near"],
  ["sui", "0x2::sui::SUI"],
]);

const EVM_ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const DECIMAL_EVM_CHAIN_ID = /^[1-9]\d*$/;

export function toApiChain(chain: ChainRef): string {
  if (
    DECIMAL_EVM_CHAIN_ID.test(chain) ||
    CANONICAL_NON_EVM_CHAINS.has(chain)
  ) {
    return chain;
  }
  throw unsupportedChain(chain);
}

export function fromApiChain(chain: string): ChainRef {
  const normalized = chain.trim().toLowerCase();
  const alias = RAW_API_ALIASES.get(normalized);
  if (alias) return alias;
  if (CANONICAL_NON_EVM_CHAINS.has(normalized as ChainRef)) {
    return normalized as ChainRef;
  }

  if (/^0x[0-9a-f]+$/.test(normalized)) {
    const decimal = BigInt(normalized).toString();
    if (decimal !== "0") return decimal as ChainRef;
  }
  if (DECIMAL_EVM_CHAIN_ID.test(normalized)) {
    return BigInt(normalized).toString() as ChainRef;
  }

  throw unsupportedChain(chain);
}

export function toApiAssetAddress(asset: AssetRef): string {
  const explicit = asset.address.trim();
  if (explicit) return explicit;

  if (!asset.isNative) {
    throw new SwapSdkError(
      "INVALID_REQUEST",
      "quote",
      `Asset address is required for ${asset.chain}`
    );
  }

  if (DECIMAL_EVM_CHAIN_ID.test(asset.chain)) return EVM_ZERO_ADDRESS;

  const nativeAddress = NATIVE_ADDRESSES.get(asset.chain);
  if (!nativeAddress) {
    throw new SwapSdkError(
      "UNSUPPORTED_CHAIN",
      "quote",
      `No native asset mapping for ${asset.chain}`
    );
  }
  return nativeAddress;
}

function unsupportedChain(chain: string): SwapSdkError {
  return new SwapSdkError(
    "UNSUPPORTED_CHAIN",
    "quote",
    `Unsupported chain: ${chain}`
  );
}
