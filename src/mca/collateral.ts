import { SwapSdkError } from "../core/errors";
import type { McaWithdrawCollateral } from "./types";

export interface ResolveMcaWithdrawPolicyInput {
  collateralBalance: string;
  availableBalance: string;
  amountIn: string;
  isMax: boolean;
}

interface DecimalParts {
  digits: bigint;
  scale: number;
}

export function resolveMcaWithdrawPolicy(
  input: ResolveMcaWithdrawPolicyInput
): McaWithdrawCollateral & { withdrawAll: boolean } {
  const collateral = parseDecimal(input.collateralBalance, "collateralBalance");
  const available = parseDecimal(input.availableBalance, "availableBalance");
  const amount = parseDecimal(input.amountIn, "amountIn");
  const needDecrease = collateral.digits > 0n;

  return {
    needDecrease,
    decreaseAmountBurrow: needDecrease
      ? input.collateralBalance.trim()
      : "0",
    withdrawAll:
      input.isMax ||
      (available.digits > 0n && isAtLeastWithdrawAllThreshold(amount, available)),
  };
}

function isAtLeastWithdrawAllThreshold(
  amount: DecimalParts,
  available: DecimalParts
): boolean {
  const [amountScaled, availableScaled] = alignScale(amount, available);
  return amountScaled * 1_000_000n >= availableScaled * 999_999n;
}

function alignScale(a: DecimalParts, b: DecimalParts): [bigint, bigint] {
  const scale = Math.max(a.scale, b.scale);
  return [
    a.digits * pow10(scale - a.scale),
    b.digits * pow10(scale - b.scale),
  ];
}

function parseDecimal(value: string, field: string): DecimalParts {
  const trimmed = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) {
    throw new SwapSdkError(
      "INVALID_REQUEST",
      "quote",
      `${field} must be a non-negative decimal string`
    );
  }
  const [integer = "0", fraction = ""] = trimmed.split(".");
  return {
    digits: BigInt(`${integer}${fraction}`),
    scale: fraction.length,
  };
}

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}
