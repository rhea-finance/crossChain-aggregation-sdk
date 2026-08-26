import type {
  SwapCrossChainToTokensDataRaw,
  SwapFromTokensDataRaw,
  SwapTokenListRowRaw,
} from "../api/rawTypes";
import { SwapSdkError } from "../core/errors";
import type { ChainRef } from "../types/chain";
import type { SwapTokenListItem } from "../types/tokens";

interface TokenListChainMetadata {
  chain: ChainRef;
  blockchain: string;
}

const TOKEN_LIST_CHAIN_METADATA = new Map<number, TokenListChainMetadata>([
  [1, { chain: "1", blockchain: "eth" }],
  [10, { chain: "10", blockchain: "op" }],
  [43114, { chain: "43114", blockchain: "avax" }],
  [4663, { chain: "4663", blockchain: "robinhood" }],
  [747474, { chain: "747474", blockchain: "katana" }],
  [146, { chain: "146", blockchain: "sonic" }],
  [130, { chain: "130", blockchain: "unichain" }],
  [1672, { chain: "1672", blockchain: "pharos" }],
  [4217, { chain: "4217", blockchain: "tempo" }],
  [56, { chain: "56", blockchain: "bsc" }],
  [100, { chain: "100", blockchain: "gnosis" }],
  [137, { chain: "137", blockchain: "pol" }],
  [143, { chain: "143", blockchain: "monad" }],
  [196, { chain: "196", blockchain: "xlayer" }],
  [8453, { chain: "8453", blockchain: "base" }],
  [9745, { chain: "9745", blockchain: "plasma" }],
  [42161, { chain: "42161", blockchain: "arb" }],
  [80094, { chain: "80094", blockchain: "bera" }],
  [195, { chain: "tron", blockchain: "tron" }],
  [501, { chain: "solana", blockchain: "sol" }],
  [784, { chain: "sui", blockchain: "sui" }],
  [900001, { chain: "near", blockchain: "near" }],
  [900002, { chain: "btc", blockchain: "btc" }],
  [900010, { chain: "zcash", blockchain: "zec" }],
  [900012, { chain: "aptos", blockchain: "aptos" }],
]);

export function normalizeFromTokenList(
  raw: SwapFromTokensDataRaw,
  chainId: number
): SwapTokenListItem[] {
  if (!isRecord(raw) || Array.isArray(raw)) {
    throw invalidTokenList("From-token response data must be an object");
  }
  return normalizeRows(Object.values(raw), chainId);
}

export function normalizeCrossChainToTokenList(
  raw: SwapCrossChainToTokensDataRaw,
  chainId: number
): SwapTokenListItem[] {
  if (!isRecord(raw) || !Array.isArray(raw.tokens)) {
    throw invalidTokenList(
      "Cross-chain to-token response data must contain a tokens array"
    );
  }
  return normalizeRows(raw.tokens, chainId);
}

function normalizeRows(
  rows: unknown[],
  chainId: number
): SwapTokenListItem[] {
  const tokens = rows
    .map((row) => normalizeRow(row, chainId))
    .filter((token): token is SwapTokenListItem => token !== undefined);
  if (rows.length > 0 && tokens.length === 0) {
    throw invalidTokenList("Token-list response contains no valid token rows");
  }
  return tokens;
}

function normalizeRow(
  value: unknown,
  chainId: number
): SwapTokenListItem | undefined {
  if (!isRecord(value)) return undefined;
  const row = value as SwapTokenListRowRaw;
  const assetId =
    readString(row.assetId) ??
    readString(row.address) ??
    readString(row.contractAddress) ??
    readString(row.coinType);
  const symbol = readString(row.symbol);
  const decimals = readDecimals(row.decimals);
  if (!assetId || !symbol || decimals === undefined) return undefined;

  const metadata = TOKEN_LIST_CHAIN_METADATA.get(chainId);
  const chain = metadata?.chain ?? (String(chainId) as ChainRef);
  const blockchain =
    readString(row.blockchain)?.toLowerCase() ??
    metadata?.blockchain ??
    String(chainId);
  const rawAddress =
    readString(row.contractAddress) ??
    readString(row.address) ??
    readString(row.coinType);
  const isNative = isNativeToken({
    row,
    chain,
    blockchain,
    assetId,
    rawAddress,
    symbol,
  });
  const sources = Array.isArray(row.sources)
    ? row.sources.filter(
        (source): source is string =>
          typeof source === "string" && source.trim().length > 0
      )
    : readString(row.platform)
      ? [readString(row.platform)!]
      : [];
  const price =
    typeof row.price === "string" || typeof row.price === "number"
      ? row.price
      : null;
  const priceUpdatedAt =
    typeof row.updated_at === "number" && Number.isFinite(row.updated_at)
      ? row.updated_at
      : null;

  return {
    chain,
    address: assetId,
    symbol,
    decimals,
    isNative,
    tokenListChainId: chainId,
    blockchain,
    assetId,
    contractAddress: isNative ? null : rawAddress ?? null,
    coinType: readString(row.coinType) ?? null,
    name: readString(row.name) ?? null,
    logoURI: readString(row.logoURI) ?? null,
    price,
    priceUpdatedAt,
    sources,
    raw: { ...row },
  };
}

function isNativeToken(input: {
  row: SwapTokenListRowRaw;
  chain: ChainRef;
  blockchain: string;
  assetId: string;
  rawAddress?: string;
  symbol: string;
}): boolean {
  if (input.row.isNative === true) return true;
  const address = (input.rawAddress ?? "").toLowerCase();
  const assetId = input.assetId.toLowerCase();
  const coinType = readString(input.row.coinType)?.toLowerCase() ?? "";

  if (/^[1-9]\d*$/.test(input.chain)) {
    return (
      address === "0x0000000000000000000000000000000000000000" ||
      address === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" ||
      ((input.blockchain === "pol" || input.blockchain === "polygon") &&
        address === "0x0000000000000000000000000000000000001010")
    );
  }
  if (input.chain === "solana") {
    return (
      address === "11111111111111111111111111111111" ||
      assetId === "nep141:sol.omft.near"
    );
  }
  if (input.chain === "tron") {
    return input.symbol.toUpperCase() === "TRX";
  }
  if (input.chain === "sui") {
    return address.endsWith("::sui::sui");
  }
  if (input.chain === "aptos") {
    if (coinType === "0x1::aptos_coin::aptoscoin") return true;
    if (!/^0x[0-9a-f]+$/.test(address)) return false;
    const compactAddress = address.slice(2).replace(/^0+/, "") || "0";
    return compactAddress === "a";
  }
  return false;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

function readDecimals(value: unknown): number | undefined {
  const decimals =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isInteger(decimals) && decimals >= 0 ? decimals : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function invalidTokenList(message: string): SwapSdkError {
  return new SwapSdkError("INVALID_API_RESPONSE", "tokens", message);
}
