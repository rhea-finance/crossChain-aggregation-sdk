import { describe, expect, it } from "vitest";
import { resolveMcaWithdrawPolicy } from "../../src/mca/collateral";

describe("resolveMcaWithdrawPolicy", () => {
  it("reports no collateral decrease and a partial withdraw", () => {
    expect(
      resolveMcaWithdrawPolicy({
        collateralBalance: "0",
        availableBalance: "1000000",
        amountIn: "500000",
        isMax: false,
      })
    ).toEqual({
      needDecrease: false,
      decreaseAmountBurrow: "0",
      withdrawAll: false,
    });
  });

  it("decreases the complete collateral balance", () => {
    expect(
      resolveMcaWithdrawPolicy({
        collateralBalance: "12.5",
        availableBalance: "1000000",
        amountIn: "500000",
        isMax: false,
      })
    ).toEqual({
      needDecrease: true,
      decreaseAmountBurrow: "12.5",
      withdrawAll: false,
    });
  });

  it("treats the 0.999999 boundary as withdraw all", () => {
    expect(
      resolveMcaWithdrawPolicy({
        collateralBalance: "12.5",
        availableBalance: "1000000",
        amountIn: "999999",
        isMax: false,
      })
    ).toEqual({
      needDecrease: true,
      decreaseAmountBurrow: "12.5",
      withdrawAll: true,
    });
  });

  it("does not round a value below the threshold", () => {
    expect(
      resolveMcaWithdrawPolicy({
        collateralBalance: "0",
        availableBalance: "1000000",
        amountIn: "999998.999999",
        isMax: false,
      }).withdrawAll
    ).toBe(false);
  });

  it("uses max or exact decimal equality", () => {
    expect(
      resolveMcaWithdrawPolicy({
        collateralBalance: "0",
        availableBalance: "7.25",
        amountIn: "1",
        isMax: true,
      }).withdrawAll
    ).toBe(true);
    expect(
      resolveMcaWithdrawPolicy({
        collateralBalance: "0",
        availableBalance: "7.2500",
        amountIn: "7.25",
        isMax: false,
      }).withdrawAll
    ).toBe(true);
  });

  it("does not infer withdraw all from zero available balance", () => {
    expect(
      resolveMcaWithdrawPolicy({
        collateralBalance: "0",
        availableBalance: "0",
        amountIn: "0",
        isMax: false,
      }).withdrawAll
    ).toBe(false);
  });

  it.each(["-1", "+1", "1e6", "", ".", "1.2.3"])(
    "rejects invalid decimal input %s",
    (amountIn) => {
      expect(() =>
        resolveMcaWithdrawPolicy({
          collateralBalance: "0",
          availableBalance: "100",
          amountIn,
          isMax: false,
        })
      ).toThrowError(/amountIn/);
    }
  );
});
