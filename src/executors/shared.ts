import {
  SwapSdkError,
  type SwapErrorCode,
  type SwapErrorStage,
} from "../core/errors";
import type {
  ChainExecutor,
  ExecutionContext,
  MessageSignOptions,
} from "../core/registry";
import type { ChainRef } from "../types/chain";

export interface TransactionSubmission {
  txHash: string;
  raw?: unknown;
}

export interface ExecutorErrorAdapter {
  isUserRejection?(error: unknown): boolean;
  /** Identity serialized as `mca.signer.identityKey` for MCA quotes. */
  getIdentityKey?(): string | Promise<string>;
  /**
   * Optional offline message signing for flows such as MCA relayer withdraw.
   * Chain transfer executors do not call this during normal swap execution.
   */
  signMessage?(
    message: string,
    options?: MessageSignOptions
  ): Promise<string>;
}

export function exposeExecutorSigner(
  signerChain: string,
  adapter: ExecutorErrorAdapter
): Pick<
  ChainExecutor,
  "signerChain" | "getIdentityKey" | "signMessage"
> {
  return {
    signerChain,
    ...(adapter.getIdentityKey
      ? { getIdentityKey: () => adapter.getIdentityKey!() }
      : {}),
    ...(adapter.signMessage
      ? {
          signMessage: (
            message: string,
            options?: MessageSignOptions
          ) => adapter.signMessage!(message, options),
        }
      : {}),
  };
}

export function throwIfAborted(
  signal: AbortSignal | undefined,
  stage: SwapErrorStage = "sign"
): void {
  if (!signal?.aborted) return;
  throw new SwapSdkError("REQUEST_ABORTED", stage, "Execution was aborted", {
    cause: signal.reason,
  });
}

export function assertChain(
  expected: ChainRef,
  actual: ChainRef,
  stage: SwapErrorStage = "sign"
): void {
  if (expected === actual) return;
  throw new SwapSdkError(
    "CHAIN_MISMATCH",
    stage,
    `Connected chain ${actual} does not match execution chain ${expected}`,
    { details: { expected, actual } }
  );
}

export async function requestSignApproval(
  context: ExecutionContext,
  chain: ChainRef,
  kind: string,
  summary: Record<string, unknown>
): Promise<void> {
  throwIfAborted(context.signal, "sign");
  await context.beforeSign?.({ chain, kind, summary });
  throwIfAborted(context.signal, "sign");
}

export function mapExecutorError(
  error: unknown,
  adapter: ExecutorErrorAdapter,
  stage: SwapErrorStage,
  code: SwapErrorCode,
  message: string
): SwapSdkError {
  if (error instanceof SwapSdkError) return error;
  if (isUserRejection(error, adapter)) {
    return new SwapSdkError("USER_REJECTED", stage, "User rejected the request", {
      cause: error,
    });
  }
  return new SwapSdkError(code, stage, message, { cause: error });
}

function isUserRejection(
  error: unknown,
  adapter: ExecutorErrorAdapter
): boolean {
  if (adapter.isUserRejection?.(error)) return true;
  if (typeof error !== "object" || error === null) return false;
  const code = "code" in error ? error.code : undefined;
  if (code === 4001 || code === "ACTION_REJECTED") return true;
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message.toLowerCase()
      : "";
  return /user (rejected|denied)|request rejected|cancelled by user/.test(message);
}
