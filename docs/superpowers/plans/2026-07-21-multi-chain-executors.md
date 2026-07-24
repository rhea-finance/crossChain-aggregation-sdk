# Multi-chain Executors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add production-usable, wallet-library-neutral executor factories for all nine execution kinds across EVM, Solana, Aptos, NEAR, Tron, Bitcoin, Zcash, and Sui.

**Architecture:** Each chain subpath exports a small injected wallet adapter interface and a `create*Executor` factory. Shared helpers enforce abort behavior, chain matching, sign previews, confirmation semantics, and stable `SwapSdkError` mapping without importing wallet SDKs or reading browser globals.

**Tech Stack:** TypeScript 5, Vitest, tsup, injected wallet/signer adapters.

## Global Constraints

- Work directly in the current repository as explicitly requested by the user.
- Do not commit intermediate changes; prior commit approval was declined.
- No executor imports a wallet package or reads undeclared `window.*` globals.
- All amounts remain base-unit decimal strings.
- `waitFor: "submitted"` never performs confirmation; other modes confirm when an adapter provides confirmation support.
- User rejection, chain mismatch, invalid transaction, signing, approval, and broadcast failures use `SwapSdkError`.
- Every production behavior is introduced by a failing test first.

---

### Task 1: Shared Helpers and EVM Executor

**Files:**
- Create: `src/executors/shared.ts`
- Create: `src/executors/evm/index.ts`
- Create: `tests/executors/evm.test.ts`

**Interfaces:**
- Produces `throwIfAborted`, `assertChain`, `mapExecutorError`, `requestSignApproval`, `TransactionSubmission`, `EvmWalletAdapter`, and `createEvmExecutor`.
- EVM adapter methods:

```ts
interface EvmWalletAdapter {
  getChainId(): number | Promise<number>;
  sendTransaction(tx: EvmTx, options: { signal?: AbortSignal }): Promise<TransactionSubmission>;
  signTypedData(request: EvmSigningRequest, options: { signal?: AbortSignal }): Promise<string>;
  isApprovalRequired?(approval: EvmApproval): boolean | Promise<boolean>;
  waitForTransaction?(txHash: string, options: { signal?: AbortSignal }): Promise<unknown>;
  isUserRejection?(error: unknown): boolean;
}
```

- [ ] Write tests proving chain mismatch fails before wallet access, approval emits both approval events, a sufficient allowance skips approval, typed-data signing returns a signature, confirmations return `source-confirmed`, and rejection maps to `USER_REJECTED`.
- [ ] Run `pnpm vitest run tests/executors/evm.test.ts` and confirm missing-module failure.
- [ ] Implement shared helpers and EVM executor with separate transaction and signature kinds.
- [ ] Run the EVM tests and `pnpm type-check`.

### Task 2: Solana, Aptos, and NEAR Executors

**Files:**
- Create: `src/executors/solana/index.ts`
- Create: `src/executors/aptos/index.ts`
- Create: `src/executors/near/index.ts`
- Create: `tests/executors/account-chains.test.ts`

**Interfaces:**

```ts
interface SolanaWalletAdapter {
  getChain(): ChainRef | Promise<ChainRef>;
  getCurrentBlockHeight?(): number | Promise<number>;
  signAndSendTransaction(input: { transaction: string; format: string; metadata?: SolanaMetadata; signal?: AbortSignal }): Promise<TransactionSubmission>;
  waitForTransaction?(txHash: string, input: { metadata?: SolanaMetadata; signal?: AbortSignal }): Promise<unknown>;
  isUserRejection?(error: unknown): boolean;
}

interface AptosWalletAdapter {
  getChain(): ChainRef | Promise<ChainRef>;
  signAndSubmitTransaction(payload: { function: string; typeArguments: string[]; functionArguments: unknown[] }, options: { signal?: AbortSignal }): Promise<TransactionSubmission>;
  waitForTransaction?(txHash: string, options: { signal?: AbortSignal }): Promise<unknown>;
  isUserRejection?(error: unknown): boolean;
}

interface NearWalletAdapter {
  getChain(): ChainRef | Promise<ChainRef>;
  signAndSendTransactions(transactions: NearTransaction[], options: { signal?: AbortSignal }): Promise<{ txHashes: string[]; raw?: unknown }>;
  waitForTransactions?(txHashes: string[], options: { signal?: AbortSignal }): Promise<unknown>;
  isUserRejection?(error: unknown): boolean;
}
```

- [ ] Write failing tests for Solana expiry and confirmation, Aptos payload forwarding, and NEAR batch hashes/last hash semantics.
- [ ] Implement each factory using shared chain, preview, abort, confirmation, and error helpers.
- [ ] Run account-chain tests and type-check.

### Task 3: Tron, Bitcoin, Zcash, and Sui Executors

**Files:**
- Create: `src/executors/tron/index.ts`
- Create: `src/executors/bitcoin/index.ts`
- Create: `src/executors/zcash/index.ts`
- Create: `src/executors/sui/index.ts`
- Create: `tests/executors/transfer-chains.test.ts`

**Interfaces:**

```ts
interface TransferSubmission { txHash?: string; requiresUserAction?: boolean; raw?: unknown }
```

- Tron separates `sendNativeTransfer` and `sendTokenTransfer`, and uses injected `isAddress` for deposit and TRC20 contract validation.
- Bitcoin requires `execution.feeRate` or a positive `defaultFeeRate` factory option.
- Zcash allows a real tx hash or `requires-user-action`; it never invents a hash.
- Sui forwards `coinType`, deposit address, and base-unit amount to the wallet adapter.

- [ ] Write failing tests for Tron native/token dispatch and invalid OMFT contract ids, missing BTC fee rate, Zcash user-action result, Sui transfer forwarding, confirmation, abort, and user rejection.
- [ ] Implement all four factories with exact chain checks and common error mapping.
- [ ] Run transfer-chain tests and type-check.

### Task 4: Subpath Packaging, Documentation, and Acceptance

**Files:**
- Modify: `package.json`
- Modify: `tsup.config.ts`
- Modify: `README.md`
- Create: `tests/executors/public-api.test.ts`

**Interfaces:**
- Produces package subpaths `./executors/evm`, `./executors/solana`, `./executors/aptos`, `./executors/near`, `./executors/tron`, `./executors/bitcoin`, `./executors/zcash`, and `./executors/sui`.

- [ ] Write a failing public API test importing every executor source subpath and asserting every factory is callable.
- [ ] Add all executor entries to tsup and the package export map without adding wallet dependencies.
- [ ] Document injected adapter usage and executor registration in README.
- [ ] Run `pnpm test`, `pnpm type-check`, `pnpm lint`, and `pnpm build`.
- [ ] Import every built CJS and ESM executor subpath in Node and scan source/tests/docs for fixed credentials.
