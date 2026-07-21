export type SwapErrorCode =
  | "HTTP_ERROR"
  | "API_ERROR"
  | "RATE_LIMITED"
  | "AUTH_FAILED"
  | "REQUEST_ABORTED"
  | "REQUEST_TIMEOUT"
  | "INVALID_REQUEST"
  | "INVALID_API_RESPONSE"
  | "QUOTE_EXPIRED"
  | "ROUTE_NOT_FOUND"
  | "EXECUTOR_NOT_FOUND"
  | "UNSUPPORTED_CHAIN"
  | "CHAIN_MISMATCH"
  | "INVALID_TRANSACTION"
  | "USER_REJECTED"
  | "INSUFFICIENT_BALANCE"
  | "APPROVAL_FAILED"
  | "SIGNING_FAILED"
  | "BROADCAST_FAILED"
  | "ORDER_SUBMIT_FAILED"
  | "ORDER_TIMEOUT"
  | "REPORT_FAILED";

export type SwapErrorStage =
  | "quote"
  | "build"
  | "approve"
  | "sign"
  | "broadcast"
  | "submit"
  | "report"
  | "status"
  | "history";

export interface SwapSdkErrorOptions {
  retryable?: boolean;
  cause?: unknown;
  details?: Record<string, unknown>;
}

export class SwapSdkError extends Error {
  readonly name = "SwapSdkError";

  constructor(
    readonly code: SwapErrorCode,
    readonly stage: SwapErrorStage,
    message: string,
    readonly options: SwapSdkErrorOptions = {}
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }

  get retryable(): boolean {
    return this.options.retryable ?? false;
  }

  get cause(): unknown {
    return this.options.cause;
  }

  get details(): Record<string, unknown> | undefined {
    return this.options.details;
  }
}

export function asSwapSdkError(
  error: unknown,
  stage: SwapErrorStage
): SwapSdkError {
  if (error instanceof SwapSdkError) return error;

  const message = error instanceof Error ? error.message : String(error);
  return new SwapSdkError("API_ERROR", stage, message, { cause: error });
}
