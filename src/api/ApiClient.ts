import { SwapSdkError, SwapErrorStage } from "../core/errors";
import {
  SwapApiResponse,
  SwapBuildDataRaw,
  SwapBuildRequestRaw,
  SwapHistoryDataRaw,
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
}

export interface ApiRequestOptions {
  signal?: AbortSignal;
}

interface RequestOptions extends ApiRequestOptions {
  method: "GET" | "POST";
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
}

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
    this.fetchImpl = fetchImpl;
  }

  quote(
    body: SwapQuoteRequestRaw,
    options: ApiRequestOptions = {}
  ): Promise<SwapQuoteDataRaw> {
    return this.request("/api/swap/quote", "quote", {
      ...options,
      method: "POST",
      body,
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
      query: {
        sender: params.sender,
        pageNumber: params.pageNumber,
        pageSize: params.pageSize,
      },
    });
  }

  private async request<T>(
    path: string,
    stage: SwapErrorStage,
    options: RequestOptions
  ): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const headers = await this.buildHeaders();
    const controller = new AbortController();
    const timeoutMs = this.config.timeoutMs ?? 15_000;
    let timedOut = false;

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
      throw new SwapSdkError("HTTP_ERROR", stage, "Network request failed", {
        cause: error,
        retryable: true,
      });
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

  private async buildHeaders(): Promise<Record<string, string>> {
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
      ...configured,
    };
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
    return (
      typeof value === "object" &&
      value !== null &&
      "code" in value &&
      typeof value.code === "number" &&
      "msg" in value &&
      typeof value.msg === "string" &&
      "data" in value
    );
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
