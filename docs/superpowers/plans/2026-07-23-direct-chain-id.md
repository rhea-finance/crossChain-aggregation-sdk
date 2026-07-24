# Direct Chain ID Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every public CAIP-style chain reference with the unified Swap API's direct chain id.

**Architecture:** Keep one canonical `ChainRef` value set across quote, build, execution, history, lifecycle events, and wallet adapters. Public request validation is strict, while the raw API response boundary may recognize historical backend aliases and immediately normalize them to canonical direct ids.

**Tech Stack:** TypeScript, Zod, Vitest, tsup, ESLint

## Global Constraints

- This is a breaking change: do not accept `eip155:*` or `*:mainnet` as public SDK input.
- EVM chain ids are positive decimal strings such as `"1"` and `"8453"`.
- Canonical non-EVM ids are `"solana"`, `"aptos"`, `"near"`, `"tron"`, `"btc"`, `"zcash"`, and `"sui"`.
- Keep `McaSignerChain` unchanged because it represents signer families rather than network ids.
- Do not modify the HTTP API field names, RPC configuration, or application balance-query behavior.
- Preserve unrelated existing worktree and index changes.

---

### Task 1: Canonical Chain Type and Boundary Normalization

**Files:**
- Modify: `src/types/chain.ts`
- Modify: `src/normalizers/chain.ts`
- Modify: `tests/normalizers/chain.test.ts`
- Test: `tests/types/chain.test.ts`

**Interfaces:**
- Consumes: raw API chain strings and public `ChainRef` values.
- Produces: `ChainRef` with direct ids, strict `toApiChain(chain): string`, tolerant raw-boundary `fromApiChain(chain): ChainRef`, and direct-id native asset handling.

- [ ] **Step 1: Write failing canonical-id tests**

Add tests equivalent to:

```ts
expect(toApiChain("8453")).toBe("8453");
expect(toApiChain("solana")).toBe("solana");
expect(fromApiChain("0x2105")).toBe("8453");
expect(fromApiChain("sol")).toBe("solana");
expect(() => toApiChain("eip155:8453" as never)).toThrowError(
  expect.objectContaining({ code: "UNSUPPORTED_CHAIN" })
);
expect(() => toApiChain("solana:mainnet" as never)).toThrowError(
  expect.objectContaining({ code: "UNSUPPORTED_CHAIN" })
);
```

Update native-address assertions to use `"8453"`, `"near"`, and `"btc"`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
pnpm vitest run tests/normalizers/chain.test.ts tests/types/chain.test.ts
```

Expected: failures because direct ids are currently rejected or converted to CAIP values.

- [ ] **Step 3: Implement the canonical direct-id model**

Change `ChainRef` to:

```ts
export type ChainRef =
  | `${number}`
  | "solana"
  | "aptos"
  | "near"
  | "tron"
  | "btc"
  | "zcash"
  | "sui";
