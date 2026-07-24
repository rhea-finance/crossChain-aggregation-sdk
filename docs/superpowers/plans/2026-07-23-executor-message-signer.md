# Executor Message Signer Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve MCA wallet identity and message signing through registered executors, remove signer objects from quote/swap inputs, and delete the unsupported passkey signer family.

**Architecture:** Extend `ChainExecutor` with optional signer capabilities forwarded by every built-in executor. Resolve those capabilities through `ExecutorRegistry`, then let `McaSwapService` read the selected executor identity during quote and invoke the same executor during relayer withdraw.

**Tech Stack:** TypeScript, Vitest, pnpm, ESLint, tsup

## Global Constraints

- Applications pass `signerChain`, not a signer object.
- Wallet methods live on executor adapters.
- The unsupported passkey signer family must not remain in source, tests, README, or MCA API documentation.
- Standard non-MCA executor integrations remain source compatible.
- Existing console logging and network diagnostics remain unchanged.
- Work directly on `main`; do not stage or commit.

---

### Task 1: Expose Executor Signer Capabilities

**Files:**
- Modify: `src/core/registry.ts`
- Modify: `src/executors/shared.ts`
- Modify: `src/executors/*/index.ts`
- Modify: `tests/core/registry.test.ts`
- Modify: `tests/executors/evm.test.ts`

**Interfaces:**
- Produces: `ChainExecutor.signerChain`, `getIdentityKey()`, `signMessage()`
- Produces: `ExecutorRegistry.getSigner(chain, requireSignMessage?)`

- [ ] **Step 1: Write failing executor and registry tests**

Create an EVM adapter with `getIdentityKey` and `signMessage`. Assert the
created executor exposes `signerChain: "evm"` and forwards both methods.
Assert the registry resolves it and rejects missing identity/sign methods.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm vitest run tests/core/registry.test.ts tests/executors/evm.test.ts
```

Expected: tests fail because signer capabilities and `getSigner` are absent.

- [ ] **Step 3: Implement shared capability forwarding**

Add the optional adapter methods, executor capability types, registry
resolution, and a shared helper that forwards methods without losing adapter
method binding. Apply the helper to all eight built-in executors with their
canonical signer chain.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
pnpm vitest run tests/core/registry.test.ts tests/executors/evm.test.ts
```

Expected: all focused tests pass.

---

### Task 2: Use Executors for MCA Identity and Signing

**Files:**
- Modify: `src/mca/types.ts`
- Modify: `src/mca/quote.ts`
- Modify: `src/mca/McaSwapService.ts`
- Modify: `src/client/SwapClient.ts`
- Modify: `tests/mca/quote.test.ts`
- Modify: `tests/mca/McaSwapService.test.ts`

**Interfaces:**
- Consumes: `McaQuoteRequest.signerChain`
- Consumes: `ExecutorRegistry.getSigner()`
- Produces: `McaQuote.signer` as the resolved immutable identity
- Produces: relayer signing without `McaSwapInput.signer`

- [ ] **Step 1: Write failing MCA API tests**

Change MCA requests to use `signerChain`, register signer-capable executors,
and call `swap({ quote })` without signer. Assert the quote request contains
the executor identity and relayer withdraw invokes executor `signMessage`.

- [ ] **Step 2: Run MCA tests and verify RED**

Run:

```bash
pnpm vitest run tests/mca/quote.test.ts tests/mca/McaSwapService.test.ts
```

Expected: type or runtime failures show the old signer-object dependency.

- [ ] **Step 3: Refactor MCA types and service**

Resolve identity during `McaSwapService.quote`, pass the resolved identity to
serialization/normalization, store it on `McaQuote`, and use the registry
capability during relayer withdraw. Remove signer inputs and old signer
adapter conversion.

- [ ] **Step 4: Run MCA tests and verify GREEN**

Run:

```bash
pnpm vitest run tests/mca/quote.test.ts tests/mca/McaSwapService.test.ts
```

Expected: MCA deposit, direct NEAR withdraw, and relayer withdraw pass.

---

### Task 3: Remove the Unsupported Signer Family and Update Public Guidance

**Files:**
- Modify: `src/mca/signers.ts`
- Modify: `tests/mca/signers.test.ts`
- Modify: `tests/public-api.test.ts`
- Modify: `README.md`
- Modify: `docs/MCA_SWAP_API.md`

**Interfaces:**
- Produces: MCA signer chains and wallet descriptors without the unsupported family
- Produces: examples using executor methods and `signerChain`

- [ ] **Step 1: Update tests to require the reduced signer set**

Remove the unsupported signer expectations and update signer helper tests to
use identity records rather than signer adapters.

- [ ] **Step 2: Remove the unsupported signer and obsolete signer-adapter API**

Delete its mappings and priority entries. Keep identity formatting and
selection helpers aligned with the eight executor-backed chains.

- [ ] **Step 3: Update README and MCA SDK documentation**

Replace signer object examples with `signerChain` plus executor adapter
`getIdentityKey` and `signMessage` methods. State that relayer withdraw uses
the registered executor automatically.

- [ ] **Step 4: Verify no unsupported signer references remain**

Run:

```bash
rg -n -i "unsupported-passkey-signer" src tests README.md docs/MCA_SWAP_API.md
```

Expected: no matches.

---

### Task 4: Full Verification

**Files:**
- Verify all modified source, tests, docs, and generated bundles.

- [ ] **Step 1: Run full checks**

Run:

```bash
pnpm test
pnpm type-check
pnpm lint
pnpm build
git diff --check
```

Expected: every command exits `0`.

- [ ] **Step 2: Inspect bundles and declarations**

Confirm built ESM, CJS, and declaration files expose executor signer
capabilities and `signerChain`, do not expose the unsupported signer, and preserve existing
network diagnostic logs.

- [ ] **Step 3: Leave changes on main**

Do not stage or commit. Preserve all unrelated worktree changes.
