import { describe, it, expect, beforeEach } from "vitest";
import {
  setSession,
  getSession,
  getSessionsByMarket,
  getReadyForFinalization,
  getAllSessions,
  clearAllSessions,
} from "./store.js";
import { createSessionState, getOrCreateAccount } from "./sessionStore.js";

describe("store", () => {
  beforeEach(clearAllSessions);

  describe("setSession and getSession", () => {
    it("stores and retrieves session by sessionId", () => {
      const state = createSessionState(
        "0x11" as `0x${string}`,
        1n,
        "0xaa" as `0x${string}`,
        2,
        { b: 100 }
      );
      setSession(state.sessionId, state);
      const retrieved = getSession(state.sessionId);
      expect(retrieved).toBe(state);
    });
  });

  describe("getSessionsByMarket", () => {
    it("returns sessions for given marketId", () => {
      const s1 = createSessionState(
        "0x11" as `0x${string}`,
        1n,
        "0xaa" as `0x${string}`,
        2,
        { b: 100 }
      );
      const s2 = createSessionState(
        "0x22" as `0x${string}`,
        1n,
        "0xaa" as `0x${string}`,
        2,
        { b: 100 }
      );
      const s3 = createSessionState(
        "0x33" as `0x${string}`,
        2n,
        "0xaa" as `0x${string}`,
        2,
        { b: 100 }
      );
      setSession(s1.sessionId, s1);
      setSession(s2.sessionId, s2);
      setSession(s3.sessionId, s3);

      const forMarket1 = getSessionsByMarket(1n);
      expect(forMarket1).toHaveLength(2);
      expect(forMarket1.map((s) => s.sessionId)).toContain(s1.sessionId);
      expect(forMarket1.map((s) => s.sessionId)).toContain(s2.sessionId);

      const forMarket2 = getSessionsByMarket(2n);
      expect(forMarket2).toHaveLength(1);
      expect(forMarket2[0].sessionId).toBe(s3.sessionId);
    });
  });

  describe("getReadyForFinalization", () => {
    it("returns sessions with resolveTime <= now", () => {
      const past = Math.floor(Date.now() / 1000) - 3600;
      const future = Math.floor(Date.now() / 1000) + 3600;
      const s1 = createSessionState(
        "0x11" as `0x${string}`,
        1n,
        "0xaa" as `0x${string}`,
        2,
        { b: 100 }
      );
      s1.resolveTime = past;
      const s2 = createSessionState(
        "0x22" as `0x${string}`,
        1n,
        "0xaa" as `0x${string}`,
        2,
        { b: 100 }
      );
      s2.resolveTime = future;
      const s3 = createSessionState(
        "0x33" as `0x${string}`,
        1n,
        "0xaa" as `0x${string}`,
        2,
        { b: 100 }
      );
      setSession(s1.sessionId, s1);
      setSession(s2.sessionId, s2);
      setSession(s3.sessionId, s3);

      const ready = getReadyForFinalization();
      expect(ready).toHaveLength(1);
      expect(ready[0].sessionId).toBe(s1.sessionId);
    });
  });

  describe("getAllSessions", () => {
    it("returns all sessions", () => {
      const s1 = createSessionState(
        "0x11" as `0x${string}`,
        1n,
        "0xaa" as `0x${string}`,
        2,
        { b: 100 }
      );
      setSession(s1.sessionId, s1);
      const all = getAllSessions();
      expect(all).toHaveLength(1);
      expect(all[0].sessionId).toBe(s1.sessionId);
    });
  });
});
