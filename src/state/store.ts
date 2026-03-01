/**
 * In-memory store of active sessions.
 * Maps sessionId -> SessionState. CRE workflow fetches from here.
 */
import type { Hex } from "viem";
import type { SessionState } from "./sessionStore.js";

const sessions = new Map<string, SessionState>();

export function setSession(sessionId: Hex, state: SessionState): void {
  sessions.set(sessionId.toLowerCase(), state);
}

export function getSession(sessionId: Hex): SessionState | undefined {
  return sessions.get(sessionId.toLowerCase());
}

export function getSessionsByMarket(marketId: bigint): SessionState[] {
  return Array.from(sessions.values()).filter((s) => s.marketId === marketId);
}

export function getReadyForFinalization(): SessionState[] {
  const now = Math.floor(Date.now() / 1000);
  return Array.from(sessions.values()).filter((s) => {
    const rt = s.resolveTime;
    return rt !== undefined && rt <= now;
  });
}

export function getAllSessions(): SessionState[] {
  return Array.from(sessions.values());
}

/** Clear all sessions (for tests only). */
export function clearAllSessions(): void {
  sessions.clear();
}
