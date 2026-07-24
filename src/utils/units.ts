import { SwapSdkError } from "../core/errors";
import { assertBaseUnitAmount, type BaseUnitAmount } from "../types/chain";

const HUMAN_AMOUNT = /^(0|[1-9]\d*)(?:\.(\d+))?$/;
const MAX_DECIMALS = 255;

export function parseUnits(value: string, decimals: number): BaseUnitAmount {
  assertDecimals(decimals);
  const match = HUMAN_AMOUNT.exec(value);
  if (!match) {
    throw invalid(`Invalid human-readable amount: ${value}`);
  }
  const whole = match[1]!;
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw invalid(
      `Amount has ${fraction.length} fractional digits but token supports ${decimals}`
    );
  }
  const combined = `${whole}${fraction.padEnd(decimals, "0")}`;
  return (combined.replace(/^0+(?=\d)/, "") || "0") as BaseUnitAmount;
}

export function formatUnits(value: BaseUnitAmount, decimals: number): string {
  assertDecimals(decimals);
  const amount = assertBaseUnitAmount(value);
  if (decimals === 0) return amount;

  const padded = amount.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function assertDecimals(decimals: number): void {
  if (
    !Number.isSafeInteger(decimals) ||
    decimals < 0 ||
    decimals > MAX_DECIMALS
  ) {
    throw invalid(`Invalid token decimals: ${String(decimals)}`);
  }
}

function invalid(message: string): SwapSdkError {
  return new SwapSdkError("INVALID_REQUEST", "quote", message);
}
