import { z, ZodError } from "zod";
import type {
  SwapBuildDataRaw,
  SwapBuildRequestRaw,
} from "../api/rawTypes";
import { SwapSdkError } from "../core/errors";
import type { ChainRef } from "../types/chain";
import type {
  DepositInfo,
  EvmApproval,
  OrderReference,
  SwapBuild,
  SwapExecution,
} from "../types/execution";
import { fromApiChain } from "./chain";
import {
  decimalStringSchema,
  evmTxSchema,
  nonEmptyStringSchema,
  positiveIntegerSchema,
} from "./schemas";

const tokenSchema = z.object({
  address: z.string(),
  symbol: z.string(),
  decimals: z.number().int().nonnegative(),
});

const commonBuildSchema = z.object({
  isCrossChain: z.boolean(),
  chainType: nonEmptyStringSchema,
  router: nonEmptyStringSchema,
  fromChain: nonEmptyStringSchema,
  toChain: nonEmptyStringSchema,
  tokenIn: tokenSchema,
  tokenOut: tokenSchema,
  amountIn: decimalStringSchema,
  estimatedOut: decimalStringSchema,
  minAmountOut: decimalStringSchema,
});

const signingRequestSchema = z.object({
  type: nonEmptyStringSchema,
  router: nonEmptyStringSchema,
  quoteId: nonEmptyStringSchema,
  chainId: positiveIntegerSchema,
  signingScheme: z.string().optional(),
  typedData: z.object({
    domain: z.record(z.string(), z.unknown()),
    types: z.record(
      z.string(),
      z.array(z.object({ name: z.string(), type: z.string() }))
    ),
    primaryType: nonEmptyStringSchema,
    message: z.record(z.string(), z.unknown()),
  }),
  submit: z
    .object({
      endpoint: z.string(),
      method: z.string(),
      params: z.record(z.string(), z.string()),
    })
    .optional(),
});

const solanaTxSchema = z.object({
  transaction: z.string(),
  format: nonEmptyStringSchema,
  addressLookupTableAddresses: z.array(z.string()).optional(),
  recentBlockhash: z.string().optional(),
  txValidUntil: z.number().optional(),
  transactionSize: z.number().optional(),
});

const aptosTxSchema = z.object({
  function: nonEmptyStringSchema,
  type_arguments: z.array(z.string()),
  arguments: z.array(z.unknown()),
});

const nearTxSchema = z.object({
  signerId: z.string().optional(),
  receiverId: nonEmptyStringSchema,
  actions: z.array(z.unknown()).min(1),
});

const transferBaseSchema = z.object({
  kind: nonEmptyStringSchema,
  chainId: z.string().optional(),
  chain: z.string().optional(),
  amount: decimalStringSchema,
  depositAddress: nonEmptyStringSchema,
});

const tronTxSchema = transferBaseSchema.extend({
  tokenAddress: z.string().optional(),
  standard: z.string().optional(),
});

const bitcoinTxSchema = transferBaseSchema.extend({
  feeRate: z.number().positive().optional(),
});

const zcashTxSchema = transferBaseSchema.extend({
  decimals: z.number().int().nonnegative().optional(),
});

const suiTxSchema = transferBaseSchema.extend({
  coinType: nonEmptyStringSchema.refine(
    (value) => !value.toLowerCase().startsWith("nep141:"),
    "Sui coinType cannot be an OMFT asset id"
  ),
});

type ExecutionLane =
  | "evm"
  | "solana"
  | "aptos"
  | "near"
  | "tron"
  | "bitcoin"
  | "zcash"
  | "sui";

export function normalizeBuild(
  raw: SwapBuildDataRaw,
  executionId = createExecutionId(),
  request?: SwapBuildRequestRaw
): SwapBuild {
  try {
    const common = commonBuildSchema.parse(raw);
    const fromChain = fromApiChain(common.fromChain);
    const toChain = fromApiChain(common.toChain);
    const lane = laneFromChainType(common.chainType, fromChain);
    assertLaneMatchesChain(lane, fromChain);
    const execution = normalizeExecution(raw, lane, fromChain);
    const order = normalizeOrder(raw, execution);
    const deposit = normalizeDeposit(raw.deposit);

    return {
      executionId,
      ...(raw.signingRequest?.quoteId
        ? { quoteId: raw.signingRequest.quoteId }
        : {}),
      isCrossChain: common.isCrossChain,
      fromChain,
      toChain,
      tokenIn: { chain: fromChain, ...common.tokenIn },
      tokenOut: { chain: toChain, ...common.tokenOut },
      amountIn: common.amountIn,
      estimatedOut: common.estimatedOut,
      minAmountOut: common.minAmountOut,
      router: common.router,
      execution,
      ...(order ? { order } : {}),
      ...(deposit ? { deposit } : {}),
      ...(request ? { request: { ...request } } : {}),
      raw,
    };
  } catch (error) {
    if (error instanceof SwapSdkError) throw error;
    throw invalidBuild(error);
  }
}

