import { describe, expect, it } from "vitest";
import { resolveMcaWithdrawPolicy } from "../../src/mca/collateral";

describe("resolveMcaWithdrawPolicy", () => {
  it("reports no collateral decrease and a partial withdraw", () => {
    expect(
      resolveMcaWithdrawPolicy({
        amountBurrow: "500000",
        suppliedBalance: "1000000",
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

  it("decreases only the part of withdraw not covered by supplied balance", () => {
    expect(
      resolveMcaWithdrawPolicy({
        amountBurrow: "500000",
        suppliedBalance: "499987.5",
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

  it("normalizes the required Burrow collateral decrease", () => {
    expect(
      resolveMcaWithdrawPolicy({
        amountBurrow: "0012.5000",
        suppliedBalance: "0",
        availableBalance: "100",
        amountIn: "1",
        isMax: false,
      })
    ).toMatchObject({
      needDecrease: true,
      decreaseAmountBurrow: "12.5",
    });
    expect(
      resolveMcaWithdrawPolicy({
        amountBurrow: "1.25e-7",
        suppliedBalance: "0",
        availableBalance: "100",
        amountIn: "1",
        isMax: false,
      })
    ).toMatchObject({
      needDecrease: true,
      decreaseAmountBurrow: "0.000000125",
    });
  });

  it("canonicalizes a non-positive supplied shortfall to zero", () => {
    expect(
      resolveMcaWithdrawPolicy({
        amountBurrow: "0.000e10",
        suppliedBalance: "1",
        availableBalance: "100",
        amountIn: "1",
        isMax: false,
      })
    ).toMatchObject({
      needDecrease: false,
      decreaseAmountBurrow: "0",
    });
  });

  it("treats the 0.999999 boundary as withdraw all", () => {
    expect(
      resolveMcaWithdrawPolicy({
        amountBurrow: "1000000",
        suppliedBalance: "999987.5",
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
        amountBurrow: "1",
        suppliedBalance: "1",
        availableBalance: "1000000",
        amountIn: "999998.999999",
        isMax: false,
      }).withdrawAll
    ).toBe(false);
  });

  it("uses max or exact decimal equality", () => {
    expect(
      resolveMcaWithdrawPolicy({
        amountBurrow: "1",
        suppliedBalance: "1",
        availableBalance: "7.25",
        amountIn: "1",
        isMax: true,
      }).withdrawAll
    ).toBe(true);
    expect(
      resolveMcaWithdrawPolicy({
        amountBurrow: "7.25",
        suppliedBalance: "7.25",
        availableBalance: "7.2500",
        amountIn: "7.25",
        isMax: false,
      }).withdrawAll
    ).toBe(true);
  });

  it("does not infer withdraw all from zero available balance", () => {
    expect(
      resolveMcaWithdrawPolicy({
        amountBurrow: "0",
        suppliedBalance: "0",
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
          amountBurrow: "1",
          suppliedBalance: "1",
          availableBalance: "100",
          amountIn,
          isMax: false,
        })
      ).toThrowError(/amountIn/);
    }
  );

  it.each(["-1", "+1", "", ".", "1.2.3", "NaN"])(
    "rejects invalid Burrow withdraw amount %s",
    (amountBurrow) => {
      expect(() =>
        resolveMcaWithdrawPolicy({
          amountBurrow,
          suppliedBalance: "0",
          availableBalance: "100",
          amountIn: "1",
          isMax: false,
        })
      ).toThrowError(/amountBurrow/);
    }
  );

  it("rejects an invalid supplied balance", () => {
    expect(() =>
      resolveMcaWithdrawPolicy({
        amountBurrow: "10",
        suppliedBalance: "-1",
        availableBalance: "10",
        amountIn: "10",
        isMax: false,
      })
    ).toThrowError(/suppliedBalance/);
  });
});
