/**
 * Full E2E: create session → credit → trade → submit → warp → finalize → verify on-chain.
 * Requires Anvil + DeployAnvilRelayerTest deployed; set RPC_URL, CHANNEL_SETTLEMENT_ADDRESS, OPERATOR_PRIVATE_KEY.
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
const USER_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;
const SESSION_ID = ("0x" + "00".repeat(31) + "01") as Hex;

async function buildApp() {
  const app = Fastify();
  await registerApiRoutes(app);
  await registerCreRoutes(app);
  return app;
}

function signCheckpointAsUser(checkpoint: Record<string, unknown>, chainId: number, verifyingContract: string) {
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

describe("Anvil trading flow", { skip: !hasE2EConfig }, () => {
  beforeEach(() => {
    clearAllSessions();
  });

  it(
    "create → credit → buy → checkpoint → submit → warp → finalize → verify outcome token",
    { skip: !hasE2EConfig },
    async () => {
      const app = await buildApp();
      const marketId = process.env.MARKET_ID ?? "0";
      const rpcUrl = process.env.RPC_URL!;
      const chainId = Number(process.env.CHAIN_ID ?? 31337);

      const createRes = await app.inject({
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
      expect(createRes.statusCode).toBe(200);

      const creditRes = await app.inject({
        method: "POST",
        url: "/api/session/credit",
        payload: { sessionId: SESSION_ID, userAddress: USER_ADDRESS, amount: 10000 },
      });
      expect(creditRes.statusCode).toBe(200);

      const buyRes = await app.inject({
        method: "POST",
        url: "/api/trade/buy",
        payload: {
          sessionId: SESSION_ID,
          outcomeIndex: 0,
          delta: 10,
          userAddress: USER_ADDRESS,
        },
      });
      expect(buyRes.statusCode).toBe(200);

      const specRes = await app.inject({ method: "GET", url: `/cre/checkpoints/${SESSION_ID}` });
      expect(specRes.statusCode).toBe(200);
      const spec = JSON.parse(specRes.payload);

      const userSigs: Record<string, string> = {};
      for (const addr of spec.users) {
        userSigs[addr] = await signCheckpointAsUser(
          spec.checkpoint,
          spec.chainId,
          spec.channelSettlementAddress
        );
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

      const finalizeRes = await app.inject({
        method: "POST",
        url: `/cre/finalize/${SESSION_ID}`,
      });
      expect(finalizeRes.statusCode).toBe(200);

      const outcomeTokenAddr = process.env.OUTCOME_TOKEN_ADDRESS;
      if (outcomeTokenAddr) {
        const client = createPublicClient({
          chain: { id: chainId, name: "Anvil", nativeCurrency: { decimals: 18, name: "ETH", symbol: "ETH" } } as any,
          transport: http(rpcUrl),
        });
        const idAbi = [{ inputs: [{ name: "marketId", type: "uint256" }, { name: "outcomeIndex", type: "uint32" }], name: "id", outputs: [{ type: "uint256" }], stateMutability: "pure", type: "function" }] as const;
        const balanceAbi = [{ inputs: [{ name: "account", type: "address" }, { name: "id", type: "uint256" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" }] as const;
        const tokenId = await client.readContract({
          address: outcomeTokenAddr as Hex,
          abi: idAbi,
          functionName: "id",
          args: [BigInt(marketId), 0],
        });
        const balance = await client.readContract({
          address: outcomeTokenAddr as Hex,
          abi: balanceAbi,
          functionName: "balanceOf",
          args: [USER_ADDRESS, tokenId],
        });
        expect(balance).toBeGreaterThanOrEqual(10n * 10n ** 6n);
      }
    }
  );
});
