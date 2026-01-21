import { TokenInfo, BluechipTokensConfig } from "../types";
import { logger } from "./logger";

let bluechipTokensConfig: BluechipTokensConfig | null = null;

/** Set the SDK-wide bluechip token config used for NearIntents compatibility and intermediate routing. */
export function setBluechipTokensConfig(config: BluechipTokensConfig): void {
  bluechipTokensConfig = config;
}

/** Get the bluechip token config; returns an empty object (and warns) if unset. */
export function getBluechipTokensConfig(): BluechipTokensConfig {
  if (!bluechipTokensConfig) {
    logger.warn(
      "getBluechipTokensConfig - Bluechip tokens config not set, returning empty config"
    );
    return {};
  }
  return bluechipTokensConfig;
}

/**
 * Normalize a NEAR asset id:
 * - strip `nep141:` prefix (if present)
 * - map `near` -> `wrap.near` (overridable via `wrapNearContractId`)
 */
export function normalizeTokenId(
  tokenId: string | undefined | null,
  wrapNearContractId: string = "wrap.near"
): string {
  if (!tokenId) {
    logger.error("normalizeTokenId - Empty tokenId:", tokenId);
    return "";
  }

  let normalized = tokenId.replace(/^nep141:/, "");

  // Note: `nep141:` has already been stripped above.
  if (normalized === "near") {
    normalized = wrapNearContractId;
  }

  if (!normalized) {
    logger.error("normalizeTokenId - Result is empty:", {
      tokenId,
      normalized,
    });
  }

  return normalized;
}

/** True if the token matches a NearIntents-supported bluechip token (by symbol + address/assetId). */
export function isNearIntentsSupportedToken(
  token: TokenInfo,
  bluechipTokens?: BluechipTokensConfig
): boolean {
  if (!token?.symbol || !token?.address) {
    return false;
  }

  const config = bluechipTokens || getBluechipTokensConfig();

  const normalizedSymbol = token.symbol.toUpperCase();

  const symbolKey =
    normalizedSymbol === "NEAR" || normalizedSymbol === "WNEAR"
      ? "NEAR"
      : normalizedSymbol;

  const tokenConfig = config[symbolKey as keyof typeof config];

  if (!tokenConfig) {
    return false;
  }

  const normalizeAddress = (addr: string) =>
    addr.replace(/^nep141:/, "").toLowerCase();
  const tokenAddress = normalizeAddress(token.address);
  const configAddress = normalizeAddress(tokenConfig.address || "");
  const configAssetId = tokenConfig.assetId
    ? normalizeAddress(tokenConfig.assetId)
    : "";

  return tokenAddress === configAddress || tokenAddress === configAssetId;
}

/** Pick an intermediate bluechip token (priority: USDT > USDC > wNEAR; fallback to `wrapNearContractId`). */
export function findBestBluechipToken(
  bluechipTokens: BluechipTokensConfig,
  wrapNearContractId: string = "wrap.near"
): TokenInfo {
  const preferredTokens: TokenInfo[] = [];

  if (bluechipTokens.USDT?.address) {
    preferredTokens.push({
      address: bluechipTokens.USDT.address,
      symbol: "USDT",
      decimals: bluechipTokens.USDT.decimals || 6,
      chain: "near",
    });
  }

  if (bluechipTokens.USDC?.address) {
    preferredTokens.push({
      address: bluechipTokens.USDC.address,
      symbol: "USDC",
      decimals: bluechipTokens.USDC.decimals || 6,
      chain: "near",
    });
  }

  if (bluechipTokens.NEAR?.address) {
    preferredTokens.push({
      address: bluechipTokens.NEAR.address,
      symbol: "wNEAR",
      decimals: bluechipTokens.NEAR.decimals || 24,
      chain: "near",
    });
  }

  if (preferredTokens.length === 0) {
    logger.warn(
      "findBestBluechipToken - No preferred tokens found, using wrap.near"
    );
    return {
      address: wrapNearContractId,
      symbol: "wNEAR",
      decimals: 24,
      chain: "near",
    };
  }

  logger.debug("findBestBluechipToken - Selected token:", preferredTokens[0]);
  return preferredTokens[0];
}

/**
 * Convert slippage input into bps (1 bps = 0.01%).
 * - `>= 1`: bps (e.g. 50 = 0.5%)
 * - `[0.01, 1)`: percent (e.g. 0.5 = 0.5%)
 * - `(0, 0.01)`: decimal (e.g. 0.005 = 0.5%)
 */
export function convertSlippageToBasisPoints(slippage: number): number {
  if (slippage >= 1) {
    return Math.round(slippage);
  }

  if (slippage > 0 && slippage < 0.01) {
    // 0.005 -> 0.5% -> 50 bps
    return Math.round(slippage * 10000);
  }
  if (slippage >= 0.01 && slippage < 1) {
    // 0.5 -> 0.5% -> 50 bps
    return Math.round(slippage * 100);
  }
  return Math.round(slippage);
}

/** Normalize NearIntents `destinationAsset` (prefix + `near` -> `wrap.near`). */
export function normalizeDestinationAsset(
  assetId: string,
  wrapNearContractId: string = "wrap.near"
): string {
  if (!assetId) return assetId;

  if (assetId.startsWith("nep141:") || assetId.startsWith("nep245:")) {
    return assetId;
  }

  if (assetId === "near" || assetId === "nep141:near") {
    return `nep141:${wrapNearContractId}`;
  }

  if (assetId.includes(".")) {
    return `nep141:${normalizeTokenId(assetId, wrapNearContractId)}`;
  }

  return assetId;
}

export { logger } from "./logger";
