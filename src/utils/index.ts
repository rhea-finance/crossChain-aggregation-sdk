/**
 * Cross-chain DEX aggregation SDK utility functions
 */

import { TokenInfo, BluechipTokensConfig } from "../types";
import { logger } from "./logger";

/**
 * Normalize token ID (remove nep141: prefix, convert near to wrap.near)
 */
export function normalizeTokenId(
  tokenId: string | undefined | null,
  wrapNearContractId: string = "wrap.near"
): string {
  if (!tokenId) {
    logger.error("normalizeTokenId - Empty tokenId:", tokenId);
    return "";
  }

  // Remove nep141: prefix
  let normalized = tokenId.replace(/^nep141:/, "");

  // Convert near to wrap.near
  if (normalized === "near" || normalized === "nep141:near") {
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

/**
 * Check if token is a NearIntents-supported bluechip token
 */
export function isNearIntentsSupportedToken(
  token: TokenInfo,
  bluechipTokens: BluechipTokensConfig
): boolean {
  if (!token?.symbol) return false;

  const tokenConfig = bluechipTokens[token.symbol];
  return !!tokenConfig?.address;
}

/**
 * Find the best bluechip token to use as intermediate token
 */
export function findBestBluechipToken(
  bluechipTokens: BluechipTokensConfig,
  wrapNearContractId: string = "wrap.near"
): TokenInfo {
  // Priority order: USDT > USDC > wNEAR
  const preferredTokens: TokenInfo[] = [];

  // USDT
  if (bluechipTokens.USDT?.address) {
    preferredTokens.push({
      address: bluechipTokens.USDT.address,
      symbol: "USDT",
      decimals: bluechipTokens.USDT.decimals || 6,
      chain: "near",
    });
  }

  // USDC
  if (bluechipTokens.USDC?.address) {
    preferredTokens.push({
      address: bluechipTokens.USDC.address,
      symbol: "USDC",
      decimals: bluechipTokens.USDC.decimals || 6,
      chain: "near",
    });
  }

  // wNEAR
  if (bluechipTokens.NEAR?.address) {
    preferredTokens.push({
      address: bluechipTokens.NEAR.address,
      symbol: "wNEAR",
      decimals: bluechipTokens.NEAR.decimals || 24,
      chain: "near",
    });
  }

  // Return first available bluechip token
  if (preferredTokens.length === 0) {
    // Fallback to wrap.near
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
 * Convert slippage format (percentage or decimal -> basis points)
 */
export function convertSlippageToBasisPoints(slippage: number): number {
  // If already in basis points (>= 1), return directly
  if (slippage >= 1) {
    return Math.round(slippage);
  }

  // If percentage (0.5 means 0.5%), convert to basis points
  if (slippage > 0 && slippage < 1) {
    return Math.round(slippage * 100);
  }

  // If decimal (0.005 means 0.5%), convert to basis points
  if (slippage < 0.01) {
    return Math.round(slippage * 10000);
  }

  return Math.round(slippage * 100);
}

/**
 * Normalize destination asset address (for NearIntents)
 */
export function normalizeDestinationAsset(
  assetId: string,
  wrapNearContractId: string = "wrap.near"
): string {
  if (!assetId) return assetId;

  // If already a complete assetId (with prefix), return directly
  if (assetId.startsWith("nep141:") || assetId.startsWith("nep245:")) {
    return assetId;
  }

  // If near, convert to wrap.near
  if (assetId === "near" || assetId === "nep141:near") {
    return `nep141:${wrapNearContractId}`;
  }

  // If contract address (contains .), add nep141: prefix
  if (assetId.includes(".")) {
    return `nep141:${normalizeTokenId(assetId, wrapNearContractId)}`;
  }

  return assetId;
}

// Export logger for external use
export { logger } from "./logger";
