# Network Error Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Print safe, actionable diagnostics when `fetch` fails before returning an HTTP response and enrich the resulting `SwapSdkError`.

**Architecture:** Keep network-failure handling inside `ApiClient`. Convert an unknown thrown value into a sanitized diagnostic summary, use that summary for both `console.error` and `SwapSdkError.details`, and preserve the original value as `cause`.

**Tech Stack:** TypeScript, Vitest, tsup, ESLint

## Global Constraints

- Do not log request headers, authorization tokens, request bodies, wallet data, token data, or URL query parameters.
- Do not change retry counts, retry decisions, timeout behavior, abort behavior, HTTP response handling, or successful requests.
- Print one diagnostic for each failed network attempt.
- Preserve the original thrown value as `SwapSdkError.cause`.
- Preserve unrelated worktree and index changes.

---

### Task 1: Safe Network-Failure Diagnostics

**Files:**
- Modify: `tests/api/ApiClient.test.ts`
- Modify: `src/api/ApiClient.ts`

**Interfaces:**
- Consumes: an unknown value thrown by `fetch`, request method, API path, SDK stage, and attempt number.
- Produces: a structured `console.error` entry and `SwapSdkError` with enriched `message`, `details`, and preserved `cause`.

- [x] **Step 1: Write failing diagnostic tests**

Add tests that use `retry.maxRetries: 0`, reject `fetch` with:

```ts
const cause = new TypeError(
  "Failed to fetch https://swap.example/api/swap/quote?secret=query"
);
```

Assert the thrown error contains:

```ts
{
  code: "HTTP_ERROR",
  stage: "quote",
  message:
    "Network request failed: TypeError: Failed to fetch https://swap.example/api/swap/quote?[redacted]",
  cause,
  details: {
    method: "POST",
    path: "/api/swap/quote",
    attempt: 1,
    causeName: "TypeError",
    causeMessage:
      "Failed to fetch https://swap.example/api/swap/quote?[redacted]",
  },
}
```

Spy on `console.error` and assert it receives:

```ts
[
  "SDK network request failed",
  {
    method: "POST",
    path: "/api/swap/quote",
    stage: "quote",
    attempt: 1,
    causeName: "TypeError",
    causeMessage:
      "Failed to fetch https://swap.example/api/swap/quote?[redacted]",
  },
]
```

Also assert the serialized console arguments do not contain the configured API
token, sender, request body, or `secret=query`.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm vitest run tests/api/ApiClient.test.ts
```

Expected: the new assertions fail because the current SDK only reports
`Network request failed` and does not call `console.error`.

- [x] **Step 3: Implement the safe diagnostic summary**

Add a private request failure method or local helper equivalent to:

```ts
function networkFailureDetails(
  error: unknown,
  method: RequestOptions["method"],
  path: string,
  attempt: number
): Record<string, unknown> {
  const causeName =
    error instanceof Error && error.name.trim() ? error.name : "Error";
  const rawMessage =
    error instanceof Error && error.message.trim()
      ? error.message
      : String(error);
  const causeMessage = rawMessage.replace(
    /\b(https?:\/\/[^\s?#]+)\?[^\s#]*/gi,
    "$1?[redacted]"
  );
  return {
    method,
    path,
    attempt,
    causeName,
    causeMessage,
  };
}
```

In the non-abort/non-timeout catch branch, print:

```ts
console.error("SDK network request failed", {
  ...details,
  stage,
});
```

Then throw:

```ts
throw new SwapSdkError(
  "HTTP_ERROR",
  stage,
  `Network request failed: ${details.causeName}: ${details.causeMessage}`,
  {
    cause: error,
    retryable: true,
    details,
  }
);
```

Keep `path` sourced from the fixed API endpoint argument rather than from the
full URL.

- [x] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
pnpm vitest run tests/api/ApiClient.test.ts
```

Expected: all `ApiClient` tests pass and the new diagnostic test proves safe
output.

- [x] **Step 5: Run full verification**

Run:

```bash
pnpm test
pnpm type-check
pnpm lint
pnpm build
```

Expected: all commands exit 0. Confirm both `dist/index.js` and
`dist/index.mjs` contain `SDK network request failed`.

- [x] **Step 6: Leave changes on main without staging or committing**

Do not stage or commit. Preserve all pre-existing worktree changes.

### Task 2: Bind Fetch to the Global Receiver

**Files:**
- Modify: `tests/api/ApiClient.test.ts`
- Modify: `src/api/ApiClient.ts:70-80`

**Interfaces:**
- Consumes: the default global fetch or a fetch-compatible function supplied
  through `ApiClientConfig.fetch`.
- Produces: a stored fetch implementation whose receiver is always
  `globalThis`.

- [x] **Step 1: Write the failing receiver test**

Add a fetch-compatible test function that throws the same browser error unless
its receiver is `globalThis`:

```ts
const fetch = vi.fn(function (this: unknown) {
  if (this !== globalThis) {
    throw new TypeError(
      "Failed to execute 'fetch' on 'Window': Illegal invocation"
    );
  }
  return Promise.resolve(
    jsonResponse({ code: 0, msg: "ok", data: { bestQuote: {} } })
  );
});
```

Pass it through `ApiClientConfig.fetch` and assert `client.quote()` resolves.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm vitest run tests/api/ApiClient.test.ts
```

Expected: the new test fails with the enriched `Illegal invocation` network
error because `this.fetchImpl(...)` uses the `ApiClient` receiver.

- [x] **Step 3: Bind the fetch implementation once**

In the constructor, replace:

```ts
this.fetchImpl = fetchImpl;
```

with:

```ts
this.fetchImpl = fetchImpl.bind(globalThis);
```

- [x] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm vitest run tests/api/ApiClient.test.ts
```

Expected: all `ApiClient` tests pass.

- [x] **Step 5: Run full verification and inspect the bundle**

Run:

```bash
pnpm test
pnpm type-check
pnpm lint
pnpm build
```

Expected: every command exits 0. Confirm the built bundle binds the selected
fetch implementation to `globalThis`.

- [x] **Step 6: Leave changes on main without staging or committing**

Do not stage or commit. Preserve all pre-existing worktree changes.
