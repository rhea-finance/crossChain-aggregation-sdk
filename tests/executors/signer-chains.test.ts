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
        waitForTransaction: async () => ({ status: "confirmed" }),
      }),
      createSolanaExecutor({
        getChain: () => "solana",
        signAndSendTransaction: async () => ({ txHash: "solana" }),
        waitForTransaction: async () => ({ status: "confirmed" }),
      }),
      createAptosExecutor({
        getChain: () => "aptos",
        signAndSubmitTransaction: async () => ({ txHash: "aptos" }),
        waitForTransaction: async () => ({ status: "confirmed" }),
      }),
      createNearExecutor({
        getChain: () => "near",
        signAndSendTransactions: async () => ({ txHashes: ["near"] }),
        waitForTransactions: async () => ({ status: "confirmed" }),
      }),
      createTronExecutor({
        getChain: () => "tron",
        isAddress: () => true,
        sendNativeTransfer: async () => ({ txHash: "tron-native" }),
        sendTokenTransfer: async () => ({ txHash: "tron-token" }),
        waitForTransaction: async () => ({ status: "confirmed" }),
      }),
      createBitcoinExecutor({
        getChain: () => "btc",
        isAddress: () => true,
        sendTransfer: async () => ({ txHash: "btc" }),
        waitForTransaction: async () => ({ status: "confirmed" }),
      }),
      createZcashExecutor({
        getChain: () => "zcash",
        isAddress: () => true,
        sendTransfer: async () => ({ txHash: "zcash" }),
        waitForTransaction: async () => ({ status: "confirmed" }),
      }),
      createSuiExecutor({
        getChain: () => "sui",
        isAddress: () => true,
        transferCoin: async () => ({ txHash: "sui" }),
        waitForTransaction: async () => ({ status: "confirmed" }),
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
