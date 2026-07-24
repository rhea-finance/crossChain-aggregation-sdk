# Multi-chain Swap SDK Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the browser/Node-compatible SDK core that exposes raw and normalized quote, build, execute-contract, status, report, and history APIs for EVM, Solana, Aptos, NEAR, Tron, Bitcoin, Zcash, and Sui transaction payloads.

**Architecture:** A transport-backed `ApiClient` preserves the unified Swap API shapes, normalizers convert responses into strict discriminated unions, and `SwapClient` composes those pieces with an executor registry. This plan stops at the chain-executor contract and fake-executor lifecycle tests; concrete wallet integrations are separate plans so the core remains independently testable and shippable.

**Tech Stack:** TypeScript 5, tsup, Vitest, Zod, native/injected Fetch API, pnpm.

## Global Constraints

- Package name remains `@rhea-finance/cross-chain-aggregation-dex`.
- Runtime support is browsers, Node.js 18+ out of the box, and Node.js 16 only with injected `fetch`.
- Amounts, gas, and value are base-unit decimal strings; JavaScript `number` is forbidden for token amounts.
- Slippage is integer basis points in `slippageBps`.
- Core modules must not read undeclared `window.*` globals or import wallet libraries.
- API credentials are injected through `apiKey` or `getAccessToken`; no fixed token may appear in source or fixtures.
- Raw methods preserve the API `data` shape; normalized methods retain it in `raw`.
- `buildSwap()` never opens a wallet, `executeSwap()` never re-quotes, and `swap()` only composes build plus execute.
- Default execution wait mode is `submitted`.
- Unknown optional API fields remain available through `raw`.
- Existing unstaged source deletions belong to the user; stage only files explicitly listed by each task.

---

## Delivery Decomposition

This plan is the first independently testable subsystem from the approved design. Follow-up plans cover:

1. Account-model executors: EVM, Solana, Aptos, and NEAR.
2. Transfer/UTXO executors: Tron, Bitcoin, Zcash, and Sui.
3. `multi-chain-lending` migration to the SDK raw surface and then normalized surface.

## Planned File Structure

```text
src/
  api/
    ApiClient.ts              HTTP endpoints, auth, timeout, and retry
    rawTypes.ts               exact API data shapes
  client/
    SwapClient.ts             public orchestration API
  core/
    errors.ts                 SwapSdkError and error codes
    lifecycle.ts              lifecycle events and execution orchestration
    registry.ts               executor registration and lookup
  normalizers/
    build.ts                  SwapBuildData -> SwapBuild
    chain.ts                  ChainRef/API chain conversion
    history.ts                raw history -> normalized page
    quote.ts                  raw quote -> Quote + BuildContext
    schemas.ts                shared runtime schemas
  types/
    chain.ts                  ChainRef, AssetRef, amounts
    execution.ts              discriminated execution union
    history.ts                history request/result types
    quote.ts                  quote/build public types
  index.ts                    root exports
tests/
  api/ApiClient.test.ts
  client/SwapClient.test.ts
  core/registry.test.ts
  fixtures/builds.ts
  normalizers/build.test.ts
  normalizers/chain.test.ts
  normalizers/history.test.ts
  normalizers/quote.test.ts
vitest.config.ts
```

### Task 1: Test Harness, Core Identifiers, and Error Model

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/types/chain.ts`
- Create: `src/core/errors.ts`
- Create: `tests/types/chain.test.ts`
- Create: `tests/core/errors.test.ts`

**Interfaces:**
- Produces: `BaseUnitAmount`, `ChainRef`, `AssetRef`, `SwapErrorCode`, `SwapErrorStage`, `SwapSdkError`, `asSwapSdkError`.
- Consumes: no earlier tasks.

- [ ] **Step 1: Add test and runtime-schema dependencies plus test scripts**

Run:

```bash
pnpm add zod
pnpm add -D vitest
```

Modify `package.json` scripts to contain:

```json
{
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "type-check": "tsc --noEmit",
    "lint": "eslint src tests --ext .ts",
    "prepublishOnly": "pnpm test && pnpm type-check && pnpm build"
  }
}
```

Expected: `pnpm-lock.yaml` records Zod and Vitest without changing the package name or Node engine.

- [ ] **Step 2: Configure Vitest and TypeScript test globals**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    restoreMocks: true,
  },
});
```

Add `"DOM"` to `compilerOptions.lib` so the package can type `fetch`, `RequestInit`, and `AbortSignal` without accessing browser globals at runtime:

```json
{
  "compilerOptions": {
    "lib": ["ES2020", "DOM"]
  }
}
```

- [ ] **Step 3: Write failing chain and error tests**

Create `tests/types/chain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assertBaseUnitAmount } from "../../src/types/chain";

describe("assertBaseUnitAmount", () => {
  it.each(["0", "1", "1000000000000000000000000"])(
    "accepts %s",
    (amount) => expect(assertBaseUnitAmount(amount)).toBe(amount)
  );

  it.each(["", "-1", "1.2", "1e18", " 1"])("rejects %s", (amount) => {
    expect(() => assertBaseUnitAmount(amount)).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" })
    );
  });
});
```

Create `tests/core/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SwapSdkError, asSwapSdkError } from "../../src/core/errors";

describe("asSwapSdkError", () => {
  it("preserves SDK errors", () => {
    const error = new SwapSdkError("API_ERROR", "quote", "bad quote");
    expect(asSwapSdkError(error, "build")).toBe(error);
  });

  it("wraps unknown errors", () => {
    const error = asSwapSdkError(new Error("boom"), "history");
    expect(error).toMatchObject({
      code: "API_ERROR",
      stage: "history",
      retryable: false,
    });
  });
});
```

- [ ] **Step 4: Run tests and verify the red state**

Run:

```bash
pnpm vitest run tests/types/chain.test.ts tests/core/errors.test.ts
```

Expected: FAIL because `src/types/chain.ts` and `src/core/errors.ts` do not exist.

- [ ] **Step 5: Implement the error model**

Create `src/core/errors.ts`:

