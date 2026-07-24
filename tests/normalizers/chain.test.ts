import { describe, expect, it } from "vitest";
import {
  fromApiChain,
  toApiAssetAddress,
  toApiChain,
} from "../../src/normalizers/chain";

describe("chain conversion", () => {
  it.each([
    ["eip155:1", "1"],
    ["near:mainnet", "near"],
    ["solana:mainnet", "solana"],
    ["aptos:mainnet", "aptos"],
    ["tron:mainnet", "tron"],
    ["bitcoin:mainnet", "btc"],
    ["zcash:mainnet", "zcash"],
    ["sui:mainnet", "sui"],
  ] as const)("maps %s", (standard, api) => {
    expect(toApiChain(standard)).toBe(api);
    expect(fromApiChain(api)).toBe(standard);
  });

  it("normalizes hexadecimal EVM API chain ids", () => {
    expect(fromApiChain("0x89")).toBe("eip155:137");
  });

  it("rejects unsupported standard chains", () => {
    expect(() => toApiChain("cosmos:cosmoshub-4")).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_CHAIN" })
    );
  });

  it("uses the canonical native placeholder for an empty native asset", () => {
    expect(
      toApiAssetAddress({
        chain: "bitcoin:mainnet",
        address: "",
        isNative: true,
      })
    ).toBe("btc");
  });

  it("preserves explicit asset addresses", () => {
    expect(
      toApiAssetAddress({
        chain: "near:mainnet",
        address: "token.near",
      })
    ).toBe("token.near");
  });
});
