# Quote Call Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Chinese, scenario-based guide that shows exactly how to call `quote()` and `quoteRaw()`/HTTP for standard Swap and all supported MCA quote flows.

**Architecture:** Create one focused `docs/QUOTE.md` as the source of truth for quote request parameters, then link it from the README. Derive every field name, required condition, transformation, and example value from the public request types, serializers, and their existing tests; do not change runtime code.

**Tech Stack:** Markdown, TypeScript API examples, JSON HTTP examples, pnpm, TypeScript, Vitest.

## Global Constraints

- Documentation language is Chinese; public identifiers and API field names remain unchanged.
- Cover `client.quote()`, `client.quoteRaw()`, and `POST /api/swap/quote`.
- Cover standard Swap, MCA Deposit, MCA Withdraw to bound NEAR, and MCA Withdraw through the relayer.
- Standard SDK chains use `ChainRef`; raw/HTTP chains use Swap API chain IDs.
- `amountIn` is a base-unit decimal string; `decreaseAmountBurrow` is a Burrow decimal balance string.
- Both `slippageBps` and serialized raw `slippage` use basis points; `50` means 0.5%.
- `executionPreference` and `boundNearAccountId` are SDK-only mode-selection fields and are not serialized.
- Do not change SDK types, serializers, runtime behavior, or API endpoints.
- Do not stage or commit files unless the user explicitly grants Git write permission.

---

### Task 1: Write the scenario-based Quote guide

**Files:**
- Create: `docs/QUOTE.md`
- Reference: `src/types/quote.ts`
- Reference: `src/types/chain.ts`
- Reference: `src/api/rawTypes.ts`
- Reference: `src/normalizers/chain.ts`
- Reference: `src/normalizers/quote.ts`
- Reference: `src/mca/types.ts`
- Reference: `src/mca/quote.ts`
- Reference: `tests/normalizers/quote.test.ts`
- Reference: `tests/mca/quote.test.ts`

**Interfaces:**
- Consumes: `QuoteRequest`, `McaDepositQuoteRequest`, `McaWithdrawQuoteRequest`, `SwapQuoteRequestRaw`, `ApiRequestOptions`, `serializeQuoteRequest()`, and `serializeMcaQuoteRequest()`.
- Produces: a standalone guide whose examples can be copied into an application and whose raw JSON matches the serializers.

- [ ] **Step 1: Add the interface-selection and scenario-selection sections**

Start the document with these exact decisions:

```markdown
# Quote 调用文档

本文说明 `SwapClient.quote()`、`SwapClient.quoteRaw()` 和
`POST /api/swap/quote` 在不同业务场景下应当如何传参。

## 1. 先选择调用接口

| 接口 | 参数 | 返回值 | 适用场景 |
| --- | --- | --- | --- |
| `client.quote()` | SDK 标准类型 | `Quote` 或 `McaQuote` | 推荐；需要继续调用 `buildSwap()` 或 `swap()` |
| `client.quoteRaw()` | `SwapQuoteRequestRaw` | `SwapQuoteDataRaw` | 需要直接处理服务端原始字段 |
| `POST /api/swap/quote` | 与 `quoteRaw()` 相同的 JSON | `{ code, msg, data }` | 不使用 SDK 的 HTTP 调用方 |

## 2. 按资金来源和目标选择场景

| 资金来源 | 最终目标 | 场景 | SDK 特有字段 | Raw/HTTP 特有结构 |
| --- | --- | --- | --- | --- |
| 普通钱包 | 普通钱包 | 普通 Swap | 不传 MCA 字段 | 不传 `mca` |
| 普通钱包 | MCA | MCA Deposit | `flow: "deposit"` | `mca.flow: "deposit"` |
| MCA | 绑定 NEAR account | MCA Withdraw / NEAR | `flow: "withdraw"` + 本地模式选择 | `mca.flow: "withdraw"` |
| MCA | 其他目标地址 | MCA Withdraw / Relayer | `flow: "withdraw"` + signer adapter | `mca.flow: "withdraw"` |
```

State explicitly that ownership of an MCA alone does not make a request an MCA quote. The source or destination balance must actually be the MCA.

- [ ] **Step 2: Add common parameter rules and mappings**

Add a `client.quote()` parameter table with these exact public fields:

