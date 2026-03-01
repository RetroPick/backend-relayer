/**
 * HTTP/WS API for trades (BuyShares, SwapShares) with constraint validation.
 * Per whitepaper: maxCost, minShares, maxOddsImpact
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  costBuy,
  costSwap,
  costSell,
  slippageBps,
  avgExecutionPriceBuy,
  prices as lmsrPrices,
  openInterest,
  type LMSRParams,
} from "../matching/lmsr.js";
import { createSessionState, getOrCreateAccount, hashSessionState } from "../state/sessionStore.js";
import { getSession, setSession } from "../state/store.js";
import type { Hex } from "viem";

const BuySharesSchema = z.object({
  sessionId: z.string().regex(/^0x[a-fA-F0-9]+$/),
  outcomeIndex: z.number().int().min(0),
  delta: z.number().positive(),
  maxCost: z.number().optional(),
  minShares: z.number().optional(),
  maxOddsImpactBps: z.number().optional(),
  userAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

const SellSharesSchema = z.object({
  sessionId: z.string().regex(/^0x[a-fA-F0-9]+$/),
  outcomeIndex: z.number().int().min(0),
  delta: z.number().positive(),
  minReceive: z.number().optional(),
  maxOddsImpactBps: z.number().optional(),
  userAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

const SwapSharesSchema = z.object({
  sessionId: z.string().regex(/^0x[a-fA-F0-9]+$/),
  fromOutcome: z.number().int().min(0),
  toOutcome: z.number().int().min(0),
  delta: z.number().positive(),
  maxCost: z.number().optional(),
  minReceive: z.number().optional(),
  userAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

const CreditSchema = z.object({
  sessionId: z.string().regex(/^0x[a-fA-F0-9]+$/),
  userAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.number().positive(),
});

const CreateSessionSchema = z.object({
  sessionId: z.string().regex(/^0x[a-fA-F0-9]+$/),
  marketId: z.string().or(z.number()),
  vaultId: z.string().regex(/^0x[a-fA-F0-9]+$/),
  numOutcomes: z.number().int().min(2),
  b: z.number().positive(),
  b0: z.number().optional(),
  alpha: z.number().optional(),
  resolveTime: z.number().optional(),
  riskCaps: z
    .object({
      maxOI: z.number().positive().optional(),
      maxPosPerUser: z.number().positive().optional(),
      maxOddsImpactBps: z.number().int().min(0).optional(),
    })
    .optional(),
});

interface SessionIdParams {
  sessionId: string;
}

interface SessionIdAddressParams {
  sessionId: string;
  address: string;
}

export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/session/:sessionId/quote",
    async (
      req: FastifyRequest<{
        Params: SessionIdParams;
        Querystring: { type: string; outcomeIndex?: string; fromOutcome?: string; toOutcome?: string; delta: string };
      }>,
      reply: FastifyReply
    ) => {
      const { sessionId } = req.params;
      const { type, outcomeIndex, fromOutcome, toOutcome, delta: deltaStr } = req.query ?? {};
      const state = getSession(sessionId as Hex);
      if (!state) return reply.status(404).send({ error: "Session not found" });

      const delta = parseFloat(deltaStr ?? "0");
      if (!delta || delta <= 0) return reply.status(400).send({ error: "delta required and must be positive" });

      const tau = state.feeParams.tau;
      const feeRate = tau;

      if (type === "buy") {
        const k = parseInt(outcomeIndex ?? "0", 10);
        if (k < 0 || k >= state.q.length) return reply.status(400).send({ error: "invalid outcomeIndex" });
        const costVal = costBuy(state.q, k, delta, state.bParams);
        const netCost = costVal * (1 + tau);
        const avgPrice = avgExecutionPriceBuy(state.q, k, delta, state.bParams);
        const slip = slippageBps(state.q, k, delta, state.bParams);
        const priceVec = lmsrPrices(state.q, state.bParams);
        return {
          cost: costVal,
          netCost,
          avgPrice,
          slippageBps: slip,
          prices: priceVec,
          feeRate,
        };
      }
      if (type === "swap") {
        const i = parseInt(fromOutcome ?? "0", 10);
        const j = parseInt(toOutcome ?? "0", 10);
        if (i < 0 || i >= state.q.length) return reply.status(400).send({ error: "invalid fromOutcome" });
        if (j < 0 || j >= state.q.length) return reply.status(400).send({ error: "invalid toOutcome" });
        if (i === j) return reply.status(400).send({ error: "fromOutcome and toOutcome must differ" });
        const costVal = costSwap(state.q, i, j, delta, state.bParams);
        const netCost = costVal > 0 ? costVal * (1 + tau) : costVal;
        const priceVec = lmsrPrices(state.q, state.bParams);
        return {
          cost: costVal,
          netCost,
          prices: priceVec,
          feeRate,
        };
      }
      return reply.status(400).send({ error: "type must be buy or swap" });
    }
  );

  app.get(
    "/api/session/:sessionId/prices",
    async (req: FastifyRequest<{ Params: SessionIdParams }>, reply: FastifyReply) => {
      const { sessionId } = req.params;
      const state = getSession(sessionId as Hex);
      if (!state) return reply.status(404).send({ error: "Session not found" });
      const priceVec = lmsrPrices(state.q, state.bParams);
      return { prices: priceVec };
    }
  );

  app.get(
    "/api/session/:sessionId",
    async (req: FastifyRequest<{ Params: SessionIdParams }>, reply: FastifyReply) => {
      const { sessionId } = req.params;
      const state = getSession(sessionId as Hex);
      if (!state) return reply.status(404).send({ error: "Session not found" });
      return {
        sessionId: state.sessionId,
        marketId: state.marketId.toString(),
        vaultId: state.vaultId,
        nonce: state.nonce.toString(),
        q: state.q,
        bParams: state.bParams,
        resolveTime: state.resolveTime,
        lastTradeAt: state.lastTradeAt,
        feeParams: state.feeParams,
        riskCaps: state.riskCaps,
      };
    }
  );

  app.get(
    "/api/session/:sessionId/account/:address",
    async (req: FastifyRequest<{ Params: SessionIdAddressParams }>, reply: FastifyReply) => {
      const { sessionId, address } = req.params;
      const state = getSession(sessionId as Hex);
      if (!state) return reply.status(404).send({ error: "Session not found" });
      const acc = getOrCreateAccount(state, address);
      return {
        address: address.toLowerCase(),
        balance: acc.balance.toString(),
        positions: acc.positions.map((p) => p.toString()),
        initialBalance: (acc.initialBalance ?? 0n).toString(),
      };
    }
  );

  app.post("/api/session/create", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = CreateSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }
    const { sessionId, marketId, vaultId, numOutcomes, b, b0, alpha, resolveTime, riskCaps } = parsed.data;
    const bParams: LMSRParams = { b, b0, alpha };
    const state = createSessionState(
      sessionId as Hex,
      BigInt(marketId),
      vaultId as Hex,
      numOutcomes,
      bParams
    );
    if (resolveTime !== undefined) state.resolveTime = resolveTime;
    if (riskCaps !== undefined) state.riskCaps = riskCaps;
    setSession(sessionId as Hex, state);
    return { ok: true, sessionId };
  });

  app.post("/api/session/credit", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = CreditSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
    const { sessionId, userAddress, amount } = parsed.data;
    const state = getSession(sessionId as Hex);
    if (!state) return reply.status(404).send({ error: "Session not found" });
    const acc = getOrCreateAccount(state, userAddress);
    const credit = BigInt(Math.floor(amount * 1e6));
    acc.balance += credit;
    acc.initialBalance = (acc.initialBalance ?? 0n) + credit;
    setSession(sessionId as Hex, state);
    return { ok: true, balance: acc.balance.toString() };
  });

  app.post("/api/trade/buy", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = BuySharesSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }
    const { sessionId, outcomeIndex, delta, maxCost, minShares, maxOddsImpactBps, userAddress } =
      parsed.data;

    const state = getSession(sessionId as Hex);
    if (!state) return reply.status(404).send({ error: "Session not found" });

    const buyCost = costBuy(state.q, outcomeIndex, delta, state.bParams);
    const tau = state.feeParams.tau;
    const netCost = buyCost * (1 + tau);

    if (maxCost !== undefined && netCost > maxCost) {
      return reply.status(400).send({ error: "maxCost exceeded" });
    }
    if (minShares !== undefined && delta < minShares) {
      return reply.status(400).send({ error: "minShares not met" });
    }
    const slip = slippageBps(state.q, outcomeIndex, delta, state.bParams);
    if (maxOddsImpactBps !== undefined && slip > maxOddsImpactBps) {
      return reply.status(400).send({ error: "maxOddsImpact exceeded" });
    }

    const acc = getOrCreateAccount(state, userAddress);
    if (acc.balance < BigInt(Math.ceil(netCost * 1e6))) {
      return reply.status(400).send({ error: "Insufficient balance" });
    }

    const newQ = [...state.q];
    while (newQ.length <= outcomeIndex) newQ.push(0);
    newQ[outcomeIndex] = (newQ[outcomeIndex] ?? 0) + delta;
    const rc = state.riskCaps;
    if (rc?.maxOI !== undefined && openInterest(newQ) > rc.maxOI) {
      return reply.status(400).send({ error: "maxOI exceeded" });
    }
    if (rc?.maxPosPerUser !== undefined) {
      const newPos = (acc.positions[outcomeIndex] ?? 0n) + BigInt(Math.floor(delta * 1e6));
      if (newPos > BigInt(Math.floor(rc.maxPosPerUser * 1e6))) {
        return reply.status(400).send({ error: "maxPosPerUser exceeded" });
      }
    }

    acc.balance -= BigInt(Math.ceil(netCost * 1e6));
    const posIdx = outcomeIndex;
    while (acc.positions.length <= posIdx) acc.positions.push(0n);
    acc.positions[posIdx] = (acc.positions[posIdx] ?? 0n) + BigInt(Math.floor(delta * 1e6));
    state.q[outcomeIndex] = (state.q[outcomeIndex] ?? 0) + delta;
    state.nonce += 1n;
    state.lastTradeAt = Math.floor(Date.now() / 1000);
    state.prevStateHash = hashSessionState(state);

    setSession(sessionId as Hex, state);
    return {
      ok: true,
      cost: buyCost,
      netCost,
      delta,
      nonce: state.nonce.toString(),
    };
  });

  app.post("/api/trade/swap", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = SwapSharesSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }
    const { sessionId, fromOutcome, toOutcome, delta, maxCost, minReceive, userAddress } =
      parsed.data;

    const state = getSession(sessionId as Hex);
    if (!state) return reply.status(404).send({ error: "Session not found" });

    const acc = getOrCreateAccount(state, userAddress);
    const fromPos = acc.positions[fromOutcome] ?? 0n;
    if (fromPos < BigInt(Math.floor(delta * 1e6))) {
      return reply.status(400).send({ error: "Insufficient shares to swap" });
    }

    const costVal = costSwap(state.q, fromOutcome, toOutcome, delta, state.bParams);
    if (costVal > 0 && maxCost !== undefined && costVal > maxCost) {
      return reply.status(400).send({ error: "maxCost exceeded" });
    }
    if (costVal < 0 && minReceive !== undefined && Math.abs(costVal) < minReceive) {
      return reply.status(400).send({ error: "minReceive not met" });
    }

    const newQ = [...state.q];
    newQ[fromOutcome] = (state.q[fromOutcome] ?? 0) - delta;
    newQ[toOutcome] = (state.q[toOutcome] ?? 0) + delta;
    const rc = state.riskCaps;
    if (rc?.maxOI !== undefined && openInterest(newQ) > rc.maxOI) {
      return reply.status(400).send({ error: "maxOI exceeded" });
    }
    if (rc?.maxPosPerUser !== undefined) {
      const newToPos = (acc.positions[toOutcome] ?? 0n) + BigInt(Math.floor(delta * 1e6));
      if (newToPos > BigInt(Math.floor(rc.maxPosPerUser * 1e6))) {
        return reply.status(400).send({ error: "maxPosPerUser exceeded" });
      }
    }

    acc.positions[fromOutcome] = fromPos - BigInt(Math.floor(delta * 1e6));
    while (acc.positions.length <= toOutcome) acc.positions.push(0n);
    acc.positions[toOutcome] = (acc.positions[toOutcome] ?? 0n) + BigInt(Math.floor(delta * 1e6));
    state.q[fromOutcome] = (state.q[fromOutcome] ?? 0) - delta;
    state.q[toOutcome] = (state.q[toOutcome] ?? 0) + delta;
    if (costVal < 0) {
      acc.balance += BigInt(Math.floor(Math.abs(costVal) * (1 - state.feeParams.tau) * 1e6));
    }
    state.nonce += 1n;
    state.lastTradeAt = Math.floor(Date.now() / 1000);
    state.prevStateHash = hashSessionState(state);

    setSession(sessionId as Hex, state);
    return {
      ok: true,
      cost: costVal,
      nonce: state.nonce.toString(),
    };
  });

  app.post("/api/trade/sell", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = SellSharesSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }
    const { sessionId, outcomeIndex, delta, minReceive, maxOddsImpactBps, userAddress } = parsed.data;

    const state = getSession(sessionId as Hex);
    if (!state) return reply.status(404).send({ error: "Session not found" });

    const acc = getOrCreateAccount(state, userAddress);
    const posScaled = acc.positions[outcomeIndex] ?? 0n;
    const deltaScaled = BigInt(Math.floor(delta * 1e6));
    if (posScaled < deltaScaled) {
      return reply.status(400).send({ error: "Insufficient shares to sell" });
    }

    const costVal = costSell(state.q, outcomeIndex, delta, state.bParams);
    if (costVal >= 0) {
      return reply.status(400).send({ error: "Sell cost must be negative (trader receives)" });
    }
    const receiveGross = Math.abs(costVal);
    const tau = state.feeParams.tau;
    const receiveNet = receiveGross * (1 - tau);

    if (minReceive !== undefined && receiveNet < minReceive) {
      return reply.status(400).send({ error: "minReceive not met" });
    }

    if (maxOddsImpactBps !== undefined) {
      const p = lmsrPrices(state.q, state.bParams);
      const pk = p[outcomeIndex] ?? 0;
      if (pk > 0) {
        const avgPrice = receiveGross / delta;
        const slipBps = Math.round(10000 * (pk - avgPrice) / pk);
        if (slipBps > maxOddsImpactBps) {
          return reply.status(400).send({ error: "maxOddsImpact exceeded" });
        }
      }
    }

    const newQk = (state.q[outcomeIndex] ?? 0) - delta;
    if (newQk < 0) {
      return reply.status(400).send({ error: "Sell would create negative q; not allowed" });
    }

    acc.balance += BigInt(Math.floor(receiveNet * 1e6));
    acc.positions[outcomeIndex] = posScaled - deltaScaled;
    state.q[outcomeIndex] = newQk;
    state.nonce += 1n;
    state.lastTradeAt = Math.floor(Date.now() / 1000);
    state.prevStateHash = hashSessionState(state);

    setSession(sessionId as Hex, state);
    return {
      ok: true,
      cost: costVal,
      receiveNet,
      delta,
      nonce: state.nonce.toString(),
    };
  });
}
