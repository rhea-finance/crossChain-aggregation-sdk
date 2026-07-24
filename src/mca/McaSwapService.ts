import type { ApiRequestOptions } from "../api/ApiClient";
import type {
  SwapReportRequestRaw,
  SwapMcaRelayerRequestRaw,
} from "../api/rawTypes";
import type { SwapClient } from "../client/SwapClient";
import { asSwapSdkError, SwapSdkError } from "../core/errors";
import type {
  SwapLifecycleEvent,
  SwapWarning,
} from "../core/lifecycle";
import type {
  ExecutorIdentityProvider,
  ExecutorMessageSigner,
} from "../core/registry";
import { createExecutionId, normalizeBuild } from "../normalizers/build";
import { normalizeQuote } from "../normalizers/quote";
import type { SwapBuild } from "../types/execution";
import type { Quote, QuoteRequest } from "../types/quote";
import { normalizeMcaQuote, serializeMcaQuoteRequest } from "./quote";
import { formatMcaWallet, isSameMcaSignerIdentity } from "./signers";
import type {
  McaQuote,
  McaQuoteRequest,
  McaSignerIdentity,
  McaSwapInput,
  McaSwapResult,
} from "./types";
import {
  buildMcaWithdrawRelayerRequest,
  buildNearMcaWithdrawTransactions,
  extractMcaWithdrawBusiness,
  extractMcaWithdrawDepositAddress,
  extractMcaWithdrawSignerWallet,
} from "./withdraw";

export interface McaSwapServiceConfig {
  now?: () => number;
  maxQuoteAgeMs?: number | null;
  reportMode?: "auto" | "manual" | "disabled";
  onEvent?: (event: SwapLifecycleEvent) => void;
  resolveSignerIdentity(
    chain: McaSignerIdentity["chain"]
  ): ExecutorIdentityProvider;
  resolveMessageSigner(
    chain: McaSignerIdentity["chain"]
  ): ExecutorMessageSigner;
  buildStandardSwap(input: {
    quote: Quote;
    signal?: AbortSignal;
    idempotencyKey?: string;
  }): Promise<SwapBuild>;
}

export class McaSwapService {
  private readonly now: () => number;
  private readonly maxQuoteAgeMs: number | null;
  private readonly reportMode: "auto" | "manual" | "disabled";
  private readonly onEvent?: (event: SwapLifecycleEvent) => void;
  private readonly resolveSignerIdentity: McaSwapServiceConfig["resolveSignerIdentity"];
  private readonly resolveMessageSigner: McaSwapServiceConfig["resolveMessageSigner"];
  private readonly buildStandardSwap: McaSwapServiceConfig["buildStandardSwap"];
  private readonly relayerReports = new Map<string, SwapReportRequestRaw>();

  constructor(
    private readonly client: SwapClient,
    config: McaSwapServiceConfig
  ) {
    this.now = config.now ?? Date.now;
    this.maxQuoteAgeMs =
      config.maxQuoteAgeMs === undefined ? 30_000 : config.maxQuoteAgeMs;
    this.reportMode = config.reportMode ?? "auto";
    this.onEvent = config.onEvent;
    this.resolveSignerIdentity = config.resolveSignerIdentity;
    this.resolveMessageSigner = config.resolveMessageSigner;
    this.buildStandardSwap = config.buildStandardSwap;
  }

  async quote(
    request: McaQuoteRequest,
    options: ApiRequestOptions = {}
  ): Promise<McaQuote> {
    const signer = await this.readSignerIdentity(request.signerChain, "quote");
    const rawRequest = serializeMcaQuoteRequest(request, signer);
    const raw = await this.client.quoteRaw(rawRequest, options);
    const normalizationRequest: QuoteRequest = {
      ...request,
      extensions: {
        ...(request.extensions ?? {}),
        mca: rawRequest.mca,
      },
    };
    const quote = normalizeQuote(normalizationRequest, raw, this.now());
    return normalizeMcaQuote(request, signer, quote);
  }

