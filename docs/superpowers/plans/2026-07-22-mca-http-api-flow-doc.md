# MCA HTTP API Conditional Flow Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the HTTP API guide so integrators can determine when MCA fields, message signatures, reports, and status polling are required.

**Architecture:** Keep one HTTP guide, but lead with a request classifier and four end-to-end flows: regular swap, MCA deposit, MCA withdraw to bound NEAR, and MCA withdraw through the Intents relayer. Move endpoint schemas after the flows so they serve as reference rather than defining the integration sequence.

**Tech Stack:** Markdown, Mermaid, JSON, curl, Fetch/TypeScript

## Global Constraints

- The production API origin is always `https://api.rhea.finance`.
- `mca` is omitted when neither side is an MCA balance.
- The current extension supports exactly one MCA side: target MCA means deposit; source MCA means withdraw.
- Only the Intents relayer withdraw signs `mcaWithdrawToIntents.messageToSign`.
- A report is sent only after a transaction hash or relayer order id exists.
- Do not change SDK or server behavior.

---

### Task 1: Replace endpoint-first guidance with an entry decision

**Files:**
- Modify: `docs/MCA_SWAP_HTTP_API.md`

**Interfaces:**
- Consumes: quote request fields and MCA response previews already documented in the file
- Produces: a decision tree and conditional matrix used by every later flow

- [ ] **Step 1: Add the request classifier**

Document the four cases and the exact MCA presence rule:

```text
neither side MCA -> regular swap -> omit mca
target side MCA -> deposit -> include mca.flow=deposit
source side MCA + bound NEAR recipient -> withdraw-near
source side MCA + any other recipient -> withdraw-relayer
```

- [ ] **Step 2: Add a field-presence matrix**

Cover `mca`, `mcaRelayer`, off-chain message signing, `/swap`, `/report`, and `/order-status` for all four cases.

- [ ] **Step 3: Verify MCA is not described as globally required**

Run: `rg -n 'MCA 必填|所有请求.*mca|必须.*mca' docs/MCA_SWAP_HTTP_API.md`

Expected: no statement that makes `mca` mandatory for ordinary swaps.

### Task 2: Write complete branch narratives

**Files:**
- Modify: `docs/MCA_SWAP_HTTP_API.md`

**Interfaces:**
- Consumes: decision result from Task 1
- Produces: executable request/response rules for each branch

- [ ] **Step 1: Document regular swap**

Show quote and build bodies without `mca`, state that the wallet signs/broadcasts the returned transaction, and report only after submission.

- [ ] **Step 2: Document MCA deposit**

Show `mca.flow`, `mcaAccountId`, bound signer identity, and `useAsCollateral`; carry the same `mca` object from quote into build; do not sign an MCA message.

- [ ] **Step 3: Document bound-NEAR withdraw**

Use `nearMcaWithdrawTx` directly, do not call `/swap`, set the MCA `exec` argument `signature` to `""`, and let the NEAR wallet sign the chain transaction.

- [ ] **Step 4: Document relayer withdraw**

Sign the exact `messageToSign`, submit `mcaRelayer` through `/swap`, then report with the returned order id.

### Task 3: Define signing and reporting contracts

**Files:**
- Modify: `docs/MCA_SWAP_HTTP_API.md`

**Interfaces:**
- Consumes: `messageToSign`, `business`, signer identity, transaction hash, order id, deposit address, and router
- Produces: unambiguous signature and post-submission behavior

- [ ] **Step 1: Add the message-signing invariant**

State that `messageToSign` is an opaque string whose exact UTF-8 bytes are signed; clients must not rebuild it from `business`, trim it, or JSON-stringify it.

- [ ] **Step 2: Add chain signature formats**

Document the reference encodings for EVM, Solana, BTC, NEAR, Aptos, and Sui. Separate wallet-descriptor support from current Tron/Zcash relayer-signing support.

- [ ] **Step 3: Add report and status decision tables**

Require report after main transaction broadcast or relayer acceptance; exclude quote, build, approval-only, rejection, and failed broadcast. Poll status only when both a status key and router exist.

### Task 4: Validate the rewritten guide

**Files:**
- Modify: `docs/MCA_SWAP_HTTP_API.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: all rewritten Markdown
- Produces: a linked, parseable, internally consistent HTTP guide

- [ ] **Step 1: Validate JSON examples**

Run: `node -e 'const fs=require("fs");const s=fs.readFileSync("docs/MCA_SWAP_HTTP_API.md","utf8");const b=[...s.matchAll(/```json\\n([\\s\\S]*?)\\n```/g)];for(const x of b)JSON.parse(x[1]);console.log(b.length)'`

Expected: a positive block count and exit code 0.

- [ ] **Step 2: Validate Markdown fences and fixed origin**

Run: `awk '/^```/{n++} END{print n; if(n%2)exit 1}' docs/MCA_SWAP_HTTP_API.md`

Expected: an even number and exit code 0.

Run: `rg -n 'BASE_URL|your-swap-api|swap\.example' docs/MCA_SWAP_HTTP_API.md`

Expected: no matches.

- [ ] **Step 3: Check whitespace and links**

Run: `rg -n '[[:blank:]]+$' docs/MCA_SWAP_HTTP_API.md`

Expected: no matches.

Run: `test -f docs/MCA_SWAP_HTTP_API.md`

Expected: exit code 0.
