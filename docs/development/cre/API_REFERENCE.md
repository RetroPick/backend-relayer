# Relayer CRE API Reference

**Audience:** CRE workflow engineers  
**Base URL:** `https://backend-relayer-production.up.railway.app`  
**Source:** [apps/relayer/src/api/creRoutes.ts](../../apps/relayer/src/api/creRoutes.ts)

---

## Overview

The relayer exposes HTTP endpoints under `/cre/` for the CRE workflow to fetch session and checkpoint data. All checkpoint delivery goes through the Chainlink Forwarder; the relayer prepares payloads; CRE delivers them.

---

## Endpoints

### GET /cre/sessions

List sessions ready for finalization (`resolveTime <= now`).

**Response:**
```json
{
  "sessions": [
    {
      "sessionId": "0x...",
      "marketId": "0",
      "vaultId": "0x...",
      "resolveTime": 1735689600,
      "stateHash": "0x...",
      "nonce": "1"
    }
  ]
}
```

**Use:** CRE workflow can call this to know which sessions to process.

---

### GET /cre/sessions/:sessionId

Get session payload for **legacy SessionFinalizer** format.

For ChannelSettlement checkpoint path, use `GET /cre/checkpoints/:sessionId` instead.

**Params:** `sessionId` — hex session identifier

**Response:**
```json
{
  "sessionId": "0x...",
  "marketId": "0",
  "stateHash": "0x...",
  "participants": ["0x...", "0x..."],
  "payload": "0x...",
  "format": "SessionFinalizer"
}
```

**Errors:** 404 — session not found; 400 — no participants.

---

### GET /cre/markets

Get session-to-market mapping for frontend alignment. Returns markets with their sessionIds.

**Response:**
```json
{
  "markets": [
    {
      "marketId": "0",
      "sessionIds": ["0x...", "0x..."]
    }
  ]
}
```

**Use:** Schedule resolver (`useRelayerMarkets`) and frontend alignment.

---

### POST /cre/sessions/create

Create a trading session for a market. Used by CRE workflow for session auto-creation after market creation.

**Body:**
```json
{
  "marketId": "0",
  "vaultId": "0x...",
  "resolveTime": 1735689600,
  "sessionId": "0x...",
  "numOutcomes": 2,
  "b": 100
}
```

**Required:** `marketId`, `vaultId`, `resolveTime`. If `sessionId` omitted, generated deterministically.

**Response:** `{ ok: true, sessionId }` or `{ ok: true, sessionId, existing: true }` if already exists.

---

### GET /cre/checkpoints

Get checkpoint metadata for all active sessions.

When `CHANNEL_SETTLEMENT_ADDRESS` and `RPC_URL` are set, each checkpoint may include `pendingCheckpointCreatedAt`, `canFinalize`, `canCancel` for pre-filtering.

