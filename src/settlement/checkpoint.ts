/**
 * Checkpoint logic: commit stateHash, accountsRoot to onchain.
 * Per whitepaper Section 6.3: time/volume/risk-based checkpointing.
 * The relayer prepares checkpoint payloads; actual onchain write is done by CRE workflow.
 */
import { keccak256, toHex } from "viem";
import type { Hex } from "viem";
import { hashSessionState } from "../state/sessionStore.js";
import { getAllSessions } from "../state/store.js";
import { sessionStateToDeltas } from "./buildCheckpointPayload.js";

export interface CheckpointPayload {
  sessionId: Hex;
  marketId: bigint;
  epoch: number;
  stateHash: Hex;
  accountsRoot: Hex;
  nonce: string;
  timestamp: number;
  /** True if session has checkpointable deltas (CRE can fetch full spec at GET /cre/checkpoints/:sessionId). */
  hasDeltas: boolean;
}

function simpleAccountsRoot(accounts: Map<string, { balance: bigint; positions: bigint[] }>): Hex {
  const entries = Array.from(accounts.entries())
    .map(([addr, acc]) => `${addr}:${acc.balance}:${acc.positions.join(",")}`)
    .sort();
  const payload = entries.join("|");
  return keccak256(toHex(new TextEncoder().encode(payload)));
}

export function buildCheckpointPayloads(): CheckpointPayload[] {
  const sessions = getAllSessions();
  const now = Math.floor(Date.now() / 1000);
  return sessions.map((state) => {
    const stateHash = hashSessionState(state);
    const accountsRoot = simpleAccountsRoot(
      new Map(
        Array.from(state.accounts.entries()).map(([k, v]) => [
          k,
          { balance: v.balance, positions: v.positions },
        ])
      )
    );
    const deltas = sessionStateToDeltas(state);
    return {
      sessionId: state.sessionId,
      marketId: state.marketId,
      epoch: state.epoch,
      stateHash,
      accountsRoot,
      nonce: state.nonce.toString(),
      timestamp: now,
      hasDeltas: deltas.length > 0,
    };
  });
}
