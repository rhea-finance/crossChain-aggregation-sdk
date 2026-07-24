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
  type TransactionSubmission,
} from "../shared";

export interface SuiWalletAdapter extends ExecutorErrorAdapter {
  getChain(): ChainRef | Promise<ChainRef>;
  isAddress(address: string): boolean;
  transferCoin(input: {
    amount: string;
    depositAddress: string;
    coinType: string;
    signal?: AbortSignal;
  }): Promise<TransactionSubmission>;
  waitForTransaction?(
    txHash: string,
    options: { signal?: AbortSignal }
  ): Promise<unknown>;
}

export function createSuiExecutor(
  adapter: SuiWalletAdapter
): ChainExecutor<"sui-transfer"> {
  return {
    ...exposeExecutorSigner("sui", adapter),
    kinds: ["sui-transfer"],

    async validate(execution, context) {
      throwIfAborted(context.signal, "sign");
      assertChain(execution.chain, await adapter.getChain());
      if (!adapter.isAddress(execution.depositAddress)) {
        throw new SwapSdkError(
          "INVALID_TRANSACTION",
          "sign",
          "Invalid Sui deposit address"
        );
      }
      if (
        execution.coinType.toLowerCase().startsWith("nep141:") ||
        !/^0x[0-9a-fA-F]+::[A-Za-z_][\w]*::[A-Za-z_][\w]*$/.test(
          execution.coinType
        )
      ) {
        throw new SwapSdkError(
          "INVALID_TRANSACTION",
          "sign",
          "Invalid Sui Move coin type"
        );
      }
    },

    async execute(execution, context) {
      await requestSignApproval(context, execution.chain, execution.kind, {
        amount: execution.amount,
        depositAddress: execution.depositAddress,
        coinType: execution.coinType,
      });
      let submission: TransactionSubmission;
      try {
        submission = await adapter.transferCoin({
          amount: execution.amount,
          depositAddress: execution.depositAddress,
          coinType: execution.coinType,
          signal: context.signal,
        });
      } catch (error) {
        throw mapExecutorError(
          error,
          adapter,
          "broadcast",
          "BROADCAST_FAILED",
          "Failed to broadcast Sui transfer"
        );
      }
      return confirm(adapter, submission, context);
    },
  };
}

async function confirm(
  adapter: SuiWalletAdapter,
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
      "Failed while confirming Sui transfer"
    );
  }
}
