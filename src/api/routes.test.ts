import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "./routes.js";
import { getSession, setSession, clearAllSessions } from "../state/store.js";
import { createSessionState, getOrCreateAccount } from "../state/sessionStore.js";

const USER = "0x0000000000000000000000000000000000000001";
function sessionId(seed: string) {
  return ("0x" + Buffer.from(seed).toString("hex").padEnd(64, "0").slice(0, 64)) as `0x${string}`;
}

async function buildApp() {
  const app = Fastify();
  await registerApiRoutes(app);
  return app;
}

describe("API Routes", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    clearAllSessions();
    app = await buildApp();
  });

  describe("session create", () => {
    it("creates session successfully", async () => {
      const sid = sessionId("create");
      const res = await app.inject({
        method: "POST",
        url: "/api/session/create",
        payload: {
          sessionId: sid,
          marketId: "1",
          vaultId: "0x" + "aa".repeat(20),
          numOutcomes: 3,
          b: 100,
        },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload).ok).toBe(true);
    });
  });

  describe("session credit", () => {
    it("credits user balance", async () => {
      const sid = sessionId("credit");
      const state = createSessionState(
        sid,
        1n,
        "0x" + "aa".repeat(20) as `0x${string}`,
        3,
        { b: 100 }
      );
      setSession(sid, state);
      const res = await app.inject({
        method: "POST",
        url: "/api/session/credit",
        payload: { sessionId: sid, userAddress: USER, amount: 1000 },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("trade buy", () => {
    it("buy success", async () => {
      const sid = sessionId("buy-ok");
      const state = createSessionState(
        sid,
        1n,
        "0x" + "aa".repeat(20) as `0x${string}`,
        3,
        { b: 100 }
      );
      const acc = getOrCreateAccount(state, USER);
      acc.balance = BigInt(1e9);
      acc.initialBalance = BigInt(1e9);
      setSession(sid, state);
      const res = await app.inject({
        method: "POST",
        url: "/api/trade/buy",
        payload: {
          sessionId: sid,
          outcomeIndex: 0,
          delta: 10,
          userAddress: USER,
        },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.ok).toBe(true);
      expect(body.cost).toBeGreaterThan(0);
    });

    it("buy rejects maxCost exceeded", async () => {
      const sid = sessionId("buy-maxcost");
      const state = createSessionState(
        sid,
        1n,
        "0x" + "aa".repeat(20) as `0x${string}`,
        3,
        { b: 100 }
      );
      const acc = getOrCreateAccount(state, USER);
      acc.balance = BigInt(1e9);
      acc.initialBalance = BigInt(1e9);
      setSession(sid, state);
      const res = await app.inject({
        method: "POST",
        url: "/api/trade/buy",
        payload: {
          sessionId: sid,
          outcomeIndex: 0,
          delta: 1000,
          maxCost: 0.01,
          userAddress: USER,
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("buy rejects minShares not met", async () => {
      const sid = sessionId("buy-minshares");
      const state = createSessionState(
        sid,
        1n,
        "0x" + "aa".repeat(20) as `0x${string}`,
        3,
        { b: 100 }
      );
      const acc = getOrCreateAccount(state, USER);
      acc.balance = BigInt(1e9);
      acc.initialBalance = BigInt(1e9);
      setSession(sid, state);
      const res = await app.inject({
        method: "POST",
        url: "/api/trade/buy",
        payload: {
          sessionId: sid,
          outcomeIndex: 0,
          delta: 1,
          minShares: 100,
          userAddress: USER,
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("buy rejects insufficient balance", async () => {
      const sid = sessionId("buy-insuff");
      const state = createSessionState(
        sid,
        1n,
        "0x" + "aa".repeat(20) as `0x${string}`,
        3,
        { b: 100 }
      );
      const acc = getOrCreateAccount(state, USER);
      acc.balance = 1n;
      acc.initialBalance = 1n;
      setSession(sid, state);
      const res = await app.inject({
        method: "POST",
        url: "/api/trade/buy",
        payload: {
          sessionId: sid,
          outcomeIndex: 0,
          delta: 100,
          userAddress: USER,
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("trade swap", () => {
    it("swap success", async () => {
      const sid = sessionId("swap-ok");
      const state = createSessionState(
        sid,
        1n,
        "0x" + "aa".repeat(20) as `0x${string}`,
        3,
        { b: 100 }
      );
      const acc = getOrCreateAccount(state, USER);
      acc.balance = BigInt(1e9);
      acc.initialBalance = BigInt(1e9);
      setSession(sid, state);
      await app.inject({
        method: "POST",
        url: "/api/trade/buy",
        payload: { sessionId: sid, outcomeIndex: 1, delta: 100, userAddress: USER },
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/trade/swap",
        payload: {
          sessionId: sid,
          fromOutcome: 1,
          toOutcome: 0,
          delta: 50,
          userAddress: USER,
        },
      });
      expect(res.statusCode).toBe(200);
    });

    it("swap rejects insufficient shares", async () => {
      const sid = sessionId("swap-insuff");
      const state = createSessionState(
        sid,
        1n,
        "0x" + "aa".repeat(20) as `0x${string}`,
        3,
        { b: 100 }
      );
      const acc = getOrCreateAccount(state, USER);
      acc.balance = BigInt(1e9);
      acc.initialBalance = BigInt(1e9);
      setSession(sid, state);
      await app.inject({
        method: "POST",
        url: "/api/trade/buy",
        payload: { sessionId: sid, outcomeIndex: 1, delta: 100, userAddress: USER },
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/trade/swap",
        payload: {
          sessionId: sid,
          fromOutcome: 1,
          toOutcome: 0,
          delta: 200,
          userAddress: USER,
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET quote", () => {
    it("quote buy", async () => {
      const sid = sessionId("quote-buy");
      const state = createSessionState(
        sid,
        1n,
        "0x" + "aa".repeat(20) as `0x${string}`,
        3,
        { b: 100 }
      );
      setSession(sid, state);
      const res = await app.inject({
        method: "GET",
        url: `/api/session/${sid}/quote?type=buy&outcomeIndex=0&delta=10`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.cost).toBeDefined();
      expect(body.prices).toHaveLength(3);
    });

    it("quote swap", async () => {
      const sid = sessionId("quote-swap");
      const state = createSessionState(
        sid,
        1n,
        "0x" + "aa".repeat(20) as `0x${string}`,
        3,
        { b: 100 }
      );
      setSession(sid, state);
      const res = await app.inject({
        method: "GET",
        url: `/api/session/${sid}/quote?type=swap&fromOutcome=0&toOutcome=1&delta=10`,
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("GET prices", () => {
    it("returns prices", async () => {
      const sid = sessionId("prices");
      const state = createSessionState(
        sid,
        1n,
        "0x" + "aa".repeat(20) as `0x${string}`,
        3,
        { b: 100 }
      );
      setSession(sid, state);
      const res = await app.inject({
        method: "GET",
        url: `/api/session/${sid}/prices`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.prices).toHaveLength(3);
    });
  });

  describe("GET session", () => {
    it("returns session metadata", async () => {
      const sid = sessionId("session");
      const state = createSessionState(
        sid,
        1n,
        "0x" + "aa".repeat(20) as `0x${string}`,
        3,
        { b: 100 }
      );
      state.riskCaps = { maxOI: 1000 };
      setSession(sid, state);
      const res = await app.inject({
        method: "GET",
        url: `/api/session/${sid}`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.sessionId).toBe(sid);
      expect(body.q).toHaveLength(3);
      expect(body.riskCaps?.maxOI).toBe(1000);
    });
  });

  describe("GET account", () => {
    it("returns account", async () => {
      const sid = sessionId("account");
      const state = createSessionState(
        sid,
        1n,
        "0x" + "aa".repeat(20) as `0x${string}`,
        3,
        { b: 100 }
      );
      const acc = getOrCreateAccount(state, USER);
      acc.balance = 500n;
      acc.positions = [100n, 200n];
      acc.initialBalance = 1000n;
      setSession(sid, state);
      const res = await app.inject({
        method: "GET",
        url: `/api/session/${sid}/account/${USER}`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.balance).toBe("500");
      expect(body.positions).toEqual(["100", "200"]);
    });
  });

  describe("risk caps", () => {
    it("buy rejects when maxOI exceeded", async () => {
      const sid = sessionId("riskcap");
      const state = createSessionState(
        sid,
        1n,
        "0x" + "aa".repeat(20) as `0x${string}`,
        2,
        { b: 100 }
      );
      state.riskCaps = { maxOI: 15 };
      const acc = getOrCreateAccount(state, USER);
      acc.balance = BigInt(1e12);
      acc.initialBalance = BigInt(1e12);
      setSession(sid, state);
      await app.inject({
        method: "POST",
        url: "/api/trade/buy",
        payload: { sessionId: sid, outcomeIndex: 0, delta: 10, userAddress: USER },
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/trade/buy",
        payload: { sessionId: sid, outcomeIndex: 0, delta: 10, userAddress: USER },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.payload).error).toContain("maxOI");
    });
  });

  describe("trade sell", () => {
    it("sell success", async () => {
      const sid = sessionId("sell-ok");
      const state = createSessionState(
        sid,
        1n,
        "0x" + "aa".repeat(20) as `0x${string}`,
        3,
        { b: 100 }
      );
      const acc = getOrCreateAccount(state, USER);
      acc.balance = BigInt(1e9);
      acc.initialBalance = BigInt(1e9);
      setSession(sid, state);
      await app.inject({
        method: "POST",
        url: "/api/trade/buy",
        payload: { sessionId: sid, outcomeIndex: 0, delta: 50, userAddress: USER },
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/trade/sell",
        payload: {
          sessionId: sid,
          outcomeIndex: 0,
          delta: 20,
          userAddress: USER,
        },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.cost).toBeLessThan(0);
    });

    it("sell rejects insufficient shares", async () => {
      const sid = sessionId("sell-insuff");
      const state = createSessionState(
        sid,
        1n,
        "0x" + "aa".repeat(20) as `0x${string}`,
        3,
        { b: 100 }
      );
      const acc = getOrCreateAccount(state, USER);
      acc.balance = BigInt(1e9);
      acc.initialBalance = BigInt(1e9);
      setSession(sid, state);
      await app.inject({
        method: "POST",
        url: "/api/trade/buy",
        payload: { sessionId: sid, outcomeIndex: 0, delta: 50, userAddress: USER },
      });
      const res = await app.inject({
        method: "POST",
        url: "/api/trade/sell",
        payload: {
          sessionId: sid,
          outcomeIndex: 0,
          delta: 1000,
          userAddress: USER,
        },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
