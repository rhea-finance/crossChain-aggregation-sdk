# SDK Resilience and Utilities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the approved retry, safe logging, idempotency, and base-unit conversion features of the multi-chain SDK.

**Architecture:** `ApiClient` retries only explicitly safe read-like operations through an attempt-scoped transport loop. Logging emits metadata-only structured events. Amount conversion remains dependency-free pure functions exported by the root package.

**Tech Stack:** TypeScript 5, Vitest, native Fetch API.

## Global Constraints

- Work in the current directory and do not commit automatically.
- Quote, history, and order status retry retryable failures at most two times by default.
- Build, report, signature submission, and broadcasts never retry automatically.
- Logs never contain Authorization, request bodies, signatures, typed data, calldata, serialized transactions, or full query strings.
- Amount utilities never use floating-point arithmetic.
- Write and run a failing test before every production behavior.

### Task 1: Amount Utilities

- Create `src/utils/units.ts` and `tests/utils/units.test.ts`.
- Add `parseUnits(value, decimals)` and `formatUnits(value, decimals)` using string arithmetic.
- Reject signs, scientific notation, malformed decimals, invalid base-unit values, and excessive fractional precision.
- Export both functions from `src/index.ts`.

### Task 2: Retry, Logger, and Idempotency Transport

- Create `src/core/logger.ts`.
- Extend `ApiClientConfig` with `retry?: Partial<RetryConfig>` and `logger?: SdkLogger`.
- Extend `ApiRequestOptions` with `idempotencyKey?: string`.
- Retry quote/history/order-status for network errors, timeouts, 429, and retryable 5xx.
- Use attempt-scoped AbortController and timeout state.
- Never retry business errors, auth errors, caller abort, build, submit, or report.
- Emit only `api.request`, `api.response`, and `api.retry` metadata.
- Add `Idempotency-Key` only when explicitly supplied.

### Task 3: Documentation and Acceptance

- Document retry settings, logger shape, idempotency, and amount utilities in README.
- Run full tests, type-check, lint, multi-entry build, CJS/ESM import, secret scan, and `git diff --check`.
