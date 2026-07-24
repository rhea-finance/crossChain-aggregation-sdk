import type {
  SwapBuildRequestRaw,
  SwapMcaRelayerRequestRaw,
} from "../api/rawTypes";
import { SwapSdkError } from "../core/errors";
import type { NearTransaction } from "../types/execution";
import { parseUnits } from "../utils/units";

export function extractMcaWithdrawBusiness(
  preview: unknown
): Record<string, unknown> | undefined {
  if (!isPlainObject(preview)) return undefined;
  if (isPlainObject(preview.business)) return cloneObject(preview.business);
  return extractPreviewField(preview, "business");
}

export function extractMcaWithdrawSignerWallet(
  preview: unknown
): Record<string, unknown> | undefined {
  if (!isPlainObject(preview)) return undefined;
  if (isPlainObject(preview.signer_wallet)) {
    return cloneObject(preview.signer_wallet);
  }
  return extractPreviewField(preview, "signer_wallet");
}

export interface ExtractMcaWithdrawDepositAddressInput {
  bestQuote?: unknown;
  preview?: unknown;
  snapshotDepositAddress?: string | null;
  storeDepositAddress?: string | null;
}

export function extractMcaWithdrawDepositAddress(
  input: ExtractMcaWithdrawDepositAddressInput
): string {
  return (
    pickString(input.snapshotDepositAddress) ||
    pickString(input.storeDepositAddress) ||
    extractDepositAddressFromObject(input.preview) ||
    extractDepositAddressFromObject(input.bestQuote)
  );
}

export interface BuildNearMcaWithdrawTransactionsInput {
  business: Record<string, unknown>;
  signerWallet: Record<string, unknown>;
  signature?: string;
  mcaAccountId: string;
}

export function buildNearMcaWithdrawTransactions(
  preview: unknown,
  input: BuildNearMcaWithdrawTransactionsInput
): NearTransaction[] {
  if (!isPlainObject(preview)) {
    throw invalidPreview("MCA withdraw preview must be an object");
  }
  const fallbackAccount = input.mcaAccountId.trim();
  const executionArgs = {
    business: cloneObject(input.business),
    signer_wallet: cloneObject(input.signerWallet),
    signature: input.signature ?? "",
  };
  const transactions = Array.isArray(preview.transactions)
    ? preview.transactions
    : [];
  const mapped = transactions.flatMap((value): NearTransaction[] => {
    if (!isPlainObject(value)) return [];
    const receiverId = pickString(value.contractId) || fallbackAccount;
    if (!receiverId) return [];
    const methodName = pickString(value.methodName) || "exec";
    const existingArgs = isPlainObject(value.args)
      ? cloneObject(value.args)
      : {};
    return [
      {
        receiverId,
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName,
              args: { ...existingArgs, ...executionArgs },
              gas: normalizeGas(value.gas),
              deposit: normalizeDeposit(value.deposit),
            },
          },
        ],
      },
    ];
  });
  if (mapped.length > 0) return mapped;
  if (!fallbackAccount) {
    throw invalidPreview("MCA withdraw preview is missing mcaAccountId");
  }
  return [
    {
      receiverId: fallbackAccount,
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "exec",
            args: executionArgs,
            gas: "300000000000000",
            deposit: "0",
          },
        },
      ],
    },
  ];
}

export interface BuildMcaWithdrawRelayerRequestInput {
  quoteBuild: SwapBuildRequestRaw;
  mcaRelayer: SwapMcaRelayerRequestRaw;
  isCrossChain: boolean;
  depositAddress: string;
  mcaAccountId: string;
  recipientFallback?: string | null;
}

export function buildMcaWithdrawRelayerRequest(
  input: BuildMcaWithdrawRelayerRequestInput
): SwapBuildRequestRaw {
  const mcaAccountId = input.mcaAccountId.trim();
  if (!mcaAccountId) {
    throw new SwapSdkError(
      "INVALID_REQUEST",
      "build",
      "mcaAccountId is required for an MCA relayer request"
    );
  }
  const recipient =
    pickString(input.quoteBuild.recipient) ||
    pickString(input.recipientFallback);
  return {
    ...input.quoteBuild,
    ...(recipient ? { recipient } : {}),
    mcaRelayer: {
      ...input.mcaRelayer,
      wallet: cloneValue(input.mcaRelayer.wallet),
      business: cloneObject(input.mcaRelayer.business),
    },
    mca: {
      ...(input.quoteBuild.mca ?? {}),
      flow:
        input.quoteBuild.mca?.flow ??
        input.quoteBuild.mca?.mcaFlow ??
        "withdraw",
      mcaAccountId,
    },
    deposit_address: input.depositAddress.trim(),
    is_cross_chain: input.isCrossChain,
    tx_type: "mca-withdraw-relayer",
    multi_addr: mcaAccountId,
  };
}

function extractPreviewField(
  preview: Record<string, unknown>,
  field: "business" | "signer_wallet"
): Record<string, unknown> | undefined {
  const transactions = preview.transactions;
  if (Array.isArray(transactions)) {
    for (const transaction of transactions) {
      if (!isPlainObject(transaction) || !isPlainObject(transaction.args)) {
        continue;
      }
      const value = parseObject(transaction.args[field]);
      if (value) return cloneObject(value);
    }
  }

  const actions = preview.actions;
  if (Array.isArray(actions)) {
    for (const action of actions) {
      if (
        !isPlainObject(action) ||
        action.type !== "FunctionCall" ||
        !isPlainObject(action.params)
      ) {
        continue;
      }
      const args = parseObject(action.params.args);
      if (!args) continue;
      const value = parseObject(args[field]);
      if (value) return cloneObject(value);
    }
  }
  return undefined;
}

function extractDepositAddressFromObject(value: unknown): string {
  if (!isPlainObject(value)) return "";
  const direct = pickString(value.depositAddress) || pickString(value.deposit_address);
  if (direct) return direct;
  if (!isPlainObject(value.deposit)) return "";
  return (
    pickString(value.deposit.depositAddress) ||
    pickString(value.deposit.deposit_address)
  );
}

function parseObject(value: unknown): Record<string, unknown> | undefined {
  if (isPlainObject(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickString(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeGas(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return BigInt(Math.trunc(value)) < 10_000n
      ? (BigInt(Math.trunc(value)) * 1_000_000_000_000n).toString()
      : BigInt(Math.trunc(value)).toString();
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const gas = BigInt(value.trim());
    return gas < 10_000n ? (gas * 1_000_000_000_000n).toString() : gas.toString();
  }
  return "300000000000000";
}

function normalizeDeposit(value: unknown): string {
  if (value === undefined || value === null || value === "") return "0";
  const decimal =
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";
  if (!decimal) {
    throw invalidPreview("MCA withdraw transaction has an invalid NEAR deposit");
  }
  try {
    return parseUnits(decimal, 24);
  } catch (error) {
    throw new SwapSdkError(
      "INVALID_API_RESPONSE",
      "build",
      "MCA withdraw transaction has an invalid NEAR deposit",
      { cause: error }
    );
  }
}

function cloneObject(
  value: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  return cloneValue(value) as Record<string, unknown>;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function invalidPreview(message: string): SwapSdkError {
  return new SwapSdkError("INVALID_API_RESPONSE", "build", message);
}
