import { describe, expect, it } from "vitest";
import { SwapSdkError, asSwapSdkError } from "../../src/core/errors";

describe("asSwapSdkError", () => {
  it("preserves SDK errors", () => {
    const error = new SwapSdkError("API_ERROR", "quote", "bad quote");
    expect(asSwapSdkError(error, "build")).toBe(error);
  });

  it("wraps unknown errors", () => {
    const error = asSwapSdkError(new Error("boom"), "history");
    expect(error).toMatchObject({
      code: "API_ERROR",
      stage: "history",
      retryable: false,
    });
  });
});