**Response:**
```json
{
  "checkpoints": [
    {
      "sessionId": "0x...",
      "marketId": "0",
      "epoch": 0,
      "stateHash": "0x...",
      "accountsRoot": "0x...",
      "nonce": "1",
      "timestamp": 1735680000,
      "hasDeltas": true
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| hasDeltas | True if session has checkpointable deltas; CRE can fetch full spec at GET /cre/checkpoints/:sessionId |

---

### GET /cre/checkpoints/:sessionId

Get **checkpoint spec** for ChannelSettlement. Returns digest and users so the workflow can collect signatures, then POST to build the full payload.

**Syncs nonce from chain.** Rejects if state already finalized (`state.nonce <= chainNonce`).

**Params:** `sessionId` — hex session identifier

**Response:**
```json
{
  "sessionId": "0x...",
  "marketId": "0",
  "checkpoint": {
    "marketId": "0",
    "sessionId": "0x...",
    "nonce": "1",
    "validAfter": "0",
    "validBefore": "0",
    "lastTradeAt": 1735680000,
    "stateHash": "0x...",
    "deltasHash": "0x...",
    "riskHash": "0x..."
  },
  "deltas": [
    {
      "user": "0x...",
      "outcomeIndex": 0,
      "sharesDelta": "10",
      "cashDelta": "-1000"
    }
  ],
  "digest": "0x...",
  "users": ["0x...", "0x..."],
  "chainId": 43113,
  "channelSettlementAddress": "0xFA5D0e64B0B21374690345d4A88a9748C7E22182"
}
```

**Errors:**
- 404 — session not found
- 400 — no deltas to checkpoint; or no new trades (state already finalized on chain)
- 503 — CHANNEL_SETTLEMENT_ADDRESS not configured; RPC_URL required; failed to read latestNonce

---

### POST /cre/checkpoints/:sessionId

Build full checkpoint payload for ChannelSettlement. Operator signs from `OPERATOR_PRIVATE_KEY`; user signatures come from the request body. Returns `0x03`-prefixed payload for CRE.

**Params:** `sessionId` — hex session identifier

**Body:**
```json
{
  "userSigs": {
    "0xUserAddress1": "0x...",
    "0xUserAddress2": "0x..."
  }
}
```

**Response:**
```json
{
  "payload": "0x03...",
  "format": "ChannelSettlement"
}
```

**Errors:**
- 404 — session not found
- 400 — no new trades to checkpoint; missing user signature or build failed
- 503 — CHANNEL_SETTLEMENT_ADDRESS or OPERATOR_PRIVATE_KEY missing; RPC_URL required

**Fallback:** When body has no `userSigs`, relayer uses stored sigs from `POST /cre/checkpoints/:sessionId/sigs` if available.

---

### GET /cre/checkpoints/:sessionId/sigs

Get stored user signatures for checkpoint. CRE workflow fetches before POST to build payload. Returns 404 if none stored or expired (TTL: 10 min).

**Params:** `sessionId` — hex session identifier

**Response:**
```json
{
  "userSigs": {
    "0xUserAddress1": "0x...",
    "0xUserAddress2": "0x..."
  }
}
```

**Use:** Frontend POSTs sigs via `POST /cre/checkpoints/:sessionId/sigs`; CRE fetches before calling `POST /cre/checkpoints/:sessionId` with empty body.

---

### POST /cre/checkpoints/:sessionId/sigs

Store user signatures for checkpoint. Frontend calls after users sign EIP-712 checkpoint digest. TTL: 10 min.

**Params:** `sessionId` — hex session identifier

**Body:**
```json
{
  "userSigs": {
    "0xUserAddress1": "0x...",
    "0xUserAddress2": "0x..."
  }
}
```

**Response:** `{ "ok": true, "sessionId": "0x..." }`

**Errors:** 400 — `userSigs` object required; at least one sig required

---

### POST /cre/finalize/:sessionId

Submit `finalizeCheckpoint` tx to ChannelSettlement. Permissionless; relayer submits for convenience. Requires RPC_URL and FINALIZER_PRIVATE_KEY (or OPERATOR_PRIVATE_KEY).

**Params:** `sessionId` — hex session identifier

**Response:**
```json
{
  "txHash": "0x...",
  "ok": true
}
```

**Errors:**
- 400 — no deltas to finalize; challenge window not elapsed; no pending checkpoint to finalize
- 404 — session not found
- 500 — finalize failed (e.g. tx revert)
- 503 — RPC_URL and FINALIZER_PRIVATE_KEY (or OPERATOR_PRIVATE_KEY) required

---

### POST /cre/cancel/:sessionId

Submit `cancelPendingCheckpoint` tx. Callable after CANCEL_DELAY (6 hours) from pending `createdAt`. Permissionless; releases stuck reserves when checkpoint was submitted but never finalized.

**Params:** `sessionId` — hex session identifier

**Response:**
```json
{
  "txHash": "0x...",
  "ok": true
}
```

**Errors:**
- 400 — CANCEL_DELAY not elapsed; no pending checkpoint to cancel
- 404 — session not found
- 500 — cancel tx failed
- 503 — RPC_URL and FINALIZER_PRIVATE_KEY (or OPERATOR_PRIVATE_KEY) required

---

## Typical Workflow Usage

1. **GET** `/cre/checkpoints` or `/cre/sessions` — find sessions to finalize
2. **GET** `/cre/checkpoints/:sessionId` — get digest and users
3. Collect user signatures (EIP-712 on checkpoint digest; see [development/frontend/CHECKPOINT_SIGNING.md](../frontend/CHECKPOINT_SIGNING.md))
4. **POST** `/cre/checkpoints/:sessionId` — send `userSigs`, receive `0x03`-prefixed payload
5. CRE workflow: `evmClient.writeReport(payload)` targeting CREReceiver
6. After 30 min: **POST** `/cre/finalize/:sessionId` (or workflow submits finalize tx directly)
7. If stuck > 6 hr: **POST** `/cre/cancel/:sessionId` to release reserves

**Stored sigs flow:** Frontend POSTs user sigs to `POST /cre/checkpoints/:sessionId/sigs` before CRE cron. CRE fetches via `GET /cre/checkpoints/:sessionId/sigs` and POSTs with empty body; relayer falls back to stored sigs.

---

## Error Summary

| Code | Meaning |
|------|---------|
| 400 | No deltas; state already finalized; missing user sig; challenge window not elapsed; no pending checkpoint; CANCEL_DELAY not elapsed |
| 404 | Session not found |
| 500 | Finalize tx failed |
| 503 | CHANNEL_SETTLEMENT_ADDRESS, OPERATOR_PRIVATE_KEY, or RPC_URL not configured; nonce sync failed |
