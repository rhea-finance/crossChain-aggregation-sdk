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
  // Convert to lowercase for case-insensitive matching
  const errorString = errorMessage.toLowerCase();

  // Keywords that indicate user-initiated actions (keep original message)
  const userActionKeywords = [
    "user",
    "rejected",
    "cancelled",
    "cancel",
    "denied",
    "undefined",
    "null",
  ];

  // Check if error message contains any of the user action keywords
  const containsUserActionKeyword = userActionKeywords.some((keyword) =>
    errorString.includes(keyword)
  );

  // If contains user action keyword, return original message
  if (containsUserActionKeyword) {
    return errorMessage;
  }

  // Otherwise, return generic error message
  return TRANSACTION_EXECUTION_ERROR_MESSAGE;
}

/**
 * Normalize common error patterns
 */
export function normalizeError(error: string | undefined | null): string {
  if (!error) return ErrorMessages.EXECUTE_FAILED;
  
  const errorLower = error.toLowerCase();
  
  // All quote/validation errors -> QUOTE_FAILED
  if (errorLower.includes("quote") || errorLower.includes("route") || errorLower.includes("missing") || 
      errorLower.includes("required") || errorLower.includes("invalid") || errorLower.includes("balance") ||
      errorLower.includes("liquidity") || errorLower.includes("slippage") || errorLower.includes("gas") ||
      errorLower.includes("network")) {
    return ErrorMessages.QUOTE_FAILED;
  }
  
  // For other system errors, use processErrorMessage to return unified message
  return processErrorMessage(error);
}

