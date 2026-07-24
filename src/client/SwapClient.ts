import {
  ApiClient,
  type ApiClientConfig,
  type ApiRequestOptions,
} from "../api/ApiClient";
import type {
  SwapBuildDataRaw,
  SwapBuildRequestRaw,
  SwapHistoryDataRaw,
  SwapHistoryParamsRaw,
  SwapOrderStatusDataRaw,
  SwapOrderSubmitDataRaw,
  SwapQuoteDataRaw,
  SwapQuoteRequestRaw,
  SwapReportDataRaw,
  SwapReportRequestRaw,
} from "../api/rawTypes";
import { asSwapSdkError, SwapSdkError } from "../core/errors";
import {
  normalizeOrderStatus,
  type ExecuteSwapInput,
  type OrderStatusResult,
  type SwapExecutionResult,
  type SwapInput,
  type SwapLifecycleEvent,
  type SwapWarning,
  type WaitForOrderInput,
} from "../core/lifecycle";
import { ExecutorRegistry, type ChainExecutor } from "../core/registry";
import {
  createExecutionId,
  normalizeBuild,
} from "../normalizers/build";
import { normalizeQuote, serializeQuoteRequest } from "../normalizers/quote";
import { normalizeHistory } from "../normalizers/history";
import { McaSwapService } from "../mca/McaSwapService";
import type {
  McaQuote,
  McaQuoteRequest,
  McaSwapInput,
  McaSwapResult,
} from "../mca/types";
import type { SwapBuild } from "../types/execution";
import type { HistoryRequest, SwapHistoryPage } from "../types/history";
import type { Quote, QuoteRequest } from "../types/quote";

export interface SwapClientConfig extends ApiClientConfig {
  maxQuoteAgeMs?: number | null;
  reportMode?: "auto" | "manual" | "disabled";
  executors?: readonly ChainExecutor[];
  onEvent?: (event: SwapLifecycleEvent) => void;
  now?: () => number;
}

export interface BuildSwapInput {
  quote: Quote;
  signal?: AbortSignal;
  idempotencyKey?: string;
}

export class SwapClient {
  private readonly managedSwapFlow: McaSwapService;
  protected readonly api: ApiClient;
  protected readonly registry: ExecutorRegistry;
  protected readonly reportMode: "auto" | "manual" | "disabled";
  protected readonly config: SwapClientConfig;
  private readonly now: () => number;
  private readonly inFlight = new Set<string>();
  private readonly reportRequests = new Map<string, SwapReportRequestRaw>();

  constructor(config: SwapClientConfig) {
    this.config = config;
    this.api = new ApiClient(config);
    this.registry = new ExecutorRegistry(config.executors ?? []);
    this.reportMode = config.reportMode ?? "auto";
    this.now = config.now ?? Date.now;
    this.managedSwapFlow = new McaSwapService(this, {
      now: this.now,
      maxQuoteAgeMs: config.maxQuoteAgeMs,
      reportMode: this.reportMode,
      resolveSignerIdentity: (chain) => this.registry.getSigner(chain),
      resolveMessageSigner: (chain) =>
        this.registry.getSigner(chain, true),
      buildStandardSwap: (input) => this.buildStandardSwap(input),
      ...(config.onEvent ? { onEvent: config.onEvent } : {}),
    });
  }

  quoteRaw(
    request: SwapQuoteRequestRaw,
    options: ApiRequestOptions = {}
  ): Promise<SwapQuoteDataRaw> {
    return this.api.quote(request, options);
  }

  quote(
    request: McaQuoteRequest,
    options?: ApiRequestOptions
  ): Promise<McaQuote>;
  quote(request: QuoteRequest, options?: ApiRequestOptions): Promise<Quote>;
  async quote(
    request: QuoteRequest | McaQuoteRequest,
    options: ApiRequestOptions = {}
  ): Promise<Quote | McaQuote> {
    if (isMcaQuoteRequest(request)) {
      return this.managedSwapFlow.quote(request, options);
    }
    return this.quoteStandard(request, options);
  }

  private async quoteStandard(
    request: QuoteRequest,
    options: ApiRequestOptions = {}
  ): Promise<Quote> {
    const rawRequest = serializeQuoteRequest(request);

    const raw = await this.api.quote(rawRequest, options);
    return normalizeQuote(request, raw, this.now());
  }

  buildRaw(
    request: SwapBuildRequestRaw,
    options: ApiRequestOptions = {}
  ): Promise<SwapBuildDataRaw> {
    return this.api.build(request, options);
  }

