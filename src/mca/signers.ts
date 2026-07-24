import { SwapSdkError } from "../core/errors";
import type {
  McaSignerChain,
  McaSignerIdentity,
} from "./types";

export type McaWalletKey =
  | "EVM"
  | "Solana"
  | "Bitcoin"
  | "Near"
  | "Aptos"
  | "Sui"
  | "Zcash"
  | "Tron";

export type McaWalletDescriptor = Partial<Record<McaWalletKey, string>>;

export const DEFAULT_MCA_SIGNER_PRIORITY = [
  "evm",
  "solana",
  "btc",
  "aptos",
  "near",
  "zcash",
  "sui",
  "tron",
] as const satisfies readonly McaSignerChain[];

const WALLET_KEYS: Record<McaSignerChain, McaWalletKey> = {
  evm: "EVM",
  solana: "Solana",
  btc: "Bitcoin",
  near: "Near",
  aptos: "Aptos",
  sui: "Sui",
  zcash: "Zcash",
  tron: "Tron",
};

export function formatMcaWallet(
  chain: McaSignerChain,
  identityKey: string
): McaWalletDescriptor {
  const identity = identityKey.trim();
  if (!identity) {
    throw new SwapSdkError(
      "INVALID_REQUEST",
      "sign",
      "MCA signer identityKey is required"
    );
  }
  return {
    [WALLET_KEYS[chain]]:
      chain === "evm" ? identity.replace(/^0x/i, "") : identity,
  };
}

export function selectMcaSigner(
  boundWallets: ReadonlyArray<Readonly<Record<string, unknown>>>,
  connectedSigners: readonly McaSignerIdentity[],
  priority: readonly McaSignerChain[] = DEFAULT_MCA_SIGNER_PRIORITY
): McaSignerIdentity | undefined {
  for (const chain of priority) {
    const key = WALLET_KEYS[chain];
    const boundValues = boundWallets.flatMap((wallet) => {
      const value = wallet[key];
      return typeof value === "string" && value.trim() ? [value.trim()] : [];
    });
    if (boundValues.length === 0) continue;

    for (const signer of connectedSigners) {
      if (signer.chain !== chain) continue;
      const candidates = [signer.identityKey, signer.accountId]
        .filter((value): value is string => Boolean(value?.trim()))
        .map((value) => normalizeIdentity(chain, value));
      if (
        boundValues.some((bound) =>
          candidates.includes(normalizeIdentity(chain, bound))
        )
      ) {
        return signer;
      }
    }
  }
  return undefined;
}

export function isSameMcaSignerIdentity(
  a: Pick<McaSignerIdentity, "chain" | "identityKey">,
  b: Pick<McaSignerIdentity, "chain" | "identityKey">
): boolean {
  return (
    a.chain === b.chain &&
    normalizeIdentity(a.chain, a.identityKey) ===
      normalizeIdentity(b.chain, b.identityKey)
  );
}

function normalizeIdentity(chain: McaSignerChain, value: string): string {
  const trimmed = value.trim();
  if (chain === "evm") return trimmed.replace(/^0x/i, "").toLowerCase();
  if (chain === "sui" || chain === "aptos") return trimmed.toLowerCase();
  return trimmed;
}
