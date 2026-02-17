/**
 * HTTP/WS API for trades (BuyShares, SwapShares) with constraint validation.
 * Per whitepaper: maxCost, minShares, maxOddsImpact
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { costBuy, costSwap, slippageBps, type LMSRParams } from "../matching/lmsr.js";
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
});

export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/session/create", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = CreateSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }
    const { sessionId, marketId, vaultId, numOutcomes, b, b0, alpha, resolveTime } = parsed.data;
    const bParams: LMSRParams = { b, b0, alpha };
    const state = createSessionState(
      sessionId as Hex,
      BigInt(marketId),
      vaultId as Hex,
      numOutcomes,
      bParams
    );
    if (resolveTime !== undefined) state.resolveTime = resolveTime;
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

    acc.balance -= BigInt(Math.ceil(netCost * 1e6));
    const posIdx = outcomeIndex;
    while (acc.positions.length <= posIdx) acc.positions.push(0n);
    acc.positions[posIdx] = (acc.positions[posIdx] ?? 0n) + BigInt(Math.floor(delta * 1e6));
    state.q[outcomeIndex] = (state.q[outcomeIndex] ?? 0) + delta;
    state.nonce += 1n;
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

    acc.positions[fromOutcome] = fromPos - BigInt(Math.floor(delta * 1e6));
    while (acc.positions.length <= toOutcome) acc.positions.push(0n);
    acc.positions[toOutcome] = (acc.positions[toOutcome] ?? 0n) + BigInt(Math.floor(delta * 1e6));
    state.q[fromOutcome] = (state.q[fromOutcome] ?? 0) - delta;
    state.q[toOutcome] = (state.q[toOutcome] ?? 0) + delta;
    if (costVal < 0) {
      acc.balance += BigInt(Math.floor(Math.abs(costVal) * (1 - state.feeParams.tau) * 1e6));
    }
    state.nonce += 1n;
    state.prevStateHash = hashSessionState(state);

    setSession(sessionId as Hex, state);
    return {
      ok: true,
      cost: costVal,
      nonce: state.nonce.toString(),
    };
  });
}
