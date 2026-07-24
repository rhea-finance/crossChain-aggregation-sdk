import type {
  SwapQuoteDataRaw,
  SwapQuoteRequestRaw,
} from "../api/rawTypes";
import { SwapSdkError } from "../core/errors";
import { assertBaseUnitAmount } from "../types/chain";
import type {
  BuildContext,
  Quote,
  QuoteRequest,
  RouteSummary,
} from "../types/quote";
import { toApiAssetAddress, toApiChain } from "./chain";

export function serializeQuoteRequest(
  request: QuoteRequest
): SwapQuoteRequestRaw {
  validateQuoteRequest(request);

  return {
    ...(request.extensions ?? {}),
    fromChain: toApiChain(request.fromChain),
    toChain: toApiChain(request.toChain),
    tokenIn: toApiAssetAddress(request.tokenIn),
    tokenOut: toApiAssetAddress(request.tokenOut),
    amountIn: request.amountIn,
    slippage: request.slippageBps,
    sender: request.sender.trim(),
    ...(request.recipient?.trim()
      ? { recipient: request.recipient.trim() }
      : {}),
  } as SwapQuoteRequestRaw;
}

export function normalizeQuote(
  request: QuoteRequest,
  raw: SwapQuoteDataRaw,
  receivedAt = Date.now()
): Quote {
  const bestRoute = normalizeRoute(raw.bestQuote, true);
  if (!bestRoute) {
    throw invalidQuote("Quote response does not contain a valid best route");
  }

  const quoteId = readOptionalString(raw.bestQuote.quoteId);
  const apiRequest = Object.freeze({ ...serializeQuoteRequest(request) });
  const buildContext: Readonly<BuildContext> = Object.freeze({
    request: apiRequest,
    router: bestRoute.router,
    ...(bestRoute.market ? { market: bestRoute.market } : {}),
    expectedOut: bestRoute.amountOut,
    minAmountOut: bestRoute.minAmountOut,
    preSwap: raw.bestQuote.preSwap ?? null,
    bridge: raw.bestQuote.bridge ?? null,
    ...(quoteId ? { quoteId } : {}),
  });
  const expiresAt = readTimestamp(
    raw.bestQuote.expiresAt ?? raw.bestQuote.expirationTime
  );

  return {
    ...(quoteId ? { id: quoteId } : {}),
    fromChain: request.fromChain,
    toChain: request.toChain,
    tokenIn: { ...request.tokenIn },
    tokenOut: { ...request.tokenOut },
    amountIn: validateResponseAmount(request.amountIn, "amountIn"),
    estimatedOut: bestRoute.amountOut,
    minAmountOut: bestRoute.minAmountOut,
    route: bestRoute,
    alternatives: raw.allQuotes.flatMap((route) => {
      try {
        const normalized = normalizeRoute(route, false);
        return normalized ? [normalized] : [];
      } catch {
        return [];
      }
    }),
    receivedAt,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    buildContext,
    raw,
  };
}

function validateQuoteRequest(request: QuoteRequest): void {
  assertBaseUnitAmount(request.amountIn);
  if (!Number.isInteger(request.slippageBps) || request.slippageBps < 0) {
    throw new SwapSdkError(
      "INVALID_REQUEST",
      "quote",
      "slippageBps must be a non-negative integer"
    );
  }
  if (request.slippageBps > 10_000) {
    throw new SwapSdkError(
      "INVALID_REQUEST",
      "quote",
      "slippageBps cannot exceed 10000"
    );
  }
  if (!request.sender.trim()) {
    throw new SwapSdkError(
      "INVALID_REQUEST",
      "quote",
      "sender is required"
    );
  }
  if (request.tokenIn.chain !== request.fromChain) {
    throw new SwapSdkError(
      "CHAIN_MISMATCH",
      "quote",
      "tokenIn chain does not match fromChain"
    );
  }
  if (request.tokenOut.chain !== request.toChain) {
    throw new SwapSdkError(
      "CHAIN_MISMATCH",
      "quote",
      "tokenOut chain does not match toChain"
    );
  }
}

function normalizeRoute(
  raw: Record<string, unknown>,
  required: boolean
): RouteSummary | undefined {
  const router = readOptionalString(raw.router);
  const amountOutValue = raw.amountOut ?? raw.estimatedOut;
  const amountOut = readOptionalString(amountOutValue);
  const minAmountOut = readOptionalString(raw.minAmountOut) ?? amountOut;

  if (!router || !amountOut || !minAmountOut) {
    if (required) throw invalidQuote("Quote response is missing route fields");
    return undefined;
  }

  return {
    router,
    ...(readOptionalString(raw.market)
      ? { market: readOptionalString(raw.market) }
      : {}),
    amountOut: validateResponseAmount(amountOut, "amountOut"),
    minAmountOut: validateResponseAmount(minAmountOut, "minAmountOut"),
    raw,
  };
}

function validateResponseAmount(value: string, field: string): string {
  try {
    return assertBaseUnitAmount(value);
  } catch (error) {
    throw invalidQuote(`Quote response has invalid ${field}`, error);
  }
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function invalidQuote(message: string, cause?: unknown): SwapSdkError {
  return new SwapSdkError("INVALID_API_RESPONSE", "quote", message, {
    cause,
  });
}
