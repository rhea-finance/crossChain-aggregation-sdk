import { describe, expect, it } from "vitest";
import {
  buildOrderStatusQuery,
  orderStatusParamsFromHistoryItem,
  resolveOrderStatusLookup,
  resolveSwapReportRecordId,
  shouldPollSwapOrderStatus,
} from "../../src/utils/orderStatus";

describe("orderStatus utils", () => {
  it("prefers report record id in order-status queries", () => {
    expect(
      buildOrderStatusQuery({
        recordId: 42,
        orderId: "order-1",
        router: "nearintents",
        chainId: 1,
      })
    ).toEqual({ recordId: "42", router: "nearintents" });
  });

  it("falls back to order id and router when record id is absent", () => {
    expect(
      buildOrderStatusQuery({
        orderId: "order-1",
        router: "cow",
        chainId: 56,
      })
    ).toEqual({ orderId: "order-1", router: "cow", chainId: 56 });
  });

  it("does not query status by transaction hash", () => {
    expect(
      buildOrderStatusQuery({
        txHash: "0xabc",
        router: "nearintents",
      })
    ).toEqual({});
  });

  it("extracts report record id", () => {
    expect(resolveSwapReportRecordId({ id: 7, from_hash: "0x1" })).toBe("7");
    expect(resolveSwapReportRecordId({ recordId: "8" })).toBe("8");
    expect(resolveSwapReportRecordId({ record_id: 9 })).toBe("9");
    expect(resolveSwapReportRecordId(null)).toBe("");
  });

  it("maps history items to record id status queries", () => {
    expect(
      orderStatusParamsFromHistoryItem({
        id: "15",
        orderId: "legacy-order",
        router: "nearintents",
        sourceTxHash: "0xlegacy",
      })
    ).toEqual({ recordId: "15", router: "nearintents" });
  });

  it("polls order status for cross-chain source-confirmed waits", () => {
    expect(
      shouldPollSwapOrderStatus({
        waitFor: "source-confirmed",
        isCrossChain: true,
      })
    ).toBe(true);
    expect(
      shouldPollSwapOrderStatus({
        waitFor: "submitted",
        isCrossChain: true,
      })
    ).toBe(false);
  });

  it("polls order status whenever report returned a record id", () => {
    expect(
      shouldPollSwapOrderStatus({
        waitFor: "submitted",
        isCrossChain: false,
        reportRecordId: "3201",
      })
    ).toBe(true);
  });

  it("resolves lookup priority recordId > orderId", () => {
    expect(
      resolveOrderStatusLookup({
        recordId: "9",
        orderId: "order-1",
        router: "nearintents",
      })
    ).toEqual({ recordId: "9", router: "nearintents" });
  });
});
