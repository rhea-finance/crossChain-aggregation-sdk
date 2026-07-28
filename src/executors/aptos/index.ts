import type {
  ChainExecutionResult,
  ChainExecutor,
  ExecutionContext,
} from "../../core/registry";
import type { ChainRef } from "../../types/chain";
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

export interface AptosWalletAdapter extends ExecutorErrorAdapter {
  getChain(): ChainRef | Promise<ChainRef>;
  signAndSubmitTransaction(
    payload: {
      function: string;
      typeArguments: string[];
      functionArguments: unknown[];
    },
    options: { signal?: AbortSignal }
  ): Promise<TransactionSubmission>;
  waitForTransaction(
    txHash: string,
    options: { signal?: AbortSignal }
  ): Promise<TransactionConfirmation>;
}

export function createAptosExecutor(
  adapter: AptosWalletAdapter
): ChainExecutor<"aptos-entry-function"> {
  return {
    ...exposeExecutorSigner("aptos", adapter),
    kinds: ["aptos-entry-function"],

    async validate(execution, context) {
      throwIfAborted(context.signal, "sign");
      assertChain(execution.chain, await adapter.getChain());
    },

    async execute(execution, context) {
      await requestSignApproval(context, execution.chain, execution.kind, {
        function: execution.function,
        typeArguments: execution.typeArguments,
        functionArguments: execution.functionArguments,
      });
      let submission: TransactionSubmission;
      try {
        submission = await adapter.signAndSubmitTransaction(
          {
            function: execution.function,
            typeArguments: execution.typeArguments,
            functionArguments: execution.functionArguments,
          },
          { signal: context.signal }
        );
      } catch (error) {
        throw mapExecutorError(
          error,
          adapter,
          "broadcast",
          "BROADCAST_FAILED",
          "Failed to sign or submit Aptos transaction"
        );
      }
      return confirm(adapter, submission, context);
    },
  };
}

async function confirm(
  adapter: AptosWalletAdapter,
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
      message: "Aptos transaction failed",
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
      "Failed while confirming Aptos transaction"
    );
  }
}
