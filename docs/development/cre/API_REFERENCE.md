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

### GET /cre/checkpoints

Get checkpoint metadata for all active sessions.

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

## Typical Workflow Usage

1. **GET** `/cre/checkpoints` or `/cre/sessions` — find sessions to finalize
2. **GET** `/cre/checkpoints/:sessionId` — get digest and users
3. Collect user signatures (EIP-712 on checkpoint digest; see [development/frontend/CHECKPOINT_SIGNING.md](../frontend/CHECKPOINT_SIGNING.md))
4. **POST** `/cre/checkpoints/:sessionId` — send `userSigs`, receive `0x03`-prefixed payload
5. CRE workflow: `evmClient.writeReport(payload)` targeting CREReceiver
6. After 30 min: **POST** `/cre/finalize/:sessionId` (or workflow submits finalize tx directly)

---

## Error Summary

| Code | Meaning |
|------|---------|
| 400 | No deltas; state already finalized; missing user sig; challenge window not elapsed; no pending checkpoint |
| 404 | Session not found |
| 500 | Finalize tx failed |
| 503 | CHANNEL_SETTLEMENT_ADDRESS, OPERATOR_PRIVATE_KEY, or RPC_URL not configured; nonce sync failed |