  async build(input: {
    quote: McaQuote;
    signal?: AbortSignal;
    idempotencyKey?: string;
  }): Promise<SwapBuild> {
    this.assertQuoteFresh(input.quote);
    if (input.quote.executionMode === "withdraw-relayer") {
      throw new SwapSdkError(
        "INVALID_REQUEST",
        "build",
        "MCA relayer withdraw requires a signature and must use swap()"
      );
    }
    const build =
      input.quote.executionMode === "deposit"
        ? await this.buildStandardSwap(input)
        : this.buildNearWithdraw(input.quote);
    return {
      ...build,
      reportContext: {
        ...build.reportContext,
        multiAddr: input.quote.mcaAccountId,
        ...(input.quote.executionMode === "deposit"
          ? {
              txType: build.isCrossChain ? "cross-chain" : "same-chain",
            }
          : {}),
      },
    };
  }

  async swap(input: McaSwapInput): Promise<McaSwapResult> {
    this.assertQuoteFresh(input.quote);
    if (input.quote.executionMode === "withdraw-relayer") {
      return this.executeRelayerWithdraw({ ...input, quote: input.quote });
    }
    const build = await this.build({
      quote: input.quote,
      signal: input.signal,
      idempotencyKey: input.idempotencyKey,
    });
    const nearStatusKey =
      input.quote.executionMode === "withdraw-near" &&
      input.waitFor === "completed"
        ? extractMcaWithdrawDepositAddress({
            preview: input.quote.preview,
            bestQuote: input.quote.raw.bestQuote,
          })
        : undefined;
    if (
      input.quote.executionMode === "withdraw-near" &&
      input.waitFor === "completed" &&
      !nearStatusKey
    ) {
      throw new SwapSdkError(
        "INVALID_API_RESPONSE",
        "status",
        "MCA NEAR withdraw is missing a status deposit address"
      );
    }
    const result = await this.client.executeSwap({
      build,
      waitFor:
        input.quote.executionMode === "withdraw-near" &&
        input.waitFor === "completed"
          ? "source-confirmed"
          : input.waitFor,
      signal: input.signal,
      onEvent: input.onEvent,
    });
    if (
      input.quote.executionMode === "withdraw-near" &&
      input.waitFor === "completed"
    ) {
      const status = await this.client.waitForOrder({
        orderId: nearStatusKey!,
        router: input.quote.route.router,
        signal: input.signal,
      });
      this.emitEvent(
        {
          type: "order-status",
          executionId: result.executionId,
          status: status.status,
        },
        input.onEvent
      );
      result.status =
        status.status === "unknown" || status.status === "pending"
          ? "processing"
          : status.status;
      if (status.status === "completed") {
        this.emitEvent(
          { type: "completed", executionId: result.executionId },
          input.onEvent
        );
      }
    }
    return result;
  }

  reportIfManaged(
    result: McaSwapResult
  ): Promise<import("../api/rawTypes").SwapReportDataRaw> | undefined {
    const request = this.relayerReports.get(result.executionId);
    if (!request) return undefined;
    return this.client.reportRaw(request);
  }

  private buildNearWithdraw(
    quote: Extract<McaQuote, { executionMode: "withdraw-near" }>
  ): SwapBuild {
    const business = extractMcaWithdrawBusiness(quote.preview);
    if (!business) {
      throw new SwapSdkError(
        "INVALID_API_RESPONSE",
        "build",
        "MCA NEAR withdraw preview is missing business"
      );
    }
    const recipient = quote.request.recipient?.trim();
    const signerWallet =
      extractMcaWithdrawSignerWallet(quote.preview) ??
      (recipient ? formatMcaWallet("near", recipient) : undefined);
    if (!signerWallet) {
      throw new SwapSdkError(
        "INVALID_REQUEST",
        "build",
        "MCA NEAR withdraw requires a NEAR recipient or signer_wallet"
      );
    }
    const transactions = buildNearMcaWithdrawTransactions(quote.preview, {
      business,
      signerWallet,
      signature: "",
      mcaAccountId: quote.mcaAccountId,
    });
    const request = buildRequestFromQuote(quote);
    const depositAddress = extractMcaWithdrawDepositAddress({
      preview: quote.preview,
      bestQuote: quote.raw.bestQuote,
    });
    const build = normalizeBuild(
      {
        isCrossChain: true,
        chainType: "near",
        router: quote.route.router,
        fromChain: request.fromChain,
        toChain: request.toChain,
        tokenIn: {
          address: request.tokenIn,
          symbol: quote.tokenIn.symbol ?? "",
          decimals: quote.tokenIn.decimals ?? 0,
        },
        tokenOut: {
          address: request.tokenOut,
          symbol: quote.tokenOut.symbol ?? "",
          decimals: quote.tokenOut.decimals ?? 0,
        },
        amountIn: quote.amountIn,
        estimatedOut: quote.estimatedOut,
        minAmountOut: quote.minAmountOut,
        tx: transactions,
        approve: null,
        ...(depositAddress
          ? { deposit: { depositAddress } }
          : {}),
      },
      undefined,
      request
    );
    return {
      ...build,
      reportContext: {
        txType: "mca-withdraw-near",
        multiAddr: quote.mcaAccountId,
        ...(depositAddress ? { depositAddress } : {}),
        ...(recipient ? { recipient } : {}),
        isCrossChain: true,
      },
    };
  }

