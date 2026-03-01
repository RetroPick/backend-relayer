import { describe, it, expect } from "vitest";
import {
  buildFinalStateRequest,
  sessionStateToPayload,
} from "./buildFinalState.js";
import { createSessionState, getOrCreateAccount } from "../state/sessionStore.js";
import type { Hex } from "viem";

describe("buildFinalState", () => {
  describe("sessionStateToPayload", () => {
    it("converts SessionState to payload with participants and balances", () => {
      const state = createSessionState(
        "0x11" as Hex,
        1n,
        "0xaa" as Hex,
        2,
        { b: 100 }
      );
      const acc = getOrCreateAccount(state, "0x0000000000000000000000000000000000000001");
      acc.balance = 500n;
      const backendSig = "0x" + "00".repeat(65) as Hex;
      const payload = sessionStateToPayload(state, backendSig);
      expect(payload.marketId).toBe(1n);
      expect(payload.sessionId).toBe("0x11");
      expect(payload.participants).toHaveLength(1);
      expect(payload.balances).toEqual([500n]);
      expect(payload.signatures).toHaveLength(1);
      expect(payload.backendSignature).toBe(backendSig);
    });
  });

  describe("buildFinalStateRequest", () => {
    it("produces 0x03-prefixed hex payload", () => {
      const input = {
        marketId: 1n,
        sessionId: "0x" + "00".repeat(32) as Hex,
        participants: ["0x0000000000000000000000000000000000000001" as Hex],
        balances: [1000n],
        signatures: ["0x" as Hex],
        backendSignature: "0x" + "00".repeat(65) as Hex,
      };
      const result = buildFinalStateRequest(input);
      expect(result.startsWith("0x03")).toBe(true);
      expect(result.length).toBeGreaterThan(10);
    });
  });
});