  async buildSwap(input: BuildSwapInput): Promise<SwapBuild> {
    if (isMcaQuote(input.quote)) {
      return this.managedSwapFlow.build({
        quote: input.quote,
        signal: input.signal,
        idempotencyKey: input.idempotencyKey,
      });
    }
    return this.buildStandardSwap(input);
  }

  private async buildStandardSwap(input: BuildSwapInput): Promise<SwapBuild> {
    this.assertQuoteFresh(input.quote);
    const executionId = createExecutionId();
    this.emit({ type: "build-started", executionId });
    const context = input.quote.buildContext;
    const request: SwapBuildRequestRaw = {
      ...context.request,
      router: context.router,
      ...(context.market ? { market: context.market } : {}),
      expectedOut: context.expectedOut,
      minAmountOut: context.minAmountOut,
      preSwap: context.preSwap,
      bridge: context.bridge,
      ...(context.quoteId ? { quoteId: context.quoteId } : {}),
    };
    const raw = await this.api.build(request, {
      signal: input.signal,
      idempotencyKey: input.idempotencyKey,
    });
    const build = normalizeBuild(raw, executionId, request);
    this.emit({ type: "build-completed", executionId });
    return build;
  }

  async executeSwap(input: ExecuteSwapInput): Promise<SwapExecutionResult> {
    const { build } = input;
    if (this.inFlight.has(build.executionId)) {
      throw new SwapSdkError(
        "INVALID_REQUEST",
        "sign",
        `Execution ${build.executionId} is already in progress`
      );
    }

    this.inFlight.add(build.executionId);
    const emit = (event: SwapLifecycleEvent) => {
      this.emit(event);
      if (input.onEvent !== this.config.onEvent) input.onEvent?.(event);
    };

    try {
      const executor = this.registry.get(build.execution.kind);
      const context = {
        executionId: build.executionId,
        signal: input.signal,
        waitFor: input.waitFor ?? ("submitted" as const),
        emit,
        ...(input.beforeSign ? { beforeSign: input.beforeSign } : {}),
      };
      await executor.validate(build.execution, context);
      emit({ type: "signing-requested", executionId: build.executionId });
      const chainResult = await executor.execute(build.execution, context);
      let orderId = chainResult.orderId ?? build.order?.orderId;
      let orderRouter = build.order?.router;
      let orderChainId = build.order?.chainId;

      if (chainResult.signature) {
        if (build.execution.kind !== "evm-signature") {
          throw new SwapSdkError(
            "INVALID_TRANSACTION",
            "submit",
            "Only signature executions can submit signed orders"
          );
        }
        const submitParams = build.execution.request.submit?.params;
        const submitRouter =
          readNonEmptyString(submitParams?.router) ??
          build.execution.request.router;
        const submitQuoteId =
          readNonEmptyString(submitParams?.quoteId) ??
          build.execution.request.quoteId;
        const signingScheme =
          readNonEmptyString(submitParams?.signingScheme) ??
          chainResult.signingScheme ??
          build.execution.request.signingScheme ??
          "eip712";
        const submitted = await this.api.submitOrder(
          {
            router: submitRouter,
            quoteId: submitQuoteId,
            signature: chainResult.signature,
            signingScheme,
          },
          { signal: input.signal }
        );
        orderId = submitted.orderId;
        orderRouter = readNonEmptyString(submitted.router) ?? submitRouter;
        orderChainId = String(
          submitted.chainId ?? build.execution.request.chainId
        );
      }

      const result: SwapExecutionResult = {
        executionId: build.executionId,
        status: chainResult.status,
        router: build.router,
        ...(chainResult.txHash ? { txHash: chainResult.txHash } : {}),
        ...(chainResult.txHashes ? { txHashes: chainResult.txHashes } : {}),
        ...(orderId ? { orderId } : {}),
        ...(build.deposit?.depositAddress
          ? { depositAddress: build.deposit.depositAddress }
          : {}),
        report: { status: "skipped" },
        raw: chainResult.raw ?? build.raw,
      };

      if (chainResult.status === "requires-user-action") {
        emit({
          type: "requires-user-action",
          executionId: build.executionId,
        });
      } else {
        emit({
          type: "submitted",
          executionId: build.executionId,
          ...(chainResult.txHash ? { txHash: chainResult.txHash } : {}),
          ...(orderId ? { orderId } : {}),
        });
        if (chainResult.status === "source-confirmed") {
          emit({
            type: "source-confirmed",
            executionId: build.executionId,
          });
        }
      }

      const reportRequest = this.createReportRequest(build, result);
      if (reportRequest) {
        this.reportRequests.set(build.executionId, reportRequest);
      }
      if (this.reportMode === "auto" && reportRequest) {
        try {
          await this.api.report(reportRequest, { signal: input.signal });
          result.report = { status: "reported" };
        } catch (error) {
          const warning: SwapWarning = {
            code: "REPORT_FAILED",
            message: "Swap submitted but report failed",
            cause: error,
          };
          result.report = { status: "failed", warning };
          emit({ type: "warning", executionId: build.executionId, warning });
        }
      }

      if ((input.waitFor ?? "submitted") === "completed" && orderId) {
        const status = await this.waitForOrder({
          orderId,
          router: orderRouter ?? build.router,
          chainId: orderChainId,
          signal: input.signal,
        });
        result.status =
          status.status === "unknown" || status.status === "pending"
            ? "processing"
            : status.status;
        if (status.status === "completed") {
          emit({ type: "completed", executionId: build.executionId });
        }
      }

      return result;
    } catch (error) {
      const sdkError = asSwapSdkError(error, "broadcast");
      emit({ type: "failed", executionId: build.executionId, error: sdkError });
      throw sdkError;
    } finally {
      this.inFlight.delete(build.executionId);
    }
  }