  private async executeRelayerWithdraw(
    input: McaSwapInput & {
      quote: Extract<McaQuote, { executionMode: "withdraw-relayer" }>;
    }
  ): Promise<McaSwapResult> {
    const executionId = createExecutionId();
    const emit = (event: SwapLifecycleEvent) =>
      this.emitEvent(event, input.onEvent);

    try {
      const signer = this.resolveMessageSigner(input.quote.signer.chain);
      const currentSigner = await this.readSignerIdentity(
        input.quote.signer.chain,
        "sign",
        signer
      );
      assertSignerMatchesQuote(currentSigner, input.quote.signer);
      const business = extractMcaWithdrawBusiness(input.quote.preview);
      if (!business) {
        throw new SwapSdkError(
          "INVALID_API_RESPONSE",
          "sign",
          "MCA relayer preview is missing business"
        );
      }
      const message = readString(input.quote.preview.messageToSign);
      if (!message) {
        throw new SwapSdkError(
          "INVALID_API_RESPONSE",
          "sign",
          "MCA relayer preview is missing messageToSign"
        );
      }
      const depositAddress = extractMcaWithdrawDepositAddress({
        snapshotDepositAddress: readString(input.quote.raw.depositAddress),
        preview: input.quote.preview,
        bestQuote: input.quote.raw.bestQuote,
      });
      if (!depositAddress) {
        throw new SwapSdkError(
          "INVALID_API_RESPONSE",
          "build",
          "MCA relayer preview is missing a deposit address"
        );
      }

      emit({ type: "signing-requested", executionId });
      await input.beforeSign?.({
        chain: currentSigner.chain,
        identityKey: currentSigner.identityKey,
        message,
        business,
      });
      let signature: string;
      try {
        signature = (
          await signer.signMessage(message, {
            signal: input.signal,
            context: {
              flow: "withdraw",
              mcaAccountId: input.quote.mcaAccountId,
              business,
            },
          })
        ).trim();
      } catch (error) {
        if (error instanceof SwapSdkError) throw error;
        throw new SwapSdkError(
          "SIGNING_FAILED",
          "sign",
          "Failed to sign the MCA relayer message",
          { cause: error }
        );
      }
      if (!signature) {
        throw new SwapSdkError(
          "SIGNING_FAILED",
          "sign",
          "MCA signer returned an empty signature"
        );
      }

      const mcaRelayer: SwapMcaRelayerRequestRaw = {
        mcaAccountId: input.quote.mcaAccountId,
        wallet: formatMcaWallet(
          currentSigner.chain,
          currentSigner.identityKey
        ),
        business,
        signature,
      };
      const request = buildMcaWithdrawRelayerRequest({
        quoteBuild: buildRequestFromQuote(input.quote),
        mcaRelayer,
        isCrossChain: input.quote.raw.isCrossChain ?? true,
        depositAddress,
        mcaAccountId: input.quote.mcaAccountId,
        recipientFallback: input.quote.request.recipient,
      });
      const raw = await this.client.buildRaw(request, {
        signal: input.signal,
        idempotencyKey: input.idempotencyKey,
      });
      const orderId =
        readString(raw.orderId) ?? readRecordString(raw.deposit, "orderId");
      const router = readString(raw.router) ?? input.quote.route.router;
      const submittedDepositAddress =
        readRecordString(raw.deposit, "depositAddress") ?? depositAddress;
      if (!orderId || !router) {
        throw new SwapSdkError(
          "INVALID_API_RESPONSE",
          "submit",
          "MCA relayer submission is missing orderId or router"
        );
      }

      const reportRequest: SwapReportRequestRaw = {
        sender: input.quote.request.sender,
        recipient:
          input.quote.request.recipient ?? input.quote.request.sender,
        from_hash: orderId,
        from_token: request.tokenIn,
        to_token: request.tokenOut,
        deposit_address: submittedDepositAddress,
        from_chain: request.fromChain,
        to_chain: request.toChain,
        amount_in: request.amountIn,
        estimated_out: input.quote.estimatedOut,
        router,
        is_cross_chain: true,
        tx_type: "mca-withdraw-relayer",
        multi_addr: input.quote.mcaAccountId,
        swapId: orderId,
      };
      this.relayerReports.set(executionId, reportRequest);
      const result: McaSwapResult = {
        executionId,
        status: "submitted",
        router,
        orderId,
        depositAddress: submittedDepositAddress,
        report: { status: "skipped" },
        raw,
      };
      emit({ type: "submitted", executionId, orderId });

      if (this.reportMode === "auto") {
        try {
          await this.client.reportRaw(reportRequest, { signal: input.signal });
          result.report = { status: "reported" };
        } catch (error) {
          const warning: SwapWarning = {
            code: "REPORT_FAILED",
            message: "MCA withdraw submitted but report failed",
            cause: error,
          };
          result.report = { status: "failed", warning };
          emit({ type: "warning", executionId, warning });
        }
      }

      if (input.waitFor === "completed") {
        const status = await this.client.waitForOrder({
          orderId,
          router,
          signal: input.signal,
        });
        emit({ type: "order-status", executionId, status: status.status });
        result.status =
          status.status === "unknown" || status.status === "pending"
            ? "processing"
            : status.status;
        if (status.status === "completed") {
          emit({ type: "completed", executionId });
        }
      }
      return result;
    } catch (error) {
      const sdkError = asSwapSdkError(error, "submit");
      emit({ type: "failed", executionId, error: sdkError });
      throw sdkError;
    }
  }

