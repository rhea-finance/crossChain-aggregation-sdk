import { SwapSdkError } from "../core/errors";
import type { McaWithdrawCollateral } from "./types";

export interface ResolveMcaWithdrawPolicyInput {
  /** Requested withdraw amount in Burrow internal decimals. */
  amountBurrow: string;
  /** Current supplied balance for the token in Burrow internal decimals. */
  suppliedBalance: string;
  availableBalance: string;
  /** Human/display withdraw amount, in the same precision as availableBalance. */
  amountIn: string;
  isMax: boolean;
}

interface DecimalParts {
  digits: bigint;
  scale: number;
}

export function resolveMcaWithdrawPolicy(
  input: ResolveMcaWithdrawPolicyInput
): McaWithdrawCollateral & { needDecrease: boolean; withdrawAll: boolean } {
  const decreaseCollateral = resolveMcaRequiredCollateralDecrease({
    amountBurrow: input.amountBurrow,
    suppliedBalance: input.suppliedBalance,
  });
  const available = parseDecimal(input.availableBalance, "availableBalance");
  const amount = parseDecimal(input.amountIn, "amountIn");

  return {
    ...decreaseCollateral,
    withdrawAll:
      input.isMax ||
      (available.digits > 0n && isAtLeastWithdrawAllThreshold(amount, available)),
  };
}

export interface ResolveMcaRequiredCollateralDecreaseInput {
  amountBurrow: string;
  suppliedBalance: string;
}

/**
 * Matches Lending Withdraw and multi-chain-lending's 2026-08-20 hotfix:
 * only the part of the requested withdraw that exceeds supplied balance must
 * be removed from collateral.
 */
export function resolveMcaRequiredCollateralDecrease(
  input: ResolveMcaRequiredCollateralDecreaseInput
): Pick<McaWithdrawCollateral, "needDecrease" | "decreaseAmountBurrow"> & {
  needDecrease: boolean;
} {
  const amount = parseBurrowDecimal(input.amountBurrow, "amountBurrow");
  const supplied = parseBurrowDecimal(
    input.suppliedBalance,
    "suppliedBalance"
  );
  const [amountScaled, suppliedScaled] = alignScale(amount, supplied);
  const decreaseScaled =
    amountScaled > suppliedScaled ? amountScaled - suppliedScaled : 0n;
  return resolveParsedMcaDecreaseCollateral({
    digits: decreaseScaled,
    scale: Math.max(amount.scale, supplied.scale),
  });
}

/**
 * Derive needDecreaseCollateral from an already-computed required decrease and
 * serialize it in canonical, non-exponential decimal form.
 */
export function resolveMcaDecreaseCollateral(
  decreaseAmountBurrow: string,
  field = "decreaseAmountBurrow"
): Pick<McaWithdrawCollateral, "needDecrease" | "decreaseAmountBurrow"> & {
  needDecrease: boolean;
} {
  const parsed = parseBurrowDecimal(decreaseAmountBurrow, field);
  return resolveParsedMcaDecreaseCollateral(parsed);
}

function resolveParsedMcaDecreaseCollateral(
  parsed: DecimalParts
): Pick<McaWithdrawCollateral, "needDecrease" | "decreaseAmountBurrow"> & {
  needDecrease: boolean;
} {
  const needDecrease = parsed.digits > 0n;
  return {
    needDecrease,
    decreaseAmountBurrow: needDecrease ? formatDecimal(parsed) : "0",
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

function parseBurrowDecimal(value: string, field: string): DecimalParts {
  const trimmed = value.trim();
  const match = /^(?:([0-9]+)(?:\.([0-9]*))?|\.([0-9]+))(?:[eE]([+-]?[0-9]+))?$/.exec(
    trimmed
  );
  if (!match) {
    throw new SwapSdkError(
      "INVALID_REQUEST",
      "quote",
      `${field} must be a non-negative decimal string`
    );
  }

  const integer = match[1] ?? "0";
  const fraction = match[2] ?? match[3] ?? "";
  const exponent = Number(match[4] ?? "0");
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100_000) {
    throw new SwapSdkError(
      "INVALID_REQUEST",
      "quote",
      `${field} exponent is out of range`
    );
  }

  let digits = BigInt(`${integer}${fraction}` || "0");
  let scale = fraction.length - exponent;
  if (scale < 0) {
    digits *= pow10(-scale);
    scale = 0;
  }
  return { digits, scale };
}

function formatDecimal(value: DecimalParts): string {
  if (value.digits === 0n) return "0";
  if (value.scale === 0) return value.digits.toString();

  const padded = value.digits.toString().padStart(value.scale + 1, "0");
  const splitAt = padded.length - value.scale;
  const integer = padded.slice(0, splitAt);
  const fraction = padded.slice(splitAt).replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : integer;
}

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}
