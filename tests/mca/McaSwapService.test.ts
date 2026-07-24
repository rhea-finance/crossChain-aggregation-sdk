import { describe, expect, it, vi } from "vitest";
import { SwapClient } from "../../src/client/SwapClient";
import type { ChainExecutor } from "../../src/core/registry";
import type { McaQuoteRequest } from "../../src/mca/types";
import { buildFixtures } from "../fixtures/builds";

function response(data: unknown): Response {
  return new Response(JSON.stringify({ code: 0, msg: "ok", data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function createEvmSignerExecutor(input: {
  getIdentityKey: () => string | Promise<string>;
  signMessage?: (
    message: string,
    options?: {
      signal?: AbortSignal;
      context?: Readonly<Record<string, unknown>>;
    }
  ) => Promise<string>;
}): ChainExecutor<"evm-transaction"> {
  return {
    kinds: ["evm-transaction"],
    signerChain: "evm",
    getIdentityKey: input.getIdentityKey,
    ...(input.signMessage ? { signMessage: input.signMessage } : {}),
    validate: async () => undefined,
    execute: async () => ({ status: "submitted", txHash: "unused" }),
  };
}

const depositRequest: McaQuoteRequest = {
  flow: "deposit",
  mcaAccountId: "mca.near",
  fromChain: "btc",
  toChain: "near",
  tokenIn: {
    chain: "btc",
    address: "btc",
    symbol: "BTC",
    decimals: 8,
    isNative: true,
  },
  tokenOut: {
    chain: "near",
    address: "btc.omft.near",
    symbol: "BTC",
    decimals: 8,
  },
  amountIn: "1000",
  slippageBps: 50,
  sender: "bc1sender",
  recipient: "mca.near",
  signerChain: "btc",
  collateral: { useAsCollateral: true },
};

describe("McaSwapService", () => {
  it("quotes, builds, executes, and reports an MCA deposit", async () => {
    const quoteRaw = {
      isCrossChain: true,
      chainType: "cross-chain",
      bestQuote: {
        router: "near-mca-deposit",
        amountOut: "900",
        minAmountOut: "890",
        preSwap: null,
        bridge: { route: "intents" },
      },
      allQuotes: [],
      nearDepositTx: { kind: "mca_deposit" },
    };
    const buildRaw = {
      ...buildFixtures.bitcoin,
      router: "near-mca-deposit",
    };
    const executor: ChainExecutor<"bitcoin-transfer"> = {
      kinds: ["bitcoin-transfer"],
      signerChain: "btc",
      getIdentityKey: async () => "btc-public-key",
      validate: vi.fn(async () => undefined),
      execute: vi.fn(async () => ({
        status: "submitted",
        txHash: "btc-hash",
      })),
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(quoteRaw))
      .mockResolvedValueOnce(response(buildRaw))
      .mockResolvedValueOnce(response({ id: 1, from_hash: "btc-hash" }));
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      executors: [executor],
      fetch,
    });

    const quote = await client.quote(depositRequest);
    const result = await client.swap({ quote });

    expect(quote.executionMode).toBe("deposit");
    expect(quote.signer).toEqual({
      chain: "btc",
      identityKey: "btc-public-key",
    });
    expect(result).toMatchObject({
      status: "submitted",
      txHash: "btc-hash",
      report: { status: "reported" },
    });
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toMatchObject({
      router: "near-mca-deposit",
      mca: {
        flow: "deposit",
        mcaAccountId: "mca.near",
        useAsCollateral: true,
      },
    });
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).toMatchObject({
      multi_addr: "mca.near",
      tx_type: "cross-chain",
    });
  });

  it("executes an MCA withdraw directly through the bound NEAR wallet", async () => {
    const events: string[] = [];
    const signMessage = vi.fn(async () => "unused-signature");
    const request: McaQuoteRequest = {
      flow: "withdraw",
      mcaAccountId: "mca.near",
      fromChain: "near",
      toChain: "near",
      tokenIn: {
        chain: "near",
        address: "usdc.token.near",
        symbol: "USDC",
        decimals: 6,
      },
      tokenOut: {
        chain: "near",
        address: "usdc.token.near",
        symbol: "USDC",
        decimals: 6,
      },
      amountIn: "100",
      slippageBps: 50,
      sender: "mca.near",
      recipient: "alice.near",
      signerChain: "near",
      collateral: {
        needDecrease: false,
        decreaseAmountBurrow: "0",
      },
      executionPreference: "near",
      boundNearAccountId: "alice.near",
    };
    const quoteRaw = {
      isCrossChain: true,
      chainType: "near",
      bestQuote: {
        router: "near-mca-withdraw",
        amountOut: "99",
        minAmountOut: "98",
      },
      allQuotes: [],
      nearMcaWithdrawTx: {
        depositAddress: "near-deposit-address",
        transactions: [
          {
            contractId: "mca.near",
            methodName: "exec",
            args: {
              business: { action: "withdraw", amount: "100" },
              signer_wallet: { Near: "alice.near" },
            },
            gas: 300,
            deposit: 0,
          },
        ],
      },
    };
    const execute = vi.fn(async () => ({
      status: "submitted" as const,
      txHash: "near-hash",
      txHashes: ["near-hash"],
    }));
    const executor: ChainExecutor<"near-transaction-batch"> = {
      kinds: ["near-transaction-batch"],
      signerChain: "near",
      getIdentityKey: async () => "alice.near",
      signMessage,
      validate: vi.fn(async () => undefined),
      execute,
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(quoteRaw))
      .mockResolvedValueOnce(response({ id: 2, from_hash: "near-hash" }))
      .mockResolvedValueOnce(response({ status: "SUCCESS" }));
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      executors: [executor],
      fetch,
    });

    const quote = await client.quote(request);
    const result = await client.swap({
      quote,
      waitFor: "completed",
      onEvent: (event) => events.push(event.type),
    });

    expect(signMessage).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "near-transaction-batch",
        transactions: [
          expect.objectContaining({
            receiverId: "mca.near",
            actions: [
              expect.objectContaining({
                params: expect.objectContaining({
                  methodName: "exec",
                  args: expect.objectContaining({
                    business: { action: "withdraw", amount: "100" },
                  }),
                }),
              }),
            ],
          }),
        ],
      }),
      expect.any(Object)
    );
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toMatchObject({
      tx_type: "mca-withdraw-near",
      multi_addr: "mca.near",
      deposit_address: "near-deposit-address",
    });
    expect(String(fetch.mock.calls[2]?.[0])).toContain(
      "orderId=near-deposit-address"
    );
    expect(result.status).toBe("completed");
    expect(events).toEqual([
      "signing-requested",
      "submitted",
      "order-status",
      "completed",
    ]);
  });

  it("signs and submits an MCA withdraw through the multichain relayer", async () => {
    const signMessage = vi.fn(async () => "mca-signature");
    const request: McaQuoteRequest = {
      flow: "withdraw",
      mcaAccountId: "mca.near",
      fromChain: "near",
      toChain: "1",
      tokenIn: {
        chain: "near",
        address: "usdc.token.near",
        symbol: "USDC",
        decimals: 6,
      },
      tokenOut: {
        chain: "1",
        address: "0xusdc",
        symbol: "USDC",
        decimals: 6,
      },
      amountIn: "100",
      slippageBps: 50,
      sender: "mca.near",
      recipient: "0xrecipient",
      signerChain: "evm",
      collateral: {
        needDecrease: true,
        decreaseAmountBurrow: "100",
        withdrawAll: true,
      },
      executionPreference: "relayer",
    };
    const business = { action: "withdraw", amount: "100" };
    const quoteRaw = {
      isCrossChain: true,
      chainType: "cross-chain",
      bestQuote: {
        router: "near-mca-withdraw",
        amountOut: "99",
        minAmountOut: "98",
        bridge: { route: "intents" },
      },
      allQuotes: [],
      mcaWithdrawToIntents: {
        business,
        messageToSign: "sign this exact API message",
        depositAddress: "intents-deposit-address",
      },
    };
    const buildRaw = {
      isCrossChain: true,
      chainType: "near",
      router: "near-mca-withdraw",
      fromChain: "near",
      toChain: "1",
      tokenIn: { address: "usdc.token.near", symbol: "USDC", decimals: 6 },
      tokenOut: { address: "0xusdc", symbol: "USDC", decimals: 6 },
      amountIn: "100",
      estimatedOut: "99",
      minAmountOut: "98",
      tx: null,
      approve: null,
      orderId: "relayer-order-1",
      deposit: {
        orderId: "relayer-order-1",
        depositAddress: "intents-deposit-address",
      },
    };
    const events: string[] = [];
    const beforeSign = vi.fn(async () => undefined);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response(quoteRaw))
      .mockResolvedValueOnce(response(buildRaw))
      .mockResolvedValueOnce(
        response({ id: 3, from_hash: "relayer-order-1" })
      )
      .mockResolvedValueOnce(response({ status: "SUCCESS" }))
      .mockResolvedValueOnce(
        response({ id: 3, from_hash: "relayer-order-1" })
      );
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      fetch,
      executors: [
        createEvmSignerExecutor({
          getIdentityKey: async () => "0xAbC",
          signMessage,
        }),
      ],
      onEvent: (event) => events.push(event.type),
    });

    const quote = await client.quote(request);
    await expect(client.buildSwap({ quote })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      stage: "build",
    });
    const result = await client.swap({
      quote,
      beforeSign,
      waitFor: "completed",
    });

    expect(beforeSign).toHaveBeenCalledWith({
      chain: "evm",
      identityKey: "0xAbC",
      message: "sign this exact API message",
      business,
    });
    expect(signMessage).toHaveBeenCalledWith(
      "sign this exact API message",
      {
        signal: undefined,
        context: {
          flow: "withdraw",
          mcaAccountId: "mca.near",
          business,
        },
      }
    );
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toMatchObject({
      mcaRelayer: {
        mcaAccountId: "mca.near",
        wallet: { EVM: "AbC" },
        business,
        signature: "mca-signature",
      },
      deposit_address: "intents-deposit-address",
      is_cross_chain: true,
      tx_type: "mca-withdraw-relayer",
      multi_addr: "mca.near",
    });
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).toMatchObject({
      from_hash: "relayer-order-1",
      tx_type: "mca-withdraw-relayer",
      multi_addr: "mca.near",
      swapId: "relayer-order-1",
    });
    expect(String(fetch.mock.calls[3]?.[0])).toContain(
      "orderId=relayer-order-1"
    );
    expect(result).toMatchObject({
      orderId: "relayer-order-1",
      depositAddress: "intents-deposit-address",
      status: "completed",
      report: { status: "reported" },
    });
    await expect(client.report(result)).resolves.toMatchObject({
      from_hash: "relayer-order-1",
    });
    expect(JSON.parse(String(fetch.mock.calls[4]?.[1]?.body))).toMatchObject({
      from_hash: "relayer-order-1",
      tx_type: "mca-withdraw-relayer",
      multi_addr: "mca.near",
    });
    expect(events).toEqual([
      "signing-requested",
      "submitted",
      "order-status",
      "completed",
    ]);
  });

  it("rejects a changed executor identity before relayer signing", async () => {
    let identityKey = "0xabc";
    const signMessage = vi.fn(async () => "signature");
    const request: McaQuoteRequest = {
      flow: "withdraw",
      mcaAccountId: "mca.near",
      fromChain: "near",
      toChain: "1",
      tokenIn: { chain: "near", address: "usdc.near" },
      tokenOut: { chain: "1", address: "0xusdc" },
      amountIn: "100",
      slippageBps: 50,
      sender: "mca.near",
      recipient: "0xrecipient",
      signerChain: "evm",
      collateral: {
        needDecrease: false,
        decreaseAmountBurrow: "0",
      },
      executionPreference: "relayer",
    };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response({
        isCrossChain: true,
        chainType: "cross-chain",
        bestQuote: {
          router: "near-mca-withdraw",
          amountOut: "99",
          minAmountOut: "98",
        },
        allQuotes: [],
        mcaWithdrawToIntents: {
          business: { action: "withdraw" },
          messageToSign: "message",
          depositAddress: "deposit-address",
        },
      })
    );
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      fetch,
      reportMode: "disabled",
      executors: [
        createEvmSignerExecutor({
          getIdentityKey: async () => identityKey,
          signMessage,
        }),
      ],
    });
    const quote = await client.quote(request);
    identityKey = "0xdef";

    await expect(client.swap({ quote })).rejects.toMatchObject({
      code: "SIGNING_FAILED",
      stage: "sign",
    });
    expect(signMessage).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("queries MCA history by account id without filtering server results again", async () => {
    const historyRecord = (
      id: number,
      sender: string,
      recipient: string,
      multiAddr?: string
    ) => ({
      id,
      sender,
      recipient,
      from_hash: `hash-${id}`,
      from_token: "0xusdc",
      to_token: "usdc.token.near",
      from_chain: "1",
      to_chain: "near",
      amount_in: "100",
      estimated_out: "99",
      status: "SUCCESS",
      ...(multiAddr === undefined ? {} : { multi_addr: multiAddr }),
    });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response({
        record_list: [
          historyRecord(
            1,
            "0xdeposit-sender",
            "Cross-chain Account",
            "Cross-chain Account"
          ),
          historyRecord(2, "Cross-chain Account", "0xrecipient"),
        ],
        page_number: 1,
        page_size: 20,
        total_page: 1,
        total_size: 2,
      })
    );
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      fetch,
    });

    const page = await client.getHistory({ sender: "mca.near" });

    expect(String(fetch.mock.calls[0]?.[0])).toContain("sender=mca.near");
    expect(page.items.map((item) => item.id)).toEqual(["1", "2"]);
    expect(page.filteredLocally).toBeUndefined();
    expect(page.totalItems).toBe(2);
  });

  it("rejects a stale relayer quote before requesting a signature", async () => {
    let now = 1_000;
    const signMessage = vi.fn(async () => "signature");
    const request: McaQuoteRequest = {
      flow: "withdraw",
      mcaAccountId: "mca.near",
      fromChain: "near",
      toChain: "1",
      tokenIn: { chain: "near", address: "usdc.near" },
      tokenOut: { chain: "1", address: "0xusdc" },
      amountIn: "100",
      slippageBps: 50,
      sender: "mca.near",
      recipient: "0xrecipient",
      signerChain: "evm",
      collateral: {
        needDecrease: false,
        decreaseAmountBurrow: "0",
      },
      executionPreference: "relayer",
    };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response({
        isCrossChain: true,
        chainType: "cross-chain",
        bestQuote: {
          router: "near-mca-withdraw",
          amountOut: "99",
          minAmountOut: "98",
        },
        allQuotes: [],
        mcaWithdrawToIntents: {
          business: { action: "withdraw" },
          messageToSign: "message",
          depositAddress: "deposit-address",
        },
      })
    );
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      fetch,
      now: () => now,
      maxQuoteAgeMs: 30_000,
      reportMode: "disabled",
      executors: [
        createEvmSignerExecutor({
          getIdentityKey: async () => "0xabc",
          signMessage,
        }),
      ],
    });
    const quote = await client.quote(request);
    now = 31_001;

    await expect(client.swap({ quote })).rejects.toMatchObject({
      code: "QUOTE_EXPIRED",
      stage: "build",
    });
    expect(signMessage).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not broadcast a completed NEAR withdraw without a status key", async () => {
    const request: McaQuoteRequest = {
      flow: "withdraw",
      mcaAccountId: "mca.near",
      fromChain: "near",
      toChain: "near",
      tokenIn: { chain: "near", address: "usdc.near" },
      tokenOut: { chain: "near", address: "usdc.near" },
      amountIn: "100",
      slippageBps: 50,
      sender: "mca.near",
      recipient: "alice.near",
      signerChain: "near",
      collateral: {
        needDecrease: false,
        decreaseAmountBurrow: "0",
      },
      executionPreference: "near",
    };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response({
        isCrossChain: true,
        chainType: "near",
        bestQuote: {
          router: "near-mca-withdraw",
          amountOut: "99",
          minAmountOut: "98",
        },
        allQuotes: [],
        nearMcaWithdrawTx: {
          business: { action: "withdraw" },
          transactions: [
            {
              contractId: "mca.near",
              methodName: "exec",
              args: { business: { action: "withdraw" } },
            },
          ],
        },
      })
    );
    const execute = vi.fn(async () => ({
      status: "submitted" as const,
      txHash: "near-hash",
    }));
    const client = new SwapClient({
      baseUrl: "https://swap.example",
      fetch,
      reportMode: "disabled",
      executors: [
        {
          kinds: ["near-transaction-batch"],
          signerChain: "near",
          getIdentityKey: async () => "alice.near",
          validate: async () => undefined,
          execute,
        },
      ],
    });
    const quote = await client.quote(request);

    await expect(
      client.swap({ quote, waitFor: "completed" })
    ).rejects.toMatchObject({
      code: "INVALID_API_RESPONSE",
      stage: "status",
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
