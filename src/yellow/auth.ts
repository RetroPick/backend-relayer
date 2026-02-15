/**
 * EIP-712 auth and session key management for Yellow protocol.
 * Per whitepaper: state transitions require signatures from involved parties.
 * Uses Nitrolite's SessionKeyStateSigner for app-level session keys.
 */
import { SessionKeyStateSigner } from "@erc7824/nitrolite";
import { keccak256, toHex, type Hex } from "viem";
import { randomBytes } from "crypto";

/**
 * Generate a random session key (32 bytes).
 * In production, derive from user wallet or secure HSM.
 */
export function generateSessionKey(): Hex {
  return toHex(randomBytes(32));
}

/**
 * Create a session signer for the operator/trader.
 * Uses Nitrolite's SessionKeyStateSigner when sessionKey is provided.
 */
export function createSessionSigner(sessionKey: Hex): SessionKeyStateSigner {
  return new SessionKeyStateSigner(sessionKey);
}

/**
 * Hash a state payload for signing (EIP-712 compatible).
 * Used for session state transitions per whitepaper Section 6.2.
 */
export function hashStatePayload(payload: string | Uint8Array): Hex {
  const data = typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
  return keccak256(toHex(data));
}
