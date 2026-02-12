/**
 * Unified error messages for the SDK
 * All error messages should be defined here for consistency
 */

export const ErrorMessages = {
  // Parameter validation errors
  MISSING_PARAMS: "Required parameters missing",
  MISSING_TOKEN_ADDRESS: "Token address required",
  INVALID_TOKEN_ADDRESS: "Invalid token address",
  MISSING_USER_ADDRESS: "User address required",
  INVALID_USER_ADDRESS: "Invalid user address",
  
  // Quote errors
  QUOTE_FAILED: "Failed to get quote",
  QUOTE_INVALID: "Invalid quote",
  QUOTE_NO_ROUTE: "No route found",
  QUOTE_EXPIRED: "Quote expired, please refresh",
  
  // Execution errors
  EXECUTE_FAILED: "Transaction failed",
  EXECUTE_INVALID_QUOTE: "Invalid quote, please refresh",
  EXECUTE_INSUFFICIENT_BALANCE: "Insufficient balance",
  EXECUTE_INSUFFICIENT_LIQUIDITY: "Insufficient liquidity",
  EXECUTE_SLIPPAGE_TOO_HIGH: "Price changed, please refresh",
  
  // Network/API errors
  NETWORK_ERROR: "Network error, please try again",
  API_ERROR: "Service temporarily unavailable",
  
  // Gas/Transaction errors
  GAS_ESTIMATE_FAILED: "Unable to estimate transaction fee",
  GAS_PRICE_FAILED: "Failed to get transaction fee",
  TRANSACTION_REVERTED: "Transaction would fail, please refresh",
} as const;

/**
 * Get user-friendly error message
 * Prioritizes API error messages, falls back to standardized messages
 */
export function getErrorMessage(
  error: string | undefined | null,
  fallback: string = ErrorMessages.EXECUTE_FAILED
): string {
  if (!error) return fallback;
  
  // Use API error if available
  if (error && error.length > 0) {
    return error;
  }
  
  return fallback;
}

/**
 * Normalize common error patterns
 */
export function normalizeError(error: string | undefined | null): string {
  if (!error) return ErrorMessages.EXECUTE_FAILED;
  
  const errorLower = error.toLowerCase();
  
  // Map common error patterns to standardized messages
  if (errorLower.includes("missing") || errorLower.includes("required")) {
    if (errorLower.includes("token")) return ErrorMessages.MISSING_TOKEN_ADDRESS;
    if (errorLower.includes("address") || errorLower.includes("user") || errorLower.includes("sender") || errorLower.includes("recipient")) {
      return ErrorMessages.MISSING_USER_ADDRESS;
    }
    return ErrorMessages.MISSING_PARAMS;
  }
  
  if (errorLower.includes("invalid")) {
    if (errorLower.includes("token")) return ErrorMessages.INVALID_TOKEN_ADDRESS;
    if (errorLower.includes("address") || errorLower.includes("user")) {
      return ErrorMessages.INVALID_USER_ADDRESS;
    }
    if (errorLower.includes("quote")) return ErrorMessages.QUOTE_INVALID;
  }
  
  if (errorLower.includes("quote") && (errorLower.includes("fail") || errorLower.includes("error"))) {
    return ErrorMessages.QUOTE_FAILED;
  }
  
  if (errorLower.includes("route") || errorLower.includes("no path")) {
    return ErrorMessages.QUOTE_NO_ROUTE;
  }
  
  if (errorLower.includes("balance") && errorLower.includes("insufficient")) {
    return ErrorMessages.EXECUTE_INSUFFICIENT_BALANCE;
  }
  
  if (errorLower.includes("liquidity") || errorLower.includes("slippage")) {
    return ErrorMessages.EXECUTE_SLIPPAGE_TOO_HIGH;
  }
  
  if (errorLower.includes("gas")) {
    if (errorLower.includes("price")) return ErrorMessages.GAS_PRICE_FAILED;
    return ErrorMessages.GAS_ESTIMATE_FAILED;
  }
  
  // Return original error if no pattern matches
  return error;
}

