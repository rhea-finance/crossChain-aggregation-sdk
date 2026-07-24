import { describe, expect, it } from "vitest";
import { formatUnits, parseUnits } from "../../src/utils/units";

describe("parseUnits", () => {
  it.each([
    ["0", 18, "0"],
    ["1", 18, "1000000000000000000"],
    ["1.23", 6, "1230000"],
    ["0.000001", 6, "1"],
    ["999999999999999999999999.1", 1, "9999999999999999999999991"],
  ] as const)("converts %s with %i decimals", (value, decimals, expected) => {
    expect(parseUnits(value, decimals)).toBe(expected);
  });

  it.each([
    ["-1", 18],
    ["+1", 18],
    ["1e3", 18],
    [".1", 18],
    ["1.", 18],
    ["01", 18],
    ["1.234", 2],
  ] as const)("rejects invalid value %s", (value, decimals) => {
    expect(() => parseUnits(value, decimals)).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid decimals %s",
    (decimals) => {
      expect(() => parseUnits("1", decimals)).toThrowError(
        expect.objectContaining({ code: "INVALID_REQUEST" })
      );
    }
  );
});

describe("formatUnits", () => {
  it.each([
    ["0", 18, "0"],
    ["1000000000000000000", 18, "1"],
    ["1230000", 6, "1.23"],
    ["1", 6, "0.000001"],
    ["100", 0, "100"],
  ] as const)("formats %s with %i decimals", (value, decimals, expected) => {
    expect(formatUnits(value, decimals)).toBe(expected);
  });

  it("rejects a non-base-unit amount", () => {
    expect(() => formatUnits("1.5", 6)).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
  });
});
