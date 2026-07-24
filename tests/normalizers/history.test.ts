import { describe, expect, it } from "vitest";
import type { SwapHistoryDataRaw } from "../../src/api/rawTypes";
import {
  normalizeHistory,
  normalizeHistoryStatus,
} from "../../src/normalizers/history";

const raw: SwapHistoryDataRaw = {
  record_list: [
    {
      id: 7,
      sender: "0xsender",
      recipient: "receiver.near",
      from_hash: "0xsource",
      to_hash: "near-destination",
      deposit_address: "deposit.near",
      from_token: "0x0000000000000000000000000000000000000000",
      to_token: "wrap.near",
      from_chain: "1",
      to_chain: "near",
      amount_in: "1000",
      estimated_out: "900",
      actual_out: "895",
      router: "nearintents",
      status: "SUCCESS",
      swap_id: "order-7",
      status_response: { state: "SUCCESS" },
      created_at: "2026-07-21 01:02:03",
      updated_at: "invalid",
    },
  ],
  page_number: 1,
  page_size: 20,
  total_page: 1,
  total_size: 1,
};

describe("normalizeHistory", () => {
  it("normalizes fields, chains, native assets, timestamps, and pagination", () => {
    expect(normalizeHistory(raw)).toEqual({
      items: [
        expect.objectContaining({
          id: "7",
          sender: "0xsender",
          recipient: "receiver.near",
          fromChain: "1",
          toChain: "near",
          tokenIn: {
            chain: "1",
            address: "0x0000000000000000000000000000000000000000",
            isNative: true,
          },
          tokenOut: {
            chain: "near",
            address: "wrap.near",
            isNative: true,
          },
          sourceTxHash: "0xsource",
          destinationTxHash: "near-destination",
          orderId: "order-7",
          status: "completed",
          createdAt: "2026-07-21T01:02:03.000Z",
          statusResponse: { state: "SUCCESS" },
          raw: raw.record_list[0],
        }),
      ],
      page: 1,
      pageSize: 20,
      totalPages: 1,
      totalItems: 1,
    });
    expect(normalizeHistory(raw).items[0]).not.toHaveProperty("updatedAt");
  });

  it.each([
    ["PENDING", "pending"],
    ["CREATED", "pending"],
    ["PROCESSING", "processing"],
    ["IN_PROGRESS", "processing"],
    ["FAILED", "failed"],
    ["REFUNDED", "refunded"],
    ["EXPIRED", "expired"],
    ["mystery", "unknown"],
    [undefined, "unknown"],
  ] as const)("normalizes %s to %s", (input, expected) => {
    expect(normalizeHistoryStatus(input)).toBe(expected);
  });

  it("keeps a non-string recipient only in raw", () => {
    const page = normalizeHistory({
      ...raw,
      record_list: [{ ...raw.record_list[0]!, recipient: { memo: 1 } }],
    });
    expect(page.items[0]).not.toHaveProperty("recipient");
    expect(page.items[0]?.raw.recipient).toEqual({ memo: 1 });
  });

  it("normalizes raw chain aliases without leaking them", () => {
    const page = normalizeHistory({
      ...raw,
      record_list: [
        {
          ...raw.record_list[0]!,
          from_chain: "0x1",
          to_chain: "sol",
          to_token: "So11111111111111111111111111111111111111112",
        },
      ],
    });

    expect(page.items[0]).toMatchObject({
      fromChain: "1",
      toChain: "solana",
      tokenIn: { chain: "1" },
      tokenOut: { chain: "solana", isNative: true },
    });
  });
});
