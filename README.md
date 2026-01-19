# @rhea-finance/cross-chain-aggregation-dex

Cross-chain DEX Aggregation SDK is a TypeScript SDK for multi-chain DEX aggregation and routing. It supports token swaps on Near chain and can integrate with NearIntents bridge protocol to enable cross-chain swaps.

## Features

- 🔄 **DEX Aggregation Routing**: Automatically finds optimal swap paths
- 🌉 **Cross-chain Support**: Integrates with NearIntents for cross-chain swaps
- 🔀 **Pre-swap Handling**: Automatically handles conversion from non-bluechip tokens to bluechip tokens
- 📦 **Type Safety**: Complete TypeScript type definitions
- 🔌 **Adapter Pattern**: Abstracts dependencies through adapter interfaces for easy integration

## Installation

```bash
npm install @rhea-finance/cross-chain-aggregation-dex
# or
pnpm add @rhea-finance/cross-chain-aggregation-dex
# or
yarn add @rhea-finance/cross-chain-aggregation-dex
```

## Quick Start

### 1. Create Adapters

First, you need to implement adapter interfaces to provide necessary dependencies:

```typescript
import {
  FindPathAdapter,
  IntentsQuotationAdapter,
  NearChainAdapter,
  ConfigAdapter,
} from "@rhea-finance/cross-chain-aggregation-dex";

// FindPath API adapter
const findPathAdapter: FindPathAdapter = {
  async findPath(params) {
    const response = await fetch(
      `https://smartrouter.ref.finance/findPath?${new URLSearchParams({
        amountIn: params.amountIn,
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        slippage: String(params.slippage),
      })}`
    );
    return response.json();
  },
};

// NearIntents quotation adapter
const intentsQuotationAdapter: IntentsQuotationAdapter = {
  async quote(params) {
    // Call your NearIntents API
    const response = await fetch("https://your-api.com/intents/quote", {
      method: "POST",
      body: JSON.stringify(params),
    });
    return response.json();
  },
};

// Near chain interaction adapter
const nearChainAdapter: NearChainAdapter = {
  async call({ transactions }) {
    // Use your Near wallet or RPC to call contracts
    // Return { status: "success", txHash: "..." }
  },
  async view({ contractId, methodName, args }) {
    // Use your Near RPC to view contract state
  },
};

// Configuration adapter
const configAdapter: ConfigAdapter = {
  getRefExchangeId: () => "v2.ref-finance.near",
  getWrapNearContractId: () => "wrap.near",
  getFindPathUrl: () => "https://smartrouter.ref.finance",
  getTokenStorageDepositRead: () => "1250000000000000000000",
};
```

### 2. Create DEX Aggregator Instance

```typescript
import { NearSmartRouter } from "@rhea-finance/cross-chain-aggregation-dex";

const router = new NearSmartRouter({
  findPathAdapter,
  nearChainAdapter,
  configAdapter,
});
```

### 3. Get Quote

```typescript
import { TokenInfo } from "@rhea-finance/cross-chain-aggregation-dex";

const tokenIn: TokenInfo = {
  address: "token-a.near",
  symbol: "TOKENA",
  decimals: 18,
  chain: "near",
};

const tokenOut: TokenInfo = {
  address: "token-b.near",
  symbol: "TOKENB",
  decimals: 18,
  chain: "near",
};

const quote = await router.quote({
  tokenIn,
  tokenOut,
  amountIn: "1000000000000000000", // 1 token (18 decimals)
  slippage: 50, // 0.5% (50 basis points)
  swapType: "EXACT_INPUT",
});

if (quote.success) {
  console.log("Amount out:", quote.amountOut);
  console.log("Min amount out:", quote.minAmountOut);
  console.log("Routes:", quote.routes);
} else {
  console.error("Quote failed:", quote.error);
}
```

### 4. Execute Swap

```typescript
const result = await router.executeSwap({
  quote,
  recipient: "user.near",
  depositAddress: "deposit.near", // optional
});

if (result.success) {
  console.log("Transaction hash:", result.txHash);
} else {
  console.error("Swap failed:", result.error);
}
```

### 5. Complete Quote (DEX Aggregator + NearIntents)

