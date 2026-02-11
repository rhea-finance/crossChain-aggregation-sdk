# @rhea-finance/cross-chain-aggregation-dex

A powerful TypeScript SDK for cross-chain DEX aggregation and routing on NEAR and EVM blockchains. This SDK provides intelligent routing across multiple DEXs, automatic token registration, pre-swap handling for non-bluechip tokens, and seamless integration with NearIntents bridge protocol for cross-chain token swaps.

## Overview

This SDK offers three router implementations for different use cases:

- **NearSmartRouter (V1)**: Simple routing via FindPath API and REF Finance execution. Best for straightforward swaps on NEAR without complex recipient handling.
- **AggregateDexRouter (V2)**: Advanced multi-DEX aggregation with automatic registration handling on NEAR. Supports complex scenarios with multiple recipients and automatic token registration.
- **BitgetRouter (EVM)**: EVM chain router implementation using Bitget DEX aggregator. Supports Ethereum, BSC, Polygon, Base, and other EVM-compatible chains with automatic balance checking, token approval, and gas optimization.

All routers support optimal path finding, slippage protection, and can be combined with NearIntents for cross-chain functionality.

## Features

- 🔄 **DEX Aggregation Routing**: Automatically finds optimal swap paths across multiple DEXs on NEAR and EVM chains
- 🚀 **Multi-Router Support**: Three router implementations (V1 Simple Router, V2 Aggregate Router, and EVM Router) for different use cases
- ⛓️ **Multi-Chain Support**: Native support for NEAR blockchain and EVM-compatible chains (Ethereum, BSC, Polygon, Base, etc.)
- 🌉 **Cross-chain Support**: Seamless integration with NearIntents bridge protocol for cross-chain swaps
- 🔀 **Pre-swap Handling**: Automatically converts non-bluechip tokens to bluechip tokens (USDT/USDC/wNEAR/ETH) when needed
- 🔐 **Auto Registration**: Automatically handles token storage registration for users and contracts (NEAR)
- 💰 **Auto Approval**: Automatically handles ERC20 token approval with retry mechanism (EVM)
- ⛽ **Gas Optimization**: Intelligent gas estimation with EIP-1559 support and fallback mechanisms (EVM)
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
  EvmChainAdapter,
  BitgetAdapter,
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

// Bitget DEX aggregator adapter (for BitgetRouter EVM)
const bitgetAdapter: BitgetAdapter = {
  async quote(params) {
    const response = await fetch("https://api.bitget.com/v1/mix/market/swap-best-book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chainId: params.chainId,
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn,
        slippage: params.slippage,
        userAddress: params.userAddress,
      }),
    });
    return response.json();
  },
  async swap(params) {
    const response = await fetch("https://api.bitget.com/v1/mix/market/swap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chainId: params.chainId,
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn,
        slippage: params.slippage,
        userAddress: params.userAddress,
        market: params.market,
      }),
    });
    return response.json();
  },
};

// EVM chain interaction adapter (for BitgetRouter)
const evmChainAdapter: EvmChainAdapter = {
  async sendTransaction(params) {
    // Use your EVM wallet or provider to send transaction
    // Return { status: "success", txHash: "..." } or { status: "failed", message: "..." }
  },
  async getBalance(params) {
    // Optional: Get token balance (for ERC20) or native balance (if tokenAddress is undefined)
    // Return balance as string
  },
  async getAllowance(params) {
    // Optional: Get ERC20 token allowance
    // Return allowance as string
  },
  async approve(params) {
    // Optional: Approve ERC20 token spending
    // Return { status: "success", txHash: "..." } or { status: "failed", message: "..." }
  },
  async getSigner() {
    // Optional: Get ethers signer for gas estimation
    // Return ethers.Signer instance
  },
};

