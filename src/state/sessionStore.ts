/**
 * Session state management per whitepaper Section 6.2.
 * S = (q, balances, positions, fees, nonce); sessionId, marketId, vaultId, epoch
 */
import { keccak256, toHex } from "viem";
import type { Address, Hex } from "viem";
import type { LMSRParams } from "../matching/lmsr.js";

export interface AccountState {
  balance: bigint;
  positions: bigint[];  // outcome share holdings
  feeAccrued: bigint;
  /** Balance at session start (sum of credits before trades); used for checkpoint cashDelta. */
  initialBalance?: bigint;
}

export interface SessionState {
  sessionId: Hex;
  marketId: bigint;
  vaultId: Hex;
  epoch: number;
  nonce: bigint;
  q: number[];           // outcome share vector (LMSR)
  bParams: LMSRParams;
  accounts: Map<string, AccountState>;
  prevStateHash: Hex | null;
  feeParams: { tau: number };  // fee rate 0..1
  resolveTime?: number;  // Unix timestamp when market resolves (for CRE finalization)
  /** Unix timestamp of last trade; used for checkpoint lastTradeAt (must be <= tradingClose at finalize). */
  lastTradeAt?: number;
  /** Risk caps (optional). */
  riskCaps?: {
    maxOI?: number; // max open interest Σ max(0, q_i)
    maxPosPerUser?: number; // max position per outcome per user (in outcome units)
    maxOddsImpactBps?: number; // session default for maxOddsImpact
  };
}

export interface SessionHeader {
  sessionId: Hex;
  marketId: bigint;
  vaultId: Hex;
  epoch: number;
  nonce: bigint;
  stateVersion: number;
}

export function createEmptyAccountState(numOutcomes: number): AccountState {
  return {
    balance: 0n,
    positions: Array(numOutcomes).fill(0n),
    feeAccrued: 0n,
  };
}

export function createSessionState(
  sessionId: Hex,
  marketId: bigint,
  vaultId: Hex,
  numOutcomes: number,
  bParams: LMSRParams
): SessionState {
  return {
    sessionId,
    marketId,
    vaultId,
    epoch: 0,
    nonce: 0n,
    q: Array(numOutcomes).fill(0),
    bParams,
    accounts: new Map(),
    prevStateHash: null,
    feeParams: { tau: 0.01 },
  };
}

export function hashSessionState(state: SessionState): Hex {
  const payload = JSON.stringify({
    sessionId: state.sessionId,
    marketId: state.marketId.toString(),
    vaultId: state.vaultId,
    epoch: state.epoch,
    nonce: state.nonce.toString(),
    q: state.q,
    accounts: Array.from(state.accounts.entries()).map(([addr, acc]) => ({
      addr,
      balance: acc.balance.toString(),
      positions: acc.positions.map((p) => p.toString()),
    })),
    prevStateHash: state.prevStateHash,
  });
  return keccak256(toHex(new TextEncoder().encode(payload)));
}

export function getOrCreateAccount(state: SessionState, address: string): AccountState {
  const existing = state.accounts.get(address.toLowerCase());
  if (existing) return existing;
  const acc = createEmptyAccountState(state.q.length);
  state.accounts.set(address.toLowerCase(), acc);
  return acc;
}