  private async readSignerIdentity(
    chain: McaSignerIdentity["chain"],
    stage: "quote" | "sign",
    provider: ExecutorIdentityProvider = this.resolveSignerIdentity(chain)
  ): Promise<McaSignerIdentity> {
    let identityKey: string;
    try {
      identityKey = (await provider.getIdentityKey()).trim();
    } catch (error) {
      if (error instanceof SwapSdkError) throw error;
      throw new SwapSdkError(
        "SIGNING_FAILED",
        stage,
        "Failed to read the MCA signer identity",
        { cause: error }
      );
    }
    if (!identityKey) {
      throw new SwapSdkError(
        "SIGNING_FAILED",
        stage,
        "MCA executor returned an empty signer identity"
      );
    }
    return { chain, identityKey };
  }

  private emitEvent(
    event: SwapLifecycleEvent,
    local?: (event: SwapLifecycleEvent) => void
  ): void {
    this.onEvent?.(event);
    if (local !== this.onEvent) local?.(event);
  }

  private assertQuoteFresh(quote: McaQuote): void {
    const now = this.now();
    const expiredByApi =
      quote.expiresAt !== undefined && now > quote.expiresAt;
    const expiredByAge =
      this.maxQuoteAgeMs !== null &&
      now - quote.receivedAt > Math.max(0, this.maxQuoteAgeMs);
    if (expiredByApi || expiredByAge) {
      throw new SwapSdkError(
        "QUOTE_EXPIRED",
        "build",
        "Quote has expired; request a fresh quote"
      );
    }
  }
}

function buildRequestFromQuote(quote: McaQuote) {
  const context = quote.buildContext;
  return {
    ...context.request,
    router: context.router,
    ...(context.market ? { market: context.market } : {}),
    expectedOut: context.expectedOut,
    minAmountOut: context.minAmountOut,
    preSwap: context.preSwap,
    bridge: context.bridge,
    ...(context.quoteId ? { quoteId: context.quoteId } : {}),
  };
}

function assertSignerMatchesQuote(
  signer: McaSignerIdentity,
  expected: McaSignerIdentity
): void {
  if (!isSameMcaSignerIdentity(signer, expected)) {
    throw new SwapSdkError(
      "SIGNING_FAILED",
      "sign",
      "MCA signer does not match the signer used for the quote"
    );
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readRecordString(
  value: unknown,
  field: string
): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return readString((value as Record<string, unknown>)[field]);
}
