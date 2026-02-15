/**
 * Endpoints for CRE workflow to fetch final session state.
 * GET /cre/sessions - list sessions ready for finalization
 * GET /cre/sessions/:sessionId - get session payload for CRE report
 * GET /cre/checkpoints - get checkpoint payloads for onchain commit
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getReadyForFinalization, getSession } from "../state/store.js";
import { buildCheckpointPayloads } from "../settlement/checkpoint.js";
import { sessionStateToPayload, buildFinalStateRequest } from "../settlement/buildFinalState.js";
import { hashSessionState } from "../state/sessionStore.js";
import type { Hex } from "viem";

interface SessionIdParams {
  sessionId: string;
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
   * Get session payload for CRE report.
   * Returns the ABI-encoded payload (0x03 prefix) and metadata.
   * CRE workflow uses this to build the report for onchain writeReport.
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
        "0x" + Buffer.from("operator-signed-state").toString("hex").padEnd(130, "0") as Hex;

      const payload = sessionStateToPayload(state, backendSignature);
      const encodedPayload = buildFinalStateRequest(payload);

      return {
        sessionId: state.sessionId,
        marketId: state.marketId.toString(),
        stateHash: hashSessionState(state),
        participants,
        payload: encodedPayload,
      };
    }
  );

  /**
   * Get checkpoint payloads for all active sessions.
   * CRE workflow can call this periodically and write stateHash/accountsRoot onchain.
   */
  app.get("/cre/checkpoints", async (_req: FastifyRequest, reply: FastifyReply) => {
    const payloads = buildCheckpointPayloads();
    return { checkpoints: payloads };
  });
}
