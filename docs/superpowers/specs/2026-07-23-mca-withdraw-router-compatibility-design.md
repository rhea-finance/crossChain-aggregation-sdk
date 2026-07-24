# MCA Withdraw Router Compatibility Design

## Root Cause

The quote response is a valid MCA withdraw response:

- `bestQuote.router` is `nearintents`.
- `mcaContext.flow` is `withdraw`.
- `mcaWithdrawToIntents` contains `business`, `messageToSign`,
  `depositAddress`, signer metadata, and `submissionMode`.

`normalizeMcaQuote()` rejects the response before reading that preview because
it requires the route name to equal `near-mca-withdraw`.

## Design

Remove the MCA withdraw router-name check. A router identifies the backend
route selected for the swap; it is not the MCA execution-mode discriminator.

The normalized MCA flow continues to use:

- The typed quote request's `flow`.
- `executionPreference`, recipient, and bound NEAR account to choose
  `withdraw-near` or `withdraw-relayer`.
- `mcaWithdrawToIntents` as the required relayer preview.
- `nearMcaWithdrawTx`, with the existing fallback, as the NEAR preview.

The router returned by the API remains unchanged on `route` and
`buildContext`, so build, report, and order-status calls use the backend's
actual router.

## Error Handling

- `nearMcaWithdrawTxError` remains an API error.
- A relayer withdraw without a plain-object `mcaWithdrawToIntents` remains an
  `INVALID_API_RESPONSE`.
- A NEAR withdraw without a usable preview remains an
  `INVALID_API_RESPONSE`.
- No router allowlist is introduced.

## Testing

Add a regression test using a `nearintents` withdraw quote with a valid
`mcaWithdrawToIntents` preview. Assert normalization succeeds, selects
`withdraw-relayer`, and preserves `nearintents` in both `route` and
`buildContext`.

Run focused MCA quote tests, the full test suite, type check, lint, build,
declaration/bundle inspection, and `git diff --check`.
