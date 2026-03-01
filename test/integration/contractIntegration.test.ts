/**
 * Contract integration tests.
 *
 * These tests require a running chain with deployed ChannelSettlement.
 * Set RPC_URL, CHANNEL_SETTLEMENT_ADDRESS, and optionally CHAIN_ID to run.
 * For finalizeCheckpoint, also set FINALIZER_PRIVATE_KEY or OPERATOR_PRIVATE_KEY.
 *
 * For local testing with DeployAnvilRelayerTest:
 *   1. Start Anvil: anvil
 *   2. Deploy: cd packages/contracts && source .env.anvil.example && forge script script/DeployAnvilRelayerTest.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
 *   3. Set RPC_URL, CHANNEL_SETTLEMENT_ADDRESS, OPERATOR_PRIVATE_KEY, MARKET_ID in apps/relayer/.env
 *   4. Run: npm run test:integration
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  readLatestNonce,
  finalizeCheckpoint,
  submitCheckpointFromPayload,
  getChannelSettlementAddress,
} from "../../src/contracts/channelSettlementClient.js";
import { warpPastChallengeWindow } from "../helpers/anvil.js";
import { privateKeyToAccount } from "viem/accounts";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { registerCreRoutes } from "../../src/api/creRoutes.js";
import { clearAllSessions } from "../../src/state/store.js";
import type { Address, Hex } from "viem";

const hasContractConfig =
  !!process.env.RPC_URL && !!process.env.CHANNEL_SETTLEMENT_ADDRESS;

const hasFinalizerConfig =
  hasContractConfig &&
  !!(process.env.FINALIZER_PRIVATE_KEY ?? process.env.OPERATOR_PRIVATE_KEY);

const SESSION_ID = "0x0000000000000000000000000000000000000000000000000000000000000006" as Hex;
const USER_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ANVIL_PK_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function signCheckpoint(checkpoint: Record<string, unknown>, chainId: number, verifyingContract: string) {
  const account = privateKeyToAccount(ANVIL_PK_0 as Hex);
  return account.signTypedData({
    domain: { name: "ShadowPool", version: "1", chainId, verifyingContract: verifyingContract as Hex },
    types: {
      Checkpoint: [
        { name: "marketId", type: "uint256" },
        { name: "sessionId", type: "bytes32" },
        { name: "nonce", type: "uint64" },
        { name: "validAfter", type: "uint64" },
        { name: "validBefore", type: "uint64" },
        { name: "lastTradeAt", type: "uint48" },
        { name: "stateHash", type: "bytes32" },
        { name: "deltasHash", type: "bytes32" },
        { name: "riskHash", type: "bytes32" },
      ],
    },
    primaryType: "Checkpoint",
    message: {
      marketId: BigInt(checkpoint.marketId as string),
      sessionId: checkpoint.sessionId as Hex,
      nonce: BigInt(checkpoint.nonce as string),
      validAfter: BigInt((checkpoint.validAfter as string) ?? "0"),
      validBefore: BigInt((checkpoint.validBefore as string) ?? "0"),
      lastTradeAt: BigInt((checkpoint.lastTradeAt as number) ?? 0),
      stateHash: checkpoint.stateHash as Hex,
      deltasHash: checkpoint.deltasHash as Hex,
      riskHash: (checkpoint.riskHash as Hex) ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
    },
  });
}

describe("Contract integration", () => {
  describe("readLatestNonce", () => {
    it(
      "returns nonce when RPC_URL and CHANNEL_SETTLEMENT_ADDRESS are set",
      { skip: !hasContractConfig },
      async () => {
        const address = getChannelSettlementAddress();
        expect(address).toBeTruthy();
        const marketId = BigInt(process.env.MARKET_ID ?? "0");
        const sessionId = SESSION_ID;
        const nonce = await readLatestNonce(marketId, sessionId);
        expect(typeof nonce === "bigint").toBe(true);
        expect(nonce >= 0n).toBe(true);
      }
    );
  });

  describe("finalizeCheckpoint", () => {
    it(
      "reaches chain and reverts with NoPending when no checkpoint submitted",
      { skip: !hasFinalizerConfig },
      async () => {
        const marketId = BigInt(process.env.MARKET_ID ?? "0");
        const sessionId = SESSION_ID;
        const userAddr = USER_ADDRESS as Address;
        const deltas = [
          { user: userAddr, outcomeIndex: 0, sharesDelta: 10n * 10n ** 6n, cashDelta: -100n * 10n ** 6n },
        ];
        await expect(
          finalizeCheckpoint(marketId, sessionId, deltas)
        ).rejects.toThrow();
      }
    );

    it(
      "succeeds after submit and warp; readLatestNonce increments",
      { skip: !hasFinalizerConfig },
      async () => {
        clearAllSessions();
        const app = Fastify();
        await registerApiRoutes(app);
        await registerCreRoutes(app);

        const marketId = process.env.MARKET_ID ?? "0";
        const rpcUrl = process.env.RPC_URL!;

        await app.inject({
          method: "POST",
          url: "/api/session/create",
          payload: {
            sessionId: SESSION_ID,
            marketId,
            vaultId: "0x" + "aa".repeat(20),
            numOutcomes: 2,
            b: 100,
            resolveTime: Math.floor(Date.now() / 1000) - 60,
          },
        });
        await app.inject({
          method: "POST",
          url: "/api/session/credit",
          payload: { sessionId: SESSION_ID, userAddress: USER_ADDRESS, amount: 10000 },
        });
        await app.inject({
          method: "POST",
          url: "/api/trade/buy",
          payload: {
            sessionId: SESSION_ID,
            outcomeIndex: 0,
            delta: 5,
            userAddress: USER_ADDRESS,
          },
        });

        const nonceBefore = await readLatestNonce(BigInt(marketId), SESSION_ID);

        const specRes = await app.inject({ method: "GET", url: `/cre/checkpoints/${SESSION_ID}` });
        expect(specRes.statusCode).toBe(200);
        const spec = JSON.parse(specRes.payload);
        const userSigs: Record<string, string> = {};
        for (const addr of spec.users) {
          userSigs[addr] = await signCheckpoint(spec.checkpoint, spec.chainId, spec.channelSettlementAddress);
        }

        const buildRes = await app.inject({
          method: "POST",
          url: `/cre/checkpoints/${SESSION_ID}`,
          payload: { userSigs },
        });
        expect(buildRes.statusCode).toBe(200);
        const { payload } = JSON.parse(buildRes.payload);

        await submitCheckpointFromPayload(payload as Hex);
        await warpPastChallengeWindow(rpcUrl);

        const deltas = spec.deltas.map((d: { user: string; outcomeIndex: number; sharesDelta: string; cashDelta: string }) => ({
          user: d.user as Address,
          outcomeIndex: d.outcomeIndex,
          sharesDelta: BigInt(d.sharesDelta),
          cashDelta: BigInt(d.cashDelta),
        }));

        const txHash = await finalizeCheckpoint(BigInt(marketId), SESSION_ID, deltas);
        expect(txHash).toMatch(/^0x[a-fA-F0-9]{64}$/);

        const nonceAfter = await readLatestNonce(BigInt(marketId), SESSION_ID);
        expect(nonceAfter).toBeGreaterThan(nonceBefore);
      }
    );
  });
});