| Parameter | Type | Required | Rule |
| --- | --- | --- | --- |
| `fromChain` | `ChainRef` | Yes | Source chain; must equal `tokenIn.chain` |
| `toChain` | `ChainRef` | Yes | Destination chain; must equal `tokenOut.chain` |
| `tokenIn` | `AssetRef` | Yes | Source token; use the real token address/id |
| `tokenOut` | `AssetRef` | Yes | Destination token; MCA tokens also use the real Burrow/API token id, never a UI `mca:` key |
| `amountIn` | `string` | Yes | Positive/zero base-unit integer format accepted by the type validator; never a floating-point number |
| `slippageBps` | `number` | Yes | Integer from `0` through `10000`; `50` means 0.5% |
| `sender` | `string` | Yes | Account that owns the source balance |
| `recipient` | `string` | Conditional | Final receiving account; each scenario defines the exact value |
| `extensions` | `Record<string, unknown>` | No | Spread into the top level of the raw request before standard fields |

Document the second argument:

| Option | Type | Required | Rule |
| --- | --- | --- | --- |
| `signal` | `AbortSignal` | No | Cancel an obsolete request, for example after the user changes an input |
| `idempotencyKey` | `string` | No | Sends the `Idempotency-Key` header; normally unnecessary for the read-only quote operation |

```ts
const controller = new AbortController();

const quote = await client.quote(request, {
  signal: controller.signal,
});

controller.abort(); // cancel a stale quote when the user changes input
```

Add one reusable HTTP invocation after the first complete raw JSON body. It must show that HTTP
uses the same body as `quoteRaw()` and that the SDK access token becomes a Bearer header:

```bash
curl 'https://api.rhea.finance/api/swap/quote' \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  --data-binary @quote-request.json
```

State that callers must check both the HTTP status and the response envelope's `code`; the quote
payload is in `data`.

Include the chain mapping table supported by `toApiChain()`:

| SDK `ChainRef` | Raw/HTTP `fromChain` / `toChain` |
| --- | --- |
| `eip155:<chainId>` | decimal chain id, for example `eip155:1` → `"1"` |
| `solana:mainnet` | `"solana"` |
| `aptos:mainnet` | `"aptos"` |
| `near:mainnet` | `"near"` |
| `tron:mainnet` | `"tron"` |
| `bitcoin:mainnet` | `"btc"` |
| `zcash:mainnet` | `"zcash"` |
| `sui:mainnet` | `"sui"` |

Explain that `tokenIn` and `tokenOut` become address/id strings. For an empty-address native asset with `isNative: true`, document the mappings implemented in `toApiAssetAddress()`: EVM zero address, wrapped SOL address, `0xa`, `wrap.near`, `trx`, `btc`, `nep141:zec.omft.near`, and `0x2::sui::SUI`.

- [ ] **Step 3: Add the standard Swap example and raw mapping**

Use this typed SDK request:

```ts
import type { QuoteRequest } from "@rhea-finance/cross-chain-aggregation-dex";

const request: QuoteRequest = {
  fromChain: "eip155:1",
  toChain: "near:mainnet",
  tokenIn: {
    chain: "eip155:1",
    address: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    symbol: "USDC",
    decimals: 6,
  },
  tokenOut: {
    chain: "near:mainnet",
    address: "usdc.token.near",
    symbol: "USDC",
    decimals: 6,
  },
  amountIn: "1000000",
  slippageBps: 50,
  sender: "0xSenderAddress",
  recipient: "alice.near",
};

const quote = await client.quote(request);
```

Pair it with the exact raw request:

```ts
const rawQuote = await client.quoteRaw({
  fromChain: "1",
  toChain: "near",
  tokenIn: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  tokenOut: "usdc.token.near",
  amountIn: "1000000",
  slippage: 50,
  sender: "0xSenderAddress",
  recipient: "alice.near",
});
```

State that standard Swap must omit `flow`, `mcaAccountId`, `signer`, `collateral`, and raw `mca`.

- [ ] **Step 4: Add the MCA Deposit example and raw mapping**

Use `McaDepositQuoteRequest` with `flow: "deposit"`, `mcaAccountId: "account.near"`, source EVM USDC, destination `usdc.token.near`, `sender: "0xSenderAddress"`, `recipient: "account.near"`, signer `{ chain: "evm", identityKey: "0xSenderAddress" }`, and `collateral: { useAsCollateral: true }`.

