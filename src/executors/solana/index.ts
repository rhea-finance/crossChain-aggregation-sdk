import { SwapSdkError } from "../../core/errors";
import type {
  ChainExecutionResult,
  ChainExecutor,
  ExecutionContext,
} from "../../core/registry";
import type { ChainRef } from "../../types/chain";
import type {
  SolanaMetadata,
  SwapExecution,
} from "../../types/execution";
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

type SolanaExecution = Extract<
  SwapExecution,
  { kind: "solana-transaction" }
>;

export interface SolanaWalletAdapter extends ExecutorErrorAdapter {
  getChain(): ChainRef | Promise<ChainRef>;
  getCurrentBlockHeight?(): number | Promise<number>;
  signAndSendTransaction(input: {
    transaction: string;
    format: string;
    metadata?: SolanaMetadata;
    signal?: AbortSignal;
  }): Promise<TransactionSubmission>;
  waitForTransaction(
    txHash: string,
    input: { metadata?: SolanaMetadata; signal?: AbortSignal }
  ): Promise<TransactionConfirmation>;
}

export function createSolanaExecutor(
  adapter: SolanaWalletAdapter
): ChainExecutor<"solana-transaction"> {
  return {
    ...exposeExecutorSigner("solana", adapter),
    kinds: ["solana-transaction"],

    async validate(execution, context) {
      throwIfAborted(context.signal, "sign");
      assertChain(execution.chain, await adapter.getChain());
      const validUntil = execution.metadata?.txValidUntil;
      if (validUntil !== undefined && adapter.getCurrentBlockHeight) {
        const currentHeight = await adapter.getCurrentBlockHeight();
        if (currentHeight > validUntil) {
          throw new SwapSdkError(
            "INVALID_TRANSACTION",
            "sign",
            `Solana transaction expired at block height ${validUntil}`,
            { details: { currentHeight, validUntil } }
          );
        }
      }
    },

    async execute(execution, context) {
      await requestSignApproval(context, execution.chain, execution.kind, {
        format: execution.format,
        recentBlockhash: execution.metadata?.recentBlockhash,
        transactionSize: execution.metadata?.transactionSize,
      });
      let submission: TransactionSubmission;
      try {
        submission = await adapter.signAndSendTransaction({
          transaction: execution.transaction,
          format: execution.format,
          ...(execution.metadata ? { metadata: execution.metadata } : {}),
          signal: context.signal,
        });
      } catch (error) {
        throw mapExecutorError(
          error,
          adapter,
          "broadcast",
          "BROADCAST_FAILED",
          "Failed to sign or broadcast Solana transaction"
        );
      }
      return confirm(adapter, execution, submission, context);
    },
  };
}

async function confirm(
  adapter: SolanaWalletAdapter,
  execution: SolanaExecution,
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
      ...(execution.metadata ? { metadata: execution.metadata } : {}),
      signal: context.signal,
    });
    const confirmationRaw = assertTransactionConfirmed(confirmation, {
      code: "BROADCAST_FAILED",
      stage: "broadcast",
      message: "Solana transaction failed",
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
      "Failed while confirming Solana transaction"
    );
  }
}
