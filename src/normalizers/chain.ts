import { SwapSdkError } from "../core/errors";
import type { AssetRef, ChainRef } from "../types/chain";

const STANDARD_TO_API = new Map<ChainRef, string>([
  ["solana:mainnet", "solana"],
  ["aptos:mainnet", "aptos"],
  ["near:mainnet", "near"],
  ["tron:mainnet", "tron"],
  ["bitcoin:mainnet", "btc"],
  ["zcash:mainnet", "zcash"],
  ["sui:mainnet", "sui"],
]);

const API_TO_STANDARD = new Map<string, ChainRef>([
  ["solana", "solana:mainnet"],
  ["sol", "solana:mainnet"],
  ["501", "solana:mainnet"],
  ["aptos", "aptos:mainnet"],
  ["637", "aptos:mainnet"],
  ["near", "near:mainnet"],
  ["tron", "tron:mainnet"],
  ["trx", "tron:mainnet"],
  ["btc", "bitcoin:mainnet"],
  ["bitcoin", "bitcoin:mainnet"],
  ["zcash", "zcash:mainnet"],
  ["zec", "zcash:mainnet"],
  ["sui", "sui:mainnet"],
]);

const NATIVE_ADDRESSES = new Map<ChainRef, string>([
  ["solana:mainnet", "So11111111111111111111111111111111111111112"],
  ["aptos:mainnet", "0xa"],
  ["near:mainnet", "wrap.near"],
  ["tron:mainnet", "trx"],
  ["bitcoin:mainnet", "btc"],
  ["zcash:mainnet", "nep141:zec.omft.near"],
  ["sui:mainnet", "0x2::sui::SUI"],
]);

const EVM_ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function toApiChain(chain: ChainRef): string {
  const mapped = STANDARD_TO_API.get(chain);
  if (mapped) return mapped;

  const evmMatch = /^eip155:(\d+)$/.exec(chain);
  if (evmMatch) {
    const chainId = BigInt(evmMatch[1]);
    if (chainId > 0n) return chainId.toString();
  }

  throw new SwapSdkError(
    "UNSUPPORTED_CHAIN",
    "quote",
    `Unsupported chain: ${chain}`
  );
}

export function fromApiChain(chain: string): ChainRef {
  const normalized = chain.trim().toLowerCase();
  const mapped = API_TO_STANDARD.get(normalized);
  if (mapped) return mapped;

  if (/^0x[0-9a-f]+$/.test(normalized)) {
    return `eip155:${BigInt(normalized).toString()}`;
  }
  if (/^[1-9]\d*$/.test(normalized)) {
    return `eip155:${BigInt(normalized).toString()}`;
  }

  return normalized as ChainRef;
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

  if (/^eip155:\d+$/.test(asset.chain)) return EVM_ZERO_ADDRESS;

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
