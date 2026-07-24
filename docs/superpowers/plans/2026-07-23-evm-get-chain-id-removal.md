# EVM `getChainId` Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the provider network lookup and `getChainId()` requirement from the EVM executor.

**Architecture:** The EVM executor trusts the normalized build transaction or signing request for its target chain. It retains the local EIP-712 domain/request consistency check but no longer asks the wallet provider for its current network.

**Tech Stack:** TypeScript, Vitest, pnpm, ESLint, tsup

## Global Constraints

- Work directly on `main`.
- Do not stage or commit.
- Preserve existing network diagnostic console output.
- Remove `getChainId` from source, tests, public examples, and declarations.

---

### Task 1: Remove the EVM Provider Network Dependency

**Files:**
- Modify: `tests/executors/evm.test.ts`
- Modify: `src/executors/evm/index.ts`

**Interfaces:**
- Produces: `EvmWalletAdapter` without `getChainId()`
- Preserves: `createEvmExecutor(adapter)` and EIP-712 domain/request chain validation

- [ ] **Step 1: Write the failing test**

Remove `getChainId` from the typed test wallet:

```ts
function wallet(
  overrides: Partial<EvmWalletAdapter> = {}
): EvmWalletAdapter {
  return {
    sendTransaction: vi.fn(async () => ({ txHash: "0xswap" })),
    signTypedData: vi.fn(async () => "0xsignature"),
    ...overrides,
  };
}
```

Replace the provider mismatch test with:

```ts
it("validates a transaction without reading the provider network", async () => {
  const executor = createEvmExecutor(wallet());

  await expect(executor.validate(txExecution, context())).resolves.toBeUndefined();
});
```

Add a regression test that an EIP-712 domain chain different from
`request.chainId` still throws `CHAIN_MISMATCH`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm vitest run tests/executors/evm.test.ts
```

Expected: FAIL because `validate()` still calls the removed adapter method.

- [ ] **Step 3: Implement the minimal EVM executor change**

Delete `getChainId()` from `EvmWalletAdapter`. Remove the provider-network read,
`assertChain`, `ChainRef`, and connected-chain comparisons from `validate()`.
Keep:

```ts
if (execution.kind === "evm-signature") {
  const expectedChainId = execution.request.chainId;
  const domainChainId = execution.request.typedData.domain.chainId;
  if (
    domainChainId !== undefined &&
    String(domainChainId) !== String(expectedChainId)
  ) {
    throw new SwapSdkError(
      "CHAIN_MISMATCH",
      "sign",
      `EIP-712 domain chain ${String(domainChainId)} does not match request chain ${expectedChainId}`
    );
  }
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm vitest run tests/executors/evm.test.ts
```

Expected: every EVM executor test passes.

---

### Task 2: Remove Public Examples and Cross-Executor Test Usage

**Files:**
- Modify: `tests/executors/signer-chains.test.ts`
- Modify: `README.md`
- Modify: `docs/MCA_SWAP_API.md`

**Interfaces:**
- Consumes: `EvmWalletAdapter` without `getChainId()`
- Produces: examples that require no EVM provider network lookup

- [ ] **Step 1: Remove every remaining usage**

Delete `getChainId` from the EVM adapter in
`tests/executors/signer-chains.test.ts`, the README executor example, and both
MCA SDK documentation examples.

- [ ] **Step 2: Verify the identifier is absent from active surfaces**

Run:

```bash
rg -n "getChainId" src tests README.md docs/MCA_SWAP_API.md
```

Expected: no matches.

---

### Task 3: Full Verification and Build Inspection

**Files:**
- Verify: `dist/executors/evm.d.ts`
- Verify: `dist/index.js`
- Verify: `dist/index.mjs`

**Interfaces:**
- Produces: CJS, ESM, and declarations without `getChainId`

- [ ] **Step 1: Run all checks**

Run:

```bash
pnpm test
pnpm type-check
pnpm lint
pnpm build
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 2: Inspect generated declarations and diagnostics**

Run:

```bash
rg -n "getChainId" dist
rg -n "SDK network request failed" src/api/ApiClient.ts dist/index.js dist/index.mjs
```

Expected: the first command has no matches; the second finds the preserved
console diagnostic in source, CJS, and ESM.

- [ ] **Step 3: Leave changes on `main`**

Do not stage, commit, push, or clean unrelated worktree changes.
