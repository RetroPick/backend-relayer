import { describe, it, expect } from "vitest";
import {
  getChannelSettlementAddress,
  readLatestNonce,
  finalizeCheckpoint,
} from "./channelSettlementClient.js";
import type { Address } from "viem";

describe("channelSettlementClient", () => {
  describe("getChannelSettlementAddress", () => {
    it("returns null when CHANNEL_SETTLEMENT_ADDRESS not set", () => {
      const orig = process.env.CHANNEL_SETTLEMENT_ADDRESS;
      delete process.env.CHANNEL_SETTLEMENT_ADDRESS;
      const addr = getChannelSettlementAddress();
      if (orig) process.env.CHANNEL_SETTLEMENT_ADDRESS = orig;
      expect(addr).toBeNull();
    });

    it("returns null when CHANNEL_SETTLEMENT_ADDRESS is zero address", () => {
      const orig = process.env.CHANNEL_SETTLEMENT_ADDRESS;
      process.env.CHANNEL_SETTLEMENT_ADDRESS = "0x0000000000000000000000000000000000000000";
      const addr = getChannelSettlementAddress();
      if (orig) process.env.CHANNEL_SETTLEMENT_ADDRESS = orig;
      expect(addr).toBeNull();
    });

    it("returns address when configured", () => {
      const orig = process.env.CHANNEL_SETTLEMENT_ADDRESS;
      process.env.CHANNEL_SETTLEMENT_ADDRESS = "0x" + "fa".repeat(20);
      const addr = getChannelSettlementAddress();
      if (orig) process.env.CHANNEL_SETTLEMENT_ADDRESS = orig;
      expect(addr).toBe("0x" + "fa".repeat(20));
    });
  });

  describe("readLatestNonce", () => {
    it("throws when CHANNEL_SETTLEMENT_ADDRESS not configured", async () => {
      const orig = process.env.CHANNEL_SETTLEMENT_ADDRESS;
      delete process.env.CHANNEL_SETTLEMENT_ADDRESS;
      await expect(
        readLatestNonce(1n, "0x" + "00".repeat(32) as `0x${string}`)
      ).rejects.toThrow("CHANNEL_SETTLEMENT_ADDRESS");
      if (orig) process.env.CHANNEL_SETTLEMENT_ADDRESS = orig;
    });
  });

  describe("finalizeCheckpoint", () => {
    it("throws when CHANNEL_SETTLEMENT_ADDRESS not configured", async () => {
      const orig = process.env.CHANNEL_SETTLEMENT_ADDRESS;
      delete process.env.CHANNEL_SETTLEMENT_ADDRESS;
      const userAddr = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;
      await expect(
        finalizeCheckpoint(1n, "0x" + "00".repeat(32) as `0x${string}`, [
          { user: userAddr, outcomeIndex: 0, sharesDelta: 10n, cashDelta: -100n },
        ])
      ).rejects.toThrow("CHANNEL_SETTLEMENT_ADDRESS");
      if (orig) process.env.CHANNEL_SETTLEMENT_ADDRESS = orig;
    });

    it("throws when FINALIZER_PRIVATE_KEY and OPERATOR_PRIVATE_KEY not configured", async () => {
      const origAddr = process.env.CHANNEL_SETTLEMENT_ADDRESS;
      const origFinalizer = process.env.FINALIZER_PRIVATE_KEY;
      const origOperator = process.env.OPERATOR_PRIVATE_KEY;
      process.env.CHANNEL_SETTLEMENT_ADDRESS = "0x" + "fa".repeat(20);
      delete process.env.FINALIZER_PRIVATE_KEY;
      delete process.env.OPERATOR_PRIVATE_KEY;
      const userAddr = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;
      await expect(
        finalizeCheckpoint(1n, "0x" + "00".repeat(32) as `0x${string}`, [
          { user: userAddr, outcomeIndex: 0, sharesDelta: 10n, cashDelta: -100n },
        ])
      ).rejects.toThrow(/FINALIZER_PRIVATE_KEY|OPERATOR_PRIVATE_KEY/);
      if (origAddr) process.env.CHANNEL_SETTLEMENT_ADDRESS = origAddr;
      if (origFinalizer) process.env.FINALIZER_PRIVATE_KEY = origFinalizer;
      if (origOperator) process.env.OPERATOR_PRIVATE_KEY = origOperator;
    });
  });
});