```

Make `toApiChain()` validate and return canonical input unchanged. It must accept only `/^[1-9]\d*$/` for EVM ids and the seven canonical non-EVM ids.

Make `fromApiChain()` normalize raw API values:

```text
0x2105 -> 8453
sol or 501 -> solana
bitcoin -> btc
trx -> tron
zec -> zcash
canonical values -> unchanged
```

Update native-address lookup keys to direct ids and detect an EVM native asset with `/^[1-9]\d*$/`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Task 1 command again. Expected: all selected tests pass.

- [ ] **Step 5: Commit only Task 1 files if git authorization is available**

```bash
git add src/types/chain.ts src/normalizers/chain.ts tests/normalizers/chain.test.ts tests/types/chain.test.ts
git commit -m "refactor: use direct chain ids"
```

Do not include unrelated staged files.

### Task 2: Quote and Client Request Surface

**Files:**
- Modify: `src/normalizers/quote.ts`
- Modify: `src/types/quote.ts`
- Modify: `tests/normalizers/quote.test.ts`
- Modify: `tests/client/SwapClient.test.ts`

**Interfaces:**
- Consumes: canonical `QuoteRequest`.
- Produces: quote HTTP payload and normalized `Quote` whose chain fields remain direct ids.

- [ ] **Step 1: Write failing quote tests**

Define requests using:

```ts
const request: QuoteRequest = {
  fromChain: "8453",
  toChain: "solana",
  tokenIn: { chain: "8453", address: "0xusdc", decimals: 6 },
  tokenOut: { chain: "solana", address: "sol-usdc", decimals: 6 },
  amountIn: "1000000",
  slippageBps: 50,
  sender: "0xsender",
};
```

Assert serialized `fromChain` and `toChain` are unchanged. Add runtime rejection coverage for legacy chain values and preserve token/request chain mismatch coverage.

- [ ] **Step 2: Run quote/client tests and verify RED**

```bash
pnpm vitest run tests/normalizers/quote.test.ts tests/client/SwapClient.test.ts
```

Expected: direct-id and legacy-rejection assertions fail against current behavior.

- [ ] **Step 3: Implement direct quote flow**

Keep `serializeQuoteRequest()` as the validation boundary, but make its chain serialization an identity after Task 1 validation. Ensure `normalizeQuote()` copies canonical direct ids into the returned quote and frozen build context.

- [ ] **Step 4: Run quote/client tests and verify GREEN**

Run the Task 2 command again. Expected: all selected tests pass.

- [ ] **Step 5: Commit only Task 2 files if authorized**

```bash
git add src/normalizers/quote.ts src/types/quote.ts tests/normalizers/quote.test.ts tests/client/SwapClient.test.ts
git commit -m "refactor: accept direct ids in quotes"
```

### Task 3: Build, History, and Execution Dispatch

**Files:**
- Modify: `src/normalizers/build.ts`
- Modify: `src/normalizers/history.ts`
- Modify: `src/types/execution.ts`
- Modify: `src/types/history.ts`
- Modify: `tests/normalizers/build.test.ts`
- Modify: `tests/normalizers/history.test.ts`

**Interfaces:**
- Consumes: raw API build/history responses.
- Produces: canonical direct chain ids in `SwapBuild`, `SwapExecution`, assets, order context, and history.

- [ ] **Step 1: Write failing build/history assertions**

Assert examples such as:

```ts
expect(build.fromChain).toBe("56");
expect(build.execution.chain).toBe("56");
expect(solanaBuild.fromChain).toBe("solana");
expect(history.records[0]?.fromChain).toBe("1");
expect(history.records[0]?.toChain).toBe("near");
```

Add raw-boundary cases for a hexadecimal EVM id and supported non-EVM aliases.

- [ ] **Step 2: Run build/history tests and verify RED**

```bash
pnpm vitest run tests/normalizers/build.test.ts tests/normalizers/history.test.ts
```

Expected: normalized values still contain CAIP namespaces.

- [ ] **Step 3: Implement direct execution-lane logic**

Update `laneFromChain()` so decimal strings select EVM and canonical non-EVM ids select their lane. Update EVM signing-request validation to compare `chain === String(chainId)`. Update history native-asset detection and maps to direct ids.

- [ ] **Step 4: Run build/history tests and verify GREEN**

Run the Task 3 command again. Expected: all selected tests pass.

- [ ] **Step 5: Commit only Task 3 files if authorized**

```bash
git add src/normalizers/build.ts src/normalizers/history.ts src/types/execution.ts src/types/history.ts tests/normalizers/build.test.ts tests/normalizers/history.test.ts
git commit -m "refactor: normalize builds to direct chain ids"
```

### Task 4: Wallet Executors

**Files:**
- Modify: `src/executors/evm/index.ts`
- Modify: `src/executors/shared.ts`
- Modify: `src/executors/solana/index.ts`
- Modify: `src/executors/aptos/index.ts`
- Modify: `src/executors/near/index.ts`
- Modify: `src/executors/tron/index.ts`
- Modify: `src/executors/bitcoin/index.ts`
- Modify: `src/executors/zcash/index.ts`
- Modify: `src/executors/sui/index.ts`
- Modify: `tests/executors/evm.test.ts`
- Modify: `tests/executors/account-chains.test.ts`
- Modify: `tests/executors/transfer-chains.test.ts`

**Interfaces:**
- Consumes: `SwapExecution.chain` and adapter-reported chain.
- Produces: direct-id chain validation and unchanged execution results.

- [ ] **Step 1: Convert executor tests to the desired contract**

Use `"1"` and `"56"` for EVM executions. Make non-EVM adapters return `"solana"`, `"aptos"`, `"near"`, `"tron"`, `"btc"`, `"zcash"`, and `"sui"`.

- [ ] **Step 2: Run executor tests and verify RED**

```bash
pnpm vitest run tests/executors
```

Expected: EVM validation constructs `eip155:*` and account-chain comparisons reject direct ids.

- [ ] **Step 3: Implement executor direct-id validation**

In the EVM executor, replace:

```ts
const connectedChain = `eip155:${connectedChainId}` as const;
```

with:

```ts
const connectedChain = String(connectedChainId) as ChainRef;
```

Keep shared `assertChain()` strict equality. Account-chain executors require their adapters to report canonical direct ids.

- [ ] **Step 4: Run executor tests and verify GREEN**

Run the Task 4 command again. Expected: all executor tests pass.

- [ ] **Step 5: Commit only executor files if authorized**

```bash
git add src/executors tests/executors
git commit -m "refactor: align executors with direct chain ids"
```

### Task 5: MCA Unified Flow

**Files:**
- Modify: `src/mca/quote.ts`
- Modify: `src/mca/McaSwapService.ts`
- Modify: `src/mca/types.ts`
- Modify: `tests/mca/quote.test.ts`
- Modify: `tests/mca/McaSwapService.test.ts`
- Modify: `tests/mca/withdraw.test.ts`

**Interfaces:**
- Consumes: direct chain ids in `McaQuoteRequest`.
- Produces: MCA quotes, builds, reports, and lifecycle events with only direct ids.

- [ ] **Step 1: Convert MCA tests to direct ids**

Use `"1"`, `"near"`, `"btc"`, and the other canonical ids throughout MCA request fixtures. Assert automatic NEAR selection is based on `toChain === "near"`.

- [ ] **Step 2: Run MCA tests and verify RED**

```bash
pnpm vitest run tests/mca
```

Expected: NEAR execution selection and existing fixture expectations fail.

- [ ] **Step 3: Implement direct-id MCA decisions**

Replace namespace comparisons such as:

```ts
request.toChain === "near:mainnet"
```

with:

```ts
request.toChain === "near"
```

Ensure generated NEAR builds, report contexts, relayer requests, and status requests preserve direct ids. Do not change signer-family values.

- [ ] **Step 4: Run MCA tests and verify GREEN**

Run the Task 5 command again. Expected: all MCA tests pass.

- [ ] **Step 5: Commit only MCA files if authorized**

```bash
git add src/mca tests/mca
git commit -m "refactor: use direct ids in mca flows"
```

### Task 6: Public Documentation and Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/MCA_SWAP_API.md`
- Modify: `docs/MCA_SWAP_HTTP_API.md`
- Modify: `tests/public-api.test.ts`
- Modify: any remaining current source/test file returned by the legacy-format scan

