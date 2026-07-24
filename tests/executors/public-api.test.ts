import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createAptosExecutor } from "../../src/executors/aptos";
import { createBitcoinExecutor } from "../../src/executors/bitcoin";
import { createEvmExecutor } from "../../src/executors/evm";
import { createNearExecutor } from "../../src/executors/near";
import { createSolanaExecutor } from "../../src/executors/solana";
import { createSuiExecutor } from "../../src/executors/sui";
import { createTronExecutor } from "../../src/executors/tron";
import { createZcashExecutor } from "../../src/executors/zcash";

describe("executor public API", () => {
  it("exports all executor factories from source subpaths", () => {
    for (const factory of [
      createEvmExecutor,
      createSolanaExecutor,
      createAptosExecutor,
      createNearExecutor,
      createTronExecutor,
      createBitcoinExecutor,
      createZcashExecutor,
      createSuiExecutor,
    ]) {
      expect(factory).toBeTypeOf("function");
    }
  });

  it("publishes every executor package subpath", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8")
    ) as { exports: Record<string, unknown> };
    expect(Object.keys(packageJson.exports).sort()).toEqual(
      [
        ".",
        "./executors/aptos",
        "./executors/bitcoin",
        "./executors/evm",
        "./executors/near",
        "./executors/solana",
        "./executors/sui",
        "./executors/tron",
        "./executors/zcash",
      ].sort()
    );
  });
});
