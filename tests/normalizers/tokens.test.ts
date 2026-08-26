import { describe, expect, it } from "vitest";
import { normalizeFromTokenList } from "../../src/normalizers/tokens";

describe("token-list normalization", () => {
  it.each([
    [
      1,
      {
        address: "0x0000000000000000000000000000000000000000",
        decimals: 18,
        symbol: "ETH",
      },
    ],
    [
      137,
      {
        address: "0x0000000000000000000000000000000000001010",
        decimals: 18,
        symbol: "POL",
      },
    ],
    [
      501,
      {
        address: "11111111111111111111111111111111",
        assetId: "nep141:sol.omft.near",
        decimals: 9,
        symbol: "SOL",
      },
    ],
    [
      900012,
      {
        address: "0x000000000000000000000000000000000000000a",
        coinType: "0x1::aptos_coin::AptosCoin",
        decimals: 8,
        symbol: "APT",
      },
    ],
    [195, { address: "trx", decimals: 6, symbol: "TRX" }],
    [
      784,
      {
        address: "0x2::sui::SUI",
        coinType: "0x2::sui::SUI",
        decimals: 9,
        symbol: "SUI",
      },
    ],
  ] as const)("recognizes the native token for list chain %s", (chainId, row) => {
    const [token] = normalizeFromTokenList({ token: row }, chainId);

    expect(token).toMatchObject({
      isNative: true,
      contractAddress: null,
    });
  });
});
