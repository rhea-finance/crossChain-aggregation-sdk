import { describe, expect, it } from "vitest";
import { normalizeQuote } from "../../src/normalizers/quote";
import {
  normalizeMcaQuote,
  serializeMcaQuoteRequest,
} from "../../src/mca/quote";
import type {
  McaQuoteRequest,
  McaSignerIdentity,
} from "../../src/mca/types";

const depositSigner: McaSignerIdentity = {
  chain: "evm",
  identityKey: "0xabc",
};
const withdrawSigner: McaSignerIdentity = {
  chain: "solana",
  identityKey: "sol-pk",
};

const depositRequest: McaQuoteRequest = {
  flow: "deposit",
  mcaAccountId: "mca.near",
  fromChain: "1",
  toChain: "near",
  tokenIn: {
    chain: "1",
    address: "0xusdc",
    symbol: "USDC",
    decimals: 6,
  },
  tokenOut: {
    chain: "near",
    address: "usdc.token.near",
    symbol: "USDC",
    decimals: 6,
  },
  amountIn: "1000000",
  slippageBps: 50,
  sender: "0xsender",
  recipient: "mca.near",
  signerChain: "evm",
  collateral: { useAsCollateral: true },
};

const withdrawRequest: McaQuoteRequest = {
  flow: "withdraw",
  mcaAccountId: "mca.near",
  fromChain: "near",
  toChain: "1",
  tokenIn: {
    chain: "near",
    address: "usdc.token.near",
    symbol: "USDC",
    decimals: 6,
  },
  tokenOut: {
    chain: "1",
    address: "0xusdc",
    symbol: "USDC",
    decimals: 6,
  },
  amountIn: "1000000",
  slippageBps: 50,
  sender: "mca.near",
  recipient: "0xrecipient",
  signerChain: "solana",
  collateral: {
    needDecrease: true,
    decreaseAmountBurrow: "12.5",
    withdrawAll: true,
  },
  recipientMsgSignatures: ["recipient-signature"],
  depositSignerProofSignatures: ["proof-signature"],
  executionPreference: "relayer",
};

function rawQuote(overrides: Record<string, unknown> = {}) {
  return {
    isCrossChain: true,
    chainType: "cross-chain",
    bestQuote: {
      router: "near-mca-withdraw",
      amountOut: "900000",
      minAmountOut: "890000",
      preSwap: null,
      bridge: null,
    },
    allQuotes: [],
    ...overrides,
  };
}

describe("MCA quote serialization", () => {
  it("serializes deposit signer and collateral fields", () => {
    const raw = serializeMcaQuoteRequest(depositRequest, depositSigner);

    expect(raw).toMatchObject({
      quoteWaitingTimeMs: 3000,
      mca: {
        flow: "deposit",
        mcaAccountId: "mca.near",
        signer: { chain: "evm", identityKey: "0xabc" },
        useAsCollateral: true,
      },
    });
  });

  it("serializes withdraw collateral and proof signatures", () => {
    const raw = serializeMcaQuoteRequest(withdrawRequest, withdrawSigner);

    expect(raw.mca).toEqual({
      flow: "withdraw",
      mcaAccountId: "mca.near",
      signer: { chain: "solana", identityKey: "sol-pk" },
      needDecreaseCollateral: true,
      decreaseCollateralAmountBurrow: "12.5",
      withdrawAll: true,
      recipientMsgSignatures: ["recipient-signature"],
      depositSignerProofSignatures: ["proof-signature"],
    });
  });

  it("rejects blank MCA identities", () => {
    expect(() =>
      serializeMcaQuoteRequest({
        ...depositRequest,
        mcaAccountId: " ",
      }, depositSigner)
    ).toThrowError(/mcaAccountId/);

    expect(() =>
      serializeMcaQuoteRequest(depositRequest, {
        chain: "evm",
        identityKey: " ",
      })
    ).toThrowError(/identityKey/);
  });

  it("rejects invalid withdraw collateral amounts", () => {
    expect(() =>
      serializeMcaQuoteRequest({
        ...withdrawRequest,
        collateral: {
          ...withdrawRequest.collateral,
          decreaseAmountBurrow: "-1",
        },
      }, withdrawSigner)
    ).toThrowError(/decreaseAmountBurrow/);
  });
});

