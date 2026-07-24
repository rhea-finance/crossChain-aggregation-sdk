import { describe, expect, it } from "vitest";
import {
  DEFAULT_MCA_SIGNER_PRIORITY,
  formatMcaWallet,
  isSameMcaSignerIdentity,
  selectMcaSigner,
} from "../../src/mca/signers";
import type { McaSignerIdentity } from "../../src/mca/types";

describe("formatMcaWallet", () => {
  it("formats every supported MCA signer identity", () => {
    expect(formatMcaWallet("evm", "0xAbC")).toEqual({ EVM: "AbC" });
    expect(formatMcaWallet("solana", "sol-pk")).toEqual({
      Solana: "sol-pk",
    });
    expect(formatMcaWallet("btc", "btc-pk")).toEqual({
      Bitcoin: "btc-pk",
    });
    expect(formatMcaWallet("near", "alice.near")).toEqual({
      Near: "alice.near",
    });
    expect(formatMcaWallet("aptos", "aptos-pk")).toEqual({
      Aptos: "aptos-pk",
    });
    expect(formatMcaWallet("sui", "sui-pk")).toEqual({ Sui: "sui-pk" });
    expect(formatMcaWallet("zcash", "zec-pk")).toEqual({
      Zcash: "zec-pk",
    });
    expect(formatMcaWallet("tron", "tron-address")).toEqual({
      Tron: "tron-address",
    });
  });

  it("rejects a blank identity", () => {
    expect(() => formatMcaWallet("near", " ")).toThrowError(/identityKey/);
  });
});

describe("selectMcaSigner", () => {
  const signer = (
    chain: McaSignerIdentity["chain"],
    identityKey: string,
    accountId?: string
  ): McaSignerIdentity => ({
    chain,
    identityKey,
    ...(accountId ? { accountId } : {}),
  });

  it("uses the documented default priority", () => {
    expect(DEFAULT_MCA_SIGNER_PRIORITY).toEqual([
      "evm",
      "solana",
      "btc",
      "aptos",
      "near",
      "zcash",
      "sui",
      "tron",
    ]);
  });

  it("selects only a connected signer bound to the MCA", () => {
    const unboundSolana = signer("solana", "other-solana-key");
    const boundEvm = signer("evm", "0xAbC");

    expect(
      selectMcaSigner(
        [{ Solana: "bound-solana-key" }, { EVM: "abc" }],
        [unboundSolana, boundEvm]
      )
    ).toBe(boundEvm);
  });

  it("chooses EVM before Solana when both are bound", () => {
    const evm = signer("evm", "0xabc");
    const solana = signer("solana", "solana-key");

    expect(
      selectMcaSigner(
        [{ EVM: "abc" }, { Solana: "solana-key" }],
        [solana, evm]
      )
    ).toBe(evm);
  });

  it("can match a bound accountId when identityKey is a public key", () => {
    const sui = signer("sui", "sui-public-key", "0xsui-address");

    expect(selectMcaSigner([{ Sui: "0xsui-address" }], [sui])).toBe(sui);
  });

  it("supports a caller-defined priority", () => {
    const evm = signer("evm", "0xabc");
    const near = signer("near", "alice.near");

    expect(
      selectMcaSigner(
        [{ EVM: "abc" }, { Near: "alice.near" }],
        [evm, near],
        ["near", "evm"]
      )
    ).toBe(near);
  });

  it("compares only hexadecimal identities case-insensitively", () => {
    expect(
      isSameMcaSignerIdentity(
        { chain: "evm", identityKey: "0xAbC" },
        { chain: "evm", identityKey: "0xabc" }
      )
    ).toBe(true);
    expect(
      isSameMcaSignerIdentity(
        { chain: "solana", identityKey: "SolPublicKey" },
        { chain: "solana", identityKey: "solpublickey" }
      )
    ).toBe(false);
  });
});
