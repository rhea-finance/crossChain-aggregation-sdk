import { describe, expect, it } from "vitest";
import {
  fromApiChain,
  toApiAssetAddress,
  toApiChain,
} from "../../src/normalizers/chain";

describe("chain conversion", () => {
  it.each([
    "1",
    "8453",
    "near",
    "solana",
    "aptos",
    "tron",
    "btc",
    "zcash",
    "sui",
  ] as const)("preserves canonical chain id %s", (chain) => {
    expect(toApiChain(chain)).toBe(chain);
    expect(fromApiChain(chain)).toBe(chain);
  });

  it("normalizes raw API aliases to canonical chain ids", () => {
    expect(fromApiChain("0x2105")).toBe("8453");
    expect(fromApiChain("sol")).toBe("solana");
    expect(fromApiChain("501")).toBe("solana");
    expect(fromApiChain("bitcoin")).toBe("btc");
    expect(fromApiChain("trx")).toBe("tron");
    expect(fromApiChain("zec")).toBe("zcash");
  });

  it.each([
    "eip155:8453",
    "solana:mainnet",
    "0",
    "01",
    " 1",
    "+1",
    "-1",
    "1.5",
    "1e3",
  ])("rejects non-canonical public chain id %s", (chain) => {
    expect(() => toApiChain(chain as never)).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_CHAIN" })
    );
  });

  it("rejects unsupported raw API chains", () => {
    expect(() => fromApiChain("cosmos:cosmoshub-4")).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_CHAIN" })
    );
  });

  it("uses the canonical native placeholder for an empty native asset", () => {
    expect(
      toApiAssetAddress({
        chain: "btc",
        address: "",
        isNative: true,
      })
    ).toBe("btc");
  });

  it("preserves explicit asset addresses", () => {
    expect(
      toApiAssetAddress({
        chain: "near",
        address: "token.near",
      })
    ).toBe("token.near");
  });

  it("uses the EVM zero address for an empty native asset", () => {
    expect(
      toApiAssetAddress({
        chain: "8453",
        address: "",
        isNative: true,
      })
    ).toBe("0x0000000000000000000000000000000000000000");
  });
});
