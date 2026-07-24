import { z } from "zod";

export const decimalStringSchema = z.string().regex(/^(0|[1-9]\d*)$/);
export const nonEmptyStringSchema = z.string().trim().min(1);
export const hexDataSchema = z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/);
export const positiveIntegerSchema = z.number().int().positive();

const evmQuantitySchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*|0x[0-9a-fA-F]+)$/)
  .transform((value) =>
    value.startsWith("0x") ? BigInt(value).toString() : value,
  );

export const evmTxSchema = z.object({
  to: nonEmptyStringSchema,
  data: hexDataSchema,
  value: evmQuantitySchema,
  gasLimit: evmQuantitySchema,
  chainId: positiveIntegerSchema,
});