```ts
export type SwapErrorCode =
  | "HTTP_ERROR"
  | "API_ERROR"
  | "RATE_LIMITED"
  | "AUTH_FAILED"
  | "REQUEST_ABORTED"
  | "REQUEST_TIMEOUT"
  | "INVALID_REQUEST"
  | "INVALID_API_RESPONSE"
  | "QUOTE_EXPIRED"
  | "ROUTE_NOT_FOUND"
  | "EXECUTOR_NOT_FOUND"
  | "UNSUPPORTED_CHAIN"
  | "CHAIN_MISMATCH"
  | "INVALID_TRANSACTION"
  | "USER_REJECTED"
  | "INSUFFICIENT_BALANCE"
  | "APPROVAL_FAILED"
  | "SIGNING_FAILED"
  | "BROADCAST_FAILED"
  | "ORDER_SUBMIT_FAILED"
  | "ORDER_TIMEOUT"
  | "REPORT_FAILED";

export type SwapErrorStage =
  | "quote"
  | "build"
  | "approve"
  | "sign"
  | "broadcast"
  | "submit"
  | "report"
  | "status"
  | "history";

export class SwapSdkError extends Error {
  readonly name = "SwapSdkError";

  constructor(
    readonly code: SwapErrorCode,
    readonly stage: SwapErrorStage,
    message: string,
    readonly options: {
      retryable?: boolean;
      cause?: unknown;
      details?: Record<string, unknown>;
    } = {}
  ) {
    super(message);
  }

  get retryable(): boolean {
    return this.options.retryable ?? false;
  }

  get cause(): unknown {
    return this.options.cause;
  }

  get details(): Record<string, unknown> | undefined {
    return this.options.details;
  }
}

export function asSwapSdkError(
  error: unknown,
  stage: SwapErrorStage
): SwapSdkError {
  if (error instanceof SwapSdkError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new SwapSdkError("API_ERROR", stage, message, { cause: error });
}
```

- [ ] **Step 6: Implement chain and amount primitives**

Create `src/types/chain.ts`:

```ts
import { SwapSdkError } from "../core/errors";

export type ChainRef =
  | `eip155:${number}`
  | "solana:mainnet"
  | "aptos:mainnet"
  | "near:mainnet"
  | "tron:mainnet"
  | "bitcoin:mainnet"
  | "zcash:mainnet"
  | "sui:mainnet"
  | (string & {});

export type BaseUnitAmount = string;

export interface AssetRef {
  chain: ChainRef;
  address: string;
  symbol?: string;
  decimals?: number;
  isNative?: boolean;
}

const BASE_UNIT_AMOUNT = /^(0|[1-9]\d*)$/;

export function assertBaseUnitAmount(value: string): BaseUnitAmount {
  if (!BASE_UNIT_AMOUNT.test(value)) {
    throw new SwapSdkError(
      "INVALID_REQUEST",
      "quote",
      `Invalid base-unit amount: ${value}`
    );
  }
  return value;
}
```

- [ ] **Step 7: Run tests, type-check, and commit**

Run:

```bash
pnpm vitest run tests/types/chain.test.ts tests/core/errors.test.ts
pnpm type-check
```

Expected: both test files PASS and TypeScript reports no errors.

Commit only Task 1 files:

```bash
git add package.json pnpm-lock.yaml tsconfig.json vitest.config.ts src/types/chain.ts src/core/errors.ts tests/types/chain.test.ts tests/core/errors.test.ts
git commit -m "feat: add sdk core types and errors"
```

### Task 2: Raw API Types and Authenticated Transport

**Files:**
- Create: `src/api/rawTypes.ts`
- Create: `src/api/ApiClient.ts`
- Create: `tests/api/ApiClient.test.ts`

**Interfaces:**
- Consumes: `SwapSdkError`, `SwapErrorStage` from Task 1.
- Produces: `SwapApiResponse<T>`, raw request/result interfaces, `ApiClientConfig`, and `ApiClient` endpoint methods.

- [ ] **Step 1: Write failing transport tests**

Create `tests/api/ApiClient.test.ts` with a deterministic fetch stub:

```ts
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../../src/api/ApiClient";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ApiClient", () => {
  it("posts quote with a dynamic bearer token and unwraps data", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ code: 0, msg: "ok", data: { bestQuote: { router: "r" } } })
    );
    const client = new ApiClient({
      baseUrl: "https://swap.example/",
      getAccessToken: async () => "token",
      fetch: fetch as typeof globalThis.fetch,
    });

    const data = await client.quote({
      fromChain: "1",
      toChain: "near",
      tokenIn: "0x0000000000000000000000000000000000000000",
      tokenOut: "wrap.near",
      amountIn: "1",
      sender: "0xsender",
    });

    expect(data.bestQuote).toEqual({ router: "r" });
    expect(fetch).toHaveBeenCalledWith(
      "https://swap.example/api/swap/quote",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer token" }),
      })
    );
  });

  it("maps a non-zero API code", async () => {
    const client = new ApiClient({
      baseUrl: "https://swap.example",
      fetch: (async () =>
        jsonResponse({ code: 4001, msg: "no route", data: null })) as typeof globalThis.fetch,
    });
    await expect(client.quote({} as never)).rejects.toMatchObject({
      code: "API_ERROR",
      stage: "quote",
    });
  });

  it("serializes history query without undefined values", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        code: 0,
        msg: "ok",
        data: {
          record_list: [],
          page_number: 1,
          page_size: 20,
          total_page: 0,
          total_size: 0,
        },
      })
    );
    const client = new ApiClient({
      baseUrl: "https://swap.example",
      fetch: fetch as typeof globalThis.fetch,
    });
    await client.getHistory({ sender: "alice", pageNumber: 1 });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://swap.example/api/swap/history?sender=alice&pageNumber=1"
    );
  });
});
```

- [ ] **Step 2: Run the transport tests and verify failure**

Run:

```bash
pnpm vitest run tests/api/ApiClient.test.ts
```

Expected: FAIL because `ApiClient` does not exist.

- [ ] **Step 3: Define exact raw API types**

