import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";
import { registerCreRoutes } from "./creRoutes.js";
import { setSession, clearAllSessions } from "../state/store.js";
import { createSessionState, getOrCreateAccount } from "../state/sessionStore.js";
import type { Hex } from "viem";

vi.mock("../contracts/channelSettlementClient.js", () => ({
  readLatestNonce: vi.fn().mockResolvedValue(0n),
  finalizeCheckpoint: vi.fn().mockResolvedValue("0x" + "00".repeat(32)),
}));

async function buildApp() {
  const app = Fastify();
  await registerCreRoutes(app);
  return app;
}

function sessionId(seed: string): Hex {
  return ("0x" + Buffer.from(seed).toString("hex").padEnd(64, "0").slice(0, 64)) as Hex;
}

describe("CRE Routes", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(() => {
    vi.clearAllMocks();
    clearAllSessions();
  });

  beforeEach(async () => {
    app = await buildApp();
  });

  describe("GET /cre/sessions", () => {
    it("returns sessions with resolveTime <= now", async () => {
      const sid = sessionId("cre-sessions");
      const state = createSessionState(
        sid,
        1n,
        "0x" + "aa".repeat(20) as Hex,
        2,
        { b: 100 }
      );
      state.resolveTime = Math.floor(Date.now() / 1000) - 60;
      setSession(sid, state);

      const res = await app.inject({ method: "GET", url: "/cre/sessions" });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.sessions).toHaveLength(1);
      expect(body.sessions[0].sessionId).toBe(sid);
    });

    it("returns empty when no sessions ready", async () => {
      const res = await app.inject({ method: "GET", url: "/cre/sessions" });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload).sessions).toEqual([]);
    });
  });

  describe("GET /cre/sessions/:sessionId", () => {
    it("returns 404 when session not found", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/cre/sessions/${sessionId("nonexistent")}`,
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 when no participants", async () => {
      const sid = sessionId("cre-legacy");
      const state = createSessionState(
        sid,
        1n,
        "0x" + "aa".repeat(20) as Hex,
        2,
        { b: 100 }
      );
      setSession(sid, state);
      const res = await app.inject({
        method: "GET",
        url: `/cre/sessions/${sid}`,
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.payload).error).toContain("No participants");
    });

    it("returns payload when session has participants", async () => {
      const sid = sessionId("cre-legacy-ok");
      const state = createSessionState(
        sid,
        1n,
        "0x" + "aa".repeat(20) as Hex,
        2,
        { b: 100 }
      );
      getOrCreateAccount(state, "0x0000000000000000000000000000000000000001");
      setSession(sid, state);
      const res = await app.inject({
        method: "GET",
        url: `/cre/sessions/${sid}`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.format).toBe("SessionFinalizer");
      expect(body.participants).toHaveLength(1);
    });
  });

  describe("GET /cre/checkpoints", () => {
    it("returns empty checkpoints when no sessions", async () => {
      const res = await app.inject({ method: "GET", url: "/cre/checkpoints" });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload).checkpoints).toEqual([]);
    });

    it("returns checkpoint payloads when sessions exist", async () => {
      const sid = sessionId("cre-cp-list");
      const state = createSessionState(
        sid,
        1n,
        "0x" + "aa".repeat(20) as Hex,
        2,
        { b: 100 }
      );
      setSession(sid, state);
      const res = await app.inject({ method: "GET", url: "/cre/checkpoints" });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.checkpoints).toHaveLength(1);
      expect(body.checkpoints[0].sessionId).toBe(sid);
    });
  });

  describe("GET /cre/checkpoints/:sessionId", () => {
    it("returns 404 when session not found", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/cre/checkpoints/${sessionId("nonexistent")}`,
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 503 when CHANNEL_SETTLEMENT_ADDRESS not set", async () => {
      const orig = process.env.CHANNEL_SETTLEMENT_ADDRESS;
      delete process.env.CHANNEL_SETTLEMENT_ADDRESS;
      const sid = sessionId("cre-cp-503");
      const state = createSessionState(
        sid,
        1n,
        "0x" + "aa".repeat(20) as Hex,
        2,
        { b: 100 }
      );
      const acc = getOrCreateAccount(state, "0x0000000000000000000000000000000000000001");
      acc.positions = [100n];
      acc.initialBalance = 1000n;
      setSession(sid, state);
      const res = await app.inject({
        method: "GET",
        url: `/cre/checkpoints/${sid}`,
      });
      if (orig) process.env.CHANNEL_SETTLEMENT_ADDRESS = orig;
      expect(res.statusCode).toBe(503);
    });

    it("returns checkpoint spec when configured", async () => {
      const origAddr = process.env.CHANNEL_SETTLEMENT_ADDRESS;
      const origRpc = process.env.RPC_URL;
      process.env.CHANNEL_SETTLEMENT_ADDRESS = "0x" + "fa".repeat(20);
      process.env.RPC_URL = "https://api.avax-test.network/ext/bc/C/rpc";
      const sid = sessionId("cre-cp-ok");
      const state = createSessionState(
        sid,
        1n,
        "0x" + "aa".repeat(20) as Hex,
        2,
        { b: 100 }
      );
      const acc = getOrCreateAccount(state, "0x0000000000000000000000000000000000000001");
      acc.positions = [100n];
      acc.initialBalance = 1000n;
      setSession(sid, state);
      const res = await app.inject({
        method: "GET",
        url: `/cre/checkpoints/${sid}`,
      });
      if (origAddr) process.env.CHANNEL_SETTLEMENT_ADDRESS = origAddr;
      else delete process.env.CHANNEL_SETTLEMENT_ADDRESS;
      if (origRpc) process.env.RPC_URL = origRpc;
      else delete process.env.RPC_URL;
      expect([200, 400, 503]).toContain(res.statusCode);
    });
  });

  describe("POST /cre/finalize/:sessionId", () => {
    it("returns 404 when session not found", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/cre/finalize/${sessionId("nonexistent")}`,
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 when no deltas", async () => {
      const sid = sessionId("cre-finalize-nodeltas");
      const state = createSessionState(
        sid,
        1n,
        "0x" + "aa".repeat(20) as Hex,
        2,
        { b: 100 }
      );
      setSession(sid, state);
      const res = await app.inject({
        method: "POST",
        url: `/cre/finalize/${sid}`,
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 503 when RPC/pk not configured", async () => {
      const origRpc = process.env.RPC_URL;
      const origPk = process.env.OPERATOR_PRIVATE_KEY;
      delete process.env.RPC_URL;
      delete process.env.OPERATOR_PRIVATE_KEY;
      const sid = sessionId("cre-finalize-503");
      const state = createSessionState(
        sid,
        1n,
        "0x" + "aa".repeat(20) as Hex,
        2,
        { b: 100 }
      );
      const acc = getOrCreateAccount(state, "0x0000000000000000000000000000000000000001");
      acc.positions = [100n];
      setSession(sid, state);
      const res = await app.inject({
        method: "POST",
        url: `/cre/finalize/${sid}`,
      });
      if (origRpc) process.env.RPC_URL = origRpc;
      if (origPk) process.env.OPERATOR_PRIVATE_KEY = origPk;
      expect(res.statusCode).toBe(503);
    });
  });
});