describe("MCA quote normalization", () => {
  it("normalizes a deposit router", () => {
    const raw = rawQuote({
      bestQuote: {
        router: "near-mca-deposit",
        amountOut: "900000",
        minAmountOut: "890000",
      },
      nearDepositTx: { kind: "mca_deposit" },
    });
    const quote = normalizeQuote(depositRequest, raw, 1000);

    expect(normalizeMcaQuote(depositRequest, depositSigner, quote)).toMatchObject({
      flow: "deposit",
      executionMode: "deposit",
      mcaAccountId: "mca.near",
      nearDepositTx: { kind: "mca_deposit" },
    });
  });

  it("preserves the underlying router for a cross-chain deposit", () => {
    const raw = rawQuote({
      bestQuote: {
        router: "nearintents",
        estimatedOut: "6424403",
        minAmountOut: "6392280",
      },
      mcaContext: {
        flow: "deposit",
        mcaAccountId: "mca.near",
        depositOneClickConfigured: true,
      },
    });
    const quote = normalizeQuote(depositRequest, raw, 1000);

    expect(normalizeMcaQuote(depositRequest, depositSigner, quote)).toMatchObject({
      flow: "deposit",
      executionMode: "deposit",
      route: { router: "nearintents" },
      buildContext: { router: "nearintents" },
    });
  });

  it("normalizes an explicit relayer withdraw preview", () => {
    const preview = {
      business: { action: "withdraw" },
      messageToSign: "sign this exact message",
      depositAddress: "deposit-address",
    };
    const raw = rawQuote({ mcaWithdrawToIntents: preview });
    const quote = normalizeQuote(withdrawRequest, raw, 1000);

    expect(normalizeMcaQuote(withdrawRequest, withdrawSigner, quote)).toMatchObject({
      flow: "withdraw",
      executionMode: "withdraw-relayer",
      preview,
    });
  });

  it("preserves a nearintents router for a relayer withdraw", () => {
    const preview = {
      business: { nonce: "56", tx_requests: [] },
      messageToSign: "{\"nonce\":\"56\",\"tx_requests\":[]}",
      depositAddress: "intents-deposit-address",
      submissionMode: "multichain_relayer",
    };
    const raw = rawQuote({
      bestQuote: {
        router: "nearintents",
        estimatedOut: "1124805",
        minAmountOut: "1119180",
      },
      mcaContext: {
        flow: "withdraw",
        mcaAccountId: "mca.near",
      },
      mcaWithdrawToIntents: preview,
    });
    const quote = normalizeQuote(withdrawRequest, raw, 1000);

    expect(
      normalizeMcaQuote(withdrawRequest, withdrawSigner, quote)
    ).toMatchObject({
      flow: "withdraw",
      executionMode: "withdraw-relayer",
      preview,
      route: { router: "nearintents" },
      buildContext: { router: "nearintents" },
    });
  });

  it("auto-selects NEAR only for the bound NEAR recipient", () => {
    const nearRequest: McaQuoteRequest = {
      ...withdrawRequest,
      toChain: "near",
      tokenOut: {
        ...withdrawRequest.tokenOut,
        chain: "near",
        address: "usdc.token.near",
      },
      recipient: "alice.near",
      executionPreference: "auto",
      boundNearAccountId: "alice.near",
    };
    const preview = {
      business: { action: "withdraw" },
      transactions: [],
    };
    const raw = rawQuote({ nearMcaWithdrawTx: preview });
    const quote = normalizeQuote(nearRequest, raw, 1000);

    expect(normalizeMcaQuote(nearRequest, withdrawSigner, quote)).toMatchObject({
      executionMode: "withdraw-near",
      preview,
    });
  });

  it("rejects router-specific API errors", () => {
    const depositRaw = rawQuote({
      bestQuote: {
        router: "near-mca-deposit",
        amountOut: "900000",
        minAmountOut: "890000",
      },
      nearDepositTxError: "deposit unavailable",
    });
    const withdrawRaw = rawQuote({
      nearMcaWithdrawTxError: "withdraw unavailable",
    });

    expect(() =>
      normalizeMcaQuote(
        depositRequest,
        depositSigner,
        normalizeQuote(depositRequest, depositRaw, 1000)
      )
    ).toThrowError(/deposit unavailable/);
    expect(() =>
      normalizeMcaQuote(
        withdrawRequest,
        withdrawSigner,
        normalizeQuote(withdrawRequest, withdrawRaw, 1000)
      )
    ).toThrowError(/withdraw unavailable/);
  });
});
