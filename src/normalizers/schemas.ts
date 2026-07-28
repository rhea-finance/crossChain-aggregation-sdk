import { z } from "zod";

export const decimalStringSchema = z.string().regex(/^(0|[1-9]\d*)$/);
export const nonEmptyStringSchema = z.string().trim().min(1);
export const hexDataSchema = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/);
export const positiveIntegerSchema = z.number().int().positive();

export const evmChainIdSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim();
  if (!/^(?:[1-9]\d*|0x[0-9a-fA-F]+)$/.test(normalized)) {
    return value;
  }
  try {
    const parsed = BigInt(normalized);
    return parsed <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(parsed)
      : value;
  } catch {
    return value;
  }
}, z.number().int().positive().max(Number.MAX_SAFE_INTEGER));

const evmQuantitySchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*|0x[0-9a-fA-F]+)$/)
  .transform((value) =>
    value.startsWith("0x") ? BigInt(value).toString() : value,
  );

/** API may return null for optional EVM quantity fields such as gasLimit. */
export const optionalEvmQuantitySchema = z.preprocess(
  (value) => (value === null || value === undefined || value === "" ? undefined : value),
  evmQuantitySchema.optional()
);

export const evmTxSchema = z.object({
  to: nonEmptyStringSchema,
  data: hexDataSchema,
  value: evmQuantitySchema,
  gasLimit: optionalEvmQuantitySchema,
  gasPrice: optionalEvmQuantitySchema,
  maxFeePerGas: optionalEvmQuantitySchema,
  maxPriorityFeePerGas: optionalEvmQuantitySchema,
  from: nonEmptyStringSchema.optional(),
  chainId: evmChainIdSchema,
});
