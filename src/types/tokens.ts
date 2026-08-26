import type { AssetRef, ChainRef } from "./chain";

export interface TokenListRequest {
  /** Numeric ID accepted by the token-list endpoints. */
  chainId: number;
}

export interface SwapTokenListItem extends AssetRef {
  chain: ChainRef;
  /** Token identifier accepted by the unified quote API. */
  address: string;
  symbol: string;
  decimals: number;
  isNative: boolean;
  tokenListChainId: number;
  blockchain: string;
  assetId: string;
  contractAddress: string | null;
  coinType: string | null;
  name: string | null;
  logoURI: string | null;
  price: string | number | null;
  priceUpdatedAt: number | null;
  sources: string[];
  raw: Record<string, unknown>;
}
