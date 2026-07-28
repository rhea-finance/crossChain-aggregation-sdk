/**
 * Live validation: fetch documented token list → quote (+ optional build)
 * for all product chains / mainstream tokens, and assert responses normalize
 * to the SDK Quote / SwapBuild shapes.
 *
 * Usage:
 *   RHEA_ACCESS_TOKEN=... pnpm exec tsx scripts/validate-live-shapes.ts
 *   # or load sibling rhea-perf-monitor/.env automatically when present
 *
 * Flags:
 *   --build          also call buildSwap() after a successful quote
 *   --per-chain=N    max mainstream tokens kept per chain (default 3)
 *   --max-pairs=N    cap total quote pairs (default 80)
 *   --amount-usd=N   notional per quote (default 25)
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  fetch as undiciFetch,
  ProxyAgent,
  type RequestInit as UndiciRequestInit,
} from "undici";
import {
  SwapClient,
  SwapSdkError,
  asSwapSdkError,
  parseUnits,
  type AssetRef,
  type ChainRef,
  type Quote,
  type QuoteRequest,
  type SwapBuild,
} from "../src/index";

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env) || !process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(resolve(process.cwd(), ".env"));
loadEnvFile(resolve(process.cwd(), "../rhea-perf-monitor/.env"));

const BASE_URL = process.env.RHEA_BASE_URL ?? "https://api.rhea.finance";
const TOKEN_CHAINS =
  "bsc,eth,arb,base,op,bera,monad,xlayer,pol,gnosis,plasma,sol,btc,near,zcash,zec,aptos,tron,sui";

function resolveProxyUrl(): string | undefined {
  for (const key of [
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "http_proxy",
    "ALL_PROXY",
    "all_proxy",
  ] as const) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function createFetch(): typeof fetch {
  const proxy = resolveProxyUrl();
  if (!proxy) return globalThis.fetch.bind(globalThis);
  const agent = new ProxyAgent(proxy);
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    undiciFetch(input as Parameters<typeof undiciFetch>[0], {
      ...init,
      dispatcher: agent,
    } as UndiciRequestInit)) as unknown as typeof fetch;
}

const proxiedFetch = createFetch();

interface ChainInfo {
  name: string;
  chainId: ChainRef;
  alias: string;
  kind: "evm" | "non-evm";
}

const CHAINS: ChainInfo[] = [
  { name: "Ethereum", chainId: "1", alias: "eth", kind: "evm" },
  { name: "BNB Smart Chain", chainId: "56", alias: "bsc", kind: "evm" },
  { name: "Arbitrum One", chainId: "42161", alias: "arb", kind: "evm" },
  { name: "Base", chainId: "8453", alias: "base", kind: "evm" },
  { name: "Optimism", chainId: "10", alias: "op", kind: "evm" },
  { name: "Berachain", chainId: "1385", alias: "bera", kind: "evm" },
  { name: "Monad", chainId: "143", alias: "monad", kind: "evm" },
  { name: "X Layer", chainId: "196", alias: "xlayer", kind: "evm" },
  { name: "Polygon PoS", chainId: "137", alias: "pol", kind: "evm" },
  { name: "Gnosis Chain", chainId: "100", alias: "gnosis", kind: "evm" },
  { name: "Plasma", chainId: "9745", alias: "plasma", kind: "evm" },
  { name: "Solana", chainId: "solana", alias: "sol", kind: "non-evm" },
  { name: "Bitcoin", chainId: "btc", alias: "btc", kind: "non-evm" },
  { name: "NEAR", chainId: "near", alias: "near", kind: "non-evm" },
  { name: "Zcash", chainId: "zcash", alias: "zcash", kind: "non-evm" },
  { name: "Aptos", chainId: "aptos", alias: "aptos", kind: "non-evm" },
  { name: "Tron", chainId: "tron", alias: "tron", kind: "non-evm" },
  { name: "Sui", chainId: "sui", alias: "sui", kind: "non-evm" },
];

const byAlias = new Map<string, ChainInfo>(
  CHAINS.flatMap((c) =>
    c.alias === "zcash"
      ? [
          [c.alias, c],
          ["zec", c],
        ]
      : [[c.alias, c]]
  )
);

const STABLES = new Set([
  "USDC",
  "USDT",
  "USDT0",
  "USDC.E",
  "DAI",
  "USD1",
  "XDAI",
]);
const MAJORS = new Set([
  "ETH",
  "WETH",
  "BTC",
  "WBTC",
  "CBBTC",
  "SOL",
  "NEAR",
  "WNEAR",
  "BNB",
  "POL",
  "APT",
  "SUI",
  "TRX",
  "ZEC",
  "BERA",
  "MON",
  "OKB",
  "XPL",
  "GNO",
]);

const DEFAULT_SENDERS: Record<string, string> = {
  evm: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  near: "root.near",
  btc: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
  sol: "So11111111111111111111111111111111111111112",
  aptos: "0x1",
  tron: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
  sui: "0x1",
  zcash: "t1VndJ6PvutS7gjLeduJk2gQcqTzxJ2gcgT",
};

interface RawToken {
  assetId?: string;
  blockchain?: string;
  symbol?: string;
  decimals?: number;
  contractAddress?: string | null;
  price?: number | string;
}

interface SelectedToken {
  alias: string;
  asset: AssetRef;
  symbol: string;
  priceUsd: number | null;
  isStable: boolean;
}

interface Pair {
  label: string;
  tokenIn: SelectedToken;
  tokenOut: SelectedToken;
}

type QuoteOutcome =
  | "quote-ok"
  | "quote-shape-fail"
  | "build-ok"
  | "build-shape-fail"
  | "no-route"
  | "auth"
  | "api-error"
  | "network"
  | "error";

interface CaseResult {
  label: string;
  from: string;
  to: string;
  outcome: QuoteOutcome;
  message?: string;
  quoteKind?: string;
  buildKind?: string;
  ms: number;
}

function parseArgs(argv: string[]) {
  const flags = new Set(argv.filter((a) => a.startsWith("--") && !a.includes("=")));
  const kv = Object.fromEntries(
    argv
      .filter((a) => a.startsWith("--") && a.includes("="))
      .map((a) => {
        const i = a.indexOf("=");
        return [a.slice(2, i), a.slice(i + 1)];
      })
  );
  return {
    build: flags.has("--build"),
    perChain: Number(kv["per-chain"] ?? 3),
    maxPairs: Number(kv["max-pairs"] ?? 80),
    amountUsd: Number(kv["amount-usd"] ?? 25),
  };
}

function assertQuoteShape(quote: Quote): void {
  if (!quote.fromChain || !quote.toChain) throw new Error("missing chains");
  if (!quote.tokenIn?.address || !quote.tokenOut?.address) {
    throw new Error("missing token addresses");
  }
  if (!/^(0|[1-9]\d*)$/.test(quote.amountIn)) throw new Error("bad amountIn");
  if (!/^(0|[1-9]\d*)$/.test(quote.estimatedOut)) {
    throw new Error("bad estimatedOut");
  }
  if (!/^(0|[1-9]\d*)$/.test(quote.minAmountOut)) {
    throw new Error("bad minAmountOut");
  }
  if (!quote.route?.router) throw new Error("missing route.router");
  if (!/^(0|[1-9]\d*)$/.test(quote.route.amountOut)) {
    throw new Error("bad route.amountOut");
  }
  if (!Array.isArray(quote.alternatives)) throw new Error("alternatives");
  if (!quote.buildContext?.router) throw new Error("missing buildContext");
  if (typeof quote.raw?.bestQuote !== "object" || quote.raw.bestQuote === null) {
    throw new Error("raw.bestQuote missing");
  }
  if (!Array.isArray(quote.raw.allQuotes)) throw new Error("raw.allQuotes");
  if (typeof quote.receivedAt !== "number") throw new Error("receivedAt");
}

function assertBuildShape(build: SwapBuild): void {
  if (!build.executionId) throw new Error("missing executionId");
  if (!build.execution?.kind) throw new Error("missing execution.kind");
  if (!build.fromChain || !build.toChain) throw new Error("missing chains");
  if (!/^(0|[1-9]\d*)$/.test(build.amountIn)) throw new Error("bad amountIn");
  if (!/^(0|[1-9]\d*)$/.test(build.estimatedOut)) {
    throw new Error("bad estimatedOut");
  }
  if (!/^(0|[1-9]\d*)$/.test(build.minAmountOut)) {
    throw new Error("bad minAmountOut");
  }
  if (!build.router) throw new Error("missing router");
  if (!build.tokenIn?.address || !build.tokenOut?.address) {
    throw new Error("missing token meta");
  }
  if (typeof build.isCrossChain !== "boolean") {
    throw new Error("isCrossChain");
  }
  if (!build.raw || typeof build.raw !== "object") throw new Error("raw");
}

async function fetchTokenList(): Promise<RawToken[]> {
  const url = `${BASE_URL}/get_multichain_lending_tokens_data?chains=${TOKEN_CHAINS}`;
  const res = await proxiedFetch(url);
  if (!res.ok) throw new Error(`token-list HTTP ${res.status}`);
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) throw new Error("token-list is not an array");
  return body as RawToken[];
}

function selectTokens(raw: RawToken[], perChain: number): SelectedToken[] {
  const byChain = new Map<string, SelectedToken[]>();

  for (const t of raw) {
    const alias = (t.blockchain ?? "").toLowerCase();
    const chain = byAlias.get(alias);
    if (!chain) continue;
    const symbol = (t.symbol ?? "").trim().toUpperCase();
    if (!symbol) continue;
    if (typeof t.decimals !== "number") continue;
    const isStable = STABLES.has(symbol);
    const isMajor = MAJORS.has(symbol);
    if (!isStable && !isMajor) continue;

    let address = (t.contractAddress ?? "").trim();
    // Documented native fallbacks when contractAddress is empty.
    if (!address) {
      if (chain.kind === "evm" && ["ETH", "BNB", "POL", "BERA", "MON", "OKB", "XPL", "XDAI"].includes(symbol)) {
        address = "0x0000000000000000000000000000000000000000";
      } else if (alias === "btc" && symbol === "BTC") {
        address = "btc";
      } else if (alias === "sui" && symbol === "SUI") {
        address = "0x2::sui::SUI";
      } else if (alias === "tron" && symbol === "TRX") {
        address = "trx";
      } else if ((alias === "zec" || alias === "zcash") && symbol === "ZEC") {
        address = "nep141:zec.omft.near";
      } else if (alias === "sol" && symbol === "SOL") {
        address = "So11111111111111111111111111111111111111112";
      } else if (alias === "aptos" && symbol === "APT") {
        address = "0xa";
      } else if (alias === "near" && (symbol === "NEAR" || symbol === "WNEAR")) {
        address = "wrap.near";
      } else {
        continue;
      }
    }

    const entry: SelectedToken = {
      alias: chain.alias,
      asset: {
        chain: chain.chainId,
        address,
        symbol,
        decimals: t.decimals,
        ...(address === "0x0000000000000000000000000000000000000000" ||
        address === "btc" ||
        address === "trx"
          ? { isNative: true }
          : {}),
      },
      symbol,
      priceUsd:
        typeof t.price === "number"
          ? t.price
          : Number.isFinite(Number(t.price))
            ? Number(t.price)
            : null,
      isStable,
    };

    const list = byChain.get(chain.alias) ?? [];
    list.push(entry);
    byChain.set(chain.alias, list);
  }

  const out: SelectedToken[] = [];
  for (const [alias, list] of byChain) {
    const seen = new Set<string>();
    const deduped = list.filter((e) => {
      const key = `${alias}:${e.asset.address.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    deduped.sort((a, b) => {
      if (a.isStable !== b.isStable) return a.isStable ? -1 : 1;
      const aMajor = MAJORS.has(a.symbol);
      const bMajor = MAJORS.has(b.symbol);
      if (aMajor !== bMajor) return aMajor ? -1 : 1;
      return (b.priceUsd ?? 0) - (a.priceUsd ?? 0);
    });
    out.push(...deduped.slice(0, perChain));
  }
  return out;
}

function senderFor(alias: string): string {
  const chain = byAlias.get(alias);
  const key = chain?.kind === "evm" ? "evm" : alias;
  return (
    process.env[`RHEA_SENDER_${key.toUpperCase()}`]?.trim() ||
    process.env[`RHEA_SENDER_${alias.toUpperCase()}`]?.trim() ||
    DEFAULT_SENDERS[key] ||
    DEFAULT_SENDERS.evm!
  );
}

function amountFor(token: SelectedToken, usd: number): string {
  const decimals = token.asset.decimals ?? 18;
  const price = token.priceUsd && token.priceUsd > 0 ? token.priceUsd : 1;
  const human = usd / price;
  const fixed = human.toFixed(Math.min(decimals, 8));
  const cleaned = fixed.replace(/0+$/, "").replace(/\.$/, "") || "0";
  try {
    return parseUnits(cleaned, decimals);
  } catch {
    return parseUnits("1", decimals);
  }
}

function buildPairs(tokens: SelectedToken[], maxPairs: number): Pair[] {
  const byChain = new Map<string, SelectedToken[]>();
  for (const t of tokens) {
    const list = byChain.get(t.alias) ?? [];
    list.push(t);
    byChain.set(t.alias, list);
  }

  const pairs: Pair[] = [];
  const push = (a: SelectedToken, b: SelectedToken) => {
    if (a.asset.address.toLowerCase() === b.asset.address.toLowerCase() && a.alias === b.alias) {
      return;
    }
    pairs.push({
      label: `${a.alias}:${a.symbol}->${b.alias}:${b.symbol}`,
      tokenIn: a,
      tokenOut: b,
    });
  };

  // Same-chain mainstream pairs.
  for (const list of byChain.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        push(list[i]!, list[j]!);
      }
    }
  }

  // Cross-chain: each chain ↔ near and eth hubs when possible.
  const hubs = ["near", "eth", "base", "sol"].flatMap((a) => byChain.get(a) ?? []);
  for (const [alias, list] of byChain) {
    if (hubs.some((h) => h.alias === alias)) continue;
    for (const token of list.slice(0, 2)) {
      for (const hub of hubs.slice(0, 4)) {
        push(token, hub);
        push(hub, token);
      }
    }
  }

  // Ensure every product chain appears at least once as source or dest.
  for (const chain of CHAINS) {
    const covered = pairs.some(
      (p) => p.tokenIn.alias === chain.alias || p.tokenOut.alias === chain.alias
    );
    if (covered) continue;
    const local = byChain.get(chain.alias)?.[0];
    const hub = hubs[0];
    if (local && hub) {
      push(local, hub);
      push(hub, local);
    }
  }

  // Stable preference first, then truncate.
  pairs.sort((a, b) => {
    const as = Number(a.tokenIn.isStable) + Number(a.tokenOut.isStable);
    const bs = Number(b.tokenIn.isStable) + Number(b.tokenOut.isStable);
    return bs - as;
  });

  const seen = new Set<string>();
  const unique = pairs.filter((p) => {
    if (seen.has(p.label)) return false;
    seen.add(p.label);
    return true;
  });
  return unique.slice(0, maxPairs);
}

function classifyError(err: unknown): { outcome: QuoteOutcome; message: string } {
  const sdk = err instanceof SwapSdkError ? err : asSwapSdkError(err, "quote");
  const message = sdk.message;
  if (sdk.code === "AUTH_FAILED" || /401|403|unauthorized/i.test(message)) {
    return { outcome: "auth", message };
  }
  if (sdk.code === "INVALID_API_RESPONSE") {
    return { outcome: "quote-shape-fail", message };
  }
  if (
    sdk.code === "ROUTE_NOT_FOUND" ||
    /no route|insufficient liquidity|no_route/i.test(message)
  ) {
    return { outcome: "no-route", message };
  }
  if (sdk.code === "API_ERROR") return { outcome: "api-error", message };
  if (
    sdk.code === "REQUEST_TIMEOUT" ||
    /fetch failed|ECONNRESET|network/i.test(message)
  ) {
    return { outcome: "network", message };
  }
  return { outcome: "error", message: `${sdk.code}: ${message}` };
}

async function runCase(
  client: SwapClient,
  pair: Pair,
  amountUsd: number,
  doBuild: boolean
): Promise<CaseResult> {
  const started = Date.now();
  const request: QuoteRequest = {
    fromChain: pair.tokenIn.asset.chain,
    toChain: pair.tokenOut.asset.chain,
    tokenIn: pair.tokenIn.asset,
    tokenOut: pair.tokenOut.asset,
    amountIn: amountFor(pair.tokenIn, amountUsd),
    slippageBps: 50,
    sender: senderFor(pair.tokenIn.alias),
    recipient: senderFor(pair.tokenOut.alias),
  };

  let quote: Quote;
  try {
    quote = await client.quote(request);
    assertQuoteShape(quote);
  } catch (err) {
    const classified = classifyError(err);
    // Extra shape failure when normalize threw INVALID_API_RESPONSE.
    if (
      err instanceof SwapSdkError &&
      err.code === "INVALID_API_RESPONSE"
    ) {
      return {
        label: pair.label,
        from: pair.tokenIn.alias,
        to: pair.tokenOut.alias,
        outcome: "quote-shape-fail",
        message: err.message,
        ms: Date.now() - started,
      };
    }
    if (classified.outcome === "quote-shape-fail") {
      return {
        label: pair.label,
        from: pair.tokenIn.alias,
        to: pair.tokenOut.alias,
        outcome: "quote-shape-fail",
        message: classified.message,
        ms: Date.now() - started,
      };
    }
    return {
      label: pair.label,
      from: pair.tokenIn.alias,
      to: pair.tokenOut.alias,
      outcome: classified.outcome,
      message: classified.message,
      ms: Date.now() - started,
    };
  }

  if (!doBuild) {
    return {
      label: pair.label,
      from: pair.tokenIn.alias,
      to: pair.tokenOut.alias,
      outcome: "quote-ok",
      quoteKind: quote.route.router,
      ms: Date.now() - started,
    };
  }

  try {
    const build = await client.buildSwap({ quote });
    assertBuildShape(build);
    return {
      label: pair.label,
      from: pair.tokenIn.alias,
      to: pair.tokenOut.alias,
      outcome: "build-ok",
      quoteKind: quote.route.router,
      buildKind: build.execution.kind,
      ms: Date.now() - started,
    };
  } catch (err) {
    const sdk = err instanceof SwapSdkError ? err : asSwapSdkError(err, "build");
    const outcome =
      sdk.code === "INVALID_API_RESPONSE" ? "build-shape-fail" : classifyError(err).outcome;
    return {
      label: pair.label,
      from: pair.tokenIn.alias,
      to: pair.tokenOut.alias,
      outcome: outcome === "quote-shape-fail" ? "build-shape-fail" : outcome,
      message: sdk.message,
      quoteKind: quote.route.router,
      ms: Date.now() - started,
    };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const accessToken = process.env.RHEA_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    console.error("Missing RHEA_ACCESS_TOKEN (set env or rhea-perf-monitor/.env)");
    process.exit(2);
  }

  console.log(`Proxy: ${resolveProxyUrl() ?? "direct"}`);

  const client = new SwapClient({
    baseUrl: BASE_URL,
    getAccessToken: () => accessToken,
    fetch: proxiedFetch,
    retry: { maxRetries: 1, baseDelayMs: 400, maxDelayMs: 1500, jitter: true },
    timeoutMs: 45_000,
  });

  console.log(`Fetching token list…`);
  const raw = await fetchTokenList();
  const selected = selectTokens(raw, args.perChain);
  const pairs = buildPairs(selected, args.maxPairs);

  const aliasesCovered = new Set(selected.map((t) => t.alias));
  console.log(
    `Tokens: fetched=${raw.length} selected=${selected.length} chains=${aliasesCovered.size}/18 pairs=${pairs.length} build=${args.build}`
  );
  for (const chain of CHAINS) {
    const n = selected.filter((t) => t.alias === chain.alias).length;
    console.log(`  ${chain.alias.padEnd(7)} ${String(n).padStart(2)} tokens`);
  }

  const results: CaseResult[] = [];
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i]!;
    process.stdout.write(`[${i + 1}/${pairs.length}] ${pair.label} … `);
    const result = await runCase(client, pair, args.amountUsd, args.build);
    results.push(result);
    const suffix = result.message ? ` (${result.message.slice(0, 120)})` : "";
    console.log(`${result.outcome}${suffix}`);
    // Soft pacing under ~60 rpm.
    await new Promise((r) => setTimeout(r, 1100));
  }

  const counts = new Map<QuoteOutcome, number>();
  for (const r of results) {
    counts.set(r.outcome, (counts.get(r.outcome) ?? 0) + 1);
  }

  const shapeFails = results.filter(
    (r) => r.outcome === "quote-shape-fail" || r.outcome === "build-shape-fail"
  );
  const ok = results.filter(
    (r) => r.outcome === "quote-ok" || r.outcome === "build-ok"
  );

  console.log("\n=== Summary ===");
  for (const [k, v] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }
  console.log(`  shape-ok rate (among non-no-route business): ${ok.length}/${results.length - (counts.get("no-route") ?? 0)}`);

  const missingChains = CHAINS.filter(
    (c) =>
      !results.some(
        (r) =>
          (r.from === c.alias || r.to === c.alias) &&
          (r.outcome === "quote-ok" || r.outcome === "build-ok")
      )
  ).map((c) => c.alias);
  if (missingChains.length) {
    console.log(`  chains without a successful shaped quote: ${missingChains.join(", ")}`);
  }

  if (shapeFails.length) {
    console.log("\n=== Shape mismatches (SDK definition failures) ===");
    for (const r of shapeFails) {
      console.log(`  ${r.label}: ${r.message}`);
    }
    process.exit(1);
  }

  console.log("\nNo SDK shape mismatches detected among successful normalizations.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
