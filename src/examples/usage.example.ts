/** Usage examples (non-production). */

import { NearSmartRouter } from "../chains/near/NearSmartRouter";
import { completeQuote } from "../integration/completeQuote";
import { TokenInfo, BluechipTokensConfig } from "../types";
import {
  ExampleFindPathAdapter,
  ExampleIntentsQuotationAdapter,
  ExampleNearChainAdapter,
  ExampleConfigAdapter,
} from "./adapters.example";

export async function exampleBasicQuote() {
  const findPathAdapter = new ExampleFindPathAdapter(
    "https://smartrouter.ref.finance"
  );
  const nearChainAdapter = new ExampleNearChainAdapter(null as any);
  const configAdapter = new ExampleConfigAdapter({
    refExchangeId: "v2.ref-finance.near",
    wrapNearContractId: "wrap.near",
    findPathUrl: "https://smartrouter.ref.finance",
    tokenStorageDepositRead: "1250000000000000000000",
  });

  const router = new NearSmartRouter({
    findPathAdapter,
    nearChainAdapter,
    configAdapter,
  });

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
    amountIn: "1000000000000000000", // 1 token
    slippage: 50, // 0.5%
    swapType: "EXACT_INPUT",
  });

  if (quote.success) {
    console.log("Quote success:", {
      amountOut: quote.amountOut,
      minAmountOut: quote.minAmountOut,
      routes: quote.routes,
    });
  } else {
    console.error("Quote failed:", quote.error);
  }

  return quote;
}

export async function exampleExecuteSwap() {
  const router = null as any;

  const quote = await exampleBasicQuote();

  if (!quote.success) {
    throw new Error("Quote failed");
  }

  const result = await router.executeSwap({
    quote,
    recipient: "user.near",
    depositAddress: "deposit.near", // optional
  });

  if (result.success) {
    console.log("Swap success:", {
      txHash: result.txHash,
      txHashArray: result.txHashArray,
    });
  } else {
    console.error("Swap failed:", result.error);
  }

  return result;
}

export async function exampleCompleteQuote() {
  const findPathAdapter = new ExampleFindPathAdapter(
    "https://smartrouter.ref.finance"
  );
  const intentsQuotationAdapter = new ExampleIntentsQuotationAdapter(
    "https://api.rhea.finance"
  );
  const nearChainAdapter = new ExampleNearChainAdapter(null as any);
  const configAdapter = new ExampleConfigAdapter({
    refExchangeId: "v2.ref-finance.near",
    wrapNearContractId: "wrap.near",
    findPathUrl: "https://smartrouter.ref.finance",
  });

  const router = new NearSmartRouter({
    findPathAdapter,
    nearChainAdapter,
    configAdapter,
  });

  const bluechipTokens: BluechipTokensConfig = {
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
      assetId:
        "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    },
    NEAR: {
      address: "wrap.near",
      symbol: "wNEAR",
      decimals: 24,
      assetId: "nep141:wrap.near",
    },
  };

  const sourceToken: TokenInfo = {
    address: "some-token.near",
    symbol: "SOMETOKEN",
    decimals: 18,
    chain: "near",
  };

  const targetToken: TokenInfo = {
    address: "nep141:bsc-0x...omft.near",
    symbol: "USDC",
    decimals: 18,
    chain: "bsc",
  };

  const completeQuoteResult = await completeQuote(
    {
      sourceToken,
      targetToken,
      sourceChain: "near",
      targetChain: "bsc",
      amountIn: "1000000000000000000",
      slippage: 50,
      recipient: "0x...", // BSC address
      refundTo: "user.near",
    },
    {
      intentsQuotationAdapter,
      dexRouter: router,
      bluechipTokens,
      configAdapter,
    }
  );

  console.log("Complete quote result:", {
    depositAddress: completeQuoteResult.intents.depositAddress,
    finalAmountOut: completeQuoteResult.finalAmountOut,
    needsPreSwap: !!completeQuoteResult.preSwap,
    preSwapQuote: completeQuoteResult.preSwap?.quote,
  });

  return completeQuoteResult;
}
