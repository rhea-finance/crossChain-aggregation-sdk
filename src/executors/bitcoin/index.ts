import { SwapSdkError } from "../../core/errors";
import type {
  ChainExecutionResult,
  ChainExecutor,
  ExecutionContext,
} from "../../core/registry";
import type { ChainRef } from "../../types/chain";
import type { SwapExecution } from "../../types/execution";
import {
  assertTransactionConfirmed,
  assertChain,
  exposeExecutorSigner,
  mapExecutorError,
  requestSignApproval,
  throwIfAborted,
  type ExecutorErrorAdapter,
  type TransactionConfirmation,
  type TransactionSubmission,
} from "../shared";

type BitcoinExecution = Extract<
  SwapExecution,
  { kind: "bitcoin-transfer" }
>;

export interface BitcoinWalletAdapter extends ExecutorErrorAdapter {
  getChain(): ChainRef | Promise<ChainRef>;
  isAddress(address: string): boolean;
  sendTransfer(input: {
    amount: string;
    depositAddress: string;
    feeRate: number;
    signal?: AbortSignal;
  }): Promise<TransactionSubmission>;
  waitForTransaction(
    txHash: string,
    options: { signal?: AbortSignal }
  ): Promise<TransactionConfirmation>;
}

export interface BitcoinExecutorOptions {
  defaultFeeRate?: number;
}

export function createBitcoinExecutor(
  adapter: BitcoinWalletAdapter,
  options: BitcoinExecutorOptions = {}
): ChainExecutor<"bitcoin-transfer"> {
  return {
    ...exposeExecutorSigner("btc", adapter),
    kinds: ["bitcoin-transfer"],

    async validate(execution, context) {
      throwIfAborted(context.signal, "sign");
      assertChain(execution.chain, await adapter.getChain());
      if (!adapter.isAddress(execution.depositAddress)) {
        throw invalid("Invalid Bitcoin deposit address");
      }
      resolveFeeRate(execution, options);
    },

    async execute(execution, context) {
      const feeRate = resolveFeeRate(execution, options);
      await requestSignApproval(context, execution.chain, execution.kind, {
        amount: execution.amount,
        depositAddress: execution.depositAddress,
        feeRate,
      });
      let submission: TransactionSubmission;
      try {
        submission = await adapter.sendTransfer({
          amount: execution.amount,
          depositAddress: execution.depositAddress,
          feeRate,
          signal: context.signal,
        });
      } catch (error) {
        throw mapExecutorError(
          error,
          adapter,
          "broadcast",
          "BROADCAST_FAILED",
          "Failed to broadcast Bitcoin transfer"
        );
      }
      return confirm(adapter, submission, context);
    },
  };
}

function resolveFeeRate(
  execution: BitcoinExecution,
  options: BitcoinExecutorOptions
): number {
  const feeRate = execution.feeRate ?? options.defaultFeeRate;
  if (feeRate === undefined || !Number.isFinite(feeRate) || feeRate <= 0) {
    throw invalid("Bitcoin fee rate is required and must be positive");
  }
  return feeRate;
}

function invalid(message: string): SwapSdkError {
  return new SwapSdkError("INVALID_TRANSACTION", "sign", message);
}

async function confirm(
  adapter: BitcoinWalletAdapter,
  submission: TransactionSubmission,
  context: ExecutionContext
): Promise<ChainExecutionResult> {
  if (context.waitFor === "submitted") {
    return {
      status: "submitted",
      txHash: submission.txHash,
      ...(submission.raw !== undefined ? { raw: submission.raw } : {}),
    };
  }
  try {
    const confirmation = await adapter.waitForTransaction(submission.txHash, {
      signal: context.signal,
    });
    const confirmationRaw = assertTransactionConfirmed(confirmation, {
      code: "BROADCAST_FAILED",
      stage: "broadcast",
      message: "Bitcoin transaction failed",
    });
    return {
      status: "source-confirmed",
      txHash: submission.txHash,
      raw: confirmationRaw ?? submission.raw,
    };
  } catch (error) {
    throw mapExecutorError(
      error,
      adapter,
      "broadcast",
      "BROADCAST_FAILED",
      "Failed while confirming Bitcoin transfer"
    );
  }
}
