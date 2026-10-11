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

  tronRawData: baseBuild({
    chainType: "tron",
    fromChain: "tron",
    needsApprove: true,
    tx: {
      format: "tron-raw-data",
      txID: "ad069e0138800eeb8a8593e07f7592b302b2219e5cefe7c79f6288b628e8ea4e",
      visible: false,
      raw_data: {
        contract: [
          {
            type: "TriggerSmartContract",
            parameter: {
              type_url: "type.googleapis.com/protocol.TriggerSmartContract",
              value: {
                owner_address: "41eb9481397c496ce332711e02de5573a54a73e79c",
                contract_address: "41f742f4589459f0923fa579600815763d1646bec3",
              },
            },
          },
        ],
        fee_limit: 300000000,
      },
      raw_data_hex: "0a02deadbeef",
      approveTxID: "fb7df9df74de4d39337f5e91a4a6367a60b3138ee5626f912e9b6f15a6395f7d",
      approveVisible: false,
      approve_raw_data: {
        contract: [
          {
            type: "TriggerSmartContract",
            parameter: {
              type_url: "type.googleapis.com/protocol.TriggerSmartContract",
              value: {
                owner_address: "41eb9481397c496ce332711e02de5573a54a73e79c",
                contract_address: "41a614f803b6fd780986a42c78ec9c7f77e6ded13c",
                data: "095ea7b3",
              },
            },
          },
        ],
        fee_limit: 14964600,
      },
      approve_raw_data_hex: "0a02approve",
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
