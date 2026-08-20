import type {
  SwapMcaPayloadRaw,
  SwapQuoteRequestRaw,
} from "../api/rawTypes";
import { SwapSdkError } from "../core/errors";
import { serializeQuoteRequest } from "../normalizers/quote";
import type { Quote } from "../types/quote";
import { resolveMcaDecreaseCollateral } from "./collateral";
import type {
  McaDepositQuote,
  McaQuote,
  McaQuoteRequest,
  McaSignerIdentity,
  McaWithdrawQuoteRequest,
} from "./types";

export function serializeMcaQuoteRequest(
  request: McaQuoteRequest,
  signer: McaSignerIdentity
): SwapQuoteRequestRaw {
  const mcaAccountId = request.mcaAccountId.trim();
  if (!mcaAccountId) {
    throw invalidRequest("mcaAccountId is required");
  }
  if (signer.chain !== request.signerChain) {
    throw invalidRequest(
      `Resolved signer chain ${signer.chain} does not match requested signer chain ${request.signerChain}`
    );
  }
  const identityKey = signer.identityKey.trim();
  if (!identityKey) {
    throw invalidRequest("signer identityKey is required");
  }
  const decreaseCollateral =
    request.flow === "withdraw"
      ? resolveMcaDecreaseCollateral(
          request.collateral.decreaseAmountBurrow,
          "collateral.decreaseAmountBurrow"
        )
      : undefined;

  const mca: SwapMcaPayloadRaw = {
    flow: request.flow,
    mcaAccountId,
    signer: {
      chain: signer.chain,
      identityKey,
    },
    ...(request.flow === "deposit"
      ? { useAsCollateral: request.collateral.useAsCollateral }
      : {
          needDecreaseCollateral: decreaseCollateral!.needDecrease,
          decreaseCollateralAmountBurrow:
            decreaseCollateral!.decreaseAmountBurrow,
          ...(request.collateral.withdrawAll ? { withdrawAll: true } : {}),
        }),
    ...(request.recipientMsgSignatures
      ? { recipientMsgSignatures: [...request.recipientMsgSignatures] }
      : {}),
    ...(request.depositSignerProofSignatures
      ? {
          depositSignerProofSignatures: [
            ...request.depositSignerProofSignatures,
          ],
        }
      : {}),
  };

  return {
    ...serializeQuoteRequest(request),
    mca,
  };
}

export function normalizeMcaQuote(
  request: McaQuoteRequest,
  signer: McaSignerIdentity,
  quote: Quote
): McaQuote {
  const mca = serializeMcaQuoteRequest(request, signer).mca!;
  const base = {
    ...quote,
    flow: request.flow,
    mcaAccountId: request.mcaAccountId.trim(),
    signer: Object.freeze({
      ...signer,
      identityKey: signer.identityKey.trim(),
    }),
    request,
    mca: Object.freeze({ ...mca }),
  };

  if (request.flow === "deposit") {
    if (readString(quote.raw.nearDepositTxError)) {
      throw invalidResponse(String(quote.raw.nearDepositTxError));
    }
    return {
      ...base,
      flow: "deposit",
      executionMode: "deposit",
      request,
      ...(quote.raw.nearDepositTx === undefined
        ? {}
        : { nearDepositTx: quote.raw.nearDepositTx }),
    } satisfies McaDepositQuote;
  }

  if (readString(quote.raw.nearMcaWithdrawTxError)) {
    throw invalidResponse(String(quote.raw.nearMcaWithdrawTxError));
  }

  const mode = resolveWithdrawMode(request);
  const preview =
    mode === "withdraw-near"
      ? quote.raw.nearMcaWithdrawTx ?? quote.raw.mcaWithdrawToIntents
      : quote.raw.mcaWithdrawToIntents;
  if (!isPlainObject(preview)) {
    throw invalidResponse(
      mode === "withdraw-near"
        ? "MCA withdraw quote is missing nearMcaWithdrawTx"
        : "MCA withdraw quote is missing mcaWithdrawToIntents"
    );
  }

  return {
    ...base,
    flow: "withdraw",
    executionMode: mode,
    request,
    preview,
  };
}

function resolveWithdrawMode(
  request: McaWithdrawQuoteRequest
): "withdraw-near" | "withdraw-relayer" {
  if (request.executionPreference === "near") return "withdraw-near";
  if (request.executionPreference === "relayer") return "withdraw-relayer";

  const recipient = request.recipient?.trim();
  const boundNearAccountId = request.boundNearAccountId?.trim();
  return request.toChain === "near" &&
    Boolean(recipient) &&
    recipient === boundNearAccountId
    ? "withdraw-near"
    : "withdraw-relayer";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function invalidRequest(message: string): SwapSdkError {
  return new SwapSdkError("INVALID_REQUEST", "quote", message);
}

function invalidResponse(message: string): SwapSdkError {
  return new SwapSdkError("INVALID_API_RESPONSE", "quote", message);
}