Create `src/api/rawTypes.ts`. Copy the field semantics from the approved design and use these exact exported top-level interfaces:

```ts
export interface SwapApiResponse<T> {
  code: number;
  msg: string;
  data: T;
}

export interface SwapQuoteRequestRaw {
  fromChain: string;
  toChain: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  slippage?: number;
  sender: string;
  recipient?: string;
  useAsCollateral?: boolean;
  mca?: Record<string, unknown>;
}

export interface SwapQuoteDataRaw {
  isCrossChain: boolean;
  chainType: string;
  bestQuote: Record<string, unknown>;
  allQuotes: Record<string, unknown>[];
  errors?: unknown;
  nearDepositTx?: unknown;
  nearDepositTxError?: string;
  nearMcaWithdrawTx?: unknown;
  nearMcaWithdrawTxError?: string;
  nearMcaWithdraw?: Record<string, unknown>;
  mcaContext?: Record<string, unknown>;
  mcaWithdrawToIntents?: unknown;
  [key: string]: unknown;
}

export interface SwapBuildRequestRaw extends SwapQuoteRequestRaw {
  router: string;
  market?: string;
  expectedOut: string;
  minAmountOut: string;
  preSwap: unknown | null;
  bridge: unknown | null;
  quoteId?: string;
  [key: string]: unknown;
}

export interface SwapBuildDataRaw {
  isCrossChain: boolean;
  chainType: string;
  router: string;
  fromChain: string;
  toChain: string;
  tokenIn: { address: string; symbol: string; decimals: number };
  tokenOut: { address: string; symbol: string; decimals: number };
  amountIn: string;
  estimatedOut: string;
  minAmountOut: string;
  executionType?: "transaction" | "signature";
  signingRequest?: Record<string, unknown> | null;
  needsApprove?: boolean;
  tx: unknown;
  approve: { tx: Record<string, unknown>; spender: string } | null;
  orderId?: string;
  statusRouter?: string;
  deposit?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SwapOrderStatusParamsRaw {
  orderId: string;
  router: string;
  chainId?: string | number;
}

export type SwapOrderStatusDataRaw = Record<string, unknown> & {
  status?: string;
  state?: string;
};

export interface SwapOrderSubmitRequestRaw {
  router: string;
  quoteId: string;
  signature: string;
  signingScheme?: string;
}

export interface SwapOrderSubmitDataRaw {
  router: string;
  orderId: string;
  chainId?: number;
  raw?: Record<string, unknown>;
}

export interface SwapReportRequestRaw {
  sender: string;
  recipient: string;
  from_hash: string;
  from_token: string;
  to_token: string;
  deposit_address: string;
  from_chain?: string;
  to_chain?: string;
  is_cross_chain?: boolean;
  amount_in?: string;
  estimated_out?: string;
  router?: string;
  tx_type?: string;
  multi_addr?: string;
  swap_id?: string;
  swapId?: string;
  extra?: Record<string, unknown>;
}

export interface SwapReportDataRaw {
  id: number;
  from_hash: string;
}

export interface SwapHistoryParamsRaw {
  sender: string;
  pageNumber?: number;
  pageSize?: number;
}

export interface SwapHistoryRecordRaw {
  id: number;
  sender: string;
  recipient?: unknown;
  from_hash: string;
  to_hash?: string | null;
  deposit_address?: string;
  from_token: string;
  to_token: string;
  from_chain: string;
  to_chain: string;
  amount_in?: string;
  estimated_out?: string;
  actual_out?: string | null;
  router?: string;
  tx_type?: string;
  is_cross_chain?: number;
  status?: string;
  multi_addr?: string | null;
  swap_id?: string | null;
  extra?: Record<string, unknown>;
  status_response?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface SwapHistoryDataRaw {
  record_list: SwapHistoryRecordRaw[];
  page_number: number;
  page_size: number;
  total_page: number;
  total_size: number;
}
```

- [ ] **Step 4: Implement ApiClient**

Create `src/api/ApiClient.ts` with one private `request<T>()` method. Its required behavior is:

```ts
export interface ApiClientConfig {
  baseUrl: string;
  apiKey?: string;
  getAccessToken?: () => string | Promise<string>;
  fetch?: typeof globalThis.fetch;
  headers?:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>);
  timeoutMs?: number;
}

export class ApiClient {
  constructor(private readonly config: ApiClientConfig) {}

  quote(body: SwapQuoteRequestRaw): Promise<SwapQuoteDataRaw>;
  build(body: SwapBuildRequestRaw): Promise<SwapBuildDataRaw>;
  submitOrder(body: SwapOrderSubmitRequestRaw): Promise<SwapOrderSubmitDataRaw>;
  getOrderStatus(params: SwapOrderStatusParamsRaw): Promise<SwapOrderStatusDataRaw>;
  report(body: SwapReportRequestRaw): Promise<SwapReportDataRaw>;
  getHistory(params: SwapHistoryParamsRaw): Promise<SwapHistoryDataRaw>;
}
```

`request<T>()` must:

1. Remove one trailing slash from `baseUrl`.
2. Resolve `getAccessToken()` before `apiKey`.
3. Merge `Content-Type`, Authorization, configured headers, then per-call headers.
4. Combine caller abort with a timeout controller.
5. Parse text before JSON so HTML/non-JSON errors become `HTTP_ERROR`.
6. Map HTTP 401/403 to `AUTH_FAILED`, 429 to `RATE_LIMITED`, other HTTP failures to `HTTP_ERROR`, and non-zero `code` to `API_ERROR`.
7. Return `body.data`, preserving unknown fields.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
pnpm vitest run tests/api/ApiClient.test.ts
pnpm type-check
```

Expected: PASS.

Commit:

```bash
git add src/api/rawTypes.ts src/api/ApiClient.ts tests/api/ApiClient.test.ts
git commit -m "feat: add unified swap api client"
```

### Task 3: Chain Serialization and Quote Normalization

**Files:**
- Create: `src/normalizers/chain.ts`
- Create: `src/types/quote.ts`
- Create: `src/normalizers/quote.ts`
- Create: `tests/normalizers/chain.test.ts`
- Create: `tests/normalizers/quote.test.ts`

**Interfaces:**
- Consumes: `ChainRef`, `AssetRef`, `BaseUnitAmount`, raw quote request/data.
- Produces: `toApiChain`, `fromApiChain`, `toApiAssetAddress`, `QuoteRequest`, `BuildContext`, `Quote`, `serializeQuoteRequest`, `normalizeQuote`.

- [ ] **Step 1: Write failing chain conversion tests**

Create `tests/normalizers/chain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fromApiChain, toApiChain } from "../../src/normalizers/chain";

