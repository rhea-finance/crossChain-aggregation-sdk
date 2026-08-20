import { SwapSdkError, SwapErrorStage } from "../core/errors";
import type { SdkLogEntry, SdkLogger } from "../core/logger";
import {
  SwapApiResponse,
  SwapBuildDataRaw,
  SwapBuildRequestRaw,
  SwapHistoryDataRaw,
  SwapHistoryAuthChallengeRaw,
  SwapHistoryAuthChallengeRequestRaw,
  SwapHistoryAuthTokenRaw,
  SwapHistoryAuthVerifyRequestRaw,
  SwapHistoryParamsRaw,
  SwapOrderStatusDataRaw,
  SwapOrderStatusParamsRaw,
  SwapOrderSubmitDataRaw,
  SwapOrderSubmitRequestRaw,
  SwapQuoteDataRaw,
  SwapQuoteRequestRaw,
  SwapReportDataRaw,
  SwapReportRequestRaw,
} from "./rawTypes";

export interface ApiClientConfig {
  baseUrl: string;
  apiKey?: string;
  getAccessToken?: () => string | Promise<string>;
  fetch?: typeof globalThis.fetch;
  headers?:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>);
  timeoutMs?: number;
  retry?: Partial<RetryConfig>;
  logger?: SdkLogger;
}

export interface ApiRequestOptions {
  signal?: AbortSignal;
  idempotencyKey?: string;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
}

interface RequestOptions extends ApiRequestOptions {
  method: "GET" | "POST";
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  retryableOperation?: boolean;
  authenticationToken?: string;
}

interface NetworkFailureDetails extends Record<string, unknown> {
  method: RequestOptions["method"];
  path: string;
  attempt: number;
  causeName: string;
  causeMessage: string;
}

