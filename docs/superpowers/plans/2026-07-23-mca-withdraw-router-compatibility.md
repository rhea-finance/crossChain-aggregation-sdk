# MCA Withdraw Router Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept valid MCA withdraw previews regardless of the backend router name.

**Architecture:** `normalizeMcaQuote()` will use the typed MCA request and required withdraw preview as its execution discriminator. The backend router remains opaque metadata and is preserved unchanged for build, report, and status operations.

**Tech Stack:** TypeScript, Vitest, pnpm, ESLint, tsup

## Global Constraints

- Work directly on `main`.
- Do not stage or commit.
- Do not add a router allowlist.
- Preserve withdraw preview validation and API-error handling.
- Preserve existing network diagnostic console output.

---

### Task 1: Normalize a `nearintents` MCA Withdraw

**Files:**
- Modify: `tests/mca/quote.test.ts`
- Modify: `src/mca/quote.ts`

**Interfaces:**
- Consumes: `normalizeMcaQuote(request, signer, quote)`
- Produces: a `McaWithdrawRelayerQuote` that preserves the backend router

- [ ] **Step 1: Write the failing regression test**

Add this test under `MCA quote normalization`:

```ts
it("preserves a nearintents router for a relayer withdraw", () => {
  const preview = {
    business: { nonce: "56", tx_requests: [] },
    messageToSign: "{\"nonce\":\"56\",\"tx_requests\":[]}",
    depositAddress: "intents-deposit-address",
    submissionMode: "multichain_relayer",
  };
  const raw = rawQuote({
    bestQuote: {
      router: "nearintents",
      estimatedOut: "1124805",
      minAmountOut: "1119180",
    },
    mcaContext: {
      flow: "withdraw",
      mcaAccountId: "mca.near",
    },
    mcaWithdrawToIntents: preview,
  });
  const quote = normalizeQuote(withdrawRequest, raw, 1000);

  expect(
    normalizeMcaQuote(withdrawRequest, withdrawSigner, quote)
  ).toMatchObject({
    flow: "withdraw",
    executionMode: "withdraw-relayer",
    preview,
    route: { router: "nearintents" },
    buildContext: { router: "nearintents" },
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm vitest run tests/mca/quote.test.ts
```

Expected: FAIL with `Expected near-mca-withdraw router, received nearintents`.

- [ ] **Step 3: Remove the router-name gate**

Delete `MCA_WITHDRAW_ROUTER`, the local normalized `router` variable, and:

```ts
if (router !== MCA_WITHDRAW_ROUTER) {
  throw invalidResponse(
    `Expected ${MCA_WITHDRAW_ROUTER} router, received ${quote.route.router}`
  );
}
```

Keep `nearMcaWithdrawTxError`, execution-mode selection, and preview validation
unchanged.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm vitest run tests/mca/quote.test.ts
```

Expected: every MCA quote test passes.

---

### Task 2: Full Verification and Build Inspection

**Files:**
- Verify: `dist/index.js`
- Verify: `dist/index.mjs`
- Verify: `dist/index.d.ts`

**Interfaces:**
- Produces: CJS, ESM, and declarations with router-agnostic MCA withdraw normalization

- [ ] **Step 1: Run all checks**

Run:

```bash
pnpm test
pnpm type-check
pnpm lint
pnpm build
git diff --check
```

Expected: every command exits `0`.

- [ ] **Step 2: Inspect generated bundles and diagnostics**

Run:

```bash
rg -n "Expected near-mca-withdraw router" src tests dist
rg -n "SDK network request failed" src/api/ApiClient.ts dist/index.js dist/index.mjs
```

Expected: the old router error has no matches; the existing console diagnostic
is present in source, CJS, and ESM.

- [ ] **Step 3: Leave changes on `main`**

Do not stage, commit, push, or clean unrelated worktree changes.