Show the corresponding raw object with the same common raw fields plus:

```json
"mca": {
  "flow": "deposit",
  "mcaAccountId": "account.near",
  "signer": {
    "chain": "evm",
    "identityKey": "0xSenderAddress"
  },
  "useAsCollateral": true
}
```

The parameter table must state:

- `mcaAccountId` and `recipient` both identify the destination MCA account.
- `signer.chain` must be one of `evm`, `solana`, `btc`, `near`, `aptos`, `sui`, `zcash`, or `tron`.
- `signer.identityKey` identifies the connected source wallet and must not be blank.
- `useAsCollateral` is an explicit business decision and must always be `true` or `false`.
- A successful normalized quote has `executionMode: "deposit"`.

- [ ] **Step 5: Add the MCA Withdraw-to-NEAR example and raw mapping**

Use `McaWithdrawQuoteRequest` with source and target NEAR USDC, `sender: "account.near"`, `recipient: "alice.near"`, signer `{ chain: "near", identityKey: "alice.near" }`, collateral `{ needDecrease: false, decreaseAmountBurrow: "0" }`, `executionPreference: "auto"`, and `boundNearAccountId: "alice.near"`.

Show the raw request with common fields and:

```json
"mca": {
  "flow": "withdraw",
  "mcaAccountId": "account.near",
  "signer": {
    "chain": "near",
    "identityKey": "alice.near"
  },
  "needDecreaseCollateral": false,
  "decreaseCollateralAmountBurrow": "0"
}
```

State all mode rules exactly:

- `auto` produces `withdraw-near` only when `toChain === "near:mainnet"`, `recipient` is non-empty, and `recipient === boundNearAccountId`.
- Otherwise `auto` produces `withdraw-relayer`.
- `near` and `relayer` force the local mode.
- Forced `near` does not validate the binding, so applications should prefer `auto` unless they have independently verified the account.
- `executionPreference` and `boundNearAccountId` do not appear in raw JSON.

- [ ] **Step 6: Add the MCA Withdraw-through-Relayer example and raw mapping**

Use an EVM signer adapter that contains `chain`, `identityKey`, and `signMessage`; use `sender: "account.near"`, `recipient: wallet.address`, `executionPreference: "relayer"`, and collateral `{ needDecrease: true, decreaseAmountBurrow: "12.5", withdrawAll: true }`.

The raw `mca` example must contain exactly:

```json
{
  "flow": "withdraw",
  "mcaAccountId": "account.near",
  "signer": {
    "chain": "evm",
    "identityKey": "0xRecipientAddress"
  },
  "needDecreaseCollateral": true,
  "decreaseCollateralAmountBurrow": "12.5",
  "withdrawAll": true
}
```

Explain that `signMessage`, `executionPreference`, `boundNearAccountId`, and `signer.accountId` are local-only and are not serialized. Explain optional proof arrays and their raw names:

| SDK field | Raw `mca` field |
| --- | --- |
| `recipientMsgSignatures` | `recipientMsgSignatures` |
| `depositSignerProofSignatures` | `depositSignerProofSignatures` |

State that a successful normalized quote has `executionMode: "withdraw-relayer"` and that `signMessage` is required later when `swap()` signs the API-provided `messageToSign`.

- [ ] **Step 7: Add the complete field-mapping, return-value, and error sections**

The mapping table must include:

| SDK field | Raw/HTTP field | Transformation |
| --- | --- | --- |
| `fromChain` | `fromChain` | `ChainRef` → API chain id |
| `toChain` | `toChain` | `ChainRef` → API chain id |
| `tokenIn.address` | `tokenIn` | Token object → address/id string |
| `tokenOut.address` | `tokenOut` | Token object → address/id string |
| `amountIn` | `amountIn` | unchanged string |
| `slippageBps` | `slippage` | unchanged basis-point number |
| `sender` | `sender` | trimmed |
| `recipient` | `recipient` | trimmed; omitted if blank |
| `flow` | `mca.flow` | MCA only |
| `mcaAccountId` | `mca.mcaAccountId` | trimmed |
| `signer.chain` | `mca.signer.chain` | unchanged |
| `signer.identityKey` | `mca.signer.identityKey` | trimmed |
| `collateral.useAsCollateral` | `mca.useAsCollateral` | Deposit only |
| `collateral.needDecrease` | `mca.needDecreaseCollateral` | Withdraw only |
| `collateral.decreaseAmountBurrow` | `mca.decreaseCollateralAmountBurrow` | Withdraw only |
| `collateral.withdrawAll` | `mca.withdrawAll` | Included only when true |

