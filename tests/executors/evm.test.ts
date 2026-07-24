import { describe, expect, it, vi } from "vitest";
import type { ExecutionContext } from "../../src/core/registry";
import {
  createEvmExecutor,
  type EvmWalletAdapter,
} from "../../src/executors/evm";
import type { SwapExecution } from "../../src/types/execution";

function context(
  overrides: Partial<ExecutionContext> = {}
): ExecutionContext {
  return {
    executionId: "exec-evm",
    waitFor: "submitted",
    emit: vi.fn(),
    ...overrides,
  };
}

const txExecution: Extract<SwapExecution, { kind: "evm-transaction" }> = {
  kind: "evm-transaction",
  chain: "1",
  tx: {
    to: "0x1111111111111111111111111111111111111111",
    data: "0xabcdef",
    value: "0",
    gasLimit: "21000",
    chainId: 1,
  },
};

function wallet(
  overrides: Partial<EvmWalletAdapter> = {}
): EvmWalletAdapter {
  return {
    sendTransaction: vi.fn(async () => ({ txHash: "0xswap" })),
    signTypedData: vi.fn(async () => "0xsignature"),
    ...overrides,
  };
}

describe("createEvmExecutor", () => {
  it("exposes the adapter identity and message signing methods", async () => {
    const getIdentityKey = vi.fn(async () => "0xabc");
    const signMessage = vi.fn(async () => "0xmessage-signature");
    const executor = createEvmExecutor(
      wallet({
        getIdentityKey,
        signMessage,
      })
    );
    const options = {
      signal: undefined,
      context: { flow: "withdraw" },
    };

    expect(executor.signerChain).toBe("evm");
    await expect(executor.getIdentityKey?.()).resolves.toBe("0xabc");
    await expect(
      executor.signMessage?.("message", options)
    ).resolves.toBe("0xmessage-signature");
    expect(getIdentityKey).toHaveBeenCalledTimes(1);
    expect(signMessage).toHaveBeenCalledWith("message", options);
  });

  it("validates a transaction without reading the provider network", async () => {
    const executor = createEvmExecutor(wallet());

    await expect(
      executor.validate(txExecution, context())
    ).resolves.toBeUndefined();
  });

  it("sends approval before swap and emits approval events", async () => {
    const adapter = wallet({
      isApprovalRequired: async () => true,
      sendTransaction: vi
        .fn()
        .mockResolvedValueOnce({ txHash: "0xapprove" })
        .mockResolvedValueOnce({ txHash: "0xswap" }),
    });
    const executor = createEvmExecutor(adapter);
    const execution: typeof txExecution = {
      ...txExecution,
      approval: {
        spender: "0x2222222222222222222222222222222222222222",
        tx: { ...txExecution.tx, data: "0x1234" },
      },
    };
    const events: string[] = [];
    const ctx = context({ emit: (event) => events.push(event.type) });

    const result = await executor.execute(execution, ctx);

    expect(adapter.sendTransaction).toHaveBeenCalledTimes(2);
    expect(events).toEqual(["approval-requested", "approval-submitted"]);
    expect(result).toMatchObject({ status: "submitted", txHash: "0xswap" });
  });

  it("skips an unnecessary approval", async () => {
    const adapter = wallet({ isApprovalRequired: async () => false });
    const executor = createEvmExecutor(adapter);
    const execution: typeof txExecution = {
      ...txExecution,
      approval: {
        spender: "0x2222222222222222222222222222222222222222",
        tx: { ...txExecution.tx, data: "0x1234" },
      },
    };

    await executor.execute(execution, context());
    expect(adapter.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("signs EIP-712 orders and returns the signature", async () => {
    const adapter = wallet();
    const executor = createEvmExecutor(adapter);
    const execution: Extract<SwapExecution, { kind: "evm-signature" }> = {
      kind: "evm-signature",
      chain: "56",
      request: {
        type: "eip712",
        router: "cow",
        quoteId: "quote-1",
        chainId: 56,
        typedData: {
          domain: { chainId: 56 },
          types: { Order: [{ name: "amount", type: "uint256" }] },
          primaryType: "Order",
          message: { amount: "1000" },
        },
      },
    };

    await executor.validate(execution, context());
    await expect(executor.execute(execution, context())).resolves.toMatchObject({
      status: "submitted",
      signature: "0xsignature",
    });
    expect(adapter.signTypedData).toHaveBeenCalledWith(
      execution.request,
      expect.objectContaining({ signal: undefined })
    );
  });

  it("rejects an EIP-712 domain chain mismatch", async () => {
    const executor = createEvmExecutor(wallet());
    const execution: Extract<SwapExecution, { kind: "evm-signature" }> = {
      kind: "evm-signature",
      chain: "56",
      request: {
        type: "eip712",
        router: "cow",
        chainId: 56,
        typedData: {
          domain: { chainId: 1 },
          types: { Order: [{ name: "amount", type: "uint256" }] },
          primaryType: "Order",
          message: { amount: "1000" },
        },
      },
    };

    await expect(
      executor.validate(execution, context())
    ).rejects.toMatchObject({
      code: "CHAIN_MISMATCH",
      stage: "sign",
    });
  });

  it("executes a required approval before signing an EIP-712 order", async () => {
    const calls: string[] = [];
    const adapter = wallet({
      isApprovalRequired: vi.fn(async () => true),
      sendTransaction: vi.fn(async () => {
        calls.push("approve");
        return { txHash: "0xapprove" };
      }),
      signTypedData: vi.fn(async () => {
        calls.push("sign");
        return "0xsignature";
      }),
    });
    const executor = createEvmExecutor(adapter);
    const execution = {
      kind: "evm-signature",
      chain: "56",
      request: {
        type: "eip712",
        router: "cow",
        quoteId: "quote-1",
        chainId: 56,
        typedData: {
          domain: { chainId: 56 },
          types: { Order: [{ name: "amount", type: "uint256" }] },
          primaryType: "Order",
          message: { amount: "1000" },
        },
      },
      approval: {
        spender: "0x2222222222222222222222222222222222222222",
        tx: {
          to: "0x3333333333333333333333333333333333333333",
          data: "0xaabb",
          value: "0",
          gasLimit: "60000",
          chainId: 56,
        },
      },
    } as unknown as Extract<SwapExecution, { kind: "evm-signature" }>;

    await executor.execute(execution, context());

    expect(calls).toEqual(["approve", "sign"]);
    expect(adapter.waitForTransaction).toBeUndefined();
  });

  it("waits for confirmation when requested", async () => {
    const adapter = wallet({ waitForTransaction: vi.fn(async () => ({ ok: true })) });
    const executor = createEvmExecutor(adapter);

    await expect(
      executor.execute(txExecution, context({ waitFor: "source-confirmed" }))
    ).resolves.toMatchObject({ status: "source-confirmed", txHash: "0xswap" });
    expect(adapter.waitForTransaction).toHaveBeenCalledWith(
      "0xswap",
      expect.objectContaining({ signal: undefined })
    );
  });

  it("maps wallet rejection to USER_REJECTED", async () => {
    const rejected = Object.assign(new Error("User rejected request"), {
      code: 4001,
    });
    const adapter = wallet({
      sendTransaction: vi.fn(async () => Promise.reject(rejected)),
    });
    const executor = createEvmExecutor(adapter);

    await expect(executor.execute(txExecution, context())).rejects.toMatchObject({
      code: "USER_REJECTED",
      stage: "broadcast",
    });
  });
});
