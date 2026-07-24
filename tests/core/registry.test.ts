import { describe, expect, it } from "vitest";
import { ExecutorRegistry } from "../../src/core/registry";

describe("ExecutorRegistry", () => {
  const executor = {
    kinds: ["bitcoin-transfer"] as const,
    validate: async () => undefined,
    execute: async () => ({
      status: "submitted" as const,
      txHash: "hash",
    }),
  };

  it("resolves by exact kind", () => {
    const registry = new ExecutorRegistry([executor]);
    expect(registry.get("bitcoin-transfer")).toBe(executor);
  });

  it("rejects duplicate kinds", () => {
    expect(() => new ExecutorRegistry([executor, executor])).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
  });

  it("returns EXECUTOR_NOT_FOUND for an unregistered kind", () => {
    expect(() => new ExecutorRegistry().get("sui-transfer")).toThrowError(
      expect.objectContaining({ code: "EXECUTOR_NOT_FOUND" })
    );
  });

  it("resolves wallet identity and message signing by signer chain", async () => {
    const signerExecutor = {
      ...executor,
      signerChain: "btc",
      getIdentityKey: async () => "btc-public-key",
      signMessage: async (message: string) => `signed:${message}`,
    };
    const registry = new ExecutorRegistry([signerExecutor]);

    const signer = registry.getSigner("btc", true);

    expect(signer).toBe(signerExecutor);
    await expect(signer.getIdentityKey()).resolves.toBe("btc-public-key");
    await expect(signer.signMessage("message")).resolves.toBe(
      "signed:message"
    );
  });

  it("reports missing executor signer capabilities", () => {
    expect(() => new ExecutorRegistry().getSigner("evm")).toThrowError(
      expect.objectContaining({ code: "EXECUTOR_NOT_FOUND" })
    );

    const withoutIdentity = {
      ...executor,
      signerChain: "btc",
    };
    expect(() =>
      new ExecutorRegistry([withoutIdentity]).getSigner("btc")
    ).toThrowError(expect.objectContaining({ code: "SIGNING_FAILED" }));

    const withoutSignMessage = {
      ...executor,
      signerChain: "btc",
      getIdentityKey: async () => "btc-public-key",
    };
    expect(() =>
      new ExecutorRegistry([withoutSignMessage]).getSigner("btc", true)
    ).toThrowError(expect.objectContaining({ code: "SIGNING_FAILED" }));
  });
});
