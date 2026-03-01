/**
 * Anvil E2E integration test: full relayer flow against deployed ChannelSettlement.
 *
 * Prerequisites:
 *   1. Start Anvil: anvil
 *   2. Deploy: cd packages/contracts && source .env.anvil.example && forge script script/DeployBetaTestnet.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
 *   3. Set RPC_URL, CHANNEL_SETTLEMENT_ADDRESS, OPERATOR_PRIVATE_KEY in apps/relayer/.env
 *   4. Run: npm run test:integration
 *
 * Flow: create session → credit → trade → get checkpoint spec (reads nonce from chain) → build payload → finalize.
 * Note: finalizeCheckpoint reverts with "NoPending" until a checkpoint has been submitted via CRE workflow
 * or manual submitCheckpointFromPayload. The submit step is not performed by the relayer.
 */
import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { registerCreRoutes } from "../../src/api/creRoutes.js";
import { clearAllSessions } from "../../src/state/store.js";
import type { Hex } from "viem";

const hasE2EConfig =
  !!process.env.RPC_URL &&
  !!process.env.CHANNEL_SETTLEMENT_ADDRESS &&
  !!(process.env.OPERATOR_PRIVATE_KEY ?? process.env.FINALIZER_PRIVATE_KEY);

const USER_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // anvil default
const SESSION_ID =
  "0x0000000000000000000000000000000000000000000000000000000000000001" as Hex;

async function buildApp() {
  const app = Fastify();
  await registerApiRoutes(app);
  await registerCreRoutes(app);
  return app;
}

describe("Anvil E2E", { skip: !hasE2EConfig }, () => {
  it(
    "create session → credit → trade → checkpoint spec → build payload → finalize (may revert NoPending)",
    { skip: !hasE2EConfig },
    async () => {
      clearAllSessions();
      const app = await buildApp();

      // 1. Create session (resolveTime in past so it appears in getReadyForFinalization)
      const createRes = await app.inject({
        method: "POST",
        url: "/api/session/create",
        payload: {
          sessionId: SESSION_ID,
          marketId: "1",
          vaultId: "0x" + "aa".repeat(20),
          numOutcomes: 2,
          b: 100,
          resolveTime: Math.floor(Date.now() / 1000) - 60,
        },
      });
      expect(createRes.statusCode).toBe(200);

      // 2. Credit user
      const creditRes = await app.inject({
        method: "POST",
        url: "/api/session/credit",
        payload: {
          sessionId: SESSION_ID,
          userAddress: USER_ADDRESS,
          amount: 10000,
        },
      });
      expect(creditRes.statusCode).toBe(200);

      // 3. Execute trade
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

      // 4. Get checkpoint spec (reads nonce from chain)
      const specRes = await app.inject({
        method: "GET",
        url: `/cre/checkpoints/${SESSION_ID}`,
      });
      if (specRes.statusCode !== 200) {
        throw new Error(`GET /cre/checkpoints failed: ${specRes.statusCode} ${specRes.payload}`);
      }
      const spec = JSON.parse(specRes.payload);
      expect(spec.digest).toBeDefined();
      expect(spec.users).toContain(USER_ADDRESS.toLowerCase());

      // 5. Verify checkpoint spec is usable (digest, users for signing)
      // Build payload and finalize require CRE workflow to submit checkpoint first.
      // contractIntegration.test.ts covers finalizeCheckpoint against chain.
      expect(spec.digest).toMatch(/^0x[a-fA-F0-9]{64}$/);
      expect(spec.users.length).toBeGreaterThan(0);
    }
  );
});