  swap(input: McaSwapInput): Promise<McaSwapResult>;
  swap(input: SwapInput): Promise<SwapExecutionResult>;
  async swap(
    input: SwapInput | McaSwapInput
  ): Promise<SwapExecutionResult | McaSwapResult> {
    if (isMcaQuote(input.quote)) {
      return this.managedSwapFlow.swap(input as McaSwapInput);
    }
    const regularInput = input as SwapInput;
    const build = await this.buildSwap({
      quote: regularInput.quote,
      signal: regularInput.signal,
      idempotencyKey: regularInput.idempotencyKey,
    });
    return this.executeSwap({
      build,
      waitFor: regularInput.waitFor,
      signal: regularInput.signal,
      onEvent: regularInput.onEvent,
      beforeSign: regularInput.beforeSign,
    });
  }

  async getOrderStatus(
    input: {
      orderId: string;
      router: string;
      chainId?: string;
      signal?: AbortSignal;
    }
  ): Promise<OrderStatusResult> {
    const raw = await this.api.getOrderStatus(
      {
        orderId: input.orderId,
        router: input.router,
        chainId: input.chainId,
      },
      { signal: input.signal }
    );
    return {
      orderId: input.orderId,
      router: input.router,
      status: normalizeOrderStatus(raw),
      raw,
    };
  }

  async waitForOrder(input: WaitForOrderInput): Promise<OrderStatusResult> {
    const intervalMs = input.intervalMs ?? 5_000;
    const timeoutMs = input.timeoutMs ?? 250_000;
    const startedAt = this.now();

    for (;;) {
      if (input.signal?.aborted) {
        throw new SwapSdkError(
          "REQUEST_ABORTED",
          "status",
          "Order polling aborted; any submitted transaction is unaffected"
        );
      }
      const result = await this.getOrderStatus(input);
      if (
        result.status === "completed" ||
        result.status === "failed" ||
        result.status === "refunded" ||
        result.status === "expired"
      ) {
        return result;
      }
      if (this.now() - startedAt >= timeoutMs) {
        throw new SwapSdkError(
          "ORDER_TIMEOUT",
          "status",
          `Order status timed out after ${timeoutMs}ms`,
          { retryable: true }
        );
      }
      await delay(intervalMs, input.signal);
    }
  }

  submitOrderRaw(
    request: Parameters<ApiClient["submitOrder"]>[0],
    options: ApiRequestOptions = {}
  ): Promise<SwapOrderSubmitDataRaw> {
    return this.api.submitOrder(request, options);
  }

  getOrderStatusRaw(
    request: Parameters<ApiClient["getOrderStatus"]>[0],
    options: ApiRequestOptions = {}
  ): Promise<SwapOrderStatusDataRaw> {
    return this.api.getOrderStatus(request, options);
  }

  reportRaw(
    request: SwapReportRequestRaw,
    options: ApiRequestOptions = {}
  ): Promise<SwapReportDataRaw> {
    return this.api.report(request, options);
  }

