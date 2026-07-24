import { describe, expect, it, vi } from "vitest";
import type { ExecutionContext } from "../../src/core/registry";
import {
  createBitcoinExecutor,
  type BitcoinWalletAdapter,
} from "../../src/executors/bitcoin";
import {
  createSuiExecutor,
  type SuiWalletAdapter,
} from "../../src/executors/sui";
import {
  createTronExecutor,
  type TronWalletAdapter,
} from "../../src/executors/tron";
import {
  createZcashExecutor,
  type ZcashWalletAdapter,
} from "../../src/executors/zcash";
import type { SwapExecution } from "../../src/types/execution";

function context(
  overrides: Partial<ExecutionContext> = {}
): ExecutionContext {
  return {
    executionId: "exec-transfer",
    waitFor: "submitted",
    emit: vi.fn(),
    ...overrides,
  };
}

describe("createTronExecutor", () => {
  const native: Extract<SwapExecution, { kind: "tron-transfer" }> = {
    kind: "tron-transfer",
    chain: "tron",
    amount: "1000000",
    depositAddress: "TReceiver",
    standard: "native",
  };

  function adapter(): TronWalletAdapter {
    return {
      getChain: () => "tron",
      isAddress: (address) => address.startsWith("T"),
      sendNativeTransfer: vi.fn(async () => ({ txHash: "tron-native" })),
      sendTokenTransfer: vi.fn(async () => ({ txHash: "tron-token" })),
    };
  }

  it("dispatches native and TRC20 transfers separately", async () => {
    const wallet = adapter();
    const executor = createTronExecutor(wallet);
    const token: typeof native = {
      ...native,
      tokenAddress: "TToken",
      standard: "trc20",
    };

    await executor.validate(native, context());
    await executor.execute(native, context());
    await executor.validate(token, context());
    await executor.execute(token, context());

    expect(wallet.sendNativeTransfer).toHaveBeenCalledWith({
      amount: "1000000",
      depositAddress: "TReceiver",
      signal: undefined,
    });
    expect(wallet.sendTokenTransfer).toHaveBeenCalledWith({
      amount: "1000000",
      depositAddress: "TReceiver",
      tokenAddress: "TToken",
      signal: undefined,
    });
  });

  it("rejects OMFT ids as Tron token contracts", async () => {
    const executor = createTronExecutor(adapter());
    await expect(
      executor.validate(
        { ...native, tokenAddress: "nep141:usdt.tether-token.near", standard: "trc20" },
        context()
      )
    ).rejects.toMatchObject({ code: "INVALID_TRANSACTION", stage: "sign" });
  });

  it("rejects TRC20 transfers without a token contract", async () => {
    const executor = createTronExecutor(adapter());
    await expect(
      executor.validate({ ...native, standard: "trc20" }, context())
    ).rejects.toMatchObject({ code: "INVALID_TRANSACTION", stage: "sign" });
  });

  it("confirms a transfer when requested", async () => {
    const wallet = adapter();
    wallet.waitForTransaction = vi.fn(async () => ({ confirmed: true }));
    const executor = createTronExecutor(wallet);

    await expect(
      executor.execute(native, context({ waitFor: "source-confirmed" }))
    ).resolves.toMatchObject({
      status: "source-confirmed",
      txHash: "tron-native",
      raw: { confirmed: true },
    });
  });
});

describe("createBitcoinExecutor", () => {
  const execution: Extract<SwapExecution, { kind: "bitcoin-transfer" }> = {
    kind: "bitcoin-transfer",
    chain: "btc",
    amount: "1000",
    depositAddress: "bc1receiver",
  };
  const adapter: BitcoinWalletAdapter = {
    getChain: () => "btc",
    isAddress: (address) => address.startsWith("bc1"),
    sendTransfer: vi.fn(async () => ({ txHash: "btc-hash" })),
  };

  it("requires a fee rate from the build or executor config", async () => {
    const executor = createBitcoinExecutor(adapter);
    await expect(executor.validate(execution, context())).rejects.toMatchObject({
      code: "INVALID_TRANSACTION",
      stage: "sign",
    });
  });

  it("uses a configured default fee rate", async () => {
    const executor = createBitcoinExecutor(adapter, { defaultFeeRate: 4 });
    await executor.validate(execution, context());
    await executor.execute(execution, context());
    expect(adapter.sendTransfer).toHaveBeenCalledWith({
      amount: "1000",
      depositAddress: "bc1receiver",
      feeRate: 4,
      signal: undefined,
    });
  });

  it("honors an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const executor = createBitcoinExecutor(adapter, { defaultFeeRate: 4 });
    await expect(
      executor.validate(execution, context({ signal: controller.signal }))
    ).rejects.toMatchObject({ code: "REQUEST_ABORTED", stage: "sign" });
  });
});

describe("createZcashExecutor", () => {
  it("returns requires-user-action without inventing a transaction hash", async () => {
    const adapter: ZcashWalletAdapter = {
      getChain: () => "zcash",
      isAddress: (address) => address.startsWith("t1"),
      sendTransfer: vi.fn(async () => ({ requiresUserAction: true })),
    };
    const executor = createZcashExecutor(adapter);
    const execution: Extract<SwapExecution, { kind: "zcash-transfer" }> = {
      kind: "zcash-transfer",
      chain: "zcash",
      amount: "1000",
      depositAddress: "t1receiver",
      decimals: 8,
    };

    await executor.validate(execution, context());
    const result = await executor.execute(execution, context());
    expect(result).toEqual({ status: "requires-user-action" });
    expect(result).not.toHaveProperty("txHash");
  });
});

describe("createSuiExecutor", () => {
  const execution: Extract<SwapExecution, { kind: "sui-transfer" }> = {
    kind: "sui-transfer",
    chain: "sui",
    amount: "100",
    depositAddress: "0xreceiver",
    coinType: "0x2::sui::SUI",
  };

  it("forwards coin type, amount, and recipient", async () => {
    const adapter: SuiWalletAdapter = {
      getChain: () => "sui",
      isAddress: (address) => address.startsWith("0x"),
      transferCoin: vi.fn(async () => ({ txHash: "sui-hash" })),
    };
    const executor = createSuiExecutor(adapter);

    await executor.validate(execution, context());
    await executor.execute(execution, context());
    expect(adapter.transferCoin).toHaveBeenCalledWith({
      amount: "100",
      depositAddress: "0xreceiver",
      coinType: "0x2::sui::SUI",
      signal: undefined,
    });
  });

  it("maps wallet rejection", async () => {
    const adapter: SuiWalletAdapter = {
      getChain: () => "sui",
      isAddress: () => true,
      transferCoin: vi.fn(async () => {
        throw Object.assign(new Error("denied"), { code: 4001 });
      }),
    };
    const executor = createSuiExecutor(adapter);

    await expect(executor.execute(execution, context())).rejects.toMatchObject({
      code: "USER_REJECTED",
      stage: "broadcast",
    });
  });
});
