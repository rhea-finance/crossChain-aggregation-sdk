# Standard Zcash Wallet Execution Design

## Goal

Remove the legacy Zcash external-confirmation flow and make the Zcash wallet
adapter follow the same transaction-submission contract as other standard
chain wallets.

## Public API

`ZcashWalletAdapter.sendTransfer()` returns `TransactionSubmission`:

```ts
interface TransactionSubmission {
  txHash: string;
  raw?: unknown;
}
```

The adapter may no longer return `requiresUserAction` or omit the transaction
hash.

## Execution

1. Validate the connected chain and destination address.
2. Request user approval through the standard `beforeSign` hook.
3. Call `sendTransfer()`.
4. Return `submitted` with the real transaction hash by default.
5. When confirmation is requested and `waitForTransaction()` exists, wait for
   it and return `source-confirmed`.

Wallet rejection and broadcast/confirmation failures keep the existing
standard error mapping.

## Removal Scope

Because no other executor uses the legacy path, remove it from the whole public
SDK:

- Delete `TransferSubmission`.
- Remove `requiresUserAction`.
- Remove the `requires-user-action` executor result status.
- Remove the `requires-user-action` lifecycle event and swap result status.
- Remove the SwapClient branch that emits the legacy event.
- Replace the legacy Zcash test with standard submission and confirmation
  tests.
- Remove the behavior from README and MCA documentation.

## Compatibility

This intentionally breaks legacy Zcash adapters. They must now finish wallet
submission inside `sendTransfer()` and return the resulting transaction hash.
The SDK never invents or accepts a placeholder hash.

## Verification

Use TDD to prove that a standard Zcash adapter returns `submitted` with a real
hash and can return `source-confirmed`. Run the full tests, type check, lint,
build, declaration inspection, legacy-term search, and `git diff --check`.
