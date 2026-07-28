import { SwapSdkError } from "../../core/errors";
import type {
  ChainExecutionResult,
  ChainExecutor,
  ExecutionContext,
} from "../../core/registry";
import type { ChainRef } from "../../types/chain";
import type { NearTransaction } from "../../types/execution";
import {
  assertTransactionConfirmed,
  assertChain,
  exposeExecutorSigner,
  mapExecutorError,
  requestSignApproval,
  throwIfAborted,
  type ExecutorErrorAdapter,
  type TransactionConfirmation,
} from "../shared";

export interface NearWalletAdapter extends ExecutorErrorAdapter {
  getChain(): ChainRef | Promise<ChainRef>;
  signAndSendTransactions(
    transactions: NearTransaction[],
    options: { signal?: AbortSignal }
  ): Promise<{ txHashes: string[]; raw?: unknown }>;
  waitForTransactions(
    txHashes: string[],
    options: { signal?: AbortSignal }
  ): Promise<TransactionConfirmation>;
}

export function createNearExecutor(
  adapter: NearWalletAdapter
): ChainExecutor<"near-transaction-batch"> {
  return {
    ...exposeExecutorSigner("near", adapter),
    kinds: ["near-transaction-batch"],

    async validate(execution, context) {
      throwIfAborted(context.signal, "sign");
      assertChain(execution.chain, await adapter.getChain());
      if (execution.transactions.length === 0) {
        throw new SwapSdkError(
          "INVALID_TRANSACTION",
          "sign",
          "NEAR transaction batch cannot be empty"
        );
      }
      for (const [index, transaction] of execution.transactions.entries()) {
        if (!transaction.receiverId.trim() || transaction.actions.length === 0) {
          throw new SwapSdkError(
            "INVALID_TRANSACTION",
            "sign",
            `Invalid NEAR transaction at index ${index}`
          );
        }
      }
    },

    async execute(execution, context) {
      await requestSignApproval(context, execution.chain, execution.kind, {
        transactionCount: execution.transactions.length,
        receivers: execution.transactions.map((item) => item.receiverId),
      });
      let submission: { txHashes: string[]; raw?: unknown };
      try {
        submission = await adapter.signAndSendTransactions(
          execution.transactions,
          { signal: context.signal }
        );
      } catch (error) {
        throw mapExecutorError(
          error,
          adapter,
          "broadcast",
          "BROADCAST_FAILED",
          "Failed to sign or broadcast NEAR transactions"
        );
      }
      if (submission.txHashes.length === 0) {
        throw new SwapSdkError(
          "BROADCAST_FAILED",
          "broadcast",
          "NEAR wallet returned no transaction hashes"
        );
      }
      return confirm(adapter, submission, context);
    },
  };
}

async function confirm(
  adapter: NearWalletAdapter,
  submission: { txHashes: string[]; raw?: unknown },
  context: ExecutionContext
): Promise<ChainExecutionResult> {
  const txHash = submission.txHashes[submission.txHashes.length - 1]!;
  if (context.waitFor === "submitted") {
    return {
      status: "submitted",
      txHash,
      txHashes: submission.txHashes,
      ...(submission.raw !== undefined ? { raw: submission.raw } : {}),
    };
  }
  try {
    const confirmation = await adapter.waitForTransactions(
      submission.txHashes,
      { signal: context.signal }
    );
    const confirmationRaw = assertTransactionConfirmed(confirmation, {
      code: "BROADCAST_FAILED",
      stage: "broadcast",
      message: "NEAR transaction batch failed",
    });
    return {
      status: "source-confirmed",
      txHash,
      txHashes: submission.txHashes,
      raw: confirmationRaw ?? submission.raw,
    };
  } catch (error) {
    throw mapExecutorError(
      error,
      adapter,
      "broadcast",
      "BROADCAST_FAILED",
      "Failed while confirming NEAR transactions"
    );
  }
}
