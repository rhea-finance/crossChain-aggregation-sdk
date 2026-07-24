# EVM Quantity Normalization Design

## Goal

Accept valid EVM transaction quantities returned by the Swap API in either
decimal or JSON-RPC hexadecimal form, while keeping the SDK's public `EvmTx`
fields canonical decimal strings.

## Boundary Behavior

The build normalizer will accept these forms for `tx.value` and
`tx.gasLimit`, including approval transactions:

```text
"0"       -> "0"
"100000"  -> "100000"
"0x0"     -> "0"
"0x186a0" -> "100000"
```

Hex quantities must use the `0x` prefix and contain at least one hexadecimal
digit. Invalid, negative, fractional, scientific-notation, and empty values
remain rejected.

## Public Contract

`EvmTx.value` and `EvmTx.gasLimit` remain `BaseUnitAmount` decimal strings.
Executors and wallet adapters receive only normalized decimal values, so this
change does not introduce a second public representation.

Transaction calldata remains strict even-length hex data and is not converted.
`chainId` remains a positive integer.

## Testing

Tests will use the actual Base-to-Solana build transaction values:

```json
{
  "value": "0x0",
  "gasLimit": "0x186a0",
  "chainId": 8453
}
```

They will verify normalization to `"0"` and `"100000"`, cover approval
transactions, preserve decimal inputs, and continue rejecting malformed
quantities. Full tests, type checking, linting, and package build must pass.

## Scope

This change does not modify HTTP payload fields, quote logic, chain IDs,
transaction execution order, or wallet adapter interfaces.
