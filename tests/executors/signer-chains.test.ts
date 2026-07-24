import { describe, expect, it } from "vitest";
import { createAptosExecutor } from "../../src/executors/aptos";
import { createBitcoinExecutor } from "../../src/executors/bitcoin";
import { createEvmExecutor } from "../../src/executors/evm";
import { createNearExecutor } from "../../src/executors/near";
import { createSolanaExecutor } from "../../src/executors/solana";
import { createSuiExecutor } from "../../src/executors/sui";
import { createTronExecutor } from "../../src/executors/tron";
import { createZcashExecutor } from "../../src/executors/zcash";

describe("built-in executor signer chains", () => {
  it("exposes the canonical signer chain for every executor", () => {
    const executors = [
      createEvmExecutor({
        sendTransaction: async () => ({ txHash: "evm" }),
        signTypedData: async () => "signature",
      }),
      createSolanaExecutor({
        getChain: () => "solana",
        signAndSendTransaction: async () => ({ txHash: "solana" }),
      }),
      createAptosExecutor({
        getChain: () => "aptos",
        signAndSubmitTransaction: async () => ({ txHash: "aptos" }),
      }),
      createNearExecutor({
        getChain: () => "near",
        signAndSendTransactions: async () => ({ txHashes: ["near"] }),
      }),
      createTronExecutor({
        getChain: () => "tron",
        isAddress: () => true,
        sendNativeTransfer: async () => ({ txHash: "tron-native" }),
        sendTokenTransfer: async () => ({ txHash: "tron-token" }),
      }),
      createBitcoinExecutor({
        getChain: () => "btc",
        isAddress: () => true,
        sendTransfer: async () => ({ txHash: "btc" }),
      }),
      createZcashExecutor({
        getChain: () => "zcash",
        isAddress: () => true,
        sendTransfer: async () => ({ txHash: "zcash" }),
      }),
      createSuiExecutor({
        getChain: () => "sui",
        isAddress: () => true,
        transferCoin: async () => ({ txHash: "sui" }),
      }),
    ];

    expect(executors.map((executor) => executor.signerChain)).toEqual([
      "evm",
      "solana",
      "aptos",
      "near",
      "tron",
      "btc",
      "zcash",
      "sui",
    ]);
  });
});
