# Current SDK README Design

## Goal

Rewrite `README.md` as the Chinese primary usage guide for the current SDK.
The document must let an integrator complete a basic quote and swap without
reading implementation code or understanding internal routing branches.

## Audience

Application developers integrating the SDK in a browser or Node.js project.
The reader understands TypeScript and wallet SDKs but should not need to know
the SDK's normalizers, router-specific response shapes, or MCA execution
branches.

## Structure

1. Package purpose and supported chain families.
2. Installation and amount conventions.
3. A minimal EVM-to-Solana demo:
   - Create an EVM adapter.
   - Register `createEvmExecutor(adapter)`.
   - Call `client.quote(request)`.
   - Pass the quote directly to `client.swap({ quote })`.
4. Field reference tables:
   - `SwapClientConfig`.
   - `QuoteRequest`.
   - `AssetRef` for `tokenIn` and `tokenOut`.
   - `SwapInput` and `WaitMode`.
   - `SwapExecutionResult`.
   - MCA-specific quote fields.
5. Executor adapter responsibilities:
   - Transaction submission.
   - Optional confirmation.
   - MCA identity and message signing.
   - No EVM `getChainId()` requirement.
   - Standard Zcash submission with a required real transaction hash.
6. Swap return timing:
   - Default `submitted`.
   - Optional `source-confirmed`.
   - `completed` with internal status polling.
   - Manual `waitForOrder()` example.
7. EVM approve sequence and optional allowance check.
8. MCA examples:
   - Deposit with `signerChain`.
   - Relayer withdraw with `signerChain` and executor `signMessage()`.
   - Direct quote-to-swap usage without application-side execution branches.
9. Lifecycle events, error handling, retry/logging behavior, and raw APIs.
10. Links to the detailed MCA SDK and HTTP documents.

## Field Documentation Rules

Every field table must include:

- Field name.
- Type.
- Required or optional status.
- Unit or encoding where relevant.
- Exact meaning.
- Default behavior.
- Conditional requirements and valid examples.

The README must explicitly clarify:

- `fromChain`, `toChain`, and each token's `chain` use the SDK's direct chain
  ID strings. EVM chains use decimal IDs such as `"8453"`; non-EVM chains use
  canonical IDs such as `"solana"` and `"near"`.
- `AssetRef.address` is the on-chain token contract/mint/asset identifier, not
  a symbol. Native assets use the backend-recognized asset ID and may set
  `isNative`.
- `amountIn` is a base-unit integer string, not a human-readable decimal.
- `decimals` describes token precision and is not applied automatically to a
  human-readable input. Use `parseUnits()` when needed.
- `slippageBps` is basis points; `50` means 0.5%.
- `sender` is the source wallet/account and `recipient` is the final
  destination address/account. They may be on different chains.
- `quoteWaitingTimeMs` controls backend quote waiting and defaults to 3000 ms.
- `signerChain` selects the registered executor used to read MCA identity; it
  is not a signer object.
- `waitFor` controls when `swap()` returns, not how the transaction is built.
- `idempotencyKey`, `signal`, `beforeSign`, and `onEvent` affect submission
  control and observability but do not change route selection.
- `txHash` identifies a chain transaction, while `orderId` identifies the
  backend cross-chain/order-status record.
- `result.status: "submitted"` means submission succeeded, not destination
  receipt.

Field descriptions must be written next to the first demo that uses them, not
only in a detached appendix.

## Demo Rules

- Use direct chain IDs such as `"8453"` and canonical non-EVM IDs such as
  `"solana"`.
- Use base-unit decimal strings for token amounts.
- Use `slippageBps`, where `50` means 0.5%.
- Do not pass signer objects to quote or swap.
- MCA requests pass only `signerChain`; the registered executor adapter
  exposes `getIdentityKey()` and, for relayer withdraw, `signMessage()`.
- Do not include `getChainId()` in the EVM adapter.
- Do not describe or expose a Zcash external-confirmation or
  `requires-user-action` path.
- Show `swap({ quote })` as the default simple path.
- Explain that default swap completion means submission, not destination
  receipt.

## Accuracy and Verification

Every public method and type used by the README must exist in current source
or generated declarations. Code examples will be checked against TypeScript
types where practical. The final verification includes tests, type check,
lint, build, link/path inspection, forbidden legacy API searches, and
`git diff --check`.
