/**
 * Gasless trading: create session, credit, buy, sell, swap - no RPC/chain calls.
 * Trades are purely off-chain (in-memory state). Passes without RPC_URL.
 */
import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../../src/api/routes.js";
import { clearAllSessions } from "../../src/state/store.js";
import type { Hex } from "viem";

const SESSION_ID = "0x0000000000000000000000000000000000000000000000000000000000000001" as Hex;
const USER_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

async function buildApp() {
  const app = Fastify();
  await registerApiRoutes(app);
  return app;
}

describe("Gasless trading", () => {
  beforeEach(() => {
    clearAllSessions();
  });

  it("create session, credit, buy - no RPC required", async () => {
    const app = await buildApp();

    const createRes = await app.inject({
      method: "POST",
      url: "/api/session/create",
      payload: {
        sessionId: SESSION_ID,
        marketId: "1",
        vaultId: "0x" + "aa".repeat(20),
        numOutcomes: 2,
        b: 100,
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

    const accountRes = await app.inject({
      method: "GET",
      url: `/api/session/${SESSION_ID}/account/${USER_ADDRESS}`,
    });
    expect(accountRes.statusCode).toBe(200);
    const account = JSON.parse(accountRes.payload);
    expect(Number(account.balance)).toBeLessThan(10000 * 1e6);
    expect(Number(account.positions[0])).toBeGreaterThan(0);
  });

  it("buy then sell - state updates off-chain", async () => {
    const app = await buildApp();

    await app.inject({
      method: "POST",
      url: "/api/session/create",
      payload: {
        sessionId: SESSION_ID,
        marketId: "1",
        vaultId: "0x" + "aa".repeat(20),
        numOutcomes: 2,
        b: 100,
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
        delta: 10,
        userAddress: USER_ADDRESS,
      },
    });

    const sellRes = await app.inject({
      method: "POST",
      url: "/api/trade/sell",
      payload: {
        sessionId: SESSION_ID,
        outcomeIndex: 0,
        delta: 5,
        userAddress: USER_ADDRESS,
      },
    });
    expect(sellRes.statusCode).toBe(200);

    const accountRes = await app.inject({
      method: "GET",
      url: `/api/session/${SESSION_ID}/account/${USER_ADDRESS}`,
    });
    const account = JSON.parse(accountRes.payload);
    expect(Number(account.positions[0])).toBe(5 * 1e6);
  });

  it("buy then swap - state updates off-chain", async () => {
    const app = await buildApp();

    await app.inject({
      method: "POST",
      url: "/api/session/create",
      payload: {
        sessionId: SESSION_ID,
        marketId: "1",
        vaultId: "0x" + "aa".repeat(20),
        numOutcomes: 2,
        b: 100,
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
        delta: 10,
        userAddress: USER_ADDRESS,
      },
    });

    const swapRes = await app.inject({
      method: "POST",
      url: "/api/trade/swap",
      payload: {
        sessionId: SESSION_ID,
        fromOutcome: 0,
        toOutcome: 1,
        delta: 5,
        userAddress: USER_ADDRESS,
      },
    });
    expect(swapRes.statusCode).toBe(200);

    const accountRes = await app.inject({
      method: "GET",
      url: `/api/session/${SESSION_ID}/account/${USER_ADDRESS}`,
    });
    const account = JSON.parse(accountRes.payload);
    expect(Number(account.positions[0])).toBe(5 * 1e6);
    expect(Number(account.positions[1])).toBeGreaterThan(0);
  });

  it("multiple trades - no chain interaction", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/api/session/create",
      payload: {
        sessionId: SESSION_ID,
        marketId: "1",
        vaultId: "0x" + "aa".repeat(20),
        numOutcomes: 2,
        b: 100,
      },
    });
    await app.inject({
      method: "POST",
      url: "/api/session/credit",
      payload: { sessionId: SESSION_ID, userAddress: USER_ADDRESS, amount: 50000 },
    });

    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/trade/buy",
        payload: {
          sessionId: SESSION_ID,
          outcomeIndex: i % 2,
          delta: 5,
          userAddress: USER_ADDRESS,
        },
      });
      expect(res.statusCode).toBe(200);
    }

    const accountRes = await app.inject({
      method: "GET",
      url: `/api/session/${SESSION_ID}/account/${USER_ADDRESS}`,
    });
    expect(accountRes.statusCode).toBe(200);
  });
});
