import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "executors/evm": "src/executors/evm/index.ts",
    "executors/solana": "src/executors/solana/index.ts",
    "executors/aptos": "src/executors/aptos/index.ts",
    "executors/near": "src/executors/near/index.ts",
    "executors/tron": "src/executors/tron/index.ts",
    "executors/bitcoin": "src/executors/bitcoin/index.ts",
    "executors/zcash": "src/executors/zcash/index.ts",
    "executors/sui": "src/executors/sui/index.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
});
