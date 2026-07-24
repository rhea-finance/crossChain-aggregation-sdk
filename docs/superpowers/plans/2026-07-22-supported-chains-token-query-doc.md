# Supported Chains and Token Query Documentation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document every product-supported Swap chain and the HTTP endpoint used to query supported token metadata without embedding a live token list.

**Architecture:** Extend the existing MCA Swap HTTP guide with a static product support matrix sourced from `multi-chain-lending/src/services/chainSwapConfig.ts`. Add a separate reference for `GET /get_multichain_lending_tokens_data`, including the all-chain query, response item schema, and the distinction between token discovery and route availability.

**Tech Stack:** Markdown, curl, JSON.

## Global Constraints

- Use the fixed production origin `https://api.rhea.finance`.
- Do not query or embed current token results.
- Do not change SDK business code.
- Treat `/api/swap/quote` as the final authority for pair route availability.

---

### Task 1: Add the complete supported-chain matrix

**Files:**
- Modify: `docs/MCA_SWAP_HTTP_API.md`

**Interfaces:**
- Consumes: Product aliases from `multi-chain-lending/src/services/chainSwapConfig.ts` and EVM chain IDs from `multi-chain-lending/src/services/config.ts`.
- Produces: One table containing 11 EVM networks and 7 non-EVM networks.

- [ ] **Step 1: Replace the family-only chain table with the complete product matrix**

Include chain name, HTTP API chain ID, token-query alias, and SDK ChainRef.

- [ ] **Step 2: Verify every `SUPPORT_CHAINS_SWAP` alias is represented**

Run:

```bash
rg -n 'bsc|eth|arb|base|op|bera|monad|xlayer|pol|gnosis|plasma|sol|btc|near|zcash|zec|aptos|tron|sui' docs/MCA_SWAP_HTTP_API.md
```

Expected: every alias appears in the supported-chain section.

### Task 2: Document the supported-token query endpoint

**Files:**
- Modify: `docs/MCA_SWAP_HTTP_API.md`

**Interfaces:**
- Consumes: `getMultichainTokensByChains(chains)` from `multi-chain-lending/src/services/api/centralized_api.ts`.
- Produces: `GET https://api.rhea.finance/get_multichain_lending_tokens_data?chains=<aliases>` reference.

- [ ] **Step 1: Add request and curl examples**

Document the comma-separated `chains` parameter and provide a complete all-chain example without real token results.

- [ ] **Step 2: Add the response item schema**

Document `assetId`, `decimals`, `blockchain`, `symbol`, `price`, `priceUpdatedAt`, and optional metadata fields as a shape only.

- [ ] **Step 3: Add route-availability rules**

State that the endpoint is for discovery, that callers should match `blockchain` against requested aliases, and that a successful `/api/swap/quote` determines whether a pair is currently tradable.

- [ ] **Step 4: Validate Markdown and JSON examples**

Run:

```bash
node -e 'const fs=require("fs");const s=fs.readFileSync("docs/MCA_SWAP_HTTP_API.md","utf8");for(const m of s.matchAll(/```json\n([\s\S]*?)\n```/g))JSON.parse(m[1]);if((s.match(/^```/gm)||[]).length%2)process.exit(1)'
```

Expected: exit code 0.
