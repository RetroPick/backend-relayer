# CRE Workflow Integration

**Audience:** CRE workflow engineers  
**Config source:** [types/config.ts](../../../../workflow/types/config.ts)  
**Contract correlation:** [CurrentSmartContract.md](../../../../front-end-v2/docs/abi/docs/CurrentSmartContract.md) Section 6.1 (Oracle), 6.3 (Checkpoint) | [CONTRACT_MAPPING.md](../CONTRACT_MAPPING.md)

---

## 1. Configuration

Add `relayerUrl` to workflow config:

**config.staging.json / config.production.json:**
```json
{
  "relayerUrl": "https://backend-relayer-production.up.railway.app",
  "gptModel": "deepseek-chat",
  "evms": [
    {
      "marketAddress": "...",
      "chainSelectorName": "avalanche-fuji",
      "gasLimit": "500000"
    }
  ]
}
```

| Variable | Description |
|----------|-------------|
| relayerUrl | Base URL of relayer (e.g. `https://backend-relayer-production.up.railway.app`) |
| evms[0].chainSelectorName | Must match deployment (e.g. `avalanche-fuji` for Fuji) |
| evms[0].gasLimit | Gas limit for writeReport |

---

## 2. Workflow Must Target CREReceiver

Checkpoint payloads are delivered via Chainlink Forwarder to **CREReceiver**, not CREPublishReceiver. Per CurrentSmartContract Section 6.1 and 6.3, CREReceiver routes:

- **0x01** — Outcome report → `submitResult` → `settleMarket` → MarketRegistry (oracle resolution)
- **0x03** — Session report → `submitSession` → `finalizeSession` → `ChannelSettlement.submitCheckpointFromPayload`

The relayer produces only **0x03** payloads.

---

## 3. Step-by-Step Flow

### 3.1 Discover Sessions

```
GET {relayerUrl}/cre/checkpoints
```

Returns list of sessions with checkpoint metadata. Filter by `hasDeltas: true`.

Alternatively:

```
GET {relayerUrl}/cre/sessions
```

Returns sessions with `resolveTime <= now`. Use when aligning with outcome resolution timing.

### 3.2 Get Checkpoint Spec

```
GET {relayerUrl}/cre/checkpoints/{sessionId}
```

**Response:** `digest`, `users`, `deltas`, `chainId`, `channelSettlementAddress`, `checkpoint`.

The `digest` is the EIP-712 hash users must sign. `users` is the list of addresses that must provide signatures.

### 3.3 Collect User Signatures

**Challenge:** The CRE workflow cannot prompt users directly. Signatures must come from:

| Option | Description |
|--------|-------------|
| Frontend | Users sign in wallet when prompted by app; frontend sends signatures to relayer or a signing service |
| Signing service | Separate service that holds or prompts for signatures; workflow fetches from it |
| Pre-signed batch | Users pre-sign at trade time; relayer or service stores; workflow fetches before POST |

See [development/frontend/CHECKPOINT_SIGNING.md](../frontend/CHECKPOINT_SIGNING.md) for frontend signing flow.

### 3.4 Build Full Payload

```
POST {relayerUrl}/cre/checkpoints/{sessionId}
Body: { "userSigs": { "0xUserAddress": "0x...", ... } }
```

**Response:** `{ "payload": "0x03...", "format": "ChannelSettlement" }`

Payload is prefixed with `0x03` and ready for `writeReport`.

### 3.5 Submit On-Chain

```
evmClient.writeReport(runtime, { receiver: creReceiverAddress, report: reportResponse, gasConfig: { gasLimit } })
```

Workflow must target **CREReceiver** address (Fuji: `0x51c0680d8E9fFE2A2f6CC65e598280D617D6cAb7`).

---

## 4. Current Workflow State

The current [sessionSnapshot.ts](../../../../workflow/jobs/sessionSnapshot.ts) uses `yellowSessions` (static config) for legacy SessionFinalizer path. Per CurrentSmartContract Section 13, the production lane uses ChannelSettlement checkpoint path.

A future checkpoint job would:

1. Poll `GET /cre/checkpoints` periodically (e.g. cron every 5–10 min)
2. For each session with `hasDeltas: true`, fetch spec and collect signatures
3. POST to build payload
4. Call `writeReport` to CREReceiver
5. Optionally: after challenge window, call relayer `POST /cre/finalize/:sessionId`

---

## 5. References

- [CREWorkflowCheckpoints.md](../../packages/contracts/docs/abi/docs/cre/CREWorkflowCheckpoints.md) — CRE checkpoint flow
- [RelayerAPI.md](../../packages/contracts/docs/abi/docs/relayer/RelayerAPI.md) — Endpoint specs
- [CHECKPOINT_FLOW.md](CHECKPOINT_FLOW.md) — Submit and finalize sequence
