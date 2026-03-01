import { describe, it, expect } from "vitest";
import {
  createSessionState,
  createEmptyAccountState,
  getOrCreateAccount,
  hashSessionState,
} from "./sessionStore.js";

describe("sessionStore", () => {
  describe("createSessionState", () => {
    it("creates correct q length, bParams, feeParams", () => {
      const state = createSessionState(
        "0x1234" as `0x${string}`,
        1n,
        "0xabcd" as `0x${string}`,
        3,
        { b: 100 }
      );
      expect(state.q).toHaveLength(3);
      expect(state.q).toEqual([0, 0, 0]);
      expect(state.bParams).toEqual({ b: 100 });
      expect(state.feeParams.tau).toBe(0.01);
      expect(state.nonce).toBe(0n);
      expect(state.accounts.size).toBe(0);
    });
  });

  describe("getOrCreateAccount", () => {
    it("creates new account when missing", () => {
      const state = createSessionState(
        "0x1" as `0x${string}`,
        1n,
        "0xa" as `0x${string}`,
        2,
        { b: 50 }
      );
      const acc = getOrCreateAccount(state, "0x0000000000000000000000000000000000000001");
      expect(acc.balance).toBe(0n);
      expect(acc.positions).toHaveLength(2);
    });

    it("returns existing account when present", () => {
      const state = createSessionState(
        "0x1" as `0x${string}`,
        1n,
        "0xa" as `0x${string}`,
        2,
        { b: 50 }
      );
      const acc1 = getOrCreateAccount(state, "0x0000000000000000000000000000000000000001");
      acc1.balance = 100n;
      const acc2 = getOrCreateAccount(state, "0x0000000000000000000000000000000000000001");
      expect(acc2.balance).toBe(100n);
    });
  });

  describe("hashSessionState", () => {
    it("is deterministic", () => {
      const state = createSessionState(
        "0x1" as `0x${string}`,
        1n,
        "0xa" as `0x${string}`,
        2,
        { b: 50 }
      );
      const h1 = hashSessionState(state);
      const h2 = hashSessionState(state);
      expect(h1).toBe(h2);
    });

    it("changes when state changes", () => {
      const state = createSessionState(
        "0x1" as `0x${string}`,
        1n,
        "0xa" as `0x${string}`,
        2,
        { b: 50 }
      );
      const h1 = hashSessionState(state);
      state.q[0] = 10;
      const h2 = hashSessionState(state);
      expect(h2).not.toBe(h1);
    });
  });

  describe("createEmptyAccountState", () => {
    it("creates account with correct positions length", () => {
      const acc = createEmptyAccountState(4);
      expect(acc.positions).toHaveLength(4);
      expect(acc.balance).toBe(0n);
    });
  });
});
