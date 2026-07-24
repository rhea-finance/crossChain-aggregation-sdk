# Quote Waiting Time Request Design

## Goal

Expose the Near Intents `quoteWaitingTimeMs` request parameter through the SDK
with a default value of `3000` milliseconds.

## Public API

Add an optional `quoteWaitingTimeMs?: number` field to `QuoteRequest`. Callers
may omit it to use `3000`, or provide a different non-negative integer number
of milliseconds.

`McaQuoteRequest` extends `QuoteRequest`, so MCA deposit and withdrawal quote
requests receive the same behavior without a second field.

## Serialization

`serializeQuoteRequest` resolves the final value and writes it to the outgoing
top-level `/quote` request body:

```ts
quoteWaitingTimeMs: request.quoteWaitingTimeMs ?? 3000
```

The resolved value is also retained in the immutable quote build context,
following the existing behavior for serialized quote request fields.

## Validation

Reject a provided value when it is not a finite, non-negative integer. This
prevents negative durations, fractional milliseconds, `NaN`, and infinity
from reaching the API.

## Compatibility

- Existing callers require no changes and begin sending `3000`.
- Callers can override the value through the typed top-level field.
- Existing `extensions` fields continue to pass through, but the typed
  `quoteWaitingTimeMs` value is authoritative.
- Existing console logging and network diagnostics remain unchanged.

## Tests

- Standard serialization includes the `3000` default.
- A caller override is preserved.
- Invalid values fail before the network request.
- `SwapClient.quote` sends the resolved field in the actual HTTP body.
- MCA serialization inherits the same default.

