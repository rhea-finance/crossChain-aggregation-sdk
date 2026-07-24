# EVM Quantity Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize decimal and hexadecimal EVM transaction quantities into canonical decimal strings during build parsing.

**Architecture:** Add one reusable Zod transform for EVM quantities in `schemas.ts`. Use it for `value` and `gasLimit` in every EVM main/approval transaction, leaving calldata and chain IDs unchanged.

**Tech Stack:** TypeScript, Zod, Vitest, tsup, ESLint

## Global Constraints

- Public `EvmTx.value` and `EvmTx.gasLimit` remain decimal strings.
- Accept only non-negative decimal strings or `0x`-prefixed hexadecimal quantities.
- Preserve strict calldata and chain-id validation.
- Preserve unrelated worktree and index changes.
- Do not stage or commit.

---

### Task 1: Normalize EVM Transaction Quantities

**Files:**
- Modify: `tests/normalizers/build.test.ts`
- Modify: `src/normalizers/schemas.ts`

**Interfaces:**
- Consumes: `tx.value` and `tx.gasLimit` from raw build responses.
- Produces: canonical decimal strings used by `EvmTx` and wallet adapters.

- [x] **Step 1: Write the failing build tests**

Create an EVM build derived from `buildFixtures.evmTransaction` with
`fromChain: "8453"`, `chainId: 8453`, `value: "0x0"`, and
`gasLimit: "0x186a0"`. Assert:

```ts
expect(result.execution).toMatchObject({
  kind: "evm-transaction",
  tx: {
    value: "0",
    gasLimit: "100000",
    chainId: 8453,
  },
});
```

Add equivalent approval coverage and malformed quantity rejection.

- [x] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm vitest run tests/normalizers/build.test.ts
```

Expected: the hexadecimal build fails with `INVALID_API_RESPONSE`.

- [x] **Step 3: Implement the quantity transform**

In `src/normalizers/schemas.ts`, define:

```ts
const evmQuantitySchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*|0x[0-9a-fA-F]+)$/)
  .transform((value) =>
    value.startsWith("0x") ? BigInt(value).toString() : value
  );
```

Use `evmQuantitySchema` for `evmTxSchema.value` and
`evmTxSchema.gasLimit`.

- [x] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
pnpm vitest run tests/normalizers/build.test.ts
```

Expected: all build normalizer tests pass.

- [x] **Step 5: Run full verification**

Run:

```bash
pnpm test
pnpm type-check
pnpm lint
pnpm build
```

Expected: every command exits 0, and built bundles contain the EVM quantity
normalization.

- [x] **Step 6: Leave changes on main**

Do not stage or commit. Preserve all existing worktree changes.
