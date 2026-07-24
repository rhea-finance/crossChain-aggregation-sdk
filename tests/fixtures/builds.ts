import type { SwapBuildDataRaw } from "../../src/api/rawTypes";

function baseBuild(
  overrides: Partial<SwapBuildDataRaw> &
    Pick<SwapBuildDataRaw, "chainType" | "fromChain" | "tx">
): SwapBuildDataRaw {
  return {
    isCrossChain: true,
    router: "nearintents",
    toChain: "near",
    tokenIn: { address: "native", symbol: "IN", decimals: 8 },
    tokenOut: { address: "wrap.near", symbol: "OUT", decimals: 24 },
    amountIn: "1000",
    estimatedOut: "900",
    minAmountOut: "890",
    approve: null,
    ...overrides,
  };
}

export const buildFixtures = {
  evmTransaction: baseBuild({
    chainType: "evm",
    fromChain: "1",
    tokenIn: {
      address: "0x0000000000000000000000000000000000000000",
      symbol: "ETH",
      decimals: 18,
    },
    tx: {
      to: "0x1111111111111111111111111111111111111111",
      data: "0xabcdef",
      value: "0",
      gasLimit: "21000",
      chainId: 1,
    },
  }),
  evmSignature: baseBuild({
    chainType: "evm",
    fromChain: "56",
    executionType: "signature",
    tx: null,
    signingRequest: {
      type: "eip712",
      router: "cow",
      quoteId: "quote-1",
      chainId: 56,
      typedData: {
        domain: { chainId: 56 },
        types: { Order: [{ name: "sellAmount", type: "uint256" }] },
        primaryType: "Order",
        message: { sellAmount: "1000" },
      },
    },
  }),
  solana: baseBuild({
    chainType: "solana",
    fromChain: "solana",
    tx: {
      transaction: "AQIDBA==",
      format: "base64",
      addressLookupTableAddresses: ["LookupTable111"],
    },
  }),
  aptos: baseBuild({
    chainType: "aptos",
    fromChain: "aptos",
    tx: {
      function: "0x1::coin::transfer",
      type_arguments: ["0x1::aptos_coin::AptosCoin"],
      arguments: ["0xabc", "100"],
    },
  }),
  near: baseBuild({
    chainType: "near",
    fromChain: "near",
    tx: {
      receiverId: "wrap.near",
      actions: [
        {
          type: "FunctionCall",
          params: {
            methodName: "near_deposit",
            args: {},
            gas: "30000000000000",
            deposit: "1",
          },
        },
      ],
    },
  }),
  tron: baseBuild({
    chainType: "tron",
    fromChain: "tron",
    tx: {
      kind: "tron_transfer",
      chainId: "tron",
      amount: "100",
      depositAddress: "TReceiver1111111111111111111111111",
      standard: "native",
    },
  }),
  bitcoin: baseBuild({
    chainType: "btc",
    fromChain: "btc",
    tx: {
      kind: "btc_transfer",
      chainId: "btc",
      amount: "1000",
      depositAddress: "bc1receiver",
      feeRate: 3,
    },
  }),
  zcash: baseBuild({
    chainType: "zcash",
    fromChain: "zcash",
    tx: {
      kind: "zcash_transfer",
      chainId: "zcash",
      amount: "1000",
      depositAddress: "t1receiver",
      decimals: 8,
    },
  }),
  sui: baseBuild({
    chainType: "sui",
    fromChain: "sui",
    tx: {
      kind: "sui_transfer",
      chainId: "sui",
      amount: "100",
      depositAddress: "0xreceiver",
      coinType: "0x2::sui::SUI",
    },
  }),
} satisfies Record<string, SwapBuildDataRaw>;