describe("chain conversion", () => {
  it.each([
    ["eip155:1", "1"],
    ["near:mainnet", "near"],
    ["solana:mainnet", "solana"],
    ["aptos:mainnet", "aptos"],
    ["tron:mainnet", "tron"],
    ["bitcoin:mainnet", "btc"],
    ["zcash:mainnet", "zcash"],
    ["sui:mainnet", "sui"],
  ] as const)("maps %s", (standard, api) => {
    expect(toApiChain(standard)).toBe(api);
    expect(fromApiChain(api)).toBe(standard);
  });
});
```

- [ ] **Step 2: Write failing quote normalization tests**

Create `tests/normalizers/quote.test.ts` with a raw cross-chain fixture where `bestQuote` contains `router`, `market`, `estimatedOut`, `minAmountOut`, `preSwap`, `bridge`, and `quoteId`. Assert:

```ts
expect(normalizeQuote(request, raw, 1_000)).toMatchObject({
  fromChain: "eip155:1",
  toChain: "near:mainnet",
  amountIn: "100",
  estimatedOut: "90",
  minAmountOut: "89",
  route: { router: "nearintents", market: "best" },
  receivedAt: 1_000,
  buildContext: {
    router: "nearintents",
    expectedOut: "90",
    minAmountOut: "89",
    quoteId: "quote-1",
  },
  raw,
});
```

Also assert that missing router or output amounts throws `INVALID_API_RESPONSE` at stage `quote`.

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm vitest run tests/normalizers/chain.test.ts tests/normalizers/quote.test.ts
```

Expected: FAIL because normalizers do not exist.

- [ ] **Step 4: Implement chain conversion**

Create `src/normalizers/chain.ts` with an explicit map for non-EVM chains and an `eip155:<decimal>` parser. Reject unknown chains in standard requests with `UNSUPPORTED_CHAIN`. Normalize API decimal/hex EVM chain ids to decimal `eip155:<id>`.

Export these exact functions:

```ts
export function toApiChain(chain: ChainRef): string;
export function fromApiChain(chain: string): ChainRef;
export function toApiAssetAddress(asset: AssetRef): string;
```

`toApiAssetAddress()` must pass explicit addresses through and map native assets to the approved API placeholders only when `asset.address` is empty.

- [ ] **Step 5: Implement quote types and normalizer**

Create `src/types/quote.ts` with:

```ts
export interface QuoteRequest {
  fromChain: ChainRef;
  toChain: ChainRef;
  tokenIn: AssetRef;
  tokenOut: AssetRef;
  amountIn: BaseUnitAmount;
  slippageBps: number;
  sender: string;
  recipient?: string;
  extensions?: Record<string, unknown>;
}

export interface RouteSummary {
  router: string;
  market?: string;
  amountOut: BaseUnitAmount;
  minAmountOut: BaseUnitAmount;
  raw: Record<string, unknown>;
}

export interface BuildContext {
  readonly request: SwapQuoteRequestRaw;
  readonly router: string;
  readonly market?: string;
  readonly expectedOut: BaseUnitAmount;
  readonly minAmountOut: BaseUnitAmount;
  readonly preSwap: unknown | null;
  readonly bridge: unknown | null;
  readonly quoteId?: string;
}

export interface Quote {
  id?: string;
  fromChain: ChainRef;
  toChain: ChainRef;
  tokenIn: AssetRef;
  tokenOut: AssetRef;
  amountIn: BaseUnitAmount;
  estimatedOut: BaseUnitAmount;
  minAmountOut: BaseUnitAmount;
  route: RouteSummary;
  alternatives: RouteSummary[];
  receivedAt: number;
  expiresAt?: number;
  buildContext: Readonly<BuildContext>;
  raw: SwapQuoteDataRaw;
}
```

Create `src/normalizers/quote.ts` and export:

```ts
export function serializeQuoteRequest(request: QuoteRequest): SwapQuoteRequestRaw;
export function normalizeQuote(
  request: QuoteRequest,
  raw: SwapQuoteDataRaw,
  receivedAt?: number
): Quote;
```

Read `amountOut` before `estimatedOut`, freeze a cloned `buildContext`, validate all amount strings, and copy unknown quote fields only into `raw`.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
pnpm vitest run tests/normalizers/chain.test.ts tests/normalizers/quote.test.ts
pnpm type-check
```

Expected: PASS.

Commit:

```bash
git add src/normalizers/chain.ts src/types/quote.ts src/normalizers/quote.ts tests/normalizers/chain.test.ts tests/normalizers/quote.test.ts
git commit -m "feat: normalize multi-chain swap quotes"
```

### Task 4: Build Runtime Schemas and Eight-Chain Execution Union

**Files:**
- Create: `src/types/execution.ts`
- Create: `src/normalizers/schemas.ts`
- Create: `src/normalizers/build.ts`
- Create: `tests/fixtures/builds.ts`
- Create: `tests/normalizers/build.test.ts`

**Interfaces:**
- Consumes: raw build data, chain normalizer, amount validator.
- Produces: `SwapExecution`, `SwapBuild`, `normalizeBuild`.

- [ ] **Step 1: Add one valid fixture per execution kind**

Create `tests/fixtures/builds.ts` exporting `buildFixtures`. Each fixture must contain the shared build fields and one of these transaction bodies:

```ts
export const txBodies = {
  evmTransaction: {
    to: "0x1111111111111111111111111111111111111111",
    data: "0xabcdef",
    value: "0",
    gasLimit: "21000",
    chainId: 1,
  },
  aptos: {
    function: "0x1::coin::transfer",
    type_arguments: ["0x1::aptos_coin::AptosCoin"],
    arguments: ["0xabc", "100"],
  },
  near: {
    receiverId: "wrap.near",
    actions: [
      { type: "FunctionCall", params: { methodName: "near_deposit", args: {}, gas: "30000000000000", deposit: "1" } },
    ],
  },
  tron: { kind: "tron_transfer", chainId: "tron", amount: "100", depositAddress: "TReceiver" },
  bitcoin: { kind: "btc_transfer", chainId: "btc", amount: "1000", depositAddress: "bc1receiver", feeRate: 3 },
  zcash: { kind: "zcash_transfer", chainId: "zcash", amount: "1000", depositAddress: "t1receiver" },
  sui: { kind: "sui_transfer", chainId: "sui", amount: "100", depositAddress: "0xreceiver", coinType: "0x2::sui::SUI" },
};
```

Add Solana base64 and EVM signature fixtures separately because they use `signingRequest` rather than the simple transfer shapes.

- [ ] **Step 2: Write table-driven normalization tests**

Create `tests/normalizers/build.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeBuild } from "../../src/normalizers/build";
import { buildFixtures } from "../fixtures/builds";