// Configuration adapter
const configAdapter: ConfigAdapter = {
  getRefExchangeId: () => "v2.ref-finance.near",
  getWrapNearContractId: () => "wrap.near",
  getFindPathUrl: () => "https://smartrouter.ref.finance",
  getTokenStorageDepositRead: () => "1250000000000000000000",
  getAggregateDexContractId: () => "aggregate-dex-contract.near", // For V2 Router
  getEvmNativeWrappedTokenAddress: () => "0x4200000000000000000000000000000000000006", // Optional: WETH address for EVM chains
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

#### Using BitgetRouter (EVM)

```typescript
import { BitgetRouter } from "@rhea-finance/cross-chain-aggregation-dex";

const evmRouter = new BitgetRouter({
  bitgetAdapter,
  evmChainAdapter,
  chainId: 1, // Ethereum mainnet (1), BSC (56), Polygon (137), Base (8453), etc.
});
```

### 3. Get Quote

#### Using NearSmartRouter (V1)

```typescript
import { TokenInfo } from "@rhea-finance/cross-chain-aggregation-dex";

// NEAR tokens
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

// EVM tokens (for BitgetRouter)
const evmTokenIn: TokenInfo = {
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC on Ethereum
  symbol: "USDC",
  decimals: 6,
  chain: "evm",
};

const evmTokenOut: TokenInfo = {
  address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", // USDT on Ethereum
  symbol: "USDT",
  decimals: 6,
  chain: "evm",
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

#### Using BitgetRouter (EVM)

```typescript
// EVM Router - Requires sender and recipient
const quote = await evmRouter.quote({
  tokenIn: evmTokenIn,
  tokenOut: evmTokenOut,
  amountIn: "1000000", // 1 USDC (6 decimals)
  slippage: 50, // 0.5% (50 basis points)
  swapType: "EXACT_INPUT",
  sender: "0x...", // Required for EVM Router
  recipient: "0x...", // Required for EVM Router (can be same as sender)
});

if (quote.success) {
  console.log("Amount out:", quote.amountOut);
  console.log("Min amount out:", quote.minAmountOut);
  console.log("Router message:", quote.routerMsg);
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

#### Using BitgetRouter (EVM)

```typescript
// EVM Router - Requires sender and receiveUser
const result = await evmRouter.executeSwap({
  quote,
  sender: "0x...", // Required for EVM Router
  receiveUser: "0x...", // Required for EVM Router (usually depositAddress)
  recipient: "0x...", // Optional, kept for compatibility
});

if (result.success) {
  console.log("Transaction hash:", result.txHash);
  console.log("Transaction hashes:", result.txHashArray);
} else {
  console.error("Swap failed:", result.error);
}
```

> **Note**: EVM Router automatically checks token balance and approval before executing. If approval is insufficient, it will automatically approve the token with retry mechanism.

### 5. Complete Quote (DEX Aggregator + NearIntents)

The `completeQuote` function integrates DEX aggregation with NearIntents bridge for cross-chain swaps. It automatically handles pre-swaps when needed:

```typescript
import { completeQuote } from "@rhea-finance/cross-chain-aggregation-dex";

// For NEAR chains
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

// For EVM chains
const evmBluechipTokens = {
  USDT: {
    address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", // USDT on Ethereum
    symbol: "USDT",
    decimals: 6,
    assetId: "evm:0xdAC17F958D2ee523a2206206994597C13D831ec7",
  },
  USDC: {
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC on Ethereum
    symbol: "USDC",
    decimals: 6,
    assetId: "evm:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  },
  ETH: {
    address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH on Ethereum
    symbol: "WETH",
    decimals: 18,
    assetId: "evm:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  },
};

// Using single router (NEAR chain)
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

// Using EVM router
const evmCompleteQuoteResult = await completeQuote(
  {
    sourceToken: evmTokenIn,
    targetToken: tokenOut, // Target token on destination chain
    sourceChain: "ethereum", // or "evm", "bsc", "polygon", "base", etc.
    targetChain: "near",
    amountIn: "1000000", // 1 USDC (6 decimals)
    slippage: 50,
    recipient: "user.near", // Target chain address
    refundTo: "0x...", // EVM address
    evmChainId: 1, // Optional: explicitly specify EVM chain ID (1 for Ethereum)
  },
  {
    intentsQuotationAdapter,
    dexRouter: evmRouter,
    bluechipTokens: evmBluechipTokens, // Use EVM bluechip tokens
    configAdapter,
    currentUserAddress: "0x...", // Required for EVM Router
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

### BitgetRouter (EVM)

EVM chain router implementation using Bitget DEX aggregator. Supports automatic balance checking, token approval, and gas optimization.

#### `quote(params: RecipientQuoteParams): Promise<QuoteResult>`

Get quote method that requires sender and recipient parameters.

**Parameters:**
- `tokenIn`: Input token information (EVM address)
- `tokenOut`: Output token information (EVM address)
- `amountIn`: Input amount (string format, considering decimals)
- `slippage`: Slippage tolerance (prefer bps, 50 = 0.5%)
- `swapType`: Swap type ("EXACT_INPUT" | "EXACT_OUTPUT")
- `sender`: Sender address (required, EVM address)
- `recipient`: Recipient address (required, EVM address, can be same as sender)

**Returns:**
- `success`: Whether successful
- `amountOut`: Output amount
- `minAmountOut`: Minimum output amount (considering slippage)
- `routerMsg`: Router message for execution (required for executeSwap)
- `error`: Error message (if failed)

#### `executeSwap(params: RecipientExecuteParams): Promise<ExecuteResult>`

Execute swap method. Automatically:
- Checks token balance (for ERC20) or native balance (for native tokens)
- Checks and approves ERC20 token if needed (with retry mechanism)
- Estimates gas with buffer and EIP-1559 support
- Executes swap via Bitget aggregator

**Parameters:**
- `quote`: Quote result from `quote()` method
- `sender`: Sender address (required, EVM address)
- `receiveUser`: Recipient address, usually depositAddress (required, EVM address)
- `recipient`: Optional, kept for compatibility

**Returns:**
- `success`: Whether successful
- `txHash`: Transaction hash
- `txHashArray`: Transaction hash array (if multiple transactions)
- `error`: Error message (if failed)

#### `getCapabilities(): RouterCapabilities`

Returns router capabilities:
- `requiresRecipient`: true
- `requiresFinalizeQuote`: false
- `requiresComplexRegistration`: false
- `supportedChain`: "evm"

#### `getSupportedChain(): "evm"`

Returns the supported chain identifier.

#### `getChainId(): number`

Returns the EVM chain ID (e.g., 1 for Ethereum, 56 for BSC, 137 for Polygon, 8453 for Base).

### completeQuote

Complete quote function that integrates DEX Aggregator and NearIntents.

**Parameters:**
- `sourceToken`: Source token information
- `targetToken`: Target token information
- `sourceChain`: Source chain identifier ("near", "evm", "ethereum", "bsc", "polygon", "base", etc.)
- `targetChain`: Target chain identifier (e.g., "bsc", "ethereum", "near")
- `amountIn`: Input amount (string format)
- `slippage`: Slippage tolerance (prefer bps, 50 = 0.5%)
- `recipient`: Recipient address on target chain
- `refundTo`: Refund address (optional, defaults to recipient)
- `evmChainId`: Optional EVM chain ID for precise chain identification (e.g., 1 for Ethereum, 56 for BSC)

**Configuration:**
- `intentsQuotationAdapter`: NearIntents quotation adapter
- `dexRouter`: Single DEX Router instance (optional, use `dexRouters` for multiple)
- `dexRouters`: Array of DEX Router instances (optional, use `dexRouter` for single)
- `bluechipTokens`: Bluechip tokens configuration (USDT, USDC, NEAR for NEAR chains; USDT, USDC, ETH for EVM chains)
- `configAdapter`: Configuration adapter (with optional `getEvmNativeWrappedTokenAddress` for EVM chains)
- `currentUserAddress`: Current user address (required for V2 Router and EVM Router)

**Returns:**
- `intents`: NearIntents quote result with depositAddress
- `preSwap`: Pre-swap information (if source token is not bluechip)
  - `quote`: Pre-swap quote result
  - `tokenIn`: Source token
  - `tokenOut`: Bluechip token
  - `executor`: Router instance to execute pre-swap
- `finalAmountOut`: Final output amount after NearIntents bridge

## Router Comparison

| Feature | NearSmartRouter (V1) | AggregateDexRouter (V2) | BitgetRouter (EVM) |
|---------|---------------------|-------------------------|-------------------|
| Chain | NEAR | NEAR | EVM (Ethereum, BSC, Polygon, Base, etc.) |
| API | FindPath | swapMultiDexPath | Bitget DEX Aggregator |
| Execution | REF Finance | Aggregate DEX Contract | Direct EVM Transaction |
| Recipient Required | No | Yes (sender + recipient) | Yes (sender + recipient) |
| Auto Registration | Basic (recipient only) | Advanced (user, receiveUser, contract) | N/A (EVM) |
| Auto Approval | N/A (NEAR) | N/A (NEAR) | Yes (ERC20 with retry) |
| Balance Check | No | No | Yes (automatic) |
| Gas Optimization | N/A (NEAR) | N/A (NEAR) | Yes (EIP-1559 support) |
| Multi-DEX Support | Via FindPath | Native multi-DEX aggregation | Via Bitget Aggregator |
| NEAR → wNEAR | Manual | Automatic | N/A (EVM) |
| Use Case | Simple swaps on NEAR | Complex swaps on NEAR, cross-chain | EVM chain swaps, cross-chain |

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

Check if a token is supported by NearIntents on NEAR chains (matches bluechip token configuration).

```typescript
import { isNearIntentsSupportedToken } from "@rhea-finance/cross-chain-aggregation-dex";

const isSupported = isNearIntentsSupportedToken(tokenIn, bluechipTokens);
```

### `normalizeEvmAddress(address: string): string`

Normalize EVM address to lowercase format for comparison.

```typescript
import { normalizeEvmAddress } from "@rhea-finance/cross-chain-aggregation-dex";

normalizeEvmAddress("0xABC..."); // "0xabc..." (lowercase)
```

### `isEvmIntentsSupportedToken(token: TokenInfo, bluechipTokens?: BluechipTokensConfig): boolean`

Check if a token is supported by NearIntents on EVM chains (matches bluechip token configuration).

```typescript
import { isEvmIntentsSupportedToken } from "@rhea-finance/cross-chain-aggregation-dex";

const isSupported = isEvmIntentsSupportedToken(evmTokenIn, evmBluechipTokens);
```

### `findBestEvmBluechipToken(bluechipTokens: BluechipTokensConfig, nativeTokenAddress?: string): TokenInfo`

Find the best bluechip token for EVM chains (priority order: USDT > USDC > ETH/WETH).

```typescript
import { findBestEvmBluechipToken } from "@rhea-finance/cross-chain-aggregation-dex";

const evmBluechipTokens = {
  USDT: { address: "0x...", symbol: "USDT", decimals: 6 },
  USDC: { address: "0x...", symbol: "USDC", decimals: 6 },
  ETH: { address: "0x...", symbol: "WETH", decimals: 18 },
};

const bestToken = findBestEvmBluechipToken(evmBluechipTokens, "0x..."); // Optional WETH address
// Returns USDT if available, otherwise USDC, otherwise ETH/WETH
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
- `BluechipTokensConfig`: Configuration for bluechip tokens (USDT, USDC, NEAR for NEAR chains; USDT, USDC, ETH for EVM chains)
- `BitgetAdapter`: Adapter interface for Bitget DEX aggregator API
- `EvmChainAdapter`: Adapter interface for EVM chain interactions (sendTransaction, getBalance, approve, etc.)

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
