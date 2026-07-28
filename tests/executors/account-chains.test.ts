import { describe, expect, it, vi } from "vitest";
import type { ExecutionContext } from "../../src/core/registry";
import {
  createAptosExecutor,
  type AptosWalletAdapter,
} from "../../src/executors/aptos";
import {
  createNearExecutor,
  type NearWalletAdapter,
} from "../../src/executors/near";
import {
  createSolanaExecutor,
  type SolanaWalletAdapter,
} from "../../src/executors/solana";
import type { SwapExecution } from "../../src/types/execution";

function context(
  overrides: Partial<ExecutionContext> = {}
): ExecutionContext {
  return {
    executionId: "exec-account",
    waitFor: "submitted",
    emit: vi.fn(),
    ...overrides,
  };
}

describe("createSolanaExecutor", () => {
  const execution: Extract<
    SwapExecution,
    { kind: "solana-transaction" }
  > = {
    kind: "solana-transaction",
    chain: "solana",
    transaction: "AQIDBA==",
    format: "base64-v0",
    metadata: {
      txValidUntil: 100,
      recentBlockhash: "blockhash",
    },
  };

  it("rejects an expired transaction before signing", async () => {
    const adapter: SolanaWalletAdapter = {
      getChain: () => "solana",
      getCurrentBlockHeight: () => 101,
      signAndSendTransaction: vi.fn(async () => ({ txHash: "sol-hash" })),
      waitForTransaction: vi.fn(async () => ({ status: "confirmed" })),
    };
    const executor = createSolanaExecutor(adapter);

    await expect(executor.validate(execution, context())).rejects.toMatchObject({
      code: "INVALID_TRANSACTION",
      stage: "sign",
    });
    expect(adapter.signAndSendTransaction).not.toHaveBeenCalled();
  });

  it("forwards serialized transaction and waits for confirmation", async () => {
    const adapter: SolanaWalletAdapter = {
      getChain: () => "solana",
      getCurrentBlockHeight: () => 99,
      signAndSendTransaction: vi.fn(async () => ({ txHash: "sol-hash" })),
      waitForTransaction: vi.fn(async () => ({
        status: "confirmed",
        raw: { slot: 1 },
      })),
    };
    const executor = createSolanaExecutor(adapter);
    const ctx = context({ waitFor: "source-confirmed" });

    await executor.validate(execution, ctx);
    await expect(executor.execute(execution, ctx)).resolves.toMatchObject({
      status: "source-confirmed",
      txHash: "sol-hash",
      raw: { slot: 1 },
    });
    expect(adapter.signAndSendTransaction).toHaveBeenCalledWith({
      transaction: "AQIDBA==",
      format: "base64-v0",
      metadata: execution.metadata,
      signal: undefined,
    });
  });
});

describe("createAptosExecutor", () => {
  it("forwards an entry-function payload without coercing arguments", async () => {
    const adapter: AptosWalletAdapter = {
      getChain: () => "aptos",
      signAndSubmitTransaction: vi.fn(async () => ({ txHash: "aptos-hash" })),
      waitForTransaction: vi.fn(async () => ({ status: "confirmed" })),
    };
    const executor = createAptosExecutor(adapter);
    const execution: Extract<
      SwapExecution,
      { kind: "aptos-entry-function" }
    > = {
      kind: "aptos-entry-function",
      chain: "aptos",
      function: "0x1::coin::transfer",
      typeArguments: ["0x1::aptos_coin::AptosCoin"],
      functionArguments: ["0xabc", "10000000000000000000"],
    };

    await executor.validate(execution, context());
    await expect(executor.execute(execution, context())).resolves.toMatchObject({
      status: "submitted",
      txHash: "aptos-hash",
    });
    expect(adapter.signAndSubmitTransaction).toHaveBeenCalledWith(
      {
        function: execution.function,
        typeArguments: execution.typeArguments,
        functionArguments: execution.functionArguments,
      },
      { signal: undefined }
    );
  });
});

describe("createNearExecutor", () => {
  it("returns all hashes and uses the last hash as the business transaction", async () => {
    const adapter: NearWalletAdapter = {
      getChain: () => "near",
      signAndSendTransactions: vi.fn(async () => ({
        txHashes: ["register-hash", "swap-hash"],
        raw: { ok: true },
      })),
      waitForTransactions: vi.fn(async () => ({
        status: "confirmed",
        raw: { final: true },
      })),
    };
    const executor = createNearExecutor(adapter);
    const execution: Extract<
      SwapExecution,
      { kind: "near-transaction-batch" }
    > = {
      kind: "near-transaction-batch",
      chain: "near",
      transactions: [
        { receiverId: "token.near", actions: [{ type: "Register" }] },
        { receiverId: "dex.near", actions: [{ type: "Swap" }] },
      ],
    };
    const ctx = context({ waitFor: "source-confirmed" });

    await executor.validate(execution, ctx);
    await expect(executor.execute(execution, ctx)).resolves.toMatchObject({
      status: "source-confirmed",
      txHash: "swap-hash",
      txHashes: ["register-hash", "swap-hash"],
      raw: { final: true },
    });
    expect(adapter.waitForTransactions).toHaveBeenCalledWith(
      ["register-hash", "swap-hash"],
      { signal: undefined }
    );
  });

  it("rejects an empty transaction batch", async () => {
    const adapter: NearWalletAdapter = {
      getChain: () => "near",
      signAndSendTransactions: vi.fn(async () => ({ txHashes: ["hash"] })),
      waitForTransactions: vi.fn(async () => ({ status: "confirmed" })),
    };
    const executor = createNearExecutor(adapter);

    await expect(
      executor.validate(
        {
          kind: "near-transaction-batch",
          chain: "near",
          transactions: [],
        },
        context()
      )
    ).rejects.toMatchObject({ code: "INVALID_TRANSACTION", stage: "sign" });
  });
});
