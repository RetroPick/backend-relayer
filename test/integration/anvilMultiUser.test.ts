/**
 * Multi-user: two users credited, each trades, single checkpoint with both in deltas.
 * Both users must have deposited to MultiAssetVault (DeployAnvilRelayerTest does user0, user1, user2).
 * Uses anvil account 0 and 1.
 */
import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { registerCreRoutes } from "../../src/api/creRoutes.js";
import { clearAllSessions } from "../../src/state/store.js";
import { submitCheckpointFromPayload } from "../../src/contracts/channelSettlementClient.js";
import { warpPastChallengeWindow } from "../helpers/anvil.js";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http } from "viem";
import type { Hex } from "viem";

const hasE2EConfig =
  !!process.env.RPC_URL &&
  !!process.env.CHANNEL_SETTLEMENT_ADDRESS &&
  !!(process.env.OPERATOR_PRIVATE_KEY ?? process.env.FINALIZER_PRIVATE_KEY);

const ANVIL_PK_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const ANVIL_PK_1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const USER_0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const USER_1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const SESSION_ID = ("0x" + "00".repeat(31) + "04") as Hex;

const PRIVATE_KEYS: Record<string, string> = {
  [USER_0.toLowerCase()]: ANVIL_PK_0,
  [USER_1.toLowerCase()]: ANVIL_PK_1,
};

async function buildApp() {
  const app = Fastify();
  await registerApiRoutes(app);
  await registerCreRoutes(app);
  return app;
}

function signCheckpointAsUser(checkpoint: Record<string, unknown>, chainId: number, verifyingContract: string, userAddr: string) {
  const pk = PRIVATE_KEYS[userAddr.toLowerCase()];
  if (!pk) throw new Error(`No key for ${userAddr}`);
  const account = privateKeyToAccount(pk as Hex);
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

describe("Anvil multi-user", { skip: !hasE2EConfig }, () => {
  beforeEach(() => {
    clearAllSessions();
  });

  it(
    "two users trade, single checkpoint, both positions on-chain",
    { skip: !hasE2EConfig },
    async () => {
      const app = await buildApp();
      const marketId = process.env.MARKET_ID ?? "0";
      const rpcUrl = process.env.RPC_URL!;
      const chainId = Number(process.env.CHAIN_ID ?? 31337);

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
        payload: { sessionId: SESSION_ID, userAddress: USER_0, amount: 10000 },
      });
      await app.inject({
        method: "POST",
        url: "/api/session/credit",
        payload: { sessionId: SESSION_ID, userAddress: USER_1, amount: 10000 },
      });
      await app.inject({
        method: "POST",
        url: "/api/trade/buy",
        payload: { sessionId: SESSION_ID, outcomeIndex: 0, delta: 5, userAddress: USER_0 },
      });
      await app.inject({
        method: "POST",
        url: "/api/trade/buy",
        payload: { sessionId: SESSION_ID, outcomeIndex: 1, delta: 3, userAddress: USER_1 },
      });

      const specRes = await app.inject({ method: "GET", url: `/cre/checkpoints/${SESSION_ID}` });
      expect(specRes.statusCode).toBe(200);
      const spec = JSON.parse(specRes.payload);
      expect(spec.users.length).toBeGreaterThanOrEqual(2);

      const userSigs: Record<string, string> = {};
      for (const addr of spec.users) {
        userSigs[addr] = await signCheckpointAsUser(spec.checkpoint, spec.chainId, spec.channelSettlementAddress, addr);
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

      const outcomeTokenAddr = process.env.OUTCOME_TOKEN_ADDRESS;
      if (outcomeTokenAddr) {
        const client = createPublicClient({
          chain: { id: chainId, name: "Anvil", nativeCurrency: { decimals: 18, name: "ETH", symbol: "ETH" } } as any,
          transport: http(rpcUrl),
        });
        const idAbi = [{ inputs: [{ name: "marketId", type: "uint256" }, { name: "outcomeIndex", type: "uint32" }], name: "id", outputs: [{ type: "uint256" }], stateMutability: "pure", type: "function" }] as const;
        const balanceAbi = [{ inputs: [{ name: "account", type: "address" }, { name: "id", type: "uint256" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" }] as const;
        const tokenId0 = await client.readContract({ address: outcomeTokenAddr as Hex, abi: idAbi, functionName: "id", args: [BigInt(marketId), 0] });
        const tokenId1 = await client.readContract({ address: outcomeTokenAddr as Hex, abi: idAbi, functionName: "id", args: [BigInt(marketId), 1] });
        const bal0 = await client.readContract({ address: outcomeTokenAddr as Hex, abi: balanceAbi, functionName: "balanceOf", args: [USER_0 as Hex, tokenId0] });
        const bal1 = await client.readContract({ address: outcomeTokenAddr as Hex, abi: balanceAbi, functionName: "balanceOf", args: [USER_1 as Hex, tokenId1] });
        expect(bal0).toBeGreaterThan(0n);
        expect(bal1).toBeGreaterThan(0n);
      }
    }
  );
});
