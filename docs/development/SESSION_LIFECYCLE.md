# Session Lifecycle: Relayer vs MarketRegistry

**Audience:** Frontend and CRE engineers  
**Reference:** [CurrentSmartContract.md](../../../front-end-v2/docs/abi/docs/CurrentSmartContract.md) Section 5.2 (MarketRegistry.Market), Section 9.3 (Market close boundary)

---

## 1. Overview

A **relayer session** is an off-chain trading context for a given market. It has a lifecycle tied to the on-chain **MarketRegistry** market timing. Misalignment causes checkpoint finalize to revert.

---

## 2. MarketRegistry Timing (CurrentSmartContract §5.2)

| Field | Description |
|-------|-------------|
| tradingOpen | When market accepts trades |
| tradingClose | When market stops accepting trades; **lastTradeAt must be <= tradingClose** at checkpoint finalize |
| resolveTime | When market can be resolved (oracle) |
| expiry | Optional expiry |

**status(marketId):** Draft | Open | Frozen | Resolved

---

## 3. Relayer Session Timing

| Field | Description |
|-------|-------------|
| resolveTime | Optional; used by `getReadyForFinalization()` for `GET /cre/sessions`; sessions with `resolveTime <= now` are "ready" |
| lastTradeAt | Set on every trade; included in Checkpoint; **must be <= market.tradingClose** when CRE calls finalize |

---

## 4. Critical Invariant

Per CurrentSmartContract §9.3:

> **Market close boundary:** `lastTradeAt > tradingClose` rejected at finalize.

Therefore:

- Relayer should **stop accepting trades** when `now > market.tradingClose` (frontend must know tradingClose)
- Or relayer session `resolveTime` should be set `<= tradingClose` so CRE does not finalize after close
- Frontend should fetch `MarketRegistry.markets(marketId)` or equivalent to get `tradingClose` and disable trading UI when `block.timestamp >= tradingClose`

---

## 5. Session Creation Alignment

When creating a session via `POST /api/session/create`:

| Field | Recommendation |
|-------|----------------|
| marketId | Must match an existing MarketRegistry market |
| vaultId | Use liquidity vault or settlement vault address from `MarketRegistry.liquidityVaultByMarketId` or draft |
| resolveTime | Set to `market.tradingClose` or earlier so CRE timing aligns |
| riskCaps | Optional; align with market policy if any |

---

## 6. Checkpoint Timing

1. **Submit** — CRE sends 0x03 payload; ChannelSettlement stores pending with `challengeDeadline = now + 30 min`
2. **Challenge window** — 30 min; no finalize
3. **Finalize** — After window; contract checks `lastTradeAt <= tradingClose`

If the market was created with `tradingClose = 0` (no close), the check is skipped.

---

## 7. Flow: Market Creation to Session to Checkpoint

```
MarketRegistry.create (or createFromDraft)
  → tradingOpen, tradingClose, resolveTime set

Frontend/Backend creates relayer session
  → POST /api/session/create { marketId, vaultId, resolveTime: tradingClose }

Users trade (off-chain)
  → lastTradeAt updated on each trade

CRE fetches checkpoints when resolveTime <= now (or on schedule)
  → GET /cre/checkpoints/:sessionId
  → Collect sigs, POST, writeReport

ChannelSettlement.submitCheckpointFromPayload
  → Stores pending; challengeDeadline = now + 30 min

After 30 min: finalizeCheckpoint
  → Reverts if lastTradeAt > tradingClose
  → Applies deltas, mints/burns OutcomeToken1155
```

---

## 8. Related Documents

- [E2E_FLOW.md](E2E_FLOW.md)
- [CONTRACT_MAPPING.md](CONTRACT_MAPPING.md)
- [cre/CHECKPOINT_FLOW.md](cre/CHECKPOINT_FLOW.md)
