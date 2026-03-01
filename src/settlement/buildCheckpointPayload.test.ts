import { describe, it, expect } from "vitest";
import {
  sessionStateToDeltas,
  hashDeltas,
  getCheckpointDigest,
  buildCheckpointPayload,
  type DeltaInput,
  type CheckpointInput,
} from "./buildCheckpointPayload.js";
import { createSessionState, getOrCreateAccount } from "../state/sessionStore.js";
import type { Address } from "viem";

describe("buildCheckpointPayload", () => {
  describe("sessionStateToDeltas", () => {
    it("cash-only user gets one Delta with outcomeIndex 0, sharesDelta 0", () => {
      const state = createSessionState(
        "0x1" as `0x${string}`,
        1n,
        "0xa" as `0x${string}`,
        2,
        { b: 100 }
      );
      const acc = getOrCreateAccount(state, "0x0000000000000000000000000000000000000001");
      acc.initialBalance = 1000000n;
      acc.balance = 500000n; // spent 500000
      const deltas = sessionStateToDeltas(state);
      expect(deltas).toHaveLength(1);
      expect(deltas[0].outcomeIndex).toBe(0);
      expect(deltas[0].sharesDelta).toBe(0n);
      expect(deltas[0].cashDelta).toBe(500000n); // initial - balance = spent
    });

    it("position user gets correct sharesDelta and cashDelta on first outcome", () => {
      const state = createSessionState(
        "0x1" as `0x${string}`,
        1n,
        "0xa" as `0x${string}`,
        2,
        { b: 100 }
      );
      const acc = getOrCreateAccount(state, "0x0000000000000000000000000000000000000001");
      acc.initialBalance = 2000000n;
      acc.balance = 1000000n;
      acc.positions = [500000n, 300000n, 0n];
      const deltas = sessionStateToDeltas(state);
      expect(deltas.length).toBeGreaterThanOrEqual(2);
      const first = deltas.find((d) => d.outcomeIndex === 0);
      expect(first?.sharesDelta).toBe(500000n);
      expect(first?.cashDelta).toBe(1000000n);
    });

    it("skips account with no position and zero cash delta", () => {
      const state = createSessionState(
        "0x1" as `0x${string}`,
        1n,
        "0xa" as `0x${string}`,
        2,
        { b: 100 }
      );
      const acc = getOrCreateAccount(state, "0x0000000000000000000000000000000000000001");
      acc.initialBalance = 0n;
      acc.balance = 0n;
      const deltas = sessionStateToDeltas(state);
      expect(deltas).toHaveLength(0);
    });
  });

  describe("hashDeltas", () => {
    it("is deterministic", () => {
      const deltas: DeltaInput[] = [
        {
          user: "0x0000000000000000000000000000000000000001" as Address,
          outcomeIndex: 0,
          sharesDelta: 10n,
          cashDelta: -100n,
        },
      ];
      const h1 = hashDeltas(deltas);
      const h2 = hashDeltas(deltas);
      expect(h1).toBe(h2);
    });

    it("empty deltas returns keccak256(0x)", () => {
      const h = hashDeltas([]);
      expect(h).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });
  });

  describe("getCheckpointDigest", () => {
    it("produces valid digest for checkpoint", () => {
      const cp: CheckpointInput = {
        marketId: 1n,
        sessionId: "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`,
        nonce: 1n,
        stateHash: "0x" + "00".repeat(32) as `0x${string}`,
        deltasHash: "0x" + "11".repeat(32) as `0x${string}`,
      };
      const chainId = 43113;
      const verifyingContract = "0x0000000000000000000000000000000000000002" as Address;
      const digest = getCheckpointDigest(cp, chainId, verifyingContract);
      expect(digest).toMatch(/^0x[a-fA-F0-9]{64}$/);
    });
  });

  describe("buildCheckpointPayload", () => {
    it("throws when user signature is missing", async () => {
      const state = createSessionState(
        "0x" + "11".repeat(32) as `0x${string}`,
        1n,
        "0x" + "aa".repeat(20) as `0x${string}`,
        2,
        { b: 100 }
      );
      const acc = getOrCreateAccount(state, "0x0376AAc07Ad725E01357B1725B5ceC61aE10473c");
      acc.positions = [500000n];
      const userSigs = new Map<string, `0x${string}`>();
      const operatorSign = async () => ("0x" + "00".repeat(65)) as `0x${string}`;

      await expect(
        buildCheckpointPayload({
          state,
          userSigs,
          operatorSign,
          chainId: 43113,
          channelSettlementAddress: "0x0000000000000000000000000000000000000002" as Address,
        })
      ).rejects.toThrow("Missing signature");
    });

  });
});
