# MCA Deposit Router Compatibility Design

## Problem

The multi-chain quote API identifies the business flow through the request
`mca.flow` and may confirm it in `mcaContext.flow`. For a cross-chain deposit,
the selected execution router can be the underlying router, such as
`nearintents`.

The SDK currently rejects every deposit quote whose selected router is not
`near-mca-deposit`. This conflates the MCA business flow with the execution
route and rejects a valid quote before the build request is made.

## Design

- Continue selecting the MCA deposit path from the typed request
  `flow: "deposit"`.
- Accept any non-empty router already validated by the standard quote
  normalizer.
- Preserve the selected router in `route` and `buildContext`, so the later
  `/swap` request receives the exact router returned by `/quote`.
- Keep `near-mca-deposit` fully supported for older and same-chain responses.
- Continue surfacing a non-empty `nearDepositTxError` when the API provides it.
- Keep `nearDepositTx` optional.
- Do not change MCA withdraw routing because this bug and response only
  demonstrate the new deposit behavior.

`mcaContext.flow` is response metadata rather than the source of truth. The
typed request already selected the managed deposit path. If `mcaContext.flow`
is absent, older responses must remain valid.

## Data Flow

1. The caller submits an `McaDepositQuoteRequest`.
2. The SDK sends the nested `mca` payload to `/quote`.
3. The quote normalizer validates the selected route and amounts.
4. The MCA normalizer classifies the result as a deposit from `request.flow`
   without rewriting the selected router.
5. Build sends the saved router and the original `mca` payload to `/swap`.

## Error Handling

- Missing or malformed standard route fields remain invalid.
- A non-empty `nearDepositTxError` remains an API-response error.
- A valid `nearintents` deposit must not fail solely because its router is not
  `near-mca-deposit`.

## Tests

- Reproduce the API response with `bestQuote.router: "nearintents"` and
  `mcaContext.flow: "deposit"`.
- Assert normalization returns `executionMode: "deposit"` and preserves
  `nearintents` in both `route.router` and `buildContext.router`.
- Keep the existing legacy `near-mca-deposit` test passing.
- Run the full project verification suite and build.
