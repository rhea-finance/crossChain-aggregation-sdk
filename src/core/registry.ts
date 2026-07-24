import { SwapSdkError } from "./errors";
import type {
  SignRequestPreview,
  SwapLifecycleEvent,
  WaitMode,
} from "./lifecycle";
import type { SwapExecution } from "../types/execution";

export interface ChainExecutionResult {
  status: "submitted" | "source-confirmed";
  txHash?: string;
  txHashes?: string[];
  orderId?: string;
  signature?: string;
  signingScheme?: string;
  raw?: unknown;
}

export interface ExecutionContext {
  executionId: string;
  signal?: AbortSignal;
  waitFor: WaitMode;
  emit(event: SwapLifecycleEvent): void;
  beforeSign?: (preview: SignRequestPreview) => void | Promise<void>;
}

export interface MessageSignOptions {
  signal?: AbortSignal;
  context?: Readonly<Record<string, unknown>>;
}

export interface ExecutorIdentityProvider {
  readonly signerChain: string;
  getIdentityKey(): string | Promise<string>;
  signMessage?(
    message: string,
    options?: MessageSignOptions
  ): Promise<string>;
}

export interface ExecutorMessageSigner extends ExecutorIdentityProvider {
  signMessage(
    message: string,
    options?: MessageSignOptions
  ): Promise<string>;
}

export interface ChainExecutor<
  K extends SwapExecution["kind"] = SwapExecution["kind"],
> {
  readonly kinds: readonly K[];
  readonly signerChain?: string;
  getIdentityKey?(): string | Promise<string>;
  signMessage?(
    message: string,
    options?: MessageSignOptions
  ): Promise<string>;
  validate(
    execution: Extract<SwapExecution, { kind: K }>,
    context: ExecutionContext
  ): void | Promise<void>;
  execute(
    execution: Extract<SwapExecution, { kind: K }>,
    context: ExecutionContext
  ): Promise<ChainExecutionResult>;
}

export class ExecutorRegistry {
  private readonly executors = new Map<
    SwapExecution["kind"],
    ChainExecutor
  >();

  constructor(executors: readonly ChainExecutor[] = []) {
    for (const executor of executors) this.register(executor);
  }

  register(executor: ChainExecutor, allowOverride = false): void {
    for (const kind of executor.kinds) {
      if (!allowOverride && this.executors.has(kind)) {
        throw new SwapSdkError(
          "INVALID_REQUEST",
          "build",
          `Executor already registered for ${kind}`
        );
      }
      this.executors.set(kind, executor);
    }
  }

  get<K extends SwapExecution["kind"]>(kind: K): ChainExecutor<K> {
    const executor = this.executors.get(kind);
    if (!executor) {
      throw new SwapSdkError(
        "EXECUTOR_NOT_FOUND",
        "sign",
        `No executor registered for ${kind}`
      );
    }
    return executor as unknown as ChainExecutor<K>;
  }

  getSigner(chain: string, requireSignMessage: true): ExecutorMessageSigner;
  getSigner(
    chain: string,
    requireSignMessage?: false
  ): ExecutorIdentityProvider;
  getSigner(
    chain: string,
    requireSignMessage = false
  ): ExecutorIdentityProvider | ExecutorMessageSigner {
    const executor = Array.from(new Set(this.executors.values())).find(
      (candidate) => candidate.signerChain === chain
    );
    if (!executor) {
      throw new SwapSdkError(
        "EXECUTOR_NOT_FOUND",
        "sign",
        `No executor registered for signer chain ${chain}`
      );
    }
    if (!executor.getIdentityKey) {
      throw new SwapSdkError(
        "SIGNING_FAILED",
        "sign",
        `Executor for signer chain ${chain} must implement getIdentityKey`
      );
    }
    if (requireSignMessage && !executor.signMessage) {
      throw new SwapSdkError(
        "SIGNING_FAILED",
        "sign",
        `Executor for signer chain ${chain} must implement signMessage`
      );
    }
    return executor as ExecutorIdentityProvider | ExecutorMessageSigner;
  }
}
