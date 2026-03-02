/**
 * Unified error messages for the SDK
 * All error messages should be defined here for consistency
 */

export const TRANSACTION_EXECUTION_ERROR_MESSAGE =
  "Transaction execution error occurred. Please contact support";

export const ErrorMessages = {
  // Quote errors
  QUOTE_FAILED: "Failed to get quote",
  
  // Execution errors
  EXECUTE_FAILED: "Transaction failed",
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
 * Process error message to determine if it's a user action or system error
 * Returns original message for user actions, unified message for system errors
 */
export function processErrorMessage(errorMessage: string): string {
  const errorString = errorMessage.toLowerCase();

  const userActionKeywords = [
    "user",
    "rejected",
    "cancelled",
    "cancel",
    "denied",
    "undefined",
    "null",
  ];

  const containsUserActionKeyword = userActionKeywords.some((keyword) =>
    errorString.includes(keyword)
  );

  if (containsUserActionKeyword) {
    return errorMessage;
  }

  return TRANSACTION_EXECUTION_ERROR_MESSAGE;
}

/**
 * Normalize error for Intents API only
 */
export function normalizeErrorForIntents(error: string | undefined | null): string {
  if (!error) return ErrorMessages.QUOTE_FAILED;
  
  const errorLower = error.toLowerCase();
  
  if (
    errorLower.includes("quote") ||
    errorLower.includes("route") ||
    errorLower.includes("missing") ||
    errorLower.includes("required") ||
    errorLower.includes("invalid") ||
    errorLower.includes("balance") ||
    errorLower.includes("liquidity") ||
    errorLower.includes("gas") ||
    errorLower.includes("network")
  ) {
    return ErrorMessages.QUOTE_FAILED;
  }
  
  return processErrorMessage(error);
}

/**
 * Normalize common error patterns
 */
export function normalizeError(error: string | undefined | null): string {
  if (!error) return ErrorMessages.EXECUTE_FAILED;
  
  return error;
}

/**
 * Format error message for intents API errors
 * Simplified version that preserves detailed error messages while applying common formatting rules
 */
export function formatErrorMessage({
  error,
  fallbackMessage,
  originAsset,
  friendly,
}: {
  error?: any;
  fallbackMessage?: string;
  originAsset?: string;
  friendly?: boolean;
}): string {
  let messageStr: string = "";
  if (error) {
    if (typeof error === "string") {
      messageStr = error;
    } else if (typeof error === "object") {
      messageStr = error?.message || error?.error || JSON.stringify(error);
    } else {
      messageStr = String(error);
    }
  }
  if (!messageStr || messageStr === "null" || messageStr === "undefined") {
    messageStr =
      fallbackMessage ||
      "Transaction execution error occurred. Please contact support";
  }

  if (messageStr?.includes("low") && originAsset) {
    return "Amount is too low for bridge.";
  } else if (messageStr?.includes("(")) {
    const index = messageStr.indexOf("(");
    return friendly
      ? processErrorMessage(messageStr.slice(0, index))
      : messageStr.slice(0, index);
  } else if (
    messageStr?.includes("timed out") ||
    messageStr?.includes("not allowed")
  ) {
    return "transaction has been cancelled";
  } else if (
    (messageStr?.toLowerCase().includes("tokenin") ||
      messageStr?.toLowerCase().includes("tokenout")) &&
    messageStr?.toLowerCase().includes("not valid")
  ) {
    return "Failed to get quote";
  } else if (
    messageStr?.toLowerCase().includes("liquidity") &&
    messageStr?.toLowerCase().includes("available")
  ) {
    return "Failed to get quote";
  }
  return friendly ? processErrorMessage(messageStr) : messageStr;
}