```typescript
import { completeQuote } from "@rhea-finance/cross-chain-aggregation-dex";

const bluechipTokens = {
  USDT: {
    address: "usdt.tether-token.near",
    symbol: "USDT",
    decimals: 6,
    assetId: "nep141:usdt.tether-token.near",
  },
  USDC: {
    address: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    symbol: "USDC",
    decimals: 6,
    assetId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  },
  NEAR: {
    address: "wrap.near",
    symbol: "wNEAR",
    decimals: 24,
    assetId: "nep141:wrap.near",
  },
};

const completeQuoteResult = await completeQuote(
  {
    sourceToken: tokenIn,
    targetToken: tokenOut,
    sourceChain: "near",
    targetChain: "bsc",
    amountIn: "1000000000000000000",
    slippage: 50,
    recipient: "0x...", // Target chain address
    refundTo: "user.near",
  },
  {
    intentsQuotationAdapter,
    dexRouter: router,
    bluechipTokens,
    configAdapter,
  }
);

console.log("Deposit address:", completeQuoteResult.intents.depositAddress);
console.log("Final amount out:", completeQuoteResult.finalAmountOut);

if (completeQuoteResult.preSwap) {
  console.log("Pre-swap required:", completeQuoteResult.preSwap.quote);
}
```

## API Documentation

### NearSmartRouter

#### `quote(params: QuoteParams): Promise<QuoteResult>`

Get quote method that returns optimal swap path and output amount.

**Parameters:**
- `tokenIn`: Input token information
- `tokenOut`: Output token information
- `amountIn`: Input amount (string format, considering decimals)
- `slippage`: Slippage tolerance (basis points, 50 = 0.5%)
- `swapType`: Swap type ("EXACT_INPUT" | "EXACT_OUTPUT")

**Returns:**
- `success`: Whether successful
- `amountOut`: Output amount
- `minAmountOut`: Minimum output amount (considering slippage)
- `routes`: Route information
- `error`: Error message (if failed)

#### `executeSwap(params: ExecuteParams): Promise<ExecuteResult>`

Execute swap method.

**Parameters:**
- `quote`: Quote result
- `recipient`: Recipient address
- `depositAddress`: Deposit address (optional, for cross-chain scenarios)

**Returns:**
- `success`: Whether successful
- `txHash`: Transaction hash
- `txHashArray`: Transaction hash array (if multiple transactions)
- `error`: Error message (if failed)

### completeQuote

Complete quote function that integrates DEX Aggregator and NearIntents.

**Parameters:**
- `sourceToken`: Source token
- `targetToken`: Target token
- `sourceChain`: Source chain
- `targetChain`: Target chain
- `amountIn`: Input amount
- `slippage`: Slippage tolerance
- `recipient`: Recipient address
- `refundTo`: Refund address (optional)

**Configuration:**
- `intentsQuotationAdapter`: NearIntents quotation adapter
- `dexRouter`: DEX Router instance
- `bluechipTokens`: Bluechip tokens configuration
- `configAdapter`: Configuration adapter

## Utility Functions

### `normalizeTokenId(tokenId: string, wrapNearContractId?: string): string`

Normalize token ID, remove `nep141:` prefix, convert `near` to `wrap.near`.

### `convertSlippageToBasisPoints(slippage: number): number`

Convert slippage format to basis points (1 basis point = 0.01%).

### `findBestBluechipToken(bluechipTokens: BluechipTokensConfig, wrapNearContractId?: string): TokenInfo`

Find the best bluechip token to use as intermediate token (priority order: USDT > USDC > wNEAR).

## Type Definitions

All type definitions can be imported from the package:

```typescript
import type {
  TokenInfo,
  QuoteParams,
  QuoteResult,
  ExecuteParams,
  ExecuteResult,
  DexRouter,
  BluechipTokensConfig,
} from "@rhea-finance/cross-chain-aggregation-dex";
```

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Type check
pnpm type-check

# Development mode (watch file changes)
pnpm dev
```

## License

MIT

## Related Links

- [GitHub Repository](https://github.com/rhea-finance/crossChain-aggregation-dex)
- [Rhea Finance](https://rhea.finance)
