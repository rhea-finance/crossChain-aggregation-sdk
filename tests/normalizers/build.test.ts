import { describe, expect, it } from "vitest";
import { normalizeBuild } from "../../src/normalizers/build";
import { buildFixtures } from "../fixtures/builds";

describe("normalizeBuild", () => {
  it.each([
    ["evmTransaction", "evm-transaction"],
    ["evmSignature", "evm-signature"],
    ["solana", "solana-transaction"],
    ["aptos", "aptos-entry-function"],
    ["near", "near-transaction-batch"],
    ["tron", "tron-transfer"],
    ["bitcoin", "bitcoin-transfer"],
    ["zcash", "zcash-transfer"],
    ["sui", "sui-transfer"],
  ] as const)("normalizes %s", (fixture, kind) => {
    const raw = buildFixtures[fixture];
    const result = normalizeBuild(raw);

    expect(result.execution.kind).toBe(kind);
    expect(result.raw).toBe(raw);
    expect(result.amountIn).toBe("1000");
  });

  it.each([
    ["evmTransaction", "1"],
    ["evmSignature", "56"],
    ["solana", "solana"],
    ["aptos", "aptos"],
    ["near", "near"],
    ["tron", "tron"],
    ["bitcoin", "btc"],
    ["zcash", "zcash"],
    ["sui", "sui"],
  ] as const)("uses canonical direct chain id for %s", (fixture, chain) => {
    const result = normalizeBuild(buildFixtures[fixture]);

    expect(result.fromChain).toBe(chain);
    expect(result.execution.chain).toBe(chain);
    expect(result.tokenIn.chain).toBe(chain);
  });

  it("normalizes a hexadecimal raw EVM chain id", () => {
    const result = normalizeBuild({
      ...buildFixtures.evmTransaction,
      fromChain: "0x1",
    });

    expect(result.fromChain).toBe("1");
    expect(result.execution.chain).toBe("1");
  });

  it("normalizes JSON-RPC hex quantities in an EVM transaction", () => {
    const result = normalizeBuild({
      ...buildFixtures.evmTransaction,
      fromChain: "8453",
      tx: {
        ...(buildFixtures.evmTransaction.tx as Record<string, unknown>),
        value: "0x0",
        gasLimit: "0x186a0",
        chainId: 8453,
      },
    });

    expect(result.execution).toMatchObject({
      kind: "evm-transaction",
      tx: {
        value: "0",
        gasLimit: "100000",
        chainId: 8453,
      },
    });
  });

  it("normalizes JSON-RPC hex quantities in an EVM approval", () => {
    const result = normalizeBuild({
      ...buildFixtures.evmTransaction,
      approve: {
        spender: "0x2222222222222222222222222222222222222222",
        tx: {
          to: "0x3333333333333333333333333333333333333333",
          data: "0xaabb",
          value: "0x0",
          gasLimit: "0xea60",
          chainId: 1,
        },
      },
    });

    expect(result.execution).toMatchObject({
      kind: "evm-transaction",
      approval: {
        tx: {
          value: "0",
          gasLimit: "60000",
        },
      },
    });
  });

  it.each(["0x", "0xgg", "-1", "1.5", "1e3"])(
    "rejects malformed EVM quantity %s",
    (value) => {
      expect(() =>
        normalizeBuild({
          ...buildFixtures.evmTransaction,
          tx: {
            ...(buildFixtures.evmTransaction.tx as Record<string, unknown>),
            value,
          },
        })
      ).toThrowError(
        expect.objectContaining({
          code: "INVALID_API_RESPONSE",
          stage: "build",
        })
      );
    }
  );

  it("turns a single NEAR transaction into a batch", () => {
    const result = normalizeBuild(buildFixtures.near);
    expect(result.execution).toMatchObject({
      kind: "near-transaction-batch",
      transactions: [{ receiverId: "wrap.near" }],
    });
  });

  it("preserves approval data for an EVM signature order", () => {
    const result = normalizeBuild({
      ...buildFixtures.evmSignature,
      approve: {
        spender: "0x2222222222222222222222222222222222222222",
        tx: {
          to: "0x3333333333333333333333333333333333333333",
          data: "0xaabb",
          value: "0",
          gasLimit: "60000",
          chainId: 56,
        },
      },
    });

    expect(result.execution).toMatchObject({
      kind: "evm-signature",
      approval: {
        spender: "0x2222222222222222222222222222222222222222",
        tx: { chainId: 56, data: "0xaabb" },
      },
    });
  });

  it("uses the signing request router for a prebuilt signature order", () => {
    const result = normalizeBuild({
      ...buildFixtures.evmSignature,
      router: "aggregate-router",
      orderId: "order-1",
    });

    expect(result.order).toMatchObject({
      orderId: "order-1",
      router: "cow",
      chainId: "56",
    });
  });

  it("rejects chain and transaction mismatches", () => {
    expect(() =>
      normalizeBuild({ ...buildFixtures.bitcoin, chainType: "sui" })
    ).toThrowError(expect.objectContaining({ code: "CHAIN_MISMATCH" }));
  });

  it("rejects OMFT ids as Sui Move coin types", () => {
    expect(() =>
      normalizeBuild({
        ...buildFixtures.sui,
        tx: {
          ...(buildFixtures.sui.tx as Record<string, unknown>),
          coinType: "nep141:sui.omft.near",
        },
      })
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_API_RESPONSE" })
    );
  });

  it("rejects invalid amount strings before execution", () => {
    expect(() =>
      normalizeBuild({ ...buildFixtures.bitcoin, amountIn: "1e8" })
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_API_RESPONSE",
        stage: "build",
      })
    );
  });
});
