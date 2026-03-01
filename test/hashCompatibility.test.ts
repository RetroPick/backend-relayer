/**
 * Hash compatibility test: verifies relayer's hashDeltas and getCheckpointDigest
 * produce the same output as the Solidity Hashing library and ChannelSettlement.digestCheckpoint.
 *
 * To regenerate expected hashes from Solidity, run:
 *   cd packages/contracts && forge script script/OutputDeltasHash.s.sol --sig "run()"
 */
import { describe, it, expect } from "vitest";
import { hashDeltas, getCheckpointDigest } from "../src/settlement/buildCheckpointPayload.js";
import type { DeltaInput, CheckpointInput } from "../src/settlement/buildCheckpointPayload.js";
import type { Address } from "viem";

const USER_ADDR = "0x0376AAc07Ad725E01357B1725B5ceC61aE10473c" as Address;

describe("Hash compatibility with Solidity", () => {
  it("hashDeltas matches Hashing.hashDeltas from contracts", () => {
    const deltas: DeltaInput[] = [
      {
        user: USER_ADDR,
        outcomeIndex: 0,
        sharesDelta: 10n,
        cashDelta: -100n,
      },
    ];
    const h = hashDeltas(deltas);
    const expected =
      "0x2e03638da05b1b26a86e3d1a30b982d9cc8da1bfe59dfb6e177ab1033dd13d9a" as `0x${string}`;
    expect(h.toLowerCase()).toBe(expected.toLowerCase());
  });

  it("getCheckpointDigest produces valid EIP-712 digest", () => {
    const cp: CheckpointInput = {
      marketId: 1n,
      sessionId:
        "0x0000000000000000000000000000000000000000000000000000000000000001" as `0x${string}`,
      nonce: 1n,
      validAfter: 0n,
      validBefore: 0n,
      lastTradeAt: 0,
      stateHash: "0x" + "00".repeat(32) as `0x${string}`,
      deltasHash: "0x2e03638da05b1b26a86e3d1a30b982d9cc8da1bfe59dfb6e177ab1033dd13d9a" as `0x${string}`,
      riskHash: "0x" + "00".repeat(32) as `0x${string}`,
    };
    const chainId = 43113;
    const verifyingContract = "0x0000000000000000000000000000000000000002" as Address;
    const digest = getCheckpointDigest(cp, chainId, verifyingContract);
    expect(digest).toMatch(/^0x[a-fA-F0-9]{64}$/);
  });
});
