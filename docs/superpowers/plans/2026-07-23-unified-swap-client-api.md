# Unified SwapClient API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `client.mca` completely and route regular and MCA swap modes through the root `SwapClient` methods.

**Architecture:** `SwapClient` owns a private MCA coordinator. Root method overloads select the coordinator only when the request/quote is an MCA discriminated union. A private standard-build method prevents recursive MCA deposit dispatch.

**Tech Stack:** TypeScript, Vitest, Zod, pnpm, tsup.

## Global Constraints

- Do not retain a deprecated `client.mca` alias.
- Do not change HTTP endpoints or request/response payloads.
- Keep ordinary swap behavior unchanged.
- Do not commit or stage changes.

---

### Task 1: Root Quote API and Public Surface

**Files:**
- Modify: `tests/mca/McaSwapService.test.ts`
- Modify: `tests/public-api.test.ts`
- Modify: `src/client/SwapClient.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `McaQuoteRequest`, `McaQuote`, `QuoteRequest`, and `Quote`.
- Produces: overloaded `SwapClient.quote()` and a private MCA coordinator with no public `mca` property.

- [ ] Replace an MCA quote test with `client.quote(depositRequest)` and assert `executionMode === "deposit"`.
- [ ] Add a public-surface assertion that `"mca" in client` is false and remove the `McaSwapService` root export expectation.
- [ ] Run `pnpm vitest run tests/mca/McaSwapService.test.ts tests/public-api.test.ts` and verify failure because root quote does not dispatch and `client.mca` still exists.
- [ ] Add MCA-first overloads and an `isMcaQuoteRequest()` guard to `SwapClient.quote()`; store the coordinator in a private field.
- [ ] Remove `McaSwapService` from `src/index.ts`.
- [ ] Re-run the focused tests and verify they pass.

### Task 2: Root Build, Swap, and Report Dispatch

**Files:**
- Modify: `tests/mca/McaSwapService.test.ts`
- Modify: `src/client/SwapClient.ts`
- Modify: `src/mca/McaSwapService.ts`
- Modify: `src/mca/types.ts`

**Interfaces:**
- Consumes: `McaQuote`, `McaSwapInput`, `SwapInput`, and `SwapExecutionResult`.
- Produces: unified `buildSwap()`, `swap()`, and `report()` behavior.

- [ ] Replace every `client.mca.build/swap/report` test call with the root method.
- [ ] Replace MCA history calls with `client.getHistory({ sender: mcaAccountId })` and remove the MCA history convenience types.
- [ ] Add a regression test proving root `buildSwap()` rejects an MCA relayer quote with `INVALID_REQUEST`.
- [ ] Run the MCA and client tests and verify failures caused by missing root dispatch.
- [ ] Extract the existing standard build implementation into private `buildStandardSwap()`.
- [ ] Pass `buildStandardSwap` into the internal coordinator so MCA deposits do not recursively call public `buildSwap()`.
- [ ] Dispatch `buildSwap()` and `swap()` by `executionMode` on the normalized MCA quote.
- [ ] Change coordinator reporting to return a managed relayer report promise only when it owns the execution ID; let root `report()` fall back to the standard report map.
- [ ] Remove the coordinator history method and `McaHistoryRequest` / `McaHistoryPage`.
- [ ] Re-run focused tests and verify they pass.

### Task 3: Documentation and API Migration

**Files:**
- Modify: `README.md`
- Modify: `docs/MCA_SWAP_API.md`

**Interfaces:**
- Consumes: unified root methods from Tasks 1 and 2.
- Produces: examples containing `client.quote/buildSwap/swap/report/getHistory` only.

- [ ] Replace `client.mca.quote/build/swap/report/getHistory` examples with root-client calls.
- [ ] Rewrite namespace descriptions and method headings so MCA is described as an internal flow.
- [ ] Run `rg -n 'client\.mca' README.md docs/MCA_SWAP_API.md tests src` and verify there are no active references.

### Task 4: Full Verification

**Files:**
- Verify all modified source, test, and documentation files.

**Interfaces:**
- Consumes: all earlier tasks.
- Produces: a buildable package with one public business API surface.

- [ ] Run `pnpm test` and require all tests to pass.
- [ ] Run `pnpm type-check` and require exit code 0.
- [ ] Run `pnpm lint` and require exit code 0.
- [ ] Run `pnpm build` and require CJS, ESM, and DTS success.
- [ ] Run `git diff --check` for all changed files.
