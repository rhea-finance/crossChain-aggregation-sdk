# MCA Deposit Router Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept valid MCA deposit quotes whose underlying execution router is `nearintents` while preserving legacy `near-mca-deposit` support.

**Architecture:** Keep the standard quote normalizer responsible for validating and preserving the selected route. Let the MCA normalizer classify deposit quotes from the typed request flow instead of requiring a router-specific sentinel value.

**Tech Stack:** TypeScript, Vitest, pnpm, ESLint, tsup

## Global Constraints

- Preserve the exact router returned by `/quote`.
- Preserve legacy `near-mca-deposit` behavior.
- Continue rejecting a non-empty `nearDepositTxError`.
- Do not change MCA withdraw routing.
- Do not remove existing console logging.
- Work directly on `main`; do not stage or commit.

---

### Task 1: Accept Underlying Routers for MCA Deposits

**Files:**
- Modify: `tests/mca/quote.test.ts`
- Modify: `src/mca/quote.ts`

**Interfaces:**
- Consumes: `normalizeMcaQuote(request: McaQuoteRequest, quote: Quote): McaQuote`
- Produces: an `McaDepositQuote` whose `route.router` and `buildContext.router` retain the API-selected router.

- [x] **Step 1: Write the failing regression test**

Add a deposit quote response with `bestQuote.router: "nearintents"` and
`mcaContext.flow: "deposit"`. Normalize it and assert:

```ts
expect(normalizeMcaQuote(depositRequest, quote)).toMatchObject({
  flow: "deposit",
  executionMode: "deposit",
  route: { router: "nearintents" },
  buildContext: { router: "nearintents" },
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm vitest run tests/mca/quote.test.ts
```

Expected: the new test fails with
`Expected near-mca-deposit router, received nearintents`.

- [x] **Step 3: Implement the minimal compatibility change**

Remove only the deposit router equality guard from `normalizeMcaQuote`.
Retain the `nearDepositTxError` check and the existing deposit result shape.
Do not alter the withdraw branch.

- [x] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm vitest run tests/mca/quote.test.ts
```

Expected: all MCA quote tests pass, including both `nearintents` and
`near-mca-deposit` deposits.

- [x] **Step 5: Run full verification**

Run:

```bash
pnpm test
pnpm type-check
pnpm lint
pnpm build
git diff --check
```

Expected: every command exits with status `0`; built ESM and CJS bundles do not
contain the removed deposit-router error message, and existing console logging
remains present.

- [x] **Step 6: Leave the verified changes on main**

Do not stage or commit. Preserve unrelated worktree changes.
