import { SwapSdkError } from "../../core/errors";
import type {
  ChainExecutionResult,
  ChainExecutor,
  ExecutionContext,
} from "../../core/registry";
import type { ChainRef } from "../../types/chain";
import type {
  SwapExecution,
  TronApproval,
  TronUnsignedTransaction,
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

type TronTransferExecution = Extract<SwapExecution, { kind: "tron-transfer" }>;
type TronTransactionExecution = Extract<
  SwapExecution,
  { kind: "tron-transaction" }
>;

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
  /** Required for RHEA `tron-raw-data` / TriggerSmartContract builds. */
  signAndSendTransaction?(input: {
    transaction: TronUnsignedTransaction;
    signal?: AbortSignal;
  }): Promise<TransactionSubmission>;
  isApprovalRequired?(approval: TronApproval): boolean | Promise<boolean>;
  waitForTransaction(
    txHash: string,
    options: { signal?: AbortSignal }
  ): Promise<TransactionConfirmation>;
}

export function createTronExecutor(
  adapter: TronWalletAdapter
): ChainExecutor<"tron-transfer" | "tron-transaction"> {
  return {
    ...exposeExecutorSigner("tron", adapter),
    kinds: ["tron-transfer", "tron-transaction"],

    async validate(execution, context) {
      throwIfAborted(context.signal, "sign");
      assertChain(execution.chain, await adapter.getChain());
      if (execution.kind === "tron-transaction") {
        validateTronTransaction(adapter, execution);
        return;
      }
      validateTronTransfer(adapter, execution);
    },

    async execute(execution, context) {
      return execution.kind === "tron-transaction"
        ? executeTronTransaction(adapter, execution, context)
        : executeTronTransfer(adapter, execution, context);
    },
  };
}

function validateTronTransfer(
  adapter: TronWalletAdapter,
  execution: TronTransferExecution
): void {
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
}

function validateTronTransaction(
  adapter: TronWalletAdapter,
  execution: TronTransactionExecution
): void {
  if (!adapter.signAndSendTransaction) {
    throw invalid(
      "Tron wallet adapter must implement signAndSendTransaction for tron-raw-data builds"
    );
  }
  assertTronUnsignedTransaction(execution.transaction, "transaction");
  if (execution.approval) {
    assertTronUnsignedTransaction(
      execution.approval.transaction,
      "approval.transaction"
    );
  }
}

async function executeTronTransfer(
  adapter: TronWalletAdapter,
  execution: TronTransferExecution,
  context: ExecutionContext
): Promise<ChainExecutionResult> {
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
  return confirm(adapter, submission, context, "transfer");
}

async function executeTronTransaction(
  adapter: TronWalletAdapter,
  execution: TronTransactionExecution,
  context: ExecutionContext
): Promise<ChainExecutionResult> {
  await executeApprovalIfRequired(adapter, execution, context);

  await requestSignApproval(context, execution.chain, execution.kind, {
    format: execution.format,
    txID: execution.transaction.txID,
  });

  let submission: TransactionSubmission;
  try {
    submission = await requireSignAndSend(adapter)({
      transaction: execution.transaction,
      signal: context.signal,
    });
  } catch (error) {
    throw mapExecutorError(
      error,
      adapter,
      "broadcast",
      "BROADCAST_FAILED",
      "Failed to sign or broadcast Tron transaction"
    );
  }

  return confirm(adapter, submission, context, "transaction");
}

async function executeApprovalIfRequired(
  adapter: TronWalletAdapter,
  execution: TronTransactionExecution,
  context: ExecutionContext
): Promise<void> {
  if (!execution.approval) return;

  let approvalRequired: boolean;
  try {
    approvalRequired = adapter.isApprovalRequired
      ? await adapter.isApprovalRequired(execution.approval)
      : true;
  } catch (error) {
    throw mapExecutorError(
      error,
      adapter,
      "approve",
      "APPROVAL_FAILED",
      "Failed to determine Tron approval requirement"
    );
  }
  if (!approvalRequired) return;

  context.emit({
    type: "approval-requested",
    executionId: context.executionId,
  });
  await requestSignApproval(context, execution.chain, "tron-approval", {
    txID: execution.approval.transaction.txID,
  });
  try {
    const submission = await requireSignAndSend(adapter)({
      transaction: execution.approval.transaction,
      signal: context.signal,
    });
    context.emit({
      type: "approval-submitted",
      executionId: context.executionId,
      txHash: submission.txHash,
    });
    const confirmation = await adapter.waitForTransaction(submission.txHash, {
      signal: context.signal,
    });
    assertTransactionConfirmed(confirmation, {
      code: "APPROVAL_FAILED",
      stage: "approve",
      message: "Tron approval transaction failed",
    });
  } catch (error) {
    throw mapExecutorError(
      error,
      adapter,
      "approve",
      "APPROVAL_FAILED",
      "Failed to approve TRC20 token"
    );
  }
}

function requireSignAndSend(
  adapter: TronWalletAdapter
): NonNullable<TronWalletAdapter["signAndSendTransaction"]> {
  if (!adapter.signAndSendTransaction) {
    throw invalid(
      "Tron wallet adapter must implement signAndSendTransaction for tron-raw-data builds"
    );
  }
  return adapter.signAndSendTransaction.bind(adapter);
}

function assertTronUnsignedTransaction(
  transaction: TronUnsignedTransaction,
  label: string
): void {
  if (!transaction.txID?.trim()) {
    throw invalid(`Missing Tron ${label}.txID`);
  }
  if (!transaction.raw_data_hex?.trim()) {
    throw invalid(`Missing Tron ${label}.raw_data_hex`);
  }
  if (
    typeof transaction.raw_data !== "object" ||
    transaction.raw_data === null
  ) {
    throw invalid(`Missing Tron ${label}.raw_data`);
  }
}

function isNative(execution: TronTransferExecution): boolean {
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
  context: ExecutionContext,
  kind: "transfer" | "transaction"
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
      message: "Tron transaction failed",
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
      kind === "transfer"
        ? "Failed while confirming Tron transfer"
        : "Failed while confirming Tron transaction"
    );
  }
}
