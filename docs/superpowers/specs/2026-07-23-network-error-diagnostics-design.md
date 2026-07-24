# Network Error Diagnostics Design

## Goal

When the underlying `fetch` call fails before returning an HTTP response, the
SDK must expose the actual failure information instead of showing only
`Network request failed`.

## Behavior

`ApiClient.requestOnce()` will handle an unknown `fetch` failure by:

1. Reading a safe diagnostic summary from the original error.
2. Printing one structured `console.error` entry for that failed attempt.
3. Throwing `SwapSdkError` with an enriched message and structured details.
4. Preserving the original error as `SwapSdkError.cause`.

The console entry and thrown error will include:

- request method;
- API path, without query parameters;
- SDK error stage;
- attempt number;
- underlying error name;
- underlying error message.

The diagnostic output must not include:

- request headers or authorization tokens;
- request body;
- URL query parameters;
- sender, recipient, wallet, token, or transaction data.

## Error Shape

For an underlying `TypeError("Failed to fetch")`, the result will be
equivalent to:

```text
SwapSdkError: Network request failed: TypeError: Failed to fetch
```

Its `details` will contain safe fields such as:

```ts
{
  method: "POST",
  path: "/api/swap/quote",
  attempt: 1,
  causeName: "TypeError",
  causeMessage: "Failed to fetch",
}
```

The SDK console output will use the same safe fields and include `stage`.

## Retry Semantics

Each failed network attempt is logged separately. Existing retry decisions,
retry counts, timeouts, abort handling, HTTP response handling, and successful
request behavior remain unchanged.

Abort and timeout errors retain their existing dedicated SDK error codes and
are not reported as generic network failures.

## Fetch Invocation Context

Browser-native `window.fetch` requires its receiver to be `Window`. Storing it
as `this.fetchImpl` and invoking it as an object member changes the receiver to
the `ApiClient` instance and can throw `TypeError: Illegal invocation` before
any network request is sent.

The constructor will bind every fetch-compatible implementation to
`globalThis` once:

```ts
this.fetchImpl = fetchImpl.bind(globalThis);
```

This covers both the default global fetch and callers that pass
`fetch: window.fetch`. Arrow-function adapters and test doubles ignore the
bound receiver and keep their existing behavior.

## Testing

Tests will verify that:

1. A rejected `fetch` prints the safe structured diagnostic.
2. The thrown `SwapSdkError` message, cause, and details expose the underlying
   error.
3. Logs do not contain headers, request bodies, tokens, or query parameters.
4. Existing retry behavior remains unchanged.
5. A fetch implementation that requires `this === globalThis` succeeds.
6. Type checking, linting, the full test suite, and package build pass.

## Scope

This change affects only failures where `fetch` throws before an HTTP
`Response` is available. It does not change request payloads, API endpoints,
chain handling, or swap execution logic.
