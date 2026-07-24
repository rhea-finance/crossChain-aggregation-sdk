# Unified SwapClient Public API Design

## Goal

Remove the public `client.mca` namespace completely. MCA deposit and withdrawal remain supported as internal swap execution modes selected by the request and normalized quote. Applications use the same root `SwapClient` methods for regular swaps and MCA-related swaps.

This is an intentional breaking change. The SDK will not retain a deprecated `client.mca` alias.

## Public API

The root client is the only business API:

```ts
const quote = await client.quote(request);
const build = await client.buildSwap({ quote });
const result = await client.swap({ quote, signer, waitFor: "completed" });
await client.report(result);
const history = await client.getHistory({ sender: accountId });
```

The existing raw methods remain available:

- `quoteRaw()`
- `buildRaw()`
- `submitOrderRaw()`
- `getOrderStatusRaw()`
- `reportRaw()`
- `getHistoryRaw()`

`McaSwapService` is no longer exported, and `SwapClient` no longer has a public `mca` property.

## Type-Directed Dispatch

`SwapClient.quote()` uses overloads:

```ts
quote(request: McaQuoteRequest, options?: ApiRequestOptions): Promise<McaQuote>;
quote(request: QuoteRequest, options?: ApiRequestOptions): Promise<Quote>;
```

A request is an MCA request only when it has a valid `flow` (`deposit` or `withdraw`) and a non-empty `mcaAccountId`. Ownership of an MCA alone does not change a regular quote into an MCA quote.

`SwapClient.buildSwap()` accepts either a regular `Quote` or an `McaQuote`:

- Regular quote: call `/api/swap/swap` and normalize its chain execution.
- MCA deposit: call `/api/swap/swap`, preserve MCA report context, and return a normal `SwapBuild`.
- MCA withdrawal to the bound NEAR wallet: build the NEAR `exec` transaction directly from the quote preview.
- MCA relayer withdrawal: reject with `INVALID_REQUEST`; it requires a wallet message signature and must use `swap()`.

`SwapClient.swap()` uses overloads:

```ts
swap(input: McaSwapInput): Promise<McaSwapResult>;
swap(input: SwapInput): Promise<SwapExecutionResult>;
```

Runtime dispatch is based on the normalized quote, not the optional presence of a signer. A regular quote always follows the regular build/execution path. An MCA quote follows its `executionMode`.

## Internal Architecture

MCA-specific logic remains isolated in `src/mca/`, but it becomes an internal coordinator owned privately by `SwapClient`.

The coordinator receives narrow callback dependencies rather than recursively calling the public dispatch methods. Required dependencies include:

- raw quote and build calls;
- the base regular build implementation used by deposits;
- chain execution;
- report and order-status calls;
- lifecycle event emission.

This avoids the recursion `SwapClient.buildSwap(McaQuote) -> coordinator.build() -> SwapClient.buildSwap(McaQuote)`.

`SwapClient.report()` remains the single public reporting method. It first checks whether the internal coordinator owns a relayer report payload for the execution ID. Otherwise it uses the standard report payload stored by `SwapClient.executeSwap()`.

MCA history does not need a separate method. The existing history endpoint already treats `sender` as a general search key matching `sender`, `recipient`, or `multi_addr`, so applications query an MCA with:

```ts
await client.getHistory({ sender: mcaAccountId });
```

## Error and Lifecycle Behavior

The change does not alter execution semantics:

- quote freshness checks remain in place;
- MCA relayer withdrawals still sign the exact API `messageToSign`;
- bound-NEAR withdrawals still execute the preview directly;
- report failures remain warnings after successful submission;
- status polling still requires both an order/status key and router;
- ordinary swaps do not acquire MCA fields or MCA signatures.

Calling `buildSwap()` with an MCA relayer quote returns a clear `INVALID_REQUEST` error directing the caller to `swap()`.

## Export and Documentation Changes

- Remove the runtime export of `McaSwapService` from `src/index.ts`.
- Keep the MCA request, quote, signer, and collateral types/functions that applications need to construct unified root-client requests.
- Replace all `client.mca.quote/build/swap/report/getHistory` examples with root-client calls.
- Remove documentation that describes MCA as a separate SDK namespace.
- Keep HTTP documentation unchanged because the HTTP routes and payloads do not change.

## Testing

Regression coverage must prove:

1. `client.mca` is absent at runtime and in public types.
2. `client.quote()` returns a regular quote for a regular request and an `McaQuote` for an MCA request.
3. `client.buildSwap()` dispatches regular, MCA deposit, and bound-NEAR withdrawal quotes correctly.
4. `client.buildSwap()` rejects an MCA relayer quote.
5. `client.swap()` executes all regular and MCA modes through the root API.
6. `client.report()` can retry both standard and MCA relayer reports.
7. `client.getHistory({ sender: mcaAccountId })` preserves MCA server pagination results.
8. Public exports no longer include `McaSwapService`.
9. README and SDK examples contain no `client.mca` references.

The full test suite, type check, lint, and package build must pass after the breaking API migration.