const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 2,
  baseDelayMs: 250,
  maxDelayMs: 2_000,
  jitter: true,
};

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(private readonly config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    const fetchImpl = config.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new SwapSdkError(
        "INVALID_REQUEST",
        "quote",
        "Fetch is unavailable; inject fetch when using Node.js 16"
      );
    }
    this.fetchImpl = fetchImpl.bind(globalThis);
  }

  quote(
    body: SwapQuoteRequestRaw,
    options: ApiRequestOptions = {}
  ): Promise<SwapQuoteDataRaw> {
    return this.request("/api/swap/quote", "quote", {
      ...options,
      method: "POST",
      body,
      retryableOperation: true,
    });
  }

  build(
    body: SwapBuildRequestRaw,
    options: ApiRequestOptions = {}
  ): Promise<SwapBuildDataRaw> {
    return this.request("/api/swap/swap", "build", {
      ...options,
      method: "POST",
      body,
    });
  }

  submitOrder(
    body: SwapOrderSubmitRequestRaw,
    options: ApiRequestOptions = {}
  ): Promise<SwapOrderSubmitDataRaw> {
    return this.request("/api/swap/order-submit", "submit", {
      ...options,
      method: "POST",
      body,
    });
  }

  getOrderStatus(
    params: SwapOrderStatusParamsRaw,
    options: ApiRequestOptions = {}
  ): Promise<SwapOrderStatusDataRaw> {
    return this.request("/api/swap/order-status", "status", {
      ...options,
      method: "GET",
      retryableOperation: true,
      query: {
        orderId: params.orderId,
        router: params.router,
        chainId: params.chainId,
      },
    });
  }

  report(
    body: SwapReportRequestRaw,
    options: ApiRequestOptions = {}
  ): Promise<SwapReportDataRaw> {
    return this.request("/api/swap/report", "report", {
      ...options,
      method: "POST",
      body,
    });
  }

  getHistory(
    params: SwapHistoryParamsRaw,
    options: ApiRequestOptions = {}
  ): Promise<SwapHistoryDataRaw> {
    return this.request("/api/swap/history", "history", {
      ...options,
      method: "GET",
      retryableOperation: true,
      query: {
        sender: params.sender,
        mode: params.mode,
        pageNumber: params.pageNumber,
        pageSize: params.pageSize,
      },
      ...(params.mode === "confidential" && params.walletToken
        ? { authenticationToken: params.walletToken }
        : {}),
    });
  }

  createHistoryAuthChallenge(
    body: SwapHistoryAuthChallengeRequestRaw,
    options: ApiRequestOptions = {}
  ): Promise<SwapHistoryAuthChallengeRaw> {
    return this.request("/api/swap/history/auth/challenge", "history", {
      ...options,
      method: "POST",
      body,
    });
  }

  verifyHistoryAuthChallenge(
    body: SwapHistoryAuthVerifyRequestRaw,
    options: ApiRequestOptions = {}
  ): Promise<SwapHistoryAuthTokenRaw> {
    return this.request("/api/swap/history/auth/verify", "history", {
      ...options,
      method: "POST",
      body,
    });
  }

  private async request<T>(
    path: string,
    stage: SwapErrorStage,
    options: RequestOptions
  ): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const headers = await this.buildHeaders(
      options.idempotencyKey,
      options.authenticationToken
    );
    const retry = this.retryConfig();
    let attempt = 1;

    for (;;) {
      this.log({
        level: "debug",
        event: "api.request",
        path,
        stage,
        attempt,
      });
      try {
        return await this.requestOnce<T>(url, path, stage, options, headers, attempt);
      } catch (error) {
        const sdkError =
          error instanceof SwapSdkError
            ? error
            : new SwapSdkError("HTTP_ERROR", stage, "Network request failed", {
                cause: error,
                retryable: true,
              });
        const canRetry =
          options.retryableOperation === true &&
          sdkError.retryable &&
          sdkError.code !== "REQUEST_ABORTED" &&
          attempt <= retry.maxRetries;
        if (!canRetry) throw sdkError;

        this.log({
          level: "warn",
          event: "api.retry",
          path,
          stage,
          attempt,
          code: sdkError.code,
        });
        await waitForRetry(this.retryDelay(attempt, retry), options.signal, stage);
        attempt += 1;
      }
    }
  }

  private async requestOnce<T>(
    url: string,
    path: string,
    stage: SwapErrorStage,
    options: RequestOptions,
    headers: Record<string, string>,
    attempt: number
  ): Promise<T> {
    if (options.signal?.aborted) {
      throw new SwapSdkError("REQUEST_ABORTED", stage, "Request aborted", {
        cause: options.signal.reason,
      });
    }
    const controller = new AbortController();
    const timeoutMs = this.config.timeoutMs ?? 15_000;
    let timedOut = false;
    const startedAt = Date.now();

    const abortFromCaller = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abortFromCaller();
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });

    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: options.method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        throw new SwapSdkError(
          timedOut ? "REQUEST_TIMEOUT" : "REQUEST_ABORTED",
          stage,
          timedOut ? `Request timed out after ${timeoutMs}ms` : "Request aborted",
          { retryable: timedOut }
        );
      }
      this.log({
        level: "debug",
        event: "api.response",
        path,
        stage,
        attempt,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      const text = await response.text();
      const parsed = this.parseResponse(text, response.status, stage);

      if (!response.ok) {
        const message = this.readMessage(parsed) || `HTTP ${response.status}`;
        if (response.status === 401 || response.status === 403) {
          throw new SwapSdkError("AUTH_FAILED", stage, message);
        }
        if (response.status === 429) {
          throw new SwapSdkError("RATE_LIMITED", stage, message, {
            retryable: true,
          });
        }
        throw new SwapSdkError("HTTP_ERROR", stage, message, {
          retryable: response.status >= 500,
          details: { status: response.status },
        });
      }

      if (!this.isEnvelope(parsed)) {
        throw new SwapSdkError(
          "INVALID_API_RESPONSE",
          stage,
          "Invalid unified swap API response envelope"
        );
      }

      if (parsed.code !== 0) {
        throw new SwapSdkError(
          "API_ERROR",
          stage,
          parsed.msg || `Service returned code ${parsed.code}`,
          { details: { apiCode: parsed.code } }
        );
      }

      return parsed.data as T;
    } catch (error) {
      if (error instanceof SwapSdkError) throw error;
      if (controller.signal.aborted) {
        throw new SwapSdkError(
          timedOut ? "REQUEST_TIMEOUT" : "REQUEST_ABORTED",
          stage,
          timedOut ? `Request timed out after ${timeoutMs}ms` : "Request aborted",
          { cause: error, retryable: timedOut }
        );
      }
      const details = networkFailureDetails(
        error,
        options.method,
        path,
        attempt
      );
      console.error("SDK network request failed", {
        ...details,
        stage,
      });
      throw new SwapSdkError(
        "HTTP_ERROR",
        stage,
        `Network request failed: ${details.causeName}: ${details.causeMessage}`,
        {
          cause: error,
          retryable: true,
          details,
        }
      );
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | undefined | null>
  ): string {
    if (!query) return `${this.baseUrl}${path}`;

    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      search.set(key, String(value));
    }
    const suffix = search.toString();
    return suffix ? `${this.baseUrl}${path}?${suffix}` : `${this.baseUrl}${path}`;
  }

  private async buildHeaders(
    idempotencyKey?: string,
    authenticationToken?: string
  ): Promise<Record<string, string>> {
    const configured =
      typeof this.config.headers === "function"
        ? await this.config.headers()
        : this.config.headers ?? {};
    const token = this.config.getAccessToken
      ? await this.config.getAccessToken()
      : this.config.apiKey;

    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(authenticationToken
        ? { Authentication: `Bearer ${authenticationToken}` }
        : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      ...configured,
    };
  }

  private retryConfig(): RetryConfig {
    const configured = { ...DEFAULT_RETRY, ...this.config.retry };
    if (
      !Number.isSafeInteger(configured.maxRetries) ||
      configured.maxRetries < 0 ||
      !Number.isFinite(configured.baseDelayMs) ||
      configured.baseDelayMs < 0 ||
      !Number.isFinite(configured.maxDelayMs) ||
      configured.maxDelayMs < configured.baseDelayMs
    ) {
      throw new SwapSdkError(
        "INVALID_REQUEST",
        "quote",
        "Invalid retry configuration"
      );
    }
    return configured;
  }

  private retryDelay(attempt: number, retry: RetryConfig): number {
    const exponential = Math.min(
      retry.maxDelayMs,
      retry.baseDelayMs * 2 ** (attempt - 1)
    );
    return retry.jitter
      ? Math.min(retry.maxDelayMs, exponential * (0.5 + Math.random()))
      : exponential;
  }

  private log(entry: SdkLogEntry): void {
    try {
      this.config.logger?.log(entry);
    } catch {
      // Application logging must never change SDK behavior.
    }
  }

  private parseResponse(
    text: string,
    status: number,
    stage: SwapErrorStage
  ): unknown {
    try {
      return text ? JSON.parse(text) : {};
    } catch (error) {
      throw new SwapSdkError(
        status >= 400 ? "HTTP_ERROR" : "INVALID_API_RESPONSE",
        stage,
        status >= 400 ? `HTTP ${status}` : "Response is not valid JSON",
        { cause: error, retryable: status >= 500 }
      );
    }
  }

  private isEnvelope(value: unknown): value is SwapApiResponse<unknown> {
    if (typeof value !== "object" || value === null) return false;
    if (!("code" in value) || typeof value.code !== "number") return false;
    if (!("msg" in value) || typeof value.msg !== "string") return false;
    // Successful responses must include `data`. Error envelopes from the
    // service sometimes omit it (only `{ code, msg }`), which is still valid.
    if (value.code === 0 && !("data" in value)) return false;
    return true;
  }

  private readMessage(value: unknown): string | undefined {
    if (typeof value !== "object" || value === null || !("msg" in value)) {
      return undefined;
    }
    return typeof value.msg === "string" && value.msg.trim()
      ? value.msg.trim()
      : undefined;
  }
}

function networkFailureDetails(
  error: unknown,
  method: RequestOptions["method"],
  path: string,
  attempt: number
): NetworkFailureDetails {
  const causeName =
    error instanceof Error && error.name.trim() ? error.name.trim() : "Error";
  const rawMessage =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : String(error);
  const causeMessage = rawMessage.replace(
    /\b(https?:\/\/[^\s?#]+)\?[^\s#]*/gi,
    "$1?[redacted]"
  );

  return {
    method,
    path,
    attempt,
    causeName,
    causeMessage,
  };
}

function waitForRetry(
  delayMs: number,
  signal: AbortSignal | undefined,
  stage: SwapErrorStage
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        new SwapSdkError("REQUEST_ABORTED", stage, "Request aborted", {
          cause: signal.reason,
        })
      );
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      reject(
        new SwapSdkError("REQUEST_ABORTED", stage, "Request aborted", {
          cause: signal?.reason,
        })
      );
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
