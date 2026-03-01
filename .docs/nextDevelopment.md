
Here’s a focused roadmap for what to do next now that relayer–smart-contract integration is working:

---

## Immediate next steps

### 1. **Wire the frontend to the relayer (trading UX)**

The frontend talks about off-chain trading but there’s no obvious code hitting `/api/trade/buy`, `/api/trade/swap`, or `/cre/checkpoints`. Recommended work:

- Add a relayer base URL (e.g. `VITE_RELAYER_URL` or `NEXT_PUBLIC_RELAYER_URL`).
- Implement trades via relayer endpoints:
  - `POST /api/trade/buy`
  - `POST /api/trade/swap`
  - `POST /api/trade/sell`
- Implement checkpoint signing:
  - `GET /cre/checkpoints/:sessionId` → get digest
  - EIP-712 sign with the user’s wallet
  - `POST /cre/checkpoints/:sessionId` with `{ userSigs: { [address]: "0x..." } }`

Docs: `packages/contracts/docs/abi/docs/frontend/RelayerIntegration.md`, `FrontendIntegration.md`.

---

### 2. **Implement the CRE checkpoint job**

The workflow README says:

> "The primary RetroPick V3 checkpoint path (relayer → GET /cre/checkpoints/:sessionId → CREReceiver 0x03) **requires a separate checkpoint job**."

You have `scheduleTrigger`, `sessionSnapshot`, `marketCreator`, `logCallback`, but no job that:

1. Calls `GET {relayerUrl}/cre/checkpoints` to list sessions
2. For each session, fetches `GET {relayerUrl}/cre/checkpoints/:sessionId`
3. Collects user signatures (frontend or signing service)
4. Posts `POST {relayerUrl}/cre/checkpoints/:sessionId` with `userSigs`
5. Sends the `0x03`-prefixed payload via `writeReport` to CREReceiver/ChannelSettlement

See `packages/contracts/docs/abi/docs/cre/CREWorkflowCheckpoints.md` for the flow.

---

### 3. **Connect relayer finalizer**

The relayer exposes `POST /cre/finalize/:sessionId`, which calls `finalizeCheckpoint` after the 30-minute challenge window. Options:

- **A.** Cron or scheduled job that:
  - Finds sessions past their challenge deadline
  - Calls `POST /cre/finalize/:sessionId` for each
- **B.** Integrate this into your existing CRE workflow or another backend job

---

### 4. **End-to-end test on Fuji**

Run the full path in testnet:

- Deploy contracts to Fuji (or use existing Fuji addresses).
- Deploy the relayer (e.g. on Railway, Fly.io, or similar).
- Point the frontend to this relayer.
- Run the CRE checkpoint job in staging.
- Execute a full cycle: trade → checkpoint → submit → wait 30 min → finalize.

---

### 5. **Production hardening**

Before production:

- **Auth/rate limiting** for relayer APIs.
- **Monitoring** for failed checkpoint/finalize flows.
- **Error handling** and retries in the checkpoint job.
- **Environment separation** (dev, staging, prod).

---

## Suggested order

| Order | Task                       | Reason |
|-------|----------------------------|--------|
| 1     | CRE checkpoint job         | Checkpoints must reach the chain for settlement. |
| 2     | Frontend ↔ relayer wiring  | Enables trading and checkpoint signing in the UI. |
| 3     | Finalizer automation       | Ensures checkpoints are finalized after the window. |
| 4     | Fuji E2E run               | Validates the full flow. |
| 5     | Hardening                 | Makes it production-ready. |

The critical missing piece is the **CRE checkpoint job** that pulls payloads from the relayer and submits them on-chain via the Chainlink Forwarder. Until that runs, relayer checkpoints never reach `ChannelSettlement`.