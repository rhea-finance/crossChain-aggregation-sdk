# @rhea-finance/cross-chain-aggregation-dex

A powerful TypeScript SDK for cross-chain DEX aggregation and routing on NEAR blockchain. This SDK provides intelligent routing across multiple DEXs, automatic token registration, pre-swap handling for non-bluechip tokens, and seamless integration with NearIntents bridge protocol for cross-chain token swaps.

## Overview

This SDK offers two router implementations for different use cases:

- **NearSmartRouter (V1)**: Simple routing via FindPath API and REF Finance execution. Best for straightforward swaps without complex recipient handling.
- **AggregateDexRouter (V2)**: Advanced multi-DEX aggregation with automatic registration handling. Supports complex scenarios with multiple recipients and automatic token registration.

Both routers support optimal path finding, slippage protection, and can be combined with NearIntents for cross-chain functionality.

## Features

- 🔄 **DEX Aggregation Routing**: Automatically finds optimal swap paths across multiple DEXs on NEAR
- 🚀 **Dual Router Support**: Two router implementations (V1 Simple Router & V2 Aggregate Router) for different use cases
- 🌉 **Cross-chain Support**: Seamless integration with NearIntents bridge protocol for cross-chain swaps
- 🔀 **Pre-swap Handling**: Automatically converts non-bluechip tokens to bluechip tokens (USDT/USDC/wNEAR) when needed
- 🔐 **Auto Registration**: Automatically handles token storage registration for users and contracts
- 📊 **Multi-Router Comparison**: Compare quotes from multiple routers and select the best one
- 📦 **Type Safety**: Complete TypeScript type definitions with full IntelliSense support
- 🔌 **Adapter Pattern**: Flexible adapter interfaces for easy integration with any backend or wallet
- 🛡️ **Slippage Protection**: Built-in slippage calculation and protection
- 📝 **Comprehensive Logging**: Configurable logging levels for debugging and monitoring

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
  SwapMultiDexPathAdapter,
  IntentsQuotationAdapter,
  NearChainAdapter,
  ConfigAdapter,
} from "@rhea-finance/cross-chain-aggregation-dex";

// FindPath API adapter (for NearSmartRouter V1)
const findPathAdapter: FindPathAdapter = {
  async findPath(params) {
    const response = await fetch(
      `https://smartrouter.rhea.finance/findPath?${new URLSearchParams({
        amountIn: params.amountIn,
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        pathDeep: "3",
        slippage: String(params.slippage),
      })}`
    );
    return response.json();
  },
};

