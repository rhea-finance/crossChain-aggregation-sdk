# Quote Waiting Time Request Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the typed `quoteWaitingTimeMs` quote request parameter with a `3000ms` default and caller override support.

**Architecture:** Define the field on the public and raw request types, validate it with the other quote inputs, and resolve its default in the shared serializer. Standard and MCA quote flows both use this serializer, so one implementation covers every quote path.

**Tech Stack:** TypeScript, Vitest, pnpm, ESLint, tsup

## Global Constraints

- Default `quoteWaitingTimeMs` to `3000`.
- Accept caller-provided non-negative integers.
- Reject negative, fractional, non-finite values before network I/O.
- Preserve existing extensions, logs, and unrelated worktree changes.
- Work directly on `main`; do not stage or commit.

---

### Task 1: Add and Serialize Quote Waiting Time

**Files:**
- Modify: `tests/normalizers/quote.test.ts`
- Modify: `tests/client/SwapClient.test.ts`
- Modify: `tests/mca/quote.test.ts`
- Modify: `src/types/quote.ts`
- Modify: `src/api/rawTypes.ts`
- Modify: `src/normalizers/quote.ts`

**Interfaces:**
- Consumes: `QuoteRequest.quoteWaitingTimeMs?: number`
- Produces: `SwapQuoteRequestRaw.quoteWaitingTimeMs?: number` with a resolved value in serialized SDK requests.

- [x] **Step 1: Write failing serialization and transport tests**

Assert the standard serializer emits `3000`, preserves an override such as
`5000`, rejects `-1`, `1.5`, `NaN`, and `Infinity`, and that
`SwapClient.quote` sends `quoteWaitingTimeMs: 3000` in the HTTP body. Assert
MCA serialization also emits the default.

- [x] **Step 2: Run focused tests and verify RED**

Run:

```bash
pnpm vitest run tests/normalizers/quote.test.ts tests/client/SwapClient.test.ts tests/mca/quote.test.ts
```

Expected: type checking during transform or assertions fail because the field
is not defined and the serializer does not emit it.

- [x] **Step 3: Implement the public field, raw field, default, and validation**

Add `quoteWaitingTimeMs?: number` to both request interfaces. In
`validateQuoteRequest`, reject non-finite, negative, and fractional provided
values. In `serializeQuoteRequest`, emit:

```ts
quoteWaitingTimeMs: request.quoteWaitingTimeMs ?? 3000
```

Place the resolved field after `extensions` so the typed value is
authoritative.

- [x] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
pnpm vitest run tests/normalizers/quote.test.ts tests/client/SwapClient.test.ts tests/mca/quote.test.ts
```

Expected: every focused test passes.

- [x] **Step 5: Run full verification**

Run:

```bash
pnpm test
pnpm type-check
pnpm lint
pnpm build
git diff --check
```

Expected: every command exits `0`, bundles contain `quoteWaitingTimeMs` and the
existing network diagnostic logging remains present.

- [x] **Step 6: Leave changes on main**

Do not stage or commit. Preserve all unrelated worktree changes.
