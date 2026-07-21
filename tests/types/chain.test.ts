import { describe, expect, it } from "vitest";
import { assertBaseUnitAmount } from "../../src/types/chain";

describe("assertBaseUnitAmount", () => {
  it.each(["0", "1", "1000000000000000000000000"])(
    "accepts %s",
    (amount) => expect(assertBaseUnitAmount(amount)).toBe(amount)
  );

  it.each(["", "-1", "1.2", "1e18", " 1"])("rejects %s", (amount) => {
    expect(() => assertBaseUnitAmount(amount)).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
  });
});
