/**
 * Resolution: session with resolveTime in past, checkpoint, submit, warp, finalize.
 * Asserts GET /cre/sessions includes session, finalize succeeds, latestNonce increments.
 */
import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { registerCreRoutes } from "../../src/api/creRoutes.js";
import { clearAllSessions } from "../../src/state/store.js";
import { submitCheckpointFromPayload, readLatestNonce } from "../../src/contracts/channelSettlementClient.js";
import { warpPastChallengeWindow } from "../helpers/anvil.js";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

const hasE2EConfig =
  !!process.env.RPC_URL &&
  !!process.env.CHANNEL_SETTLEMENT_ADDRESS &&
  !!(process.env.OPERATOR_PRIVATE_KEY ?? process.env.FINALIZER_PRIVATE_KEY);

const ANVIL_PK_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const USER_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const SESSION_ID = ("0x" + "00".repeat(31) + "02") as Hex;

async function buildApp() {
  const app = Fastify();
  await registerApiRoutes(app);
  await registerCreRoutes(app);
  return app;
}

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

describe("Anvil resolution", { skip: !hasE2EConfig }, () => {
  beforeEach(() => {
    clearAllSessions();
  });

  it(
    "session with past resolveTime appears in getReadyForFinalization, finalize increments nonce",
    { skip: !hasE2EConfig },
    async () => {
      const app = await buildApp();
      const marketId = process.env.MARKET_ID ?? "0";
      const rpcUrl = process.env.RPC_URL!;
      const resolveTime = Math.floor(Date.now() / 1000) - 120;

      await app.inject({
        method: "POST",
        url: "/api/session/create",
        payload: {
          sessionId: SESSION_ID,
          marketId,
          vaultId: "0x" + "aa".repeat(20),
          numOutcomes: 2,
          b: 100,
          resolveTime,
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

      const sessionsRes = await app.inject({ method: "GET", url: "/cre/sessions" });
      expect(sessionsRes.statusCode).toBe(200);
      const { sessions } = JSON.parse(sessionsRes.payload);
      expect(sessions.some((s: { sessionId: string }) => s.sessionId === SESSION_ID)).toBe(true);

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

      const finalizeRes = await app.inject({ method: "POST", url: `/cre/finalize/${SESSION_ID}` });
      expect(finalizeRes.statusCode).toBe(200);

      const nonceAfter = await readLatestNonce(BigInt(marketId), SESSION_ID);
      expect(nonceAfter).toBeGreaterThan(nonceBefore);
    }
  );
});
