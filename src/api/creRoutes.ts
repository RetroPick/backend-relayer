/**
 * Endpoints for CRE workflow to fetch final session state.
 * GET /cre/sessions - list sessions ready for finalization
 * GET /cre/sessions/:sessionId - get session payload (legacy SessionFinalizer format)
 * GET /cre/checkpoints - get checkpoint metadata for all sessions
 * GET /cre/checkpoints/:sessionId - get checkpoint spec for ChannelSettlement (digest, users, etc.)
 * POST /cre/checkpoints/:sessionId - build full checkpoint payload with operator + user sigs
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getReadyForFinalization, getSession } from "../state/store.js";
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
import { hashSessionState } from "../state/sessionStore.js";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

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
   * Get checkpoint metadata for all active sessions.
   */
  app.get("/cre/checkpoints", async (_req: FastifyRequest, reply: FastifyReply) => {
    const payloads = buildCheckpointPayloads();
    return { checkpoints: payloads };
  });

  /**
   * Get checkpoint spec for ChannelSettlement. Returns digest and users so workflow can
   * collect signatures, then POST to build full payload.
   */
  app.get(
    "/cre/checkpoints/:sessionId",
    async (req: FastifyRequest<{ Params: SessionIdParams }>, reply: FastifyReply) => {
      const { sessionId } = req.params;
      const state = getSession(sessionId as Hex);
      if (!state) return reply.status(404).send({ error: "Session not found" });

      const channelAddr = process.env.CHANNEL_SETTLEMENT_ADDRESS as Hex | undefined;
      const chainId = Number(process.env.CHAIN_ID ?? 11155111);
      if (!channelAddr || channelAddr === "0x0000000000000000000000000000000000000000") {
        return reply.status(503).send({
          error: "CHANNEL_SETTLEMENT_ADDRESS not configured; use SessionFinalizer path",
        });
      }

      const deltas = sessionStateToDeltas(state);
      if (deltas.length === 0) {
        return reply.status(400).send({ error: "No deltas to checkpoint" });
      }

      const stateHash = hashSessionState(state);
      const deltasHashVal = hashDeltas(deltas);

      const cp = {
        marketId: state.marketId,
        sessionId: state.sessionId,
        nonce: state.nonce,
        validAfter: 0n,
        validBefore: 0n,
        lastTradeAt: 0,
        stateHash,
        deltasHash: deltasHashVal,
        riskHash:
          "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
      };
      const digest = getCheckpointDigest(cp, chainId, channelAddr);
      const users = Array.from(new Set(deltas.map((d) => d.user)));

      return {
        sessionId: state.sessionId,
        marketId: state.marketId.toString(),
        checkpoint: cp,
        deltas,
        digest,
        users,
        chainId,
        channelSettlementAddress: channelAddr,
      };
    }
  );

  /**
   * Build full checkpoint payload for ChannelSettlement.
   * Body: { userSigs: { [address]: "0x..." } }
   * Operator signs from OPERATOR_PRIVATE_KEY. Returns 0x03-prefixed payload for CRE.
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

      const channelAddr = process.env.CHANNEL_SETTLEMENT_ADDRESS as Hex | undefined;
      const operatorPk = process.env.OPERATOR_PRIVATE_KEY as Hex | undefined;
      if (!channelAddr || !operatorPk) {
        return reply.status(503).send({
          error: "CHANNEL_SETTLEMENT_ADDRESS and OPERATOR_PRIVATE_KEY required",
        });
      }

      const userSigs = new Map<string, Hex>();
      if (userSigsRaw && typeof userSigsRaw === "object") {
        for (const [addr, sig] of Object.entries(userSigsRaw)) {
          if (sig) userSigs.set(addr.toLowerCase(), sig as Hex);
        }
      }

      const account = privateKeyToAccount(operatorPk);
      const chainIdNum = Number(process.env.CHAIN_ID ?? 11155111);
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
        });
        return { payload, format: "ChannelSettlement" };
      } catch (e) {
        return reply.status(400).send({
          error: e instanceof Error ? e.message : "Failed to build checkpoint payload",
        });
      }
    }
  );
}