// SwapMultiDexPath API adapter (for AggregateDexRouter V2)
const swapMultiDexPathAdapter: SwapMultiDexPathAdapter = {
  async swapMultiDexPath(params) {
    const response = await fetch(
      `https://smartx.rhea.finance/swapMultiDexPath?${new URLSearchParams({
        amountIn: params.amountIn,
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        slippage: String(params.slippage),
        pathDeep: "2",
        chainId: "0",
        routerCount: "1",
        skipUnwrapNativeToken: "false",
        user: params.user,
        receiveUser: params.receiveUser,
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
    // Return { status: "success", txHash: "...", txHashArr?: [...] }
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
  getAggregateDexContractId: () => "aggregate-dex-contract.near", // For V2 Router
};
```

### 2. Create Router Instances

#### Using NearSmartRouter (V1)

```typescript
import { NearSmartRouter } from "@rhea-finance/cross-chain-aggregation-dex";

const v1Router = new NearSmartRouter({
  findPathAdapter,
  nearChainAdapter,
  configAdapter,
});
```

#### Using AggregateDexRouter (V2)

```typescript
import { AggregateDexRouter } from "@rhea-finance/cross-chain-aggregation-dex";

const v2Router = new AggregateDexRouter({
  swapMultiDexPathAdapter,
  nearChainAdapter,
  configAdapter,
});
```

### 3. Get Quote

#### Using NearSmartRouter (V1)

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

// V1 Router - Simple quote (no recipient required)
const quote = await v1Router.quote({
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

#### Using AggregateDexRouter (V2)

```typescript
// V2 Router - Requires sender and recipient
const quote = await v2Router.quote({
  tokenIn,
  tokenOut,
  amountIn: "1000000000000000000",
  slippage: 50,
  swapType: "EXACT_INPUT",
  sender: "user.near", // Required for V2
  recipient: "user.near", // Required for V2 (can be same as sender)
});

if (quote.success) {
  console.log("Amount out:", quote.amountOut);
  console.log("Min amount out:", quote.minAmountOut);
  console.log("Router message:", quote.routerMsg);
  console.log("Tokens involved:", quote.tokens);
  console.log("DEXs involved:", quote.dexs);
} else {
  console.error("Quote failed:", quote.error);
}
```

### 4. Execute Swap

#### Using NearSmartRouter (V1)

```typescript
const result = await v1Router.executeSwap({
  quote,
  recipient: "user.near",
  depositAddress: "deposit.near", // optional, for cross-chain scenarios
});

if (result.success) {
  console.log("Transaction hash:", result.txHash);
  console.log("Transaction hashes:", result.txHashArray);
} else {
  console.error("Swap failed:", result.error);
}
```

#### Using AggregateDexRouter (V2)

```typescript
// V2 Router - Requires sender and receiveUser (depositAddress)
const result = await v2Router.executeSwap({
  quote,
  sender: "user.near", // Required for V2
  receiveUser: "deposit.near", // Required for V2 (usually depositAddress)
  recipient: "user.near", // Optional, kept for compatibility
});

if (result.success) {
  console.log("Transaction hash:", result.txHash);
  console.log("Transaction hashes:", result.txHashArray);
} else {
  console.error("Swap failed:", result.error);
}
```

> **Note**: V2 Router automatically fetches a fresh quote using `receiveUser` (depositAddress) during `executeSwap` to ensure correct `routerMsg` and `signature`. You don't need to call `finalizeQuote` manually.

### 5. Complete Quote (DEX Aggregator + NearIntents)

The `completeQuote` function integrates DEX aggregation with NearIntents bridge for cross-chain swaps. It automatically handles pre-swaps when needed:

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

// Using single router
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
    dexRouter: v1Router, // or v2Router
    bluechipTokens,
    configAdapter,
    currentUserAddress: "user.near", // Required for V2 Router
  }
);

// Using multiple routers (compares and selects best quote)
const completeQuoteResult = await completeQuote(
  {
    sourceToken: tokenIn,
    targetToken: tokenOut,
    sourceChain: "near",
    targetChain: "bsc",
    amountIn: "1000000000000000000",
    slippage: 50,
    recipient: "0x...",
    refundTo: "user.near",
  },
  {
    intentsQuotationAdapter,
    dexRouters: [v1Router, v2Router], // Compare multiple routers
    bluechipTokens,
    configAdapter,
    currentUserAddress: "user.near",
  }
);

console.log("Deposit address:", completeQuoteResult.intents.depositAddress);
console.log("Final amount out:", completeQuoteResult.finalAmountOut);

if (completeQuoteResult.preSwap) {
  console.log("Pre-swap required:", completeQuoteResult.preSwap.quote);
  console.log("Pre-swap executor:", completeQuoteResult.preSwap.executor);
  // Execute pre-swap if needed
  const preSwapResult = await completeQuoteResult.preSwap.executor.executeSwap({
    quote: completeQuoteResult.preSwap.quote,
    recipient: completeQuoteResult.intents.depositAddress,
    // For V2 Router, also provide sender and receiveUser
    ...(completeQuoteResult.preSwap.executor.getCapabilities().requiresRecipient && {
      sender: "user.near",
      receiveUser: completeQuoteResult.intents.depositAddress,
    }),
  });
}
```

## API Documentation

### NearSmartRouter (V1)

Simple router implementation using FindPath API and REF Finance.

#### `quote(params: QuoteParams): Promise<QuoteResult>`

Get quote method that returns optimal swap path and output amount.

**Parameters:**
- `tokenIn`: Input token information
- `tokenOut`: Output token information
- `amountIn`: Input amount (string format, considering decimals)
- `slippage`: Slippage tolerance (prefer bps, 50 = 0.5%). Percent/decimal inputs are also accepted.
- `swapType`: Swap type ("EXACT_INPUT" | "EXACT_OUTPUT") - currently reserved for future use

**Returns:**
- `success`: Whether successful
- `amountOut`: Output amount
- `minAmountOut`: Minimum output amount (considering slippage)
- `routes`: Route information with pool details
- `rawRoutes`: Raw route data from server (for internal use)
- `error`: Error message (if failed)

#### `executeSwap(params: ExecuteParams): Promise<ExecuteResult>`

Execute swap method. Automatically handles token storage registration if needed.

**Parameters:**
- `quote`: Quote result from `quote()` method
- `recipient`: Recipient address
- `depositAddress`: Deposit address (optional, for cross-chain scenarios)

**Returns:**
- `success`: Whether successful
- `txHash`: Transaction hash
- `txHashArray`: Transaction hash array (if multiple transactions)
- `error`: Error message (if failed)

#### `getCapabilities(): RouterCapabilities`

Returns router capabilities:
- `requiresRecipient`: false
- `requiresFinalizeQuote`: false
- `requiresComplexRegistration`: false
- `supportedChain`: "near"

#### `getSupportedChain(): "near"`

Returns the supported chain identifier.

### AggregateDexRouter (V2)

Advanced router implementation using Aggregate DEX contract with multi-DEX support.

#### `quote(params: RecipientQuoteParams): Promise<QuoteResult>`

Get quote method that requires sender and recipient parameters.

**Parameters:**
- `tokenIn`: Input token information
- `tokenOut`: Output token information
- `amountIn`: Input amount (string format, considering decimals)
- `slippage`: Slippage tolerance (prefer bps, 50 = 0.5%)
- `swapType`: Swap type ("EXACT_INPUT" | "EXACT_OUTPUT")
- `sender`: Sender address (required)
- `recipient`: Recipient address (required, can be same as sender)

**Returns:**
- `success`: Whether successful
- `amountOut`: Output amount
- `minAmountOut`: Minimum output amount (considering slippage)
- `routerMsg`: Router message for execution (required for executeSwap)
- `signature`: Signature for router message (required for executeSwap)
- `tokens`: Array of token addresses involved in the swap
- `dexs`: Array of DEX identifiers involved in the swap
- `error`: Error message (if failed)

#### `executeSwap(params: RecipientExecuteParams): Promise<ExecuteResult>`

Execute swap method. Automatically:
- Fetches fresh quote using `receiveUser` (depositAddress)
- Handles NEAR to wNEAR conversion if needed
- Registers user, receiveUser, and contract in all required tokens
- Executes swap via Aggregate DEX contract

**Parameters:**
- `quote`: Quote result from `quote()` method (used for initial validation)
- `sender`: Sender address (required)
- `receiveUser`: Recipient address, usually depositAddress (required)
- `recipient`: Optional, kept for compatibility

**Returns:**
- `success`: Whether successful
- `txHash`: Transaction hash
- `txHashArray`: Transaction hash array (if multiple transactions)
- `error`: Error message (if failed)

> **Important**: V2 Router automatically fetches a fresh quote during `executeSwap` using `receiveUser` to ensure the `routerMsg` and `signature` are correct for the final recipient address. You don't need to manually call `finalizeQuote`.

#### `finalizeQuote(params: QuoteParams, depositAddress: string): Promise<QuoteResult>`

> **Deprecated**: This method is kept for interface compatibility but is no longer needed. `executeSwap` automatically fetches the final quote using `receiveUser` (depositAddress).

#### `getCapabilities(): RouterCapabilities`

Returns router capabilities:
- `requiresRecipient`: true
- `requiresFinalizeQuote`: false (automatic during executeSwap)
- `requiresComplexRegistration`: true
- `supportedChain`: "near"

#### `getSupportedChain(): "near"`

Returns the supported chain identifier.

### completeQuote

Complete quote function that integrates DEX Aggregator and NearIntents.

**Parameters:**
- `sourceToken`: Source token information
- `targetToken`: Target token information
- `sourceChain`: Source chain identifier ("near")
- `targetChain`: Target chain identifier (e.g., "bsc", "ethereum")
- `amountIn`: Input amount (string format)
- `slippage`: Slippage tolerance (prefer bps, 50 = 0.5%)
- `recipient`: Recipient address on target chain
- `refundTo`: Refund address (optional, defaults to recipient)

**Configuration:**
- `intentsQuotationAdapter`: NearIntents quotation adapter
- `dexRouter`: Single DEX Router instance (optional, use `dexRouters` for multiple)
- `dexRouters`: Array of DEX Router instances (optional, use `dexRouter` for single)
- `bluechipTokens`: Bluechip tokens configuration (USDT, USDC, NEAR)
- `configAdapter`: Configuration adapter
- `currentUserAddress`: Current user address (required for V2 Router)

**Returns:**
- `intents`: NearIntents quote result with depositAddress
- `preSwap`: Pre-swap information (if source token is not bluechip)
  - `quote`: Pre-swap quote result
  - `tokenIn`: Source token
  - `tokenOut`: Bluechip token
  - `executor`: Router instance to execute pre-swap
- `finalAmountOut`: Final output amount after NearIntents bridge

## Router Comparison

| Feature | NearSmartRouter (V1) | AggregateDexRouter (V2) |
|---------|---------------------|-------------------------|
| API | FindPath | swapMultiDexPath |
| Execution | REF Finance | Aggregate DEX Contract |
| Recipient Required | No | Yes (sender + recipient) |
| Auto Registration | Basic (recipient only) | Advanced (user, receiveUser, contract) |
| Multi-DEX Support | Via FindPath | Native multi-DEX aggregation |
| NEAR → wNEAR | Manual | Automatic |
| Use Case | Simple swaps | Complex swaps, cross-chain |

## Utility Functions

### `normalizeTokenId(tokenId: string, wrapNearContractId?: string): string`

Normalize token ID by removing `nep141:` prefix and converting `near` to `wrap.near`.

```typescript
import { normalizeTokenId } from "@rhea-finance/cross-chain-aggregation-dex";

normalizeTokenId("nep141:usdt.tether-token.near"); // "usdt.tether-token.near"
normalizeTokenId("near"); // "wrap.near"
normalizeTokenId("near", "custom-wrap.near"); // "custom-wrap.near"
```

### `convertSlippageToBasisPoints(slippage: number): number`

Convert slippage format to basis points (1 basis point = 0.01%).

```typescript
import { convertSlippageToBasisPoints } from "@rhea-finance/cross-chain-aggregation-dex";

convertSlippageToBasisPoints(50); // 50 (already in bps)
convertSlippageToBasisPoints(0.5); // 50 (percent format)
convertSlippageToBasisPoints(0.005); // 50 (decimal format)
```

### `findBestBluechipToken(bluechipTokens: BluechipTokensConfig, wrapNearContractId?: string): TokenInfo`

Find the best bluechip token to use as intermediate token (priority order: USDT > USDC > wNEAR).

```typescript
import { findBestBluechipToken } from "@rhea-finance/cross-chain-aggregation-dex";

const bluechipTokens = {
  USDT: { address: "usdt.tether-token.near", symbol: "USDT", decimals: 6 },
  USDC: { address: "usdc.near", symbol: "USDC", decimals: 6 },
  NEAR: { address: "wrap.near", symbol: "wNEAR", decimals: 24 },
};

const bestToken = findBestBluechipToken(bluechipTokens);
// Returns USDT if available, otherwise USDC, otherwise wNEAR
```

### `isNearIntentsSupportedToken(token: TokenInfo, bluechipTokens?: BluechipTokensConfig): boolean`

Check if a token is supported by NearIntents (matches bluechip token configuration).

```typescript
import { isNearIntentsSupportedToken } from "@rhea-finance/cross-chain-aggregation-dex";

const isSupported = isNearIntentsSupportedToken(tokenIn, bluechipTokens);
```

### `formatGasToTgas(gasInYoctoNEAR: string | number): string`

Format gas value from yoctoNEAR to Tgas string, avoiding scientific notation.

```typescript
import { formatGasToTgas } from "@rhea-finance/cross-chain-aggregation-dex";

formatGasToTgas("300000000000000"); // "300"
```

### `formatGasString(gas: string | number | bigint): string`

Ensure gas value is a string without scientific notation.

```typescript
import { formatGasString } from "@rhea-finance/cross-chain-aggregation-dex";

formatGasString(300000000000000); // "300000000000000"
formatGasString("3e14"); // "300000000000000"
```

## Logging

The SDK uses a simple logger with log level control. You can control logging via the `LOG_LEVEL` environment variable:

- `LOG_LEVEL=debug` - Show all logs (default in development)
- `LOG_LEVEL=info` - Show info, warn, and error logs
- `LOG_LEVEL=warn` - Show only warnings and errors (default in production)
- `LOG_LEVEL=error` - Show only errors
- `LOG_LEVEL=silent` - Disable all logs

```typescript
import { logger } from "@rhea-finance/cross-chain-aggregation-dex";

// The logger is automatically used internally
// You can also use it in your code if needed
logger.debug("Debug message");
logger.info("Info message");
logger.warn("Warning message");
logger.error("Error message");
```

## Type Definitions

All type definitions can be imported from the package:

```typescript
import type {
  TokenInfo,
  QuoteParams,
  RecipientQuoteParams,
  QuoteResult,
  ExecuteParams,
  RecipientExecuteParams,
  ExecuteResult,
  DexRouter,
  RouterCapabilities,
  BluechipTokensConfig,
  BluechipTokenConfig,
  Route,
  PoolInfo,
} from "@rhea-finance/cross-chain-aggregation-dex";
```

### Key Types

- `TokenInfo`: Token information with address, symbol, decimals, and chain
- `QuoteParams`: Union type supporting both simple and recipient modes
- `QuoteResult`: Quote result with routes, amounts, and optional router-specific fields
- `ExecuteParams`: Union type supporting both simple and recipient execution modes
- `RouterCapabilities`: Router feature flags
- `BluechipTokensConfig`: Configuration for bluechip tokens (USDT, USDC, NEAR)

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Type check
pnpm type-check

# Lint
pnpm lint

# Development mode (watch file changes)
pnpm dev
```

## License

MIT

## Related Links

- [GitHub Repository](https://github.com/rhea-finance/crossChain-aggregation-sdk)
- [Rhea Finance](https://rhea.finance)