  report(result: SwapExecutionResult): Promise<SwapReportDataRaw> {
    const managedReport = this.managedSwapFlow.reportIfManaged(result);
    if (managedReport) return managedReport;
    const request = this.reportRequests.get(result.executionId);
    if (!request) {
      throw new SwapSdkError(
        "INVALID_REQUEST",
        "report",
        `No report context for execution ${result.executionId}`
      );
    }
    return this.api.report(request);
  }

  retryReport(result: SwapExecutionResult): Promise<SwapReportDataRaw> {
    return this.report(result);
  }

  getHistoryRaw(
    params: SwapHistoryParamsRaw,
    options: ApiRequestOptions = {}
  ): Promise<SwapHistoryDataRaw> {
    return this.api.getHistory(params, options);
  }

  async getHistory(
    request: HistoryRequest,
    options: ApiRequestOptions = {}
  ): Promise<SwapHistoryPage> {
    const raw = await this.api.getHistory(
      {
        sender: request.sender,
        ...(request.page !== undefined ? { pageNumber: request.page } : {}),
        ...(request.pageSize !== undefined ? { pageSize: request.pageSize } : {}),
      },
      options
    );
    const page = normalizeHistory(raw);
    if (request.status === undefined) return page;

    const statuses = new Set(request.status);
    return {
      ...page,
      items: page.items.filter((item) => statuses.has(item.status)),
      filteredLocally: true,
    };
  }

  protected emit(event: SwapLifecycleEvent): void {
    this.config.onEvent?.(event);
  }

  private assertQuoteFresh(quote: Quote): void {
    const now = this.now();
    const maxAge =
      this.config.maxQuoteAgeMs === undefined
        ? 30_000
        : this.config.maxQuoteAgeMs;
    const expiredByApi = quote.expiresAt !== undefined && now > quote.expiresAt;
    const expiredByAge =
      maxAge !== null && now - quote.receivedAt > Math.max(0, maxAge);
    if (expiredByApi || expiredByAge) {
      throw new SwapSdkError(
        "QUOTE_EXPIRED",
        "build",
        "Quote has expired; request a fresh quote"
      );
    }
  }

  private createReportRequest(
    build: SwapBuild,
    result: SwapExecutionResult
  ): SwapReportRequestRaw | undefined {
    const request = build.request;
    const reportContext = build.reportContext;
    const fromHash =
      reportContext?.fromHash ?? result.txHash ?? result.orderId;
    if (!request || !fromHash) return undefined;

    return {
      sender: reportContext?.sender ?? request.sender,
      recipient:
        reportContext?.recipient ?? request.recipient ?? request.sender,
      from_hash: fromHash,
      from_token: request.tokenIn,
      to_token: request.tokenOut,
      deposit_address:
        reportContext?.depositAddress ?? result.depositAddress ?? "",
      from_chain: request.fromChain,
      to_chain: request.toChain,
      is_cross_chain:
        reportContext?.isCrossChain ?? build.isCrossChain,
      amount_in: request.amountIn,
      estimated_out: build.estimatedOut,
      router: build.router,
      tx_type:
        reportContext?.txType ??
        (build.isCrossChain ? "cross-chain" : "same-chain"),
      ...(reportContext?.multiAddr
        ? { multi_addr: reportContext.multiAddr }
        : {}),
      ...(reportContext?.swapId ?? result.orderId
        ? { swapId: reportContext?.swapId ?? result.orderId }
        : {}),
    };
  }
}

function isMcaQuoteRequest(
  request: QuoteRequest | McaQuoteRequest
): request is McaQuoteRequest {
  if (!("flow" in request) || !("mcaAccountId" in request)) return false;
  const flow = Reflect.get(request, "flow");
  const accountId = Reflect.get(request, "mcaAccountId");
  return (
    (flow === "deposit" || flow === "withdraw") &&
    typeof accountId === "string" &&
    accountId.trim().length > 0
  );
}

function isMcaQuote(quote: Quote): quote is McaQuote {
  if (!("executionMode" in quote) || !("mcaAccountId" in quote)) {
    return false;
  }
  const mode = Reflect.get(quote, "executionMode");
  return (
    mode === "deposit" ||
    mode === "withdraw-near" ||
    mode === "withdraw-relayer"
  );
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(
        new SwapSdkError(
          "REQUEST_ABORTED",
          "status",
          "Order polling aborted; any submitted transaction is unaffected"
        )
      );
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      reject(
        new SwapSdkError(
          "REQUEST_ABORTED",
          "status",
          "Order polling aborted; any submitted transaction is unaffected"
        )
      );
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, ms));
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
