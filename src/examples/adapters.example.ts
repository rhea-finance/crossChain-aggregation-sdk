/**
 * Adapter implementation examples
 * This file demonstrates how to implement various adapter interfaces
 */

import {
  FindPathAdapter,
  IntentsQuotationAdapter,
  NearChainAdapter,
  ConfigAdapter,
  FindPathResponse,
  IntentsQuoteResult,
} from "../adapters/types";

/**
 * FindPath API adapter example
 */
export class ExampleFindPathAdapter implements FindPathAdapter {
  private findPathUrl: string;

  constructor(findPathUrl: string) {
    this.findPathUrl = findPathUrl;
  }

  async findPath(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    slippage: number;
    supportLedger?: boolean;
  }): Promise<FindPathResponse> {
    const urlParams = new URLSearchParams({
      amountIn: params.amountIn,
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      pathDeep: String(params.supportLedger ? 1 : 2),
      slippage: String(params.slippage),
    });

    const url = `${this.findPathUrl}/findPath?${urlParams.toString()}`;

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = (await response.json()) as FindPathResponse;
      return data;
    } catch (error: any) {
      console.error("FindPath request failed:", error);
      return {
        result_code: 1007,
        result_message: error?.message || "internal error",
        result_data: null,
      };
    }
  }
}

/**
 * NearIntents quotation adapter example
 */
export class ExampleIntentsQuotationAdapter
  implements IntentsQuotationAdapter
{
  private apiUrl: string;

  constructor(apiUrl: string) {
    this.apiUrl = apiUrl;
  }

  async quote(params: {
    originAsset: string;
    destinationAsset: string;
    amount: string;
    refundTo: string;
    recipient: string;
    slippageTolerance: number;
    swapType?: "EXACT_INPUT" | "EXACT_OUTPUT" | "FLEX_INPUT";
    [key: string]: any;
  }): Promise<IntentsQuoteResult> {
    try {
      const response = await fetch(`${this.apiUrl}/intents/quote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          originAsset: params.originAsset,
          destinationAsset: params.destinationAsset,
          amount: params.amount,
          refundTo: params.refundTo,
          recipient: params.recipient,
          slippageTolerance: params.slippageTolerance,
          swapType: params.swapType,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = (await response.json()) as IntentsQuoteResult;
      return data;
    } catch (error: any) {
      console.error("Intents quotation failed:", error);
      return {
        quoteStatus: "error",
        message: error?.message || "Unknown error",
      };
    }
  }
}

/**
 * Near chain interaction adapter example (using near-api-js)
 */
export class ExampleNearChainAdapter implements NearChainAdapter {
  private _account: any; // near-api-js Account instance

  constructor(account: any) {
    this._account = account;
    void this._account;
  }

  async call(params: {
    transactions: Array<{
      contractId: string;
      methodName: string;
      args: any;
      gas?: string;
      expandDeposit?: string;
    }>;
  }): Promise<{
    status: "success" | "error";
    txHash?: string;
    txHashArr?: string[];
    message?: string;
  }> {
    try {
      // Here you need to call contracts based on your Near wallet implementation
      // Example uses near-api-js
      const _actions = params.transactions.map((tx) => {
        if (tx.methodName === "ft_transfer_call") {
          // Use near-api-js's ftTransferCall
          // This is just an example, actual implementation depends on your wallet library
          return {
            type: "FunctionCall",
            params: {
              methodName: tx.methodName,
              args: tx.args,
              gas: tx.gas || "250000000000000",
              deposit: tx.expandDeposit || "1",
            },
          };
        } else if (tx.methodName === "storage_deposit") {
          return {
            type: "FunctionCall",
            params: {
              methodName: tx.methodName,
              args: tx.args,
              gas: tx.gas || "50000000000000",
              deposit: tx.expandDeposit || "1250000000000000000000",
            },
          };
        }
        // Other methods...
        return null;
      });
      void _actions;

      // Execute transaction
      // const result = await this.account.signAndSendTransaction({
      //   receiverId: params.transactions[0].contractId,
      //   actions: actions.filter(Boolean),
      // });

      // Return result
      return {
        status: "success",
        txHash: "example-tx-hash",
        txHashArr: ["example-tx-hash"],
      };
    } catch (error: any) {
      return {
        status: "error",
        message: error?.message || "Transaction failed",
      };
    }
  }

  async view(_params: {
    contractId: string;
    methodName: string;
    args?: any;
  }): Promise<any> {
    try {
      // Use near-api-js to view contract state
      // const result = await this.account.viewFunction({
      //   contractId: params.contractId,
      //   methodName: params.methodName,
      //   args: params.args || {},
      // });
      // return result;

      // Example return
      return null;
    } catch (error: any) {
      console.error("View function failed:", error);
      return null;
    }
  }
}

/**
 * Configuration adapter example
 */
export class ExampleConfigAdapter implements ConfigAdapter {
  private refExchangeId: string;
  private wrapNearContractId: string;
  private findPathUrl: string;
  private tokenStorageDepositRead?: string;

  constructor(config: {
    refExchangeId: string;
    wrapNearContractId: string;
    findPathUrl: string;
    tokenStorageDepositRead?: string;
  }) {
    this.refExchangeId = config.refExchangeId;
    this.wrapNearContractId = config.wrapNearContractId;
    this.findPathUrl = config.findPathUrl;
    this.tokenStorageDepositRead = config.tokenStorageDepositRead;
  }

  getRefExchangeId(): string {
    return this.refExchangeId;
  }

  getWrapNearContractId(): string {
    return this.wrapNearContractId;
  }

  getFindPathUrl(): string {
    return this.findPathUrl;
  }

  getTokenStorageDepositRead(): string {
    // Default storage deposit (yoctoNEAR) used for FT `storage_deposit`.
    return this.tokenStorageDepositRead || "1250000000000000000000";
  }
}
