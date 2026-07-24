import { SwapSdkError } from "../../core/errors";
import type {
  ChainExecutionResult,
  ChainExecutor,
  ExecutionContext,
} from "../../core/registry";
import type { ChainRef } from "../../types/chain";
import type { SwapExecution } from "../../types/execution";
import {
  assertChain,
  exposeExecutorSigner,
  mapExecutorError,
  requestSignApproval,
  throwIfAborted,
  type ExecutorErrorAdapter,
  type TransactionSubmission,
} from "../shared";

type TronExecution = Extract<SwapExecution, { kind: "tron-transfer" }>;

export interface TronWalletAdapter extends ExecutorErrorAdapter {
  getChain(): ChainRef | Promise<ChainRef>;
  isAddress(address: string): boolean;
  sendNativeTransfer(input: {
    amount: string;
    depositAddress: string;
    signal?: AbortSignal;
  }): Promise<TransactionSubmission>;
  sendTokenTransfer(input: {
    amount: string;
    depositAddress: string;
    tokenAddress: string;
    signal?: AbortSignal;
  }): Promise<TransactionSubmission>;
  waitForTransaction?(
    txHash: string,
    options: { signal?: AbortSignal }
  ): Promise<unknown>;
}

export function createTronExecutor(
  adapter: TronWalletAdapter
): ChainExecutor<"tron-transfer"> {
  return {
    ...exposeExecutorSigner("tron", adapter),
    kinds: ["tron-transfer"],

    async validate(execution, context) {
      throwIfAborted(context.signal, "sign");
      assertChain(execution.chain, await adapter.getChain());
      if (!adapter.isAddress(execution.depositAddress)) {
        throw invalid("Invalid Tron deposit address");
      }
      if (!isNative(execution)) {
        if (
          !execution.tokenAddress ||
          execution.tokenAddress.toLowerCase().startsWith("nep141:") ||
          !adapter.isAddress(execution.tokenAddress)
        ) {
          throw invalid("Invalid TRC20 token contract address");
        }
      }
    },

    async execute(execution, context) {
      const native = isNative(execution);
      await requestSignApproval(context, execution.chain, execution.kind, {
        amount: execution.amount,
        depositAddress: execution.depositAddress,
        standard: native ? "native" : execution.standard ?? "trc20",
        tokenAddress: execution.tokenAddress,
      });
      let submission: TransactionSubmission;
      try {
        submission = native
          ? await adapter.sendNativeTransfer({
              amount: execution.amount,
              depositAddress: execution.depositAddress,
              signal: context.signal,
            })
          : await adapter.sendTokenTransfer({
              amount: execution.amount,
              depositAddress: execution.depositAddress,
              tokenAddress: execution.tokenAddress!,
              signal: context.signal,
            });
      } catch (error) {
        throw mapExecutorError(
          error,
          adapter,
          "broadcast",
          "BROADCAST_FAILED",
          "Failed to broadcast Tron transfer"
        );
      }
      return confirm(adapter, submission, context);
    },
  };
}

function isNative(execution: TronExecution): boolean {
  const standard = execution.standard?.trim().toLowerCase();
  if (standard === "native" || standard === "trx") return true;
  if (standard === "trc20" || standard === "token") return false;
  return !execution.tokenAddress;
}

function invalid(message: string): SwapSdkError {
  return new SwapSdkError("INVALID_TRANSACTION", "sign", message);
}

async function confirm(
  adapter: TronWalletAdapter,
  submission: TransactionSubmission,
  context: ExecutionContext
): Promise<ChainExecutionResult> {
  if (context.waitFor === "submitted" || !adapter.waitForTransaction) {
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
    return {
      status: "source-confirmed",
      txHash: submission.txHash,
      raw: confirmation ?? submission.raw,
    };
  } catch (error) {
    throw mapExecutorError(
      error,
      adapter,
      "broadcast",
      "BROADCAST_FAILED",
      "Failed while confirming Tron transfer"
    );
  }
}