function normalizeExecution(
  raw: SwapBuildDataRaw,
  lane: ExecutionLane,
  chain: ChainRef
): SwapExecution {
  switch (lane) {
    case "evm":
      return normalizeEvmExecution(raw, chain);
    case "solana": {
      const tx = solanaTxSchema.parse(raw.tx);
      return {
        kind: "solana-transaction",
        chain,
        transaction: tx.transaction,
        format: tx.format,
        metadata: {
          ...(tx.addressLookupTableAddresses
            ? { addressLookupTableAddresses: tx.addressLookupTableAddresses }
            : {}),
          ...(tx.recentBlockhash ? { recentBlockhash: tx.recentBlockhash } : {}),
          ...(tx.txValidUntil === undefined
            ? {}
            : { txValidUntil: tx.txValidUntil }),
          ...(tx.transactionSize === undefined
            ? {}
            : { transactionSize: tx.transactionSize }),
        },
      };
    }
    case "aptos": {
      const tx = aptosTxSchema.parse(raw.tx);
      return {
        kind: "aptos-entry-function",
        chain,
        function: tx.function,
        typeArguments: tx.type_arguments,
        functionArguments: tx.arguments,
      };
    }
    case "near": {
      const transactions = z
        .union([nearTxSchema, z.array(nearTxSchema).min(1)])
        .parse(raw.tx);
      return {
        kind: "near-transaction-batch",
        chain,
        transactions: Array.isArray(transactions)
          ? transactions
          : [transactions],
      };
    }
    case "tron": {
      const tx = tronTxSchema.parse(raw.tx);
      assertKind(tx.kind, ["tron_transfer"]);
      return {
        kind: "tron-transfer",
        chain,
        amount: tx.amount,
        depositAddress: tx.depositAddress,
        ...(tx.tokenAddress ? { tokenAddress: tx.tokenAddress } : {}),
        ...(tx.standard ? { standard: tx.standard } : {}),
      };
    }
    case "bitcoin": {
      const tx = bitcoinTxSchema.parse(raw.tx);
      assertKind(tx.kind, ["btc_transfer", "utxo_transfer"]);
      return {
        kind: "bitcoin-transfer",
        chain,
        amount: tx.amount,
        depositAddress: tx.depositAddress,
        ...(tx.feeRate === undefined ? {} : { feeRate: tx.feeRate }),
      };
    }
    case "zcash": {
      const tx = zcashTxSchema.parse(raw.tx);
      assertKind(tx.kind, ["zcash_transfer", "utxo_transfer"]);
      return {
        kind: "zcash-transfer",
        chain,
        amount: tx.amount,
        depositAddress: tx.depositAddress,
        ...(tx.decimals === undefined ? {} : { decimals: tx.decimals }),
      };
    }
    case "sui": {
      const candidate =
        typeof raw.tx === "object" && raw.tx !== null
          ? {
              ...raw.tx,
              coinType:
                "coinType" in raw.tx && raw.tx.coinType
                  ? raw.tx.coinType
                  : raw.tokenIn.address,
            }
          : raw.tx;
      const tx = suiTxSchema.parse(candidate);
      assertKind(tx.kind, ["sui_transfer"]);
      return {
        kind: "sui-transfer",
        chain,
        amount: tx.amount,
        depositAddress: tx.depositAddress,
        coinType: tx.coinType,
      };
    }
  }
}

function normalizeEvmExecution(
  raw: SwapBuildDataRaw,
  chain: ChainRef
): SwapExecution {
  const approval = normalizeEvmApproval(raw, chain);
  if (raw.executionType === "signature" || raw.signingRequest) {
    const request = signingRequestSchema.parse(raw.signingRequest);
    assertEvmChainId(chain, request.chainId);
    return {
      kind: "evm-signature",
      chain,
      request,
      ...(approval ? { approval } : {}),
    };
  }

  const tx = evmTxSchema.parse(raw.tx);
  assertEvmChainId(chain, tx.chainId);
  return {
    kind: "evm-transaction",
    chain,
    tx,
    ...(approval ? { approval } : {}),
  };
}

function normalizeEvmApproval(
  raw: SwapBuildDataRaw,
  chain: ChainRef
): EvmApproval | undefined {
  if (raw.approve) {
    const approveTx = evmTxSchema.parse(raw.approve.tx);
    assertEvmChainId(chain, approveTx.chainId);
    return {
      tx: approveTx,
      spender: nonEmptyStringSchema.parse(raw.approve.spender),
    };
  }
  return undefined;
}