describe("normalizeBuild", () => {
  it.each([
    ["evmTransaction", "evm-transaction"],
    ["evmSignature", "evm-signature"],
    ["solana", "solana-transaction"],
    ["aptos", "aptos-entry-function"],
    ["near", "near-transaction-batch"],
    ["tron", "tron-transfer"],
    ["bitcoin", "bitcoin-transfer"],
    ["zcash", "zcash-transfer"],
    ["sui", "sui-transfer"],
  ] as const)("normalizes %s", (fixture, kind) => {
    const result = normalizeBuild(buildFixtures[fixture]);
    expect(result.execution.kind).toBe(kind);
    expect(result.raw).toBe(buildFixtures[fixture]);
  });

  it("rejects chain and transaction mismatches", () => {
    expect(() =>
      normalizeBuild({ ...buildFixtures.bitcoin, chainType: "sui" })
    ).toThrowError(expect.objectContaining({ code: "CHAIN_MISMATCH" }));
  });
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm vitest run tests/normalizers/build.test.ts
```

Expected: FAIL because `normalizeBuild` does not exist.

- [ ] **Step 4: Define the discriminated union**

Create `src/types/execution.ts`. The union must use these exact kinds and fields:

```ts
export type SwapExecution =
  | { kind: "evm-transaction"; chain: ChainRef; tx: EvmTx; approval?: EvmApproval }
  | { kind: "evm-signature"; chain: ChainRef; request: EvmSigningRequest }
  | { kind: "solana-transaction"; chain: ChainRef; transaction: string; format: string; metadata?: SolanaMetadata }
  | { kind: "aptos-entry-function"; chain: ChainRef; function: string; typeArguments: string[]; functionArguments: unknown[] }
  | { kind: "near-transaction-batch"; chain: ChainRef; transactions: NearTransaction[] }
  | { kind: "tron-transfer"; chain: ChainRef; amount: BaseUnitAmount; depositAddress: string; tokenAddress?: string; standard?: string }
  | { kind: "bitcoin-transfer"; chain: ChainRef; amount: BaseUnitAmount; depositAddress: string; feeRate?: number }
  | { kind: "zcash-transfer"; chain: ChainRef; amount: BaseUnitAmount; depositAddress: string; decimals?: number }
  | { kind: "sui-transfer"; chain: ChainRef; amount: BaseUnitAmount; depositAddress: string; coinType: string };
```

Define the referenced helpers and `SwapBuild` in the same file:

```ts
export interface EvmTx {
  to: string;
  data: string;
  value: BaseUnitAmount;
  gasLimit: BaseUnitAmount;
  chainId: number;
}

export interface EvmApproval {
  tx: EvmTx;
  spender: string;
}

export interface EvmSigningRequest {
  type: "eip712" | string;
  router: string;
  quoteId: string;
  chainId: number;
  signingScheme?: string;
  typedData: {
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: Record<string, unknown>;
  };
  submit?: {
    endpoint: string;
    method: string;
    params: Record<string, string>;
  };
}

export interface SolanaMetadata {
  addressLookupTableAddresses?: string[];
  recentBlockhash?: string;
  txValidUntil?: number;
  transactionSize?: number;
}

export interface NearTransaction {
  signerId?: string;
  receiverId: string;
  actions: unknown[];
}

export interface OrderReference {
  orderId: string;
  router: string;
  chainId?: string;
}

export interface DepositInfo {
  depositAddress: string;
  depositMemo?: string;
  orderId?: string;
  estimatedOut?: BaseUnitAmount;
  minAmountOut?: BaseUnitAmount;
  timeEstimate?: number | string;
}

export interface SwapBuild {
  executionId: string;
  quoteId?: string;
  isCrossChain: boolean;
  fromChain: ChainRef;
  toChain: ChainRef;
  tokenIn: AssetRef;
  tokenOut: AssetRef;
  amountIn: BaseUnitAmount;
  estimatedOut: BaseUnitAmount;
  minAmountOut: BaseUnitAmount;
  router: string;
  execution: SwapExecution;
  order?: OrderReference;
  deposit?: DepositInfo;
  raw: SwapBuildDataRaw;
}
```

- [ ] **Step 5: Implement Zod schemas and normalizeBuild**

Create `src/normalizers/schemas.ts` with reusable schemas:

```ts
import { z } from "zod";

export const decimalStringSchema = z.string().regex(/^(0|[1-9]\d*)$/);
export const nonEmptyStringSchema = z.string().min(1);
export const hexDataSchema = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/);
export const positiveIntegerSchema = z.number().int().positive();
```

Create `src/normalizers/build.ts`. It must:

1. Validate common build fields first.
2. Use `executionType === "signature"` or `signingRequest` only for EVM signature orders.
3. Select a chain parser from normalized `chainType`, then validate its exact tx schema.
4. Convert NEAR single tx to a one-element array.
5. Reject missing BTC feeRate only at executor time, not normalization time.
6. Reject Sui OMFT ids beginning with `nep141:` as coin types.
7. Wrap Zod errors as `INVALID_API_RESPONSE` with `stage: "build"` and issue paths in details.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
pnpm vitest run tests/normalizers/build.test.ts
pnpm type-check
```

Expected: all nine execution variants PASS and malformed fixtures fail before execution.

Commit:

```bash
git add src/types/execution.ts src/normalizers/schemas.ts src/normalizers/build.ts tests/fixtures/builds.ts tests/normalizers/build.test.ts
git commit -m "feat: normalize multi-chain swap transactions"
```

### Task 5: Executor Registry and SwapClient Quote/Build Surface

**Files:**
- Create: `src/core/registry.ts`
- Create: `src/core/lifecycle.ts`
- Create: `src/client/SwapClient.ts`
- Create: `tests/core/registry.test.ts`
- Create: `tests/client/SwapClient.test.ts`

**Interfaces:**
- Consumes: `ApiClient`, quote/build normalizers, `SwapExecution`, `SwapBuild`.
- Produces: `ChainExecutor`, `ExecutionContext`, `ExecutorRegistry`, `SwapClientConfig`, `SwapClient.quoteRaw`, `quote`, `buildRaw`, `buildSwap`.

- [ ] **Step 1: Write failing registry tests**

Create `tests/core/registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ExecutorRegistry } from "../../src/core/registry";

describe("ExecutorRegistry", () => {
  const executor = {
    kinds: ["bitcoin-transfer"] as const,
    validate: async () => undefined,
    execute: async () => ({ status: "submitted" as const, txHash: "hash" }),
  };

  it("resolves by exact kind", () => {
    const registry = new ExecutorRegistry([executor]);
    expect(registry.get("bitcoin-transfer")).toBe(executor);
  });

  it("rejects duplicate kinds", () => {
    expect(() => new ExecutorRegistry([executor, executor])).toThrow();
  });

  it("returns EXECUTOR_NOT_FOUND", () => {
    expect(() => new ExecutorRegistry().get("sui-transfer")).toThrowError(
      expect.objectContaining({ code: "EXECUTOR_NOT_FOUND" })
    );
  });
});
```

- [ ] **Step 2: Write failing client quote/build tests**

Create `tests/client/SwapClient.test.ts` with a fetch stub returning a quote then a build. Assert:

```ts
const quote = await client.quote(request);
expect(quote.buildContext.router).toBe("nearintents");

const build = await client.buildSwap({ quote });
expect(build.execution.kind).toBe("bitcoin-transfer");
expect(fetch).toHaveBeenCalledTimes(2);
```

Add a test using `maxQuoteAgeMs: 30_000` and a fake clock where an older quote throws `QUOTE_EXPIRED` before a build request is sent.

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm vitest run tests/core/registry.test.ts tests/client/SwapClient.test.ts
```

Expected: FAIL because registry and client do not exist.

- [ ] **Step 4: Define lifecycle primitives, executor contracts, and registry**

Create `src/core/lifecycle.ts` first so registry types do not depend on a later task:

```ts
import type { ChainRef } from "../types/chain";

export type WaitMode = "submitted" | "source-confirmed" | "completed";

export interface SwapWarning {
  code: "REPORT_FAILED";
  message: string;
  cause?: unknown;
}

export interface SignRequestPreview {
  chain: ChainRef;
  kind: string;
  summary: Record<string, unknown>;
}

export type OrderStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "refunded"
  | "expired"
  | "unknown";

export type SwapLifecycleEvent =
  | { type: "build-started"; executionId: string }
  | { type: "build-completed"; executionId: string }
  | { type: "approval-requested"; executionId: string }
  | { type: "approval-submitted"; executionId: string; txHash: string }
  | { type: "signing-requested"; executionId: string }
  | { type: "submitted"; executionId: string; txHash?: string; orderId?: string }
  | { type: "source-confirmed"; executionId: string }
  | { type: "order-status"; executionId: string; status: OrderStatus }
  | { type: "completed"; executionId: string }
  | { type: "requires-user-action"; executionId: string }
  | { type: "warning"; executionId: string; warning: SwapWarning }
  | { type: "failed"; executionId: string; error: Error };
```

Create `src/core/registry.ts`:

```ts
export interface ChainExecutionResult {
  status: "submitted" | "source-confirmed" | "requires-user-action";
  txHash?: string;
  txHashes?: string[];
  orderId?: string;
  raw?: unknown;
}

export interface ExecutionContext {
  signal?: AbortSignal;
  waitFor: "submitted" | "source-confirmed" | "completed";
  emit(event: SwapLifecycleEvent): void;
  beforeSign?: (preview: SignRequestPreview) => void | Promise<void>;
}

export interface ChainExecutor<K extends SwapExecution["kind"] = SwapExecution["kind"]> {
  readonly kinds: readonly K[];
  validate(execution: Extract<SwapExecution, { kind: K }>, context: ExecutionContext): void | Promise<void>;
  execute(execution: Extract<SwapExecution, { kind: K }>, context: ExecutionContext): Promise<ChainExecutionResult>;
}
```

Implement `ExecutorRegistry.register()` and `get()` with duplicate protection and `EXECUTOR_NOT_FOUND`.

- [ ] **Step 5: Implement quoteRaw, quote, buildRaw, and buildSwap**

Create `src/client/SwapClient.ts` with this configuration and constructor surface:

```ts
export interface SwapClientConfig extends ApiClientConfig {
  maxQuoteAgeMs?: number | null;
  reportMode?: "auto" | "manual" | "disabled";
  executors?: ChainExecutor[];
  onEvent?: (event: SwapLifecycleEvent) => void;
  now?: () => number;
}

export class SwapClient {
  constructor(config: SwapClientConfig);

  quoteRaw(request: SwapQuoteRequestRaw): Promise<SwapQuoteDataRaw>;
  quote(request: QuoteRequest): Promise<Quote>;
  buildRaw(request: SwapBuildRequestRaw): Promise<SwapBuildDataRaw>;
  buildSwap(input: { quote: Quote; signal?: AbortSignal }): Promise<SwapBuild>;
}
```

`buildSwap()` must create `SwapBuildRequestRaw` only from `quote.buildContext`, reject expired quotes, and never call the registry.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
pnpm vitest run tests/core/registry.test.ts tests/client/SwapClient.test.ts
pnpm type-check
```

Expected: PASS.

Commit:

```bash
git add src/core/lifecycle.ts src/core/registry.ts src/client/SwapClient.ts tests/core/registry.test.ts tests/client/SwapClient.test.ts
git commit -m "feat: add swap client quote and build api"
```

### Task 6: Execute Lifecycle, Signature Submit, Report, and Order Polling

**Files:**
- Modify: `src/core/lifecycle.ts`
- Modify: `src/client/SwapClient.ts`
- Modify: `tests/client/SwapClient.test.ts`

**Interfaces:**
- Consumes: `ExecutorRegistry`, `ApiClient.submitOrder`, `report`, `getOrderStatus`.
- Produces: `SwapLifecycleEvent`, `SwapExecutionResult`, `OrderStatus`, `executeSwap`, `swap`, `getOrderStatus`, `waitForOrder`, `report`, `retryReport`.

- [ ] **Step 1: Write failing lifecycle tests**

Add tests with a fake executor and fake timers:

```ts
it("emits signing and submitted events and treats report failure as warning", async () => {
  const events: string[] = [];
  const result = await client.executeSwap({
    build,
    waitFor: "submitted",
    onEvent: (event) => events.push(event.type),
  });
  expect(events).toEqual(["signing-requested", "submitted", "warning"]);
  expect(result.status).toBe("submitted");
  expect(result.report?.status).toBe("failed");
});
```

Add tests that:

- executor validation happens before execute;
- an already in-flight `executionId` is rejected;
- `waitForOrder` maps `SUCCESS`, `FAILED`, `REFUNDED`, and `EXPIRED`;
- abort stops polling with `REQUEST_ABORTED` without changing a submitted result to failed;
- `swap({ quote })` makes exactly one build call and one execute call and never calls quote.

- [ ] **Step 2: Run lifecycle tests and verify failure**

Run:

```bash
pnpm vitest run tests/client/SwapClient.test.ts
```

Expected: FAIL because execution methods are missing.

- [ ] **Step 3: Complete lifecycle result and method input types**

Extend `src/core/lifecycle.ts` with these exact result and method input types:

```ts
export interface SwapExecutionResult {
  executionId: string;
  status:
    | "submitted"
    | "source-confirmed"
    | "processing"
    | "completed"
    | "failed"
    | "refunded"
    | "expired"
    | "requires-user-action";
  router: string;
  txHash?: string;
  txHashes?: string[];
  orderId?: string;
  depositAddress?: string;
  report?: { status: "reported" | "failed" | "skipped"; warning?: SwapWarning };
  raw: unknown;
}

export interface ExecuteSwapInput {
  build: SwapBuild;
  waitFor?: WaitMode;
  signal?: AbortSignal;
  onEvent?: (event: SwapLifecycleEvent) => void;
  beforeSign?: (preview: SignRequestPreview) => void | Promise<void>;
}

export interface SwapInput extends Omit<ExecuteSwapInput, "build"> {
  quote: Quote;
}

export interface OrderStatusResult {
  orderId: string;
  router: string;
  status: OrderStatus;
  raw: SwapOrderStatusDataRaw;
}

export interface WaitForOrderInput extends OrderReference {
  signal?: AbortSignal;
  intervalMs?: number;
  timeoutMs?: number;
}
```

Export `normalizeOrderStatus(raw)` with an explicit uppercase mapping and no substring guessing.

- [ ] **Step 4: Implement execution methods**

Modify `SwapClient` to add:

```ts
executeSwap(input: ExecuteSwapInput): Promise<SwapExecutionResult>;
swap(input: SwapInput): Promise<SwapExecutionResult>;
getOrderStatus(input: OrderReference): Promise<OrderStatusResult>;
waitForOrder(input: WaitForOrderInput): Promise<OrderStatusResult>;
report(result: SwapExecutionResult): Promise<SwapReportDataRaw>;
retryReport(result: SwapExecutionResult): Promise<SwapReportDataRaw>;
```

Execution order must be:

1. reject duplicate in-flight execution;
2. registry lookup;
3. executor validate;
4. executor execute;
5. emit submitted/user-action event;
6. auto report if configured and identifiers exist;
7. optionally wait for source or order completion;
8. clear in-flight marker in `finally`.

Report failure returns a warning. Wallet, validation, broadcast, and order-submit errors throw `SwapSdkError`.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
pnpm vitest run tests/client/SwapClient.test.ts
pnpm type-check
```

Expected: lifecycle tests PASS.

Commit:

```bash
git add src/core/lifecycle.ts src/client/SwapClient.ts tests/client/SwapClient.test.ts
git commit -m "feat: orchestrate swap execution lifecycle"
```

### Task 7: Raw and Normalized History

**Files:**
- Create: `src/types/history.ts`
- Create: `src/normalizers/history.ts`
- Create: `tests/normalizers/history.test.ts`
- Modify: `src/client/SwapClient.ts`
- Modify: `tests/client/SwapClient.test.ts`

**Interfaces:**
- Consumes: raw history page, chain normalizer, asset normalizer.
- Produces: `HistoryRequest`, `HistoryStatus`, `SwapHistoryItem`, `SwapHistoryPage`, `normalizeHistory`, `getHistoryRaw`, `getHistory`.

- [ ] **Step 1: Write failing history tests**

Create `tests/normalizers/history.test.ts` with a record that uses EVM chain `"1"`, native zero address, snake_case hashes, SQL timestamp, and status `SUCCESS`. Assert:

```ts
expect(normalizeHistory(raw)).toEqual({
  items: [
    expect.objectContaining({
      id: "7",
      fromChain: "eip155:1",
      toChain: "near:mainnet",
      sourceTxHash: "0xsource",
      destinationTxHash: "near-destination",
      status: "completed",
      createdAt: "2026-07-21T01:02:03.000Z",
      raw: raw.record_list[0],
    }),
  ],
  page: 1,
  pageSize: 20,
  totalPages: 1,
  totalItems: 1,
});
```

Add status cases for pending, processing, failed, refunded, expired, and unknown.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm vitest run tests/normalizers/history.test.ts
```

Expected: FAIL because history normalizer does not exist.

- [ ] **Step 3: Define history types and normalizer**

Create `src/types/history.ts` using the exact approved interfaces, including `filteredLocally?: boolean`.

Create `src/normalizers/history.ts` and export:

```ts
export function normalizeHistory(raw: SwapHistoryDataRaw): SwapHistoryPage;
export function normalizeHistoryStatus(status: unknown): HistoryStatus;
```

Timestamp normalization must append `T` only for SQL-like strings and return `undefined` for invalid dates. Recipient values that are not strings remain only in `raw`.

- [ ] **Step 4: Add client history methods**

Modify `SwapClient`:

```ts
getHistoryRaw(params: SwapHistoryParamsRaw): Promise<SwapHistoryDataRaw>;
getHistory(request: HistoryRequest): Promise<SwapHistoryPage>;
```

Only `sender`, `page`, and `pageSize` go to the API. If `status` is supplied, filter the returned page and set `filteredLocally: true` while retaining the server totals.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
pnpm vitest run tests/normalizers/history.test.ts tests/client/SwapClient.test.ts
pnpm type-check
```

Expected: PASS.

Commit:

```bash
git add src/types/history.ts src/normalizers/history.ts src/client/SwapClient.ts tests/normalizers/history.test.ts tests/client/SwapClient.test.ts
git commit -m "feat: add normalized swap history"
```

### Task 8: Public Exports, Package Build, and Core Acceptance Verification

**Files:**
- Modify: `src/index.ts`
- Modify: `package.json`
- Modify: `tsup.config.ts`
- Create: `tests/public-api.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: every public type and class from Tasks 1–7.
- Produces: stable root exports and a buildable package without wallet dependencies.

- [ ] **Step 1: Write failing public API smoke test**

Create `tests/public-api.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ApiClient,
  ExecutorRegistry,
  SwapClient,
  SwapSdkError,
  normalizeBuild,
  normalizeHistory,
  normalizeQuote,
} from "../src";

describe("public API", () => {
  it("exports the core SDK without touching browser globals", () => {
    expect(ApiClient).toBeTypeOf("function");
    expect(ExecutorRegistry).toBeTypeOf("function");
    expect(SwapClient).toBeTypeOf("function");
    expect(SwapSdkError).toBeTypeOf("function");
    expect(normalizeBuild).toBeTypeOf("function");
    expect(normalizeHistory).toBeTypeOf("function");
    expect(normalizeQuote).toBeTypeOf("function");
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
pnpm vitest run tests/public-api.test.ts
```

Expected: FAIL because `src/index.ts` is empty.

- [ ] **Step 3: Export the core surface**

Modify `src/index.ts` to export only platform-neutral modules:

```ts
export * from "./api/ApiClient";
export * from "./api/rawTypes";
export * from "./client/SwapClient";
export * from "./core/errors";
export * from "./core/lifecycle";
export * from "./core/registry";
export * from "./normalizers/build";
export * from "./normalizers/chain";
export * from "./normalizers/history";
export * from "./normalizers/quote";
export * from "./types/chain";
export * from "./types/execution";
export * from "./types/history";
export * from "./types/quote";
```

Do not re-export old router implementations from the new root entry.

- [ ] **Step 4: Align package metadata and build externals**

Update the package description to mention the unified multi-chain Swap API. Keep `sideEffects: false`. Remove old runtime dependencies only after `rg` confirms the new source does not import them. Add `zod` to `tsup.config.ts` externals only if package policy is to keep runtime dependencies external; otherwise bundle it consistently in CJS and ESM.

The package exports for this core plan remain root-only. Executor subpaths are added by their own plans when concrete files exist.

- [ ] **Step 5: Replace README quick start with the new core flow**

Document this exact sequence:

```ts
const client = new SwapClient({ baseUrl, getAccessToken });
const quote = await client.quote(request);
const build = await client.buildSwap({ quote });

// build is safe to inspect or send to another process.
// Register a chain executor before calling executeSwap.
```

Also list raw methods, normalized methods, supported execution kinds, Node fetch requirements, and the no-fixed-credentials rule.

- [ ] **Step 6: Run the full core verification**

Run:

```bash
pnpm test
pnpm type-check
pnpm lint
pnpm build
node -e "const sdk = require('./dist/index.js'); if (!sdk.SwapClient) process.exit(1)"
```

Expected:

- all tests PASS;
- TypeScript reports no errors;
- ESLint reports no errors;
- tsup emits CJS, ESM, declarations, and sourcemaps;
- Node imports the package without a `window` or missing-wallet error.

- [ ] **Step 7: Verify secret and placeholder hygiene**

Run:

```bash
rg -n "Bearer e[y]|BEGIN PRIVATE KE[Y]|mnemon[i]c" src tests README.md
```

Expected: no credentials, private key material, or placeholders. Legitimate test descriptions containing the words must be renamed rather than suppressed.

- [ ] **Step 8: Commit the completed core vertical slice**

```bash
git add src/index.ts package.json tsup.config.ts README.md tests/public-api.test.ts
git commit -m "feat: publish multi-chain swap sdk core"
```

## Core Plan Completion Gate

Before starting concrete executor plans, confirm all of the following from command output:

- Raw quote/build/status/report/history endpoints work through mocked contract tests.
- Normalized quote retains immutable build context.
- All nine execution variants across eight chain families normalize with explicit kinds.
- Build never resolves or invokes an executor.
- Execute uses only the registry and does not re-quote.
- History retains raw records and normalized pagination/status.
- Node import has no browser or wallet side effect.
- No fixed API token or sensitive fixture exists.
