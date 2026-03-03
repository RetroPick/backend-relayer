/**
 * In-memory store for checkpoint user signatures.
 * Frontend POSTs sigs here; CRE workflow fetches before building payload.
 * Entries expire after SIG_TTL_MS (10 minutes).
 */
import type { Hex } from "viem";

const SIG_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface SigEntry {
  userSigs: Record<string, Hex>;
  createdAt: number;
}

const store = new Map<string, SigEntry>();

function pruneExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.createdAt >= SIG_TTL_MS) store.delete(key);
  }
}

/**
 * Store user signatures for a session. Overwrites any existing entry.
 */
export function setCheckpointSigs(sessionId: string, userSigs: Record<string, Hex>): void {
  pruneExpired();
  store.set(sessionId.toLowerCase(), {
    userSigs,
    createdAt: Date.now(),
  });
}

/**
 * Get stored user signatures for a session. Returns undefined if not found or expired.
 */
export function getCheckpointSigs(sessionId: string): Record<string, Hex> | undefined {
  pruneExpired();
  const entry = store.get(sessionId.toLowerCase());
  if (!entry) return undefined;
  if (Date.now() - entry.createdAt >= SIG_TTL_MS) {
    store.delete(sessionId.toLowerCase());
    return undefined;
  }
  return entry.userSigs;
}

/**
 * Clear stored sigs for a session (e.g. after successful checkpoint submit).
 */
export function clearCheckpointSigs(sessionId: string): void {
  store.delete(sessionId.toLowerCase());
}
