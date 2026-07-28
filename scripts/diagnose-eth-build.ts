import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { SwapClient } from "../src/index";

function loadEnv(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!(k in process.env) || !process.env[k]) process.env[k] = v;
  }
}

loadEnv(resolve(process.cwd(), "../rhea-perf-monitor/.env"));
const agent = new ProxyAgent(process.env.HTTPS_PROXY!);
const f = ((input: any, init?: any) =>
  undiciFetch(input, { ...init, dispatcher: agent })) as typeof fetch;

const client = new SwapClient({
  baseUrl: "https://api.rhea.finance",
  getAccessToken: () => process.env.RHEA_ACCESS_TOKEN!,
  fetch: f,
  timeoutMs: 45_000,
  retry: { maxRetries: 0 },
});

const req = {
  fromChain: "1" as const,
  toChain: "1" as const,
  tokenIn: {
    chain: "1" as const,
    address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    symbol: "USDC",
    decimals: 6,
  },
  tokenOut: {
    chain: "1" as const,
    address: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    symbol: "USDT",
    decimals: 6,
  },
  amountIn: "25000000",
  slippageBps: 50,
  sender: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  recipient: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
};

async function main() {
  const quote = await client.quote(req);
  console.log("quote ok", quote.route.router, quote.estimatedOut);

  try {
    const build = await client.buildSwap({ quote });
    console.log("build ok", build.execution.kind);
  } catch (e: any) {
    console.log("code", e.code, "msg", e.message);
    console.log("details", JSON.stringify(e.details, null, 2)?.slice(0, 4000));
    console.log(
      "cause",
      e.cause?.issues ? JSON.stringify(e.cause.issues, null, 2) : e.cause
    );

    const ctx = quote.buildContext;
    const raw = await client.buildRaw({
      ...ctx.request,
      router: ctx.router,
      market: ctx.market,
      expectedOut: ctx.expectedOut,
      minAmountOut: ctx.minAmountOut,
      preSwap: ctx.preSwap,
      bridge: ctx.bridge,
      quoteId: ctx.quoteId,
    });
    console.log("raw keys", Object.keys(raw));
    console.log("chainType", raw.chainType, "executionType", raw.executionType);
    console.log("needsApprove", raw.needsApprove);
    console.log("tx", JSON.stringify(raw.tx, null, 2)?.slice(0, 2000));
    console.log("approve", JSON.stringify(raw.approve, null, 2)?.slice(0, 1200));
    console.log("tokenIn", raw.tokenIn);
    console.log("tokenOut", raw.tokenOut);
    console.log("amounts", {
      amountIn: raw.amountIn,
      estimatedOut: raw.estimatedOut,
      minAmountOut: raw.minAmountOut,
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
