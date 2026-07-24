# EVM `getChainId` Removal Design

## Goal

Remove `getChainId()` completely from the EVM wallet adapter so quote and swap
flows never read the connected provider network as a separate step.

## Public API

`EvmWalletAdapter` no longer declares or requires:

```ts
getChainId(): number | Promise<number>;
```

Existing callers delete that method from their adapter implementation.

## Validation

- EVM transaction execution uses the `chainId` already present in the
  normalized build transaction.
- EVM typed-data execution continues to verify that
  `typedData.domain.chainId`, when present, matches the signing request
  `chainId`.
- The executor no longer compares either value with a provider network.
- Wallet libraries remain responsible for switching networks or rejecting a
  transaction that targets an unsupported chain.

## Scope

- Remove the method and provider-network validation from the EVM executor.
- Replace tests that expect a connected-network mismatch with tests proving no
  network lookup is required.
- Preserve typed-data internal chain consistency tests.
- Remove `getChainId()` from README and MCA SDK examples.
- Rebuild ESM, CJS, and declaration outputs.
- Preserve existing network diagnostic console output.

## Verification

Run the EVM executor tests, then the full test suite, type check, lint, build,
declaration inspection, and `git diff --check`.
