import { TokenInfo, BluechipTokensConfig } from "../types";
import { ErrorMessages } from "./errorMessages";

let bluechipTokensConfig: BluechipTokensConfig | null = null;

/** Set the SDK-wide bluechip token config used for NearIntents compatibility and intermediate routing. */
export function setBluechipTokensConfig(config: BluechipTokensConfig): void {
  bluechipTokensConfig = config;
}

/** Get the bluechip token config; returns an empty object if unset. */
export function getBluechipTokensConfig(): BluechipTokensConfig {
  if (!bluechipTokensConfig) {
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
    return "";
  }

  let normalized = tokenId.replace(/^nep141:/, "");

  // Note: `nep141:` has already been stripped above.
  if (normalized === "near") {
    normalized = wrapNearContractId;
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

/**
 * Normalize EVM address to checksum format (lowercase for comparison)
 */
export function normalizeEvmAddress(address: string): string {
  if (!address) return address;
  // Remove 0x prefix if present, convert to lowercase, then add 0x back
  const addr = address.startsWith("0x") ? address.slice(2) : address;
  return "0x" + addr.toLowerCase();
}

/** True if the token matches an Intents-supported bluechip token for EVM chains (by symbol + address). */
export function isEvmIntentsSupportedToken(
  token: TokenInfo,
  bluechipTokens?: BluechipTokensConfig
): boolean {
  if (!token?.symbol || !token?.address) {
    return false;
  }

  const config = bluechipTokens || getBluechipTokensConfig();

  const normalizedSymbol = token.symbol.toUpperCase();

  // EVM bluechip tokens: USDT, USDC, ETH, WETH
  const symbolKey =
    normalizedSymbol === "ETH" || normalizedSymbol === "WETH"
      ? "ETH"
      : normalizedSymbol;

  const tokenConfig = config[symbolKey as keyof typeof config];

  if (!tokenConfig) {
    return false;
  }

  const normalizeAddress = (addr: string) => normalizeEvmAddress(addr);
  const tokenAddress = normalizeAddress(token.address);
  const configAddress = normalizeAddress(tokenConfig.address || "");
  const configAssetId = tokenConfig.assetId
    ? normalizeAddress(tokenConfig.assetId)
    : "";

  return tokenAddress === configAddress || tokenAddress === configAssetId;
}

/**
 * Find best bluechip token for EVM chains (priority: USDT > USDC > ETH/WETH)
 */
export function findBestEvmBluechipToken(
  bluechipTokens: BluechipTokensConfig,
  nativeTokenAddress?: string // e.g., WETH address
): TokenInfo {
  const preferredTokens: TokenInfo[] = [];

  if (bluechipTokens.USDT?.address) {
    preferredTokens.push({
      address: bluechipTokens.USDT.address,
      symbol: "USDT",
      decimals: bluechipTokens.USDT.decimals || 6,
      chain: "evm",
    });
  }

  if (bluechipTokens.USDC?.address) {
    preferredTokens.push({
      address: bluechipTokens.USDC.address,
      symbol: "USDC",
      decimals: bluechipTokens.USDC.decimals || 6,
      chain: "evm",
    });
  }

  if (bluechipTokens.ETH?.address) {
    preferredTokens.push({
      address: bluechipTokens.ETH.address,
      symbol: bluechipTokens.ETH.symbol || "WETH",
      decimals: bluechipTokens.ETH.decimals || 18,
      chain: "evm",
    });
  }

  // Fallback to native wrapped token if provided
  if (preferredTokens.length === 0 && nativeTokenAddress) {
    return {
      address: nativeTokenAddress,
      symbol: "WETH",
      decimals: 18,
      chain: "evm",
    };
  }

  if (preferredTokens.length === 0) {
    throw new Error(ErrorMessages.QUOTE_FAILED);
  }

  return preferredTokens[0];
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
    return {
      address: wrapNearContractId,
      symbol: "wNEAR",
      decimals: 24,
      chain: "near",
    };
  }

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

  // Extract nep141:xxx from 1cs_v1:near:nep141:xxx format
  if (assetId.startsWith("1cs_v1:")) {
    const parts = assetId.split(":");
    const nep141Index = parts.findIndex((p) => p === "nep141");
    if (nep141Index >= 0 && nep141Index < parts.length - 1) {
      return `nep141:${parts.slice(nep141Index + 1).join(":")}`;
    }
  }

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

/**
 * Format gas value from yoctoNEAR to Tgas string, avoiding scientific notation.
 * @param gasInYoctoNEAR Gas value in yoctoNEAR (string or number)
 * @returns Formatted gas string in Tgas units (e.g., "795" for 795 Tgas)
 */
export function formatGasToTgas(gasInYoctoNEAR: string | number): string {
  if (!gasInYoctoNEAR) return "0";
  
  // Convert to string first to handle both string and number inputs
  const gasStr = String(gasInYoctoNEAR);
  
  // Check if it's already in scientific notation
  if (/[eE]/.test(gasStr)) {
    // Parse scientific notation manually to avoid precision loss
      const match = gasStr.match(/^([+-]?\d*\.?\d+)[eE]([+-]?\d+)$/);
      if (match) {
        const base = match[1];
        const exponent = parseInt(match[2], 10);
        const [intPart, fracPart = ""] = base.split(".");
      
      if (exponent > 0) {
        // Positive exponent: move decimal point right
        const newIntPart = intPart + fracPart;
        const zerosToAdd = exponent - fracPart.length;
        if (zerosToAdd > 0) {
          return (newIntPart + "0".repeat(zerosToAdd)).replace(/^0+/, "") || "0";
        } else {
          const pointPos = intPart.length + exponent;
          return (newIntPart.slice(0, pointPos) + "." + newIntPart.slice(pointPos)).replace(/\.?0+$/, "");
        }
      }
    }
  }
  
  // Convert yoctoNEAR to Tgas (1 Tgas = 10^12 yoctoNEAR)
  // Use BigInt for precise integer division
  try {
    const gasBigInt = BigInt(gasStr.split(".")[0]); // Take integer part only
    const tgasBigInt = gasBigInt / BigInt("1000000000000");
    return tgasBigInt.toString();
  } catch (error) {
    return "0";
  }
}

/**
 * Ensure gas value is a string without scientific notation.
 * This is used to format gas values before passing to wallet selector.
 * @param gas Gas value (string, number, or BigInt)
 * @returns Formatted gas string in yoctoNEAR
 */
export function formatGasString(gas: string | number | bigint): string {
  if (typeof gas === "bigint") {
    return gas.toString();
  }
  
  const gasStr = String(gas);
  
  // If already a clean string without scientific notation, return as is
  if (!/[eE]/.test(gasStr) && !gasStr.includes(".")) {
    return gasStr;
  }
  
  // Handle scientific notation
  if (/[eE]/.test(gasStr)) {
    // Use manual parsing to avoid precision loss
    const match = gasStr.match(/^([+-]?\d*\.?\d+)[eE]([+-]?\d+)$/);
    if (match) {
      const base = match[1];
      const exponent = parseInt(match[2], 10);
      const [intPart, fracPart = ""] = base.split(".");
      
      if (exponent > 0) {
        // Positive exponent: move decimal point right
        const newIntPart = intPart + fracPart;
        const zerosToAdd = exponent - fracPart.length;
        if (zerosToAdd > 0) {
          return (newIntPart + "0".repeat(zerosToAdd)).replace(/^0+/, "") || "0";
        } else {
          const pointPos = intPart.length + exponent;
          const result = newIntPart.slice(0, pointPos) + "." + newIntPart.slice(pointPos);
          return result.replace(/\.?0+$/, "").replace(/\.$/, "");
        }
      } else if (exponent < 0) {
        // Negative exponent: move decimal point left
        const absExp = Math.abs(exponent);
        const zerosToAdd = absExp - intPart.length;
        if (zerosToAdd > 0) {
          return "0." + "0".repeat(zerosToAdd - 1) + intPart.replace(/^-/, "") + fracPart;
        } else {
          const pointPos = intPart.length - absExp;
          return intPart.slice(0, pointPos) + "." + intPart.slice(pointPos) + fracPart;
        }
      }
    }
  }
  
  // Handle decimal numbers - convert to integer string
  if (gasStr.includes(".")) {
    const [intPart, fracPart = ""] = gasStr.split(".");
    return intPart + fracPart;
  }
  
  return gasStr;
}

import Big from "big.js";

/**
 * Select the best quote from multiple quotes based on maximum amountOut
 */
export function selectBestQuote<T extends { amountOut: string }, R = any>(
  quotes: Array<{ quote: T; router: R }>
): { quote: T; router: R } {
  return quotes.reduce((best, current) => {
    const bestAmount = new Big(best.quote.amountOut);
    const currentAmount = new Big(current.quote.amountOut);
    return currentAmount.gt(bestAmount) ? current : best;
  });
}

export { logger } from "./logger";
export { ErrorMessages, normalizeError, getErrorMessage, processErrorMessage, TRANSACTION_EXECUTION_ERROR_MESSAGE } from "./errorMessages";