function laneFromChainType(
  chainType: string,
  fromChain: ChainRef
): ExecutionLane {
  const normalized = chainType.toLowerCase();
  const aliases: Record<string, ExecutionLane> = {
    evm: "evm",
    solana: "solana",
    sol: "solana",
    aptos: "aptos",
    near: "near",
    tron: "tron",
    btc: "bitcoin",
    bitcoin: "bitcoin",
    zcash: "zcash",
    zec: "zcash",
    sui: "sui",
  };
  if (normalized === "cross-chain") return laneFromChain(fromChain);
  const lane = aliases[normalized];
  if (!lane) {
    throw new SwapSdkError(
      "UNSUPPORTED_CHAIN",
      "build",
      `Unsupported build chainType: ${chainType}`
    );
  }
  return lane;
}

function laneFromChain(chain: ChainRef): ExecutionLane {
  if (/^[1-9]\d*$/.test(chain)) return "evm";
  const lanes: Record<string, ExecutionLane> = {
    solana: "solana",
    aptos: "aptos",
    near: "near",
    tron: "tron",
    btc: "bitcoin",
    zcash: "zcash",
    sui: "sui",
  };
  const lane = lanes[chain];
  if (!lane) {
    throw new SwapSdkError(
      "UNSUPPORTED_CHAIN",
      "build",
      `Unsupported source chain: ${chain}`
    );
  }
  return lane;
}

function assertLaneMatchesChain(lane: ExecutionLane, chain: ChainRef): void {
  const chainLane = laneFromChain(chain);
  if (lane !== chainLane) {
    throw new SwapSdkError(
      "CHAIN_MISMATCH",
      "build",
      `Build chainType ${lane} does not match source chain ${chain}`
    );
  }
}

function assertEvmChainId(chain: ChainRef, chainId: number): void {
  if (chain !== String(chainId)) {
    throw new SwapSdkError(
      "CHAIN_MISMATCH",
      "build",
      `EVM transaction chainId ${chainId} does not match ${chain}`
    );
  }
}

function assertKind(actual: string, allowed: string[]): void {
  if (!allowed.includes(actual.toLowerCase())) {
    throw new SwapSdkError(
      "INVALID_API_RESPONSE",
      "build",
      `Unexpected transaction kind: ${actual}`
    );
  }
}

function normalizeOrder(
  raw: SwapBuildDataRaw,
  execution: SwapExecution
): OrderReference | undefined {
  const depositOrderId = readRecordString(raw.deposit, "orderId");
  const orderId = raw.orderId ?? depositOrderId;
  if (!orderId) return undefined;

  const router =
    raw.statusRouter ??
    (execution.kind === "evm-signature"
      ? execution.request.router
      : undefined) ??
    raw.router;
  const chainId =
    execution.kind === "evm-signature"
      ? String(execution.request.chainId)
      : execution.kind === "evm-transaction"
        ? String(execution.tx.chainId)
        : undefined;
  return { orderId, router, ...(chainId ? { chainId } : {}) };
}

function normalizeDeposit(value: unknown): DepositInfo | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const depositAddress = readRecordString(value, "depositAddress");
  if (!depositAddress) return undefined;

  return {
    depositAddress,
    ...(readRecordString(value, "depositMemo")
      ? { depositMemo: readRecordString(value, "depositMemo") }
      : {}),
    ...(readRecordString(value, "orderId")
      ? { orderId: readRecordString(value, "orderId") }
      : {}),
    ...(readRecordString(value, "estimatedOut")
      ? { estimatedOut: decimalStringSchema.parse(readRecordString(value, "estimatedOut")) }
      : {}),
    ...(readRecordString(value, "minAmountOut")
      ? { minAmountOut: decimalStringSchema.parse(readRecordString(value, "minAmountOut")) }
      : {}),
    ...(typeof Reflect.get(value, "timeEstimate") === "number" ||
    typeof Reflect.get(value, "timeEstimate") === "string"
      ? { timeEstimate: Reflect.get(value, "timeEstimate") as number | string }
      : {}),
  };
}

function readRecordString(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const field = Reflect.get(value, key);
  return typeof field === "string" && field.trim() ? field.trim() : undefined;
}

export function createExecutionId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `swap_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function invalidBuild(error: unknown): SwapSdkError {
  return new SwapSdkError(
    "INVALID_API_RESPONSE",
    "build",
    "Invalid swap build response",
    {
      cause: error,
      details:
        error instanceof ZodError
          ? {
              issues: error.issues.map((issue) => ({
                path: issue.path.join("."),
                message: issue.message,
              })),
            }
          : undefined,
    }
  );
}
