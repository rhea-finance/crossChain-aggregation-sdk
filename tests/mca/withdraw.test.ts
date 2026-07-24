import { describe, expect, it } from "vitest";
import type {
  SwapBuildRequestRaw,
  SwapMcaRelayerRequestRaw,
} from "../../src/api/rawTypes";
import {
  buildMcaWithdrawRelayerRequest,
  buildNearMcaWithdrawTransactions,
  extractMcaWithdrawBusiness,
  extractMcaWithdrawDepositAddress,
  extractMcaWithdrawSignerWallet,
} from "../../src/mca/withdraw";

describe("MCA withdraw preview extraction", () => {
  it("extracts top-level business", () => {
    expect(
      extractMcaWithdrawBusiness({ business: { action: "withdraw" } })
    ).toEqual({ action: "withdraw" });
  });

  it("extracts business and signer wallet from transaction args", () => {
    const preview = {
      transactions: [
        {
          args: {
            business: { action: "withdraw" },
            signer_wallet: { EVM: "abc" },
          },
        },
      ],
    };

    expect(extractMcaWithdrawBusiness(preview)).toEqual({
      action: "withdraw",
    });
    expect(extractMcaWithdrawSignerWallet(preview)).toEqual({ EVM: "abc" });
  });

  it.each([
    { business: { action: "withdraw" }, signer_wallet: { Near: "a.near" } },
    JSON.stringify({
      business: { action: "withdraw" },
      signer_wallet: { Near: "a.near" },
    }),
  ])("extracts FunctionCall JSON or object args", (args) => {
    const preview = {
      actions: [{ type: "FunctionCall", params: { args } }],
    };

    expect(extractMcaWithdrawBusiness(preview)).toEqual({
      action: "withdraw",
    });
    expect(extractMcaWithdrawSignerWallet(preview)).toEqual({
      Near: "a.near",
    });
  });

  it("ignores malformed or array payloads", () => {
    expect(
      extractMcaWithdrawBusiness({
        actions: [
          { type: "FunctionCall", params: { args: "{not-json" } },
        ],
      })
    ).toBeUndefined();
    expect(extractMcaWithdrawBusiness([])).toBeUndefined();
    expect(
      extractMcaWithdrawSignerWallet({ signer_wallet: [] })
    ).toBeUndefined();
  });

  it("chooses a deposit address in stable priority order", () => {
    expect(
      extractMcaWithdrawDepositAddress({
        snapshotDepositAddress: "snapshot",
        storeDepositAddress: "store",
        preview: { depositAddress: "preview" },
        bestQuote: { deposit: { deposit_address: "best" } },
      })
    ).toBe("snapshot");
    expect(
      extractMcaWithdrawDepositAddress({
        preview: { deposit: { deposit_address: "preview-nested" } },
        bestQuote: { depositAddress: "best" },
      })
    ).toBe("preview-nested");
  });
});

describe("MCA withdraw NEAR transactions", () => {
  it("converts call_on_near transaction previews", () => {
    const business = { action: "withdraw", amount: "100" };
    const preview = {
      transactions: [
        {
          contractId: "mca.near",
          methodName: "exec",
          args: { business: { stale: true } },
          gas: "300000000000000",
          deposit: "0",
        },
      ],
    };

    expect(
      buildNearMcaWithdrawTransactions(preview, {
        business,
        signerWallet: { Near: "alice.near" },
        signature: "",
        mcaAccountId: "fallback.near",
      })
    ).toEqual([
      {
        receiverId: "mca.near",
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: "exec",
              args: {
                business,
                signer_wallet: { Near: "alice.near" },
                signature: "",
              },
              gas: "300000000000000",
              deposit: "0",
            },
          },
        ],
      },
    ]);
  });

  it("falls back to mcaAccountId.exec", () => {
    expect(
      buildNearMcaWithdrawTransactions(
        { business: { action: "withdraw" } },
        {
          business: { action: "withdraw" },
          signerWallet: { Near: "alice.near" },
          mcaAccountId: "mca.near",
        }
      )
    ).toEqual([
      {
        receiverId: "mca.near",
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: "exec",
              args: {
                business: { action: "withdraw" },
                signer_wallet: { Near: "alice.near" },
                signature: "",
              },
              gas: "300000000000000",
              deposit: "0",
            },
          },
        ],
      },
    ]);
  });

  it("converts a human NEAR deposit to yoctoNEAR", () => {
    const [transaction] = buildNearMcaWithdrawTransactions(
      {
        transactions: [
          {
            contractId: "mca.near",
            methodName: "exec",
            deposit: "0.000000000000000000000001",
          },
        ],
      },
      {
        business: { action: "withdraw" },
        signerWallet: { Near: "alice.near" },
        mcaAccountId: "mca.near",
      }
    );

    expect(transaction?.actions).toEqual([
      expect.objectContaining({
        params: expect.objectContaining({ deposit: "1" }),
      }),
    ]);
  });
});

describe("MCA relayer build request", () => {
  it("adds relayer metadata without mutating quote inputs", () => {
    const quoteBuild: SwapBuildRequestRaw = {
      fromChain: "near",
      toChain: "eth",
      tokenIn: "usdc.near",
      tokenOut: "0xusdc",
      amountIn: "100",
      sender: "mca.near",
      router: "near-mca-withdraw",
      expectedOut: "90",
      minAmountOut: "89",
      preSwap: null,
      bridge: { name: "intents" },
      mca: { flow: "withdraw", mcaAccountId: "mca.near" },
    };
    const relayer: SwapMcaRelayerRequestRaw = {
      mcaAccountId: "mca.near",
      wallet: { EVM: "abc" },
      business: { action: "withdraw" },
      signature: "signature",
    };
    const before = JSON.parse(JSON.stringify({ quoteBuild, relayer }));

    expect(
      buildMcaWithdrawRelayerRequest({
        quoteBuild,
        mcaRelayer: relayer,
        isCrossChain: true,
        depositAddress: "deposit-address",
        mcaAccountId: "mca.near",
        recipientFallback: "0xrecipient",
      })
    ).toMatchObject({
      recipient: "0xrecipient",
      mcaRelayer: relayer,
      mca: { flow: "withdraw", mcaAccountId: "mca.near" },
      deposit_address: "deposit-address",
      is_cross_chain: true,
      tx_type: "mca-withdraw-relayer",
      multi_addr: "mca.near",
      bridge: { name: "intents" },
    });
    expect({ quoteBuild, relayer }).toEqual(before);
  });
});
