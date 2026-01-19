/**
 * Router registry
 * Used to get the corresponding DEX Router based on chain
 */

import type { DexRouter, SupportedChain } from "./types";

/**
 * Get the aggregated DEX Router for a specific chain.
 * Currently only Near is implemented; to add more chains, just add new implementations and register here.
 */
export function getDexRouter(
  chain: SupportedChain | string,
  router: DexRouter | null
): DexRouter | null {
  if (chain === "near" && router) {
    return router;
  }
  return null;
}
