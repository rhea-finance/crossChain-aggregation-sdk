import { SwapSdkError } from "../../core/errors";
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

export interface ZcashWalletAdapter extends ExecutorErrorAdapter {
  getChain(): ChainRef | Promise<ChainRef>;
  isAddress(address: string): boolean;
  sendTransfer(input: {
    amount: string;
    depositAddress: string;
    decimals?: number;
    signal?: AbortSignal;
  }): Promise<TransactionSubmission>;
  waitForTransaction(
    txHash: string,
    options: { signal?: AbortSignal }
  ): Promise<TransactionConfirmation>;
}

export function createZcashExecutor(
  adapter: ZcashWalletAdapter
): ChainExecutor<"zcash-transfer"> {
  return {
    ...exposeExecutorSigner("zcash", adapter),
    kinds: ["zcash-transfer"],

    async validate(execution, context) {
      throwIfAborted(context.signal, "sign");
      assertChain(execution.chain, await adapter.getChain());
      if (!adapter.isAddress(execution.depositAddress)) {
        throw new SwapSdkError(
          "INVALID_TRANSACTION",
          "sign",
          "Invalid Zcash transparent deposit address"
        );
      }
    },

    async execute(execution, context) {
      await requestSignApproval(context, execution.chain, execution.kind, {
        amount: execution.amount,
        depositAddress: execution.depositAddress,
        decimals: execution.decimals,
      });
      let submission: TransactionSubmission;
      try {
        submission = await adapter.sendTransfer({
          amount: execution.amount,
          depositAddress: execution.depositAddress,
          ...(execution.decimals !== undefined
            ? { decimals: execution.decimals }
            : {}),
          signal: context.signal,
        });
      } catch (error) {
        throw mapExecutorError(
          error,
          adapter,
          "broadcast",
          "BROADCAST_FAILED",
          "Failed to submit Zcash transfer"
        );
      }
      if (!submission.txHash?.trim()) {
        throw new SwapSdkError(
          "BROADCAST_FAILED",
          "broadcast",
          "Zcash wallet returned no transaction hash"
        );
      }
      return confirm(adapter, submission.txHash, submission.raw, context);
    },
  };
}

async function confirm(
  adapter: ZcashWalletAdapter,
  txHash: string,
  raw: unknown,
  context: ExecutionContext
): Promise<ChainExecutionResult> {
  if (context.waitFor === "submitted") {
    return {
      status: "submitted",
      txHash,
      ...(raw !== undefined ? { raw } : {}),
    };
  }
  try {
    const confirmation = await adapter.waitForTransaction(txHash, {
      signal: context.signal,
    });
    const confirmationRaw = assertTransactionConfirmed(confirmation, {
      code: "BROADCAST_FAILED",
      stage: "broadcast",
      message: "Zcash transaction failed",
    });
    return {
      status: "source-confirmed",
      txHash,
      raw: confirmationRaw ?? raw,
    };
  } catch (error) {
    throw mapExecutorError(
      error,
      adapter,
      "broadcast",
      "BROADCAST_FAILED",
      "Failed while confirming Zcash transfer"
    );
  }
}
