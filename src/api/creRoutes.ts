/**
 * Endpoints for CRE workflow to fetch final session state.
 * GET /cre/sessions - list sessions ready for finalization
 * GET /cre/sessions/:sessionId - get session payload (legacy SessionFinalizer format)
 * GET /cre/checkpoints - get checkpoint metadata for all sessions
 * GET /cre/checkpoints/:sessionId - get checkpoint spec for ChannelSettlement (digest, users, etc.)
 * POST /cre/checkpoints/:sessionId - build full checkpoint payload with operator + user sigs
 * POST /cre/finalize/:sessionId - submit finalizeCheckpoint tx (permissionless; relayer convenience)
 * POST /cre/cancel/:sessionId - submit cancelPendingCheckpoint tx (after 6 hr CANCEL_DELAY; permissionless)
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getReadyForFinalization, getSession, getAllSessions, setSession } from "../state/store.js";
import { buildCheckpointPayloads } from "../settlement/checkpoint.js";
import {
  sessionStateToPayload,
  buildFinalStateRequest,
} from "../settlement/buildFinalState.js";
import {
  buildCheckpointPayload,
  sessionStateToDeltas,
  getCheckpointDigest,
  hashDeltas,
} from "../settlement/buildCheckpointPayload.js";
import { hashSessionState, createSessionState } from "../state/sessionStore.js";
import { keccak256, encodeAbiParameters, parseAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import {
  readLatestNonce,
  readPendingCheckpointInfo,
  finalizeCheckpoint,
  cancelPendingCheckpoint,
} from "../contracts/channelSettlementClient.js";
import { setCheckpointSigs, getCheckpointSigs } from "../state/sigStore.js";

interface SessionIdParams {
  sessionId: string;
}

interface CheckpointPostBody {
  userSigs?: Record<string, Hex>;
}

export async function registerCreRoutes(app: FastifyInstance): Promise<void> {
  /**
   * List sessions ready for finalization (resolveTime <= now).
   * CRE workflow can call this to know which sessions to process.
   */
  app.get("/cre/sessions", async (_req: FastifyRequest, reply: FastifyReply) => {
    const sessions = getReadyForFinalization();
    const items = sessions.map((s) => ({
      sessionId: s.sessionId,
      marketId: s.marketId.toString(),
      vaultId: s.vaultId,
      resolveTime: s.resolveTime,
      stateHash: hashSessionState(s),
      nonce: s.nonce.toString(),
    }));
    return { sessions: items };
  });

  /**
   * Get session payload for CRE report (legacy SessionFinalizer format).
   * Use /cre/checkpoints/:sessionId for ChannelSettlement checkpoint format.
   */
  app.get(
    "/cre/sessions/:sessionId",
    async (req: FastifyRequest<{ Params: SessionIdParams }>, reply: FastifyReply) => {
      const { sessionId } = req.params;
      const state = getSession(sessionId as Hex);
      if (!state) return reply.status(404).send({ error: "Session not found" });

      const participants = Array.from(state.accounts.keys()) as Hex[];
      if (participants.length === 0) {
        return reply.status(400).send({ error: "No participants in session" });
      }

      const backendSignature =
        ("0x" + Buffer.from("operator-signed-state").toString("hex").padEnd(130, "0")) as Hex;

      const payload = sessionStateToPayload(state, backendSignature);
      const encodedPayload = buildFinalStateRequest(payload);

      return {
        sessionId: state.sessionId,
        marketId: state.marketId.toString(),
        stateHash: hashSessionState(state),
        participants,
        payload: encodedPayload,
        format: "SessionFinalizer",
      };
    }
  );

  /**
   * Get session-to-market mapping for frontend alignment.
   * Returns markets with their sessionIds; frontend can use to align session creation with MarketRegistry.
   */
  app.get("/cre/markets", async (_req: FastifyRequest, _reply: FastifyReply) => {
    const sessions = getAllSessions();
    const byMarket = new Map<string, string[]>();
    for (const s of sessions) {
      const marketKey = s.marketId.toString();
      const list = byMarket.get(marketKey) ?? [];
      list.push(s.sessionId);
      byMarket.set(marketKey, list);
    }
    const markets = Array.from(byMarket.entries()).map(([marketId, sessionIds]) => ({
      marketId,
      sessionIds,
    }));
    return { markets };
  });

  /**
   * Create session for a market (CRE automation hook).
   * Called by workflow after market creation to auto-create a trading session.
   * Body: { marketId, vaultId, resolveTime, sessionId?, numOutcomes?, b? }
   * If sessionId omitted, generates keccak256(marketId, vaultId, resolveTime, "cre").
   */
  app.post(
    "/cre/sessions/create",
    async (
      req: FastifyRequest<{
        Body: {
          marketId: string | number;
          vaultId: string;
          resolveTime: number;
          sessionId?: string;
          numOutcomes?: number;
          b?: number;
          b0?: number;
          alpha?: number;
        };
      }>,
      reply: FastifyReply
    ) => {
      const { marketId, vaultId, resolveTime, sessionId: providedSessionId, numOutcomes, b, b0, alpha } = req.body;
      if (marketId == null || !vaultId || resolveTime == null) {
        return reply.status(400).send({
          error: "marketId, vaultId, resolveTime required",
        });
      }
      const marketIdBn = BigInt(marketId);
      const vaultIdHex = vaultId as Hex;
      const sessionId =
        (providedSessionId as Hex) ||
        (keccak256(
          encodeAbiParameters(
            parseAbiParameters("uint256, address, uint256, bytes32"),
            [marketIdBn, vaultIdHex, BigInt(Math.floor(resolveTime)), "0x6372650000000000000000000000000000000000000000000000000000000000" as Hex]
          )
        ) as Hex);
      if (getSession(sessionId)) {
        return { ok: true, sessionId, existing: true };
      }
      const bParams = { b: b ?? 100, b0, alpha };
      const state = createSessionState(sessionId, marketIdBn, vaultIdHex, numOutcomes ?? 2, bParams);
      state.resolveTime = Math.floor(resolveTime);
      setSession(sessionId, state);
      return { ok: true, sessionId };
    }
  );

  /**
   * Get checkpoint metadata for all active sessions.
   * When CHANNEL_SETTLEMENT_ADDRESS and RPC_URL are set, enriches with pendingCheckpointCreatedAt,
   * canFinalize, canCancel for smarter filtering by CRE workflow.
   */
  app.get("/cre/checkpoints", async (_req: FastifyRequest, reply: FastifyReply) => {
    const payloads = buildCheckpointPayloads();
    const hasChainConfig =
      process.env.CHANNEL_SETTLEMENT_ADDRESS && process.env.RPC_URL;

    const checkpoints = await Promise.all(
      payloads.map(async (p) => {
        const base = { ...p, marketId: p.marketId.toString() };
        if (!hasChainConfig || !p.hasDeltas) {
          return base;
        }
        try {
          const pending = await readPendingCheckpointInfo(p.marketId, p.sessionId);
          return {
            ...base,
            pendingCheckpointCreatedAt: pending.exists ? pending.createdAt : undefined,
            canFinalize: pending.canFinalize,
            canCancel: pending.canCancel,
          };
        } catch {
          return base;
        }
      })
    );

    return { checkpoints };
  });

  /**
   * Get checkpoint spec for ChannelSettlement. Returns digest and users so workflow can
   * collect signatures, then POST to build full payload.
   * Syncs nonce from chain; rejects if state already finalized.
   */
  app.get(
    "/cre/checkpoints/:sessionId",
    async (req: FastifyRequest<{ Params: SessionIdParams }>, reply: FastifyReply) => {
      const { sessionId } = req.params;
      const state = getSession(sessionId as Hex);
      if (!state) return reply.status(404).send({ error: "Session not found" });

      const channelAddr = process.env.CHANNEL_SETTLEMENT_ADDRESS as Hex | undefined;
      const chainId = Number(process.env.CHAIN_ID ?? 43113);
      if (!channelAddr || channelAddr === "0x0000000000000000000000000000000000000000") {
        return reply.status(503).send({
          error: "CHANNEL_SETTLEMENT_ADDRESS not configured; use SessionFinalizer path",
        });
      }

      if (!process.env.RPC_URL) {
        return reply.status(503).send({ error: "RPC_URL required for nonce sync" });
      }

      let chainNonce: bigint;
      try {
        chainNonce = await readLatestNonce(state.marketId, state.sessionId as Hex);
      } catch (e) {
        return reply.status(503).send({
          error: "Failed to read latestNonce from chain: " + (e instanceof Error ? e.message : String(e)),
        });
      }

      if (state.nonce <= chainNonce) {
        return reply.status(400).send({
          error: "No new trades to checkpoint; state already finalized on chain",
        });
      }

      const deltas = sessionStateToDeltas(state);
      if (deltas.length === 0) {
        return reply.status(400).send({ error: "No deltas to checkpoint" });
      }

      const stateHash = hashSessionState(state);
      const deltasHashVal = hashDeltas(deltas);
      const lastTradeAt = state.lastTradeAt ?? 0;

      const cp = {
        marketId: state.marketId,
        sessionId: state.sessionId,
        nonce: state.nonce,
        validAfter: 0n,
        validBefore: 0n,
        lastTradeAt,
        stateHash,
        deltasHash: deltasHashVal,
        riskHash:
          "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
      };
      const digest = getCheckpointDigest(cp, chainId, channelAddr);
      const users = Array.from(new Set(deltas.map((d) => d.user)));

      // Serialize for JSON (BigInt not supported natively)
      const cpJson = {
        marketId: cp.marketId.toString(),
        sessionId: cp.sessionId,
        nonce: cp.nonce.toString(),
        validAfter: cp.validAfter.toString(),
        validBefore: cp.validBefore.toString(),
        lastTradeAt: cp.lastTradeAt,
        stateHash: cp.stateHash,
        deltasHash: cp.deltasHash,
        riskHash: cp.riskHash,
      };
      const deltasJson = deltas.map((d) => ({
        user: d.user,
        outcomeIndex: d.outcomeIndex,
        sharesDelta: d.sharesDelta.toString(),
        cashDelta: d.cashDelta.toString(),
      }));

      return {
        sessionId: state.sessionId,
        marketId: state.marketId.toString(),
        checkpoint: cpJson,
        deltas: deltasJson,
        digest,
        users,
        chainId,
        channelSettlementAddress: channelAddr,
      };
    }
  );

  /**
   * Store user signatures for checkpoint (frontend or signing service).
   * CRE workflow fetches via GET before POST to build payload. TTL: 10 min.
   */
  app.post(
    "/cre/checkpoints/:sessionId/sigs",
    async (
      req: FastifyRequest<{ Params: SessionIdParams; Body: CheckpointPostBody }>,
      reply: FastifyReply
    ) => {
      const { sessionId } = req.params;
      const { userSigs } = req.body ?? {};
      if (!userSigs || typeof userSigs !== "object") {
        return reply.status(400).send({ error: "userSigs object required" });
      }
      const normalized: Record<string, Hex> = {};
      for (const [addr, sig] of Object.entries(userSigs)) {
        if (sig) normalized[addr.toLowerCase()] = sig as Hex;
      }
      if (Object.keys(normalized).length === 0) {
        return reply.status(400).send({ error: "At least one userSig required" });
      }
      setCheckpointSigs(sessionId, normalized);
      return { ok: true, sessionId };
    }
  );

  /**
   * Get stored user signatures for checkpoint. CRE workflow fetches before POST.
   * Returns 404 if none stored or expired.
   */
  app.get(
    "/cre/checkpoints/:sessionId/sigs",
    async (req: FastifyRequest<{ Params: SessionIdParams }>, reply: FastifyReply) => {
      const { sessionId } = req.params;
      const sigs = getCheckpointSigs(sessionId);
      if (!sigs) return reply.status(404).send({ error: "No pending sigs for session" });
      return { userSigs: sigs };
    }
  );

  /**
   * Build full checkpoint payload for ChannelSettlement.
   * Body: { userSigs: { [address]: "0x..." } }
   * Operator signs from OPERATOR_PRIVATE_KEY. Returns 0x03-prefixed payload for CRE.
   * Syncs nonce from chain; bumps state.nonce if needed.
   */
  app.post(
    "/cre/checkpoints/:sessionId",
    async (
      req: FastifyRequest<{ Params: SessionIdParams; Body: CheckpointPostBody }>,
      reply: FastifyReply
    ) => {
      const { sessionId } = req.params;
      const { userSigs: userSigsRaw } = req.body ?? {};
      const state = getSession(sessionId as Hex);
      if (!state) return reply.status(404).send({ error: "Session not found" });

      // Fallback to stored sigs (from POST /cre/checkpoints/:sessionId/sigs) if body has none
      let userSigsFromBody = userSigsRaw;
      if ((!userSigsFromBody || Object.keys(userSigsFromBody).length === 0) && getCheckpointSigs(sessionId)) {
        userSigsFromBody = getCheckpointSigs(sessionId)!;
      }

      const channelAddr = process.env.CHANNEL_SETTLEMENT_ADDRESS as Hex | undefined;
      const operatorPk = process.env.OPERATOR_PRIVATE_KEY as Hex | undefined;
      if (!channelAddr || !operatorPk) {
        return reply.status(503).send({
          error: "CHANNEL_SETTLEMENT_ADDRESS and OPERATOR_PRIVATE_KEY required",
        });
      }

      if (!process.env.RPC_URL) {
        return reply.status(503).send({ error: "RPC_URL required for nonce sync" });
      }

      let chainNonce: bigint;
      try {
        chainNonce = await readLatestNonce(state.marketId, state.sessionId as Hex);
      } catch (e) {
        return reply.status(503).send({
          error: "Failed to read latestNonce from chain: " + (e instanceof Error ? e.message : String(e)),
        });
      }

      if (state.nonce <= chainNonce) {
        return reply.status(400).send({
          error: "No new trades to checkpoint; state already finalized on chain",
        });
      }

      const userSigs = new Map<string, Hex>();
      if (userSigsFromBody && typeof userSigsFromBody === "object") {
        for (const [addr, sig] of Object.entries(userSigsFromBody)) {
          if (sig) userSigs.set(addr.toLowerCase(), sig as Hex);
        }
      }

      const account = privateKeyToAccount(operatorPk);
      const chainIdNum = Number(process.env.CHAIN_ID ?? 43113);
      const operatorSign = async (_digest: Hex, cp: import("../settlement/buildCheckpointPayload.js").CheckpointInput) => {
        const sig = await account.signTypedData({
          domain: {
            name: "ShadowPool",
            version: "1",
            chainId: chainIdNum,
            verifyingContract: channelAddr,
          },
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
            marketId: cp.marketId,
            sessionId: cp.sessionId,
            nonce: cp.nonce,
            validAfter: cp.validAfter ?? 0n,
            validBefore: cp.validBefore ?? 0n,
            lastTradeAt: BigInt(cp.lastTradeAt ?? 0),
            stateHash: cp.stateHash,
            deltasHash: cp.deltasHash,
            riskHash: cp.riskHash ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
          },
        });
        return sig as Hex;
      };

      try {
        const payload = await buildCheckpointPayload({
          state,
          userSigs,
          operatorSign,
          chainId: chainIdNum,
          channelSettlementAddress: channelAddr,
          lastTradeAt: state.lastTradeAt ?? 0,
        });
        return { payload, format: "ChannelSettlement" };
      } catch (e) {
        return reply.status(400).send({
          error: e instanceof Error ? e.message : "Failed to build checkpoint payload",
        });
      }
    }
  );

  /**
   * Submit finalizeCheckpoint tx to ChannelSettlement. Permissionless; relayer submits for convenience.
   * Requires RPC_URL and FINALIZER_PRIVATE_KEY (or OPERATOR_PRIVATE_KEY).
   */
  app.post(
    "/cre/finalize/:sessionId",
    async (
      req: FastifyRequest<{ Params: SessionIdParams }>,
      reply: FastifyReply
    ) => {
      const { sessionId } = req.params;
      const state = getSession(sessionId as Hex);
      if (!state) return reply.status(404).send({ error: "Session not found" });

      const deltas = sessionStateToDeltas(state);
      if (deltas.length === 0) {
        return reply.status(400).send({ error: "No deltas to finalize" });
      }

      const pk = process.env.FINALIZER_PRIVATE_KEY ?? process.env.OPERATOR_PRIVATE_KEY;
      if (!pk || !process.env.RPC_URL) {
        return reply.status(503).send({
          error: "RPC_URL and FINALIZER_PRIVATE_KEY (or OPERATOR_PRIVATE_KEY) required",
        });
      }

      try {
        const txHash = await finalizeCheckpoint(
          state.marketId,
          state.sessionId as Hex,
          deltas.map((d) => ({
            user: d.user,
            outcomeIndex: d.outcomeIndex,
            sharesDelta: d.sharesDelta,
            cashDelta: d.cashDelta,
          })),
        );
        return { txHash, ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("TooEarly") || msg.includes("challenge") || msg.includes("window")) {
          return reply.status(400).send({ error: "Challenge window not elapsed; finalize later" });
        }
        if (msg.includes("NoPending") || msg.includes("pending") || msg.includes("exists")) {
          return reply.status(400).send({ error: "No pending checkpoint to finalize" });
        }
        return reply.status(500).send({
          error: "Finalize failed: " + msg,
        });
      }
    }
  );

  /**
   * Submit cancelPendingCheckpoint tx. Callable after CANCEL_DELAY (6 hours) from pending createdAt.
   * Permissionless; releases stuck reserves when checkpoint was submitted but never finalized.
   */
  app.post(
    "/cre/cancel/:sessionId",
    async (
      req: FastifyRequest<{ Params: SessionIdParams }>,
      reply: FastifyReply
    ) => {
      const { sessionId } = req.params;
      const state = getSession(sessionId as Hex);
      if (!state) return reply.status(404).send({ error: "Session not found" });

      const pk = process.env.FINALIZER_PRIVATE_KEY ?? process.env.OPERATOR_PRIVATE_KEY;
      if (!pk || !process.env.RPC_URL) {
        return reply.status(503).send({
          error: "RPC_URL and FINALIZER_PRIVATE_KEY (or OPERATOR_PRIVATE_KEY) required",
        });
      }

      try {
        const txHash = await cancelPendingCheckpoint(
          state.marketId,
          state.sessionId as Hex
        );
        return { txHash, ok: true };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("CancelTooEarly") || msg.includes("TooEarly")) {
          return reply.status(400).send({
            error: "CANCEL_DELAY (6 hours) not elapsed; cancel later",
          });
        }
        if (msg.includes("NoPending") || msg.includes("pending")) {
          return reply.status(400).send({ error: "No pending checkpoint to cancel" });
        }
        return reply.status(500).send({
          error: "Cancel failed: " + msg,
        });
      }
    }
  );
}
