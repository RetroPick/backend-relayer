/**
 * Build session finalization payload for CRE workflow.
 * Matches buildFinalStateRequest schema: marketId, sessionId, participants, balances, signatures, backendSignature
 */
import { encodeAbiParameters, parseAbiParameters } from "viem";
import type { Hex } from "viem";
import type { SessionState } from "../state/sessionStore.js";

export interface SessionPayloadInput {
  marketId: bigint;
  sessionId: Hex;
  participants: Hex[];
  balances: bigint[];
  signatures: Hex[];
  backendSignature: Hex;
}

const SESSION_PAYLOAD_PARAMS = parseAbiParameters(
  "uint256 marketId, bytes32 sessionId, address[] participants, uint256[] balances, bytes[] signatures, bytes backendSignature"
);

export function buildFinalStateRequest(input: SessionPayloadInput): Hex {
  const encoded = encodeAbiParameters(SESSION_PAYLOAD_PARAMS, [
    input.marketId,
    input.sessionId,
    input.participants,
    input.balances,
    input.signatures,
    input.backendSignature,
  ]);
  return ("0x03" + encoded.slice(2)) as Hex;
}

/**
 * Convert SessionState to payload for CRE. Uses placeholder signatures when not yet implemented.
 */
export function sessionStateToPayload(
  state: SessionState,
  backendSignature: Hex
): SessionPayloadInput {
  const participants = Array.from(state.accounts.keys()) as Hex[];
  const balances = participants.map((addr) => {
    const acc = state.accounts.get(addr)!;
    return acc.balance;
  });
  const signatures = participants.map(() => "0x" as Hex); // Placeholder; real impl would collect user sigs
  return {
    marketId: state.marketId,
    sessionId: state.sessionId,
    participants,
    balances,
    signatures,
    backendSignature,
  };
}