**Interfaces:**
- Consumes: the completed direct-id SDK.
- Produces: consistent package examples and final verification evidence.

- [ ] **Step 1: Add or update public-surface regression coverage**

Ensure public examples compile with direct ids and no exported runtime behavior requires conversion helpers. Preserve raw API methods.

- [ ] **Step 2: Replace active documentation examples**

Use:

```text
eip155:1 -> 1
solana:mainnet -> solana
near:mainnet -> near
bitcoin:mainnet -> btc
```

Do not rewrite historical design/plan documents except the current direct-chain-id spec and plan, where legacy strings are intentionally documented as rejected migration inputs.

- [ ] **Step 3: Scan current code, tests, and active docs**

```bash
rg -n 'eip155:|solana:mainnet|aptos:mainnet|near:mainnet|tron:mainnet|bitcoin:mainnet|zcash:mainnet|sui:mainnet' src tests README.md docs/MCA_SWAP_API.md docs/MCA_SWAP_HTTP_API.md
```

Expected: no matches except explicit legacy-rejection tests and migration explanations.

- [ ] **Step 4: Run full verification**

```bash
pnpm test
pnpm type-check
pnpm lint
pnpm build
```

Expected: every command exits 0 with no test failures, type errors, lint errors, or build errors.

- [ ] **Step 5: Review the final diff**

```bash
git diff -- src tests README.md docs/MCA_SWAP_API.md docs/MCA_SWAP_HTTP_API.md docs/superpowers/specs/2026-07-23-direct-chain-id-design.md docs/superpowers/plans/2026-07-23-direct-chain-id.md
```

Verify there are no unrelated edits and no old namespace value leaks into public behavior.

- [ ] **Step 6: Commit the completed migration if authorized**

```bash
git add src tests README.md docs/MCA_SWAP_API.md docs/MCA_SWAP_HTTP_API.md docs/superpowers/specs/2026-07-23-direct-chain-id-design.md docs/superpowers/plans/2026-07-23-direct-chain-id.md
git commit -m "refactor: standardize direct chain ids"
```
