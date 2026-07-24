import { SwapSdkError } from "../../core/errors";
import type {
  ChainExecutionResult,
  ChainExecutor,
  ExecutionContext,
} from "../../core/registry";
import type {
  EvmApproval,
  EvmSigningRequest,
  EvmTx,
  SwapExecution,
} from "../../types/execution";
import {
  exposeExecutorSigner,
  mapExecutorError,
  requestSignApproval,
  throwIfAborted,
  type ExecutorErrorAdapter,
  type TransactionSubmission,
} from "../shared";

type EvmExecution = Extract<
  SwapExecution,
  { kind: "evm-transaction" | "evm-signature" }
>;

export interface EvmWalletAdapter extends ExecutorErrorAdapter {
  sendTransaction(
    tx: EvmTx,
    options: { signal?: AbortSignal }
  ): Promise<TransactionSubmission>;
  signTypedData(
    request: EvmSigningRequest,
    options: { signal?: AbortSignal }
  ): Promise<string>;
  isApprovalRequired?(approval: EvmApproval): boolean | Promise<boolean>;
  waitForTransaction?(
    txHash: string,
    options: { signal?: AbortSignal }
  ): Promise<unknown>;
}

export function createEvmExecutor(
  adapter: EvmWalletAdapter
): ChainExecutor<"evm-transaction" | "evm-signature"> {
  return {
    ...exposeExecutorSigner("evm", adapter),
    kinds: ["evm-transaction", "evm-signature"],

    async validate(execution, context) {
      throwIfAborted(context.signal, "sign");
      if (execution.kind === "evm-signature") {
        const expectedChainId = execution.request.chainId;
        const domainChainId = execution.request.typedData.domain.chainId;
        if (
          domainChainId !== undefined &&
          String(domainChainId) !== String(expectedChainId)
        ) {
          throw new SwapSdkError(
            "CHAIN_MISMATCH",
            "sign",
            `EIP-712 domain chain ${String(domainChainId)} does not match request chain ${expectedChainId}`
          );
        }
      }
    },

    async execute(execution, context) {
      return execution.kind === "evm-signature"
        ? executeSignature(adapter, execution, context)
        : executeTransaction(adapter, execution, context);
    },
  };
}

async function executeSignature(
  adapter: EvmWalletAdapter,
  execution: Extract<EvmExecution, { kind: "evm-signature" }>,
  context: ExecutionContext
): Promise<ChainExecutionResult> {
  await executeApprovalIfRequired(adapter, execution, context);
  await requestSignApproval(context, execution.chain, execution.kind, {
    router: execution.request.router,
    quoteId: execution.request.quoteId,
    primaryType: execution.request.typedData.primaryType,
  });
  try {
    const signature = await adapter.signTypedData(execution.request, {
      signal: context.signal,
    });
    throwIfAborted(context.signal, "sign");
    if (!signature) {
      throw new SwapSdkError(
        "SIGNING_FAILED",
        "sign",
        "EVM wallet returned an empty signature"
      );
    }
    return {
      status: "submitted",
      signature,
      ...(execution.request.signingScheme
        ? { signingScheme: execution.request.signingScheme }
        : {}),
    };
  } catch (error) {
    throw mapExecutorError(
      error,
      adapter,
      "sign",
      "SIGNING_FAILED",
      "Failed to sign EIP-712 order"
    );
  }
}

async function executeTransaction(
  adapter: EvmWalletAdapter,
  execution: Extract<EvmExecution, { kind: "evm-transaction" }>,
  context: ExecutionContext
): Promise<ChainExecutionResult> {
  await executeApprovalIfRequired(adapter, execution, context);

  await requestSignApproval(context, execution.chain, execution.kind, {
    to: execution.tx.to,
    value: execution.tx.value,
    chainId: execution.tx.chainId,
  });
  let submission: TransactionSubmission;
  try {
    submission = await adapter.sendTransaction(execution.tx, {
      signal: context.signal,
    });
  } catch (error) {
    throw mapExecutorError(
      error,
      adapter,
      "broadcast",
      "BROADCAST_FAILED",
      "Failed to broadcast EVM transaction"
    );
  }

  return confirmIfRequested(adapter, submission, context);
}

async function executeApprovalIfRequired(
  adapter: EvmWalletAdapter,
  execution: EvmExecution,
  context: ExecutionContext
): Promise<void> {
  if (execution.approval) {
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
        "Failed to determine EVM approval requirement"
      );
    }
    if (approvalRequired) {
      await sendApproval(adapter, execution, execution.approval, context);
    }
  }
}

async function sendApproval(
  adapter: EvmWalletAdapter,
  execution: EvmExecution,
  approval: EvmApproval,
  context: ExecutionContext
): Promise<void> {
  context.emit({
    type: "approval-requested",
    executionId: context.executionId,
  });
  await requestSignApproval(context, execution.chain, "evm-approval", {
    spender: approval.spender,
    to: approval.tx.to,
  });
  try {
    const submission = await adapter.sendTransaction(approval.tx, {
      signal: context.signal,
    });
    context.emit({
      type: "approval-submitted",
      executionId: context.executionId,
      txHash: submission.txHash,
    });
    if (adapter.waitForTransaction) {
      await adapter.waitForTransaction(submission.txHash, {
        signal: context.signal,
      });
    }
  } catch (error) {
    throw mapExecutorError(
      error,
      adapter,
      "approve",
      "APPROVAL_FAILED",
      "Failed to approve EVM token"
    );
  }
}

async function confirmIfRequested(
  adapter: EvmWalletAdapter,
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
  if (!adapter.waitForTransaction) {
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
      "Failed while confirming EVM transaction"
    );
  }
}
