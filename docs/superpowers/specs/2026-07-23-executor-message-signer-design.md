# Executor Message Signer Integration Design

## Goal

Make registered executors the single source of wallet identity and offline
message-signing capabilities for MCA flows. Applications implement wallet
methods once when creating an executor and do not pass a signer object to
`quote()` or `swap()`.

Remove the unsupported passkey signer family because it has no corresponding executor.

## Public API

Every built-in wallet adapter inherits two optional capabilities:

```ts
getIdentityKey?(): string | Promise<string>;
signMessage?(
  message: string,
  options?: {
    signal?: AbortSignal;
    context?: Readonly<Record<string, unknown>>;
  }
): Promise<string>;
```

Every executor created by the SDK exposes:

- `signerChain`, such as `evm`, `solana`, or `btc`.
- `getIdentityKey()` when the adapter implements it.
- `signMessage()` when the adapter implements it.

`McaQuoteRequest` replaces `signer` with `signerChain`. `McaSwapInput` removes
its optional `signer`. Applications therefore select a wallet chain but never
construct or repeat a signer identity object.

## Supported Signer Chains

The supported values are:

- `evm`
- `solana`
- `btc`
- `near`
- `aptos`
- `sui`
- `zcash`
- `tron`

The unsupported passkey signer family is removed from types, wallet formatting,
default priority, tests, examples, and documentation.

## Registry

`ExecutorRegistry` resolves a signer-capable executor by `signerChain`.

For quote:

- A matching registered executor is required.
- Its adapter must implement `getIdentityKey()`.
- The returned identity must be non-empty.

For relayer withdraw:

- The same executor must still return the identity used for the quote.
- It must implement `signMessage()`.
- Identity mismatch fails before prompting the wallet.

Explicitly passing a signer at swap time is removed. This prevents the quote
identity and execution signer from diverging.

## MCA Data Flow

1. The caller creates executors and implements `getIdentityKey()` and, where
   supported, `signMessage()`.
2. The caller submits an MCA quote request with `signerChain`.
3. The SDK resolves the registered executor and reads its identity.
4. The SDK serializes `mca.signer.chain` and `mca.signer.identityKey` for the
   backend.
5. The normalized quote stores the resolved signer identity.
6. For relayer withdraw, `swap({ quote })` resolves the same executor, verifies
   the identity, reads the API `messageToSign`, and invokes `signMessage()`.
7. The SDK assembles and submits `mcaRelayer`.

Deposit and direct NEAR withdraw do not call `signMessage()`.

## Error Handling

- Missing executor: `EXECUTOR_NOT_FOUND`.
- Missing `getIdentityKey()`: `SIGNING_FAILED`.
- Blank identity: `SIGNING_FAILED`.
- Missing `signMessage()` for relayer withdraw: `SIGNING_FAILED`.
- Changed identity between quote and swap: `SIGNING_FAILED`.
- Empty signature and wallet errors retain existing signing errors.

## Compatibility

This intentionally changes the MCA request surface:

```ts
// Before
signer: { chain: "evm", identityKey: address, signMessage }

// After
signerChain: "evm"
```

The methods move to the executor adapter:

```ts
createEvmExecutor({
  getChainId,
  getIdentityKey: () => address,
  sendTransaction,
  signTypedData,
  signMessage,
});
```

Standard non-MCA swaps remain compatible because the two new adapter methods
are optional.

## Tests

- Every built-in executor exposes its signer chain.
- Executor methods preserve adapter binding and forward arguments.
- Registry resolves capabilities and reports missing methods.
- MCA quote obtains the identity from the selected executor.
- Relayer withdraw signs through the executor without a signer input.
- Identity changes fail before signing.
- The unsupported passkey signer family is absent from public types, mapping,
  priority, tests, and docs.
- Existing deposit, direct NEAR withdraw, and standard swap tests remain green.
