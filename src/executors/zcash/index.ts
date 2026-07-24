import { SwapSdkError } from "../../core/errors";
import type {
  ChainExecutionResult,
  ChainExecutor,
  ExecutionContext,
} from "../../core/registry";
import type { ChainRef } from "../../types/chain";
import {
  assertChain,
  exposeExecutorSigner,
  mapExecutorError,
  requestSignApproval,
  throwIfAborted,
  type ExecutorErrorAdapter,
  type TransferSubmission,
} from "../shared";

export interface ZcashWalletAdapter extends ExecutorErrorAdapter {
  getChain(): ChainRef | Promise<ChainRef>;
  isAddress(address: string): boolean;
  sendTransfer(input: {
    amount: string;
    depositAddress: string;
    decimals?: number;
    signal?: AbortSignal;
  }): Promise<TransferSubmission>;
  waitForTransaction?(
    txHash: string,
    options: { signal?: AbortSignal }
  ): Promise<unknown>;
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
      let submission: TransferSubmission;
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
      if (submission.requiresUserAction) {
        return {
          status: "requires-user-action",
          ...(submission.raw !== undefined ? { raw: submission.raw } : {}),
        };
      }
      if (!submission.txHash) {
        throw new SwapSdkError(
          "BROADCAST_FAILED",
          "broadcast",
          "Zcash wallet returned neither a transaction hash nor user action"
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
  if (context.waitFor === "submitted" || !adapter.waitForTransaction) {
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
    return {
      status: "source-confirmed",
      txHash,
      raw: confirmation ?? raw,
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