For returns, show:

```ts
const quote = await client.quote(request);
const build = await client.buildSwap({ quote });
// or: await client.swap({ quote, waitFor: "completed" });
```

Warn callers not to reconstruct `router`, `expectedOut`, `preSwap`, `bridge`, or `quoteId` manually. Add an error checklist covering chain mismatches, UI `mca:` ids, decimal `amountIn`, wrong slippage unit, MCA fields on a standard quote, blank MCA identities, invalid Burrow decimal strings, incorrect NEAR binding assumptions, and expecting local functions to appear in JSON.

- [ ] **Step 8: Verify the guide against serializers and tests**

Run:

```bash
rg -n 'slippage|executionPreference|boundNearAccountId|needDecreaseCollateral|decreaseCollateralAmountBurrow|useAsCollateral|signMessage' docs/QUOTE.md src/normalizers/quote.ts src/mca/quote.ts tests/normalizers/quote.test.ts tests/mca/quote.test.ts
```

Expected: every documented raw field and local-only field agrees with implementation and test expectations; `slippage` examples use `50`, not `0.5`.

Run:

```bash
rg -n 'TBD|TODO|mca:|slippage[^\n]*0\.5' docs/QUOTE.md
```

Expected: no placeholders; any `mca:` occurrence is explicitly marked as forbidden; `0.5` appears only in prose explaining that 50 bps equals 0.5%, never as a request value.

---

### Task 2: Link the Quote guide from the README

**Files:**
- Modify: `README.md:13-16`
- Test: `docs/QUOTE.md`

**Interfaces:**
- Consumes: the completed `docs/QUOTE.md` from Task 1.
- Produces: a discoverable README entry without duplicating the guide.

- [ ] **Step 1: Add the link immediately below the Quick start conventions**

Add this exact paragraph after the sentence about base-unit amounts and basis points:

```markdown
不同 Swap/MCA 场景的 `quote()`、`quoteRaw()` 与 HTTP 参数传法见 [Quote 调用文档](docs/QUOTE.md)。
```

- [ ] **Step 2: Verify the Markdown target exists**

Run:

```bash
test -f docs/QUOTE.md && rg -n '\[Quote 调用文档\]\(docs/QUOTE\.md\)' README.md
```

Expected: exit code 0 and one README match.

---

### Task 3: Run repository verification

**Files:**
- Verify: `docs/QUOTE.md`
- Verify: `README.md`
- Verify: unchanged TypeScript source and tests

**Interfaces:**
- Consumes: all documentation changes from Tasks 1 and 2.
- Produces: fresh evidence that documentation did not accompany a broken repository state and that the final diff is scoped correctly.

- [ ] **Step 1: Check Markdown whitespace and diff scope**

Run:

```bash
git diff --check -- README.md docs/QUOTE.md docs/superpowers/specs/2026-07-23-quote-call-documentation-design.md docs/superpowers/plans/2026-07-23-quote-call-documentation.md
```

Expected: exit code 0 with no whitespace errors.

- [ ] **Step 2: Run focused serializer tests**

Run:

```bash
pnpm test -- tests/normalizers/quote.test.ts tests/mca/quote.test.ts
```

Expected: both test files pass with zero failures.

- [ ] **Step 3: Run TypeScript checking**

Run:

```bash
pnpm type-check
```

Expected: exit code 0 and no TypeScript diagnostics.

- [ ] **Step 4: Run the full test suite**

Run:

```bash
pnpm test
```

Expected: exit code 0 and zero failing tests.

- [ ] **Step 5: Review only the intended documentation diff**

Run:

```bash
git diff -- README.md docs/QUOTE.md docs/superpowers/specs/2026-07-23-quote-call-documentation-design.md docs/superpowers/plans/2026-07-23-quote-call-documentation.md
```

Expected: one new quote guide, one README link, and the two workflow documents; no runtime source changes.
