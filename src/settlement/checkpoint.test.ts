import { describe, it, expect, beforeEach } from "vitest";
import { buildCheckpointPayloads } from "./checkpoint.js";
import { setSession, clearAllSessions } from "../state/store.js";
import { createSessionState, getOrCreateAccount } from "../state/sessionStore.js";

describe("checkpoint", () => {
  beforeEach(clearAllSessions);

  describe("buildCheckpointPayloads", () => {
    it("returns empty array when no sessions", () => {
      const payloads = buildCheckpointPayloads();
      expect(payloads).toEqual([]);
    });

    it("returns payload for each session with hasDeltas", () => {
      const state = createSessionState(
        "0x" + "11".repeat(32) as `0x${string}`,
        1n,
        "0x" + "aa".repeat(20) as `0x${string}`,
        2,
        { b: 100 }
      );
      const acc = getOrCreateAccount(state, "0x0000000000000000000000000000000000000001");
      acc.balance = 100n;
      acc.initialBalance = 100n;
      acc.positions = [50n];
      setSession(state.sessionId, state);

      const payloads = buildCheckpointPayloads();
      expect(payloads).toHaveLength(1);
      expect(payloads[0].sessionId).toBe(state.sessionId);
      expect(payloads[0].marketId).toBe(1n);
      expect(payloads[0].stateHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(payloads[0].accountsRoot).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(payloads[0].hasDeltas).toBe(true);
    });

    it("hasDeltas false when session has no accounts with positions or cash delta", () => {
      const state = createSessionState(
        "0x" + "22".repeat(32) as `0x${string}`,
        1n,
        "0x" + "aa".repeat(20) as `0x${string}`,
        2,
        { b: 100 }
      );
      setSession(state.sessionId, state);

      const payloads = buildCheckpointPayloads();
      expect(payloads[0].hasDeltas).toBe(false);
    });
  });
});
