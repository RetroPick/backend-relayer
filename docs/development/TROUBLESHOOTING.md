# Troubleshooting: Relayer, Frontend, CRE, Smart Contracts

**Audience:** All engineers  
**Correlated with:** [CurrentSmartContract.md](../../../front-end-v2/docs/abi/docs/CurrentSmartContract.md), [E2E_FLOW.md](E2E_FLOW.md)

---

## 1. Relayer API Errors

### 1.1 400 — Validation / Constraint

| Error Message | Semantic | Contract Correlation |
|---------------|----------|----------------------|
| maxCost exceeded | Trade would cost more than user's maxCost | N/A (off-chain constraint) |
| minShares not met | Trade yields fewer shares than minShares | N/A |
| maxOddsImpact exceeded | Slippage too high | N/A |
| Insufficient balance | User balance < netCost | Relayer session balance; on-chain uses vault |
| maxOI exceeded | Open interest cap hit | Optional risk cap; no direct contract eq |
| maxPosPerUser exceeded | Position cap per user | Optional risk cap |
| No new trades to checkpoint; state already finalized | relayer.nonce <= chainNonce | ChannelSettlement.latestNonce; nonce sync |
| No deltas to checkpoint | Session has no position/cash changes | Empty Delta[] would fail on-chain |
| Challenge window not elapsed | Too early to finalize | ChannelSettlement challenge window (§9.2) |
| No pending checkpoint to finalize | Submit was not done or failed | ChannelSettlement.pendingCheckpoint |

### 1.2 404 — Session Not Found

- Session was never created or was evicted (in-memory store)
- `sessionId` typo or wrong encoding
- **Frontend:** Ensure `POST /api/session/create` succeeded before trading

### 1.3 503 — Configuration

| Error | Cause | Fix |
|-------|-------|-----|
| CHANNEL_SETTLEMENT_ADDRESS not configured | Relayer env missing | Set in Railway/Render vars |
| OPERATOR_PRIVATE_KEY required | Relayer env missing | Must match ChannelSettlement.operator |
| RPC_URL required for nonce sync | Relayer env missing | JSON-RPC for chain |
| Failed to read latestNonce from chain | RPC error or wrong contract | Check RPC_URL, CHAIN_ID, contract address |

---

## 2. On-Chain Reverts

### 2.1 submitCheckpointFromPayload

| Revert | Meaning | Correlation |
|--------|---------|-------------|
| BadDeltasHash | deltasHash != keccak256(deltas) | Relayer buildCheckpointPayload; verify sessionStateToDeltas |
| BadOperatorSig | Operator sig does not recover to operator | OPERATOR_PRIVATE_KEY mismatch |
| InvalidUserSig | User sig invalid over checkpoint digest | Frontend EIP-712 domain/types must match |
| NonceNotIncreasing | nonce <= latestNonce | Relayer/chain nonce sync; possible race |
| DuplicateUser | Same user twice in users[] | Relayer must deduplicate delta users |
| UnsignedDelta | Delta user missing from users/sigs | Every delta.user must sign |

### 2.2 finalizeCheckpoint

| Revert | Meaning | Correlation |
|--------|---------|-------------|
| TooEarly | block.timestamp < challengeDeadline | Wait 30 min after submit |
| NoPendingCheckpoint | No submit was done | CRE must submit before finalize |
| LastTradeAfterClose | lastTradeAt > tradingClose | Session timing; see [SESSION_LIFECYCLE.md](SESSION_LIFECYCLE.md) |
| LiquidityVaultRequired | Market uses LP vault but it was cleared | MarketRegistry.liquidityVaultByMarketId |
| LpVaultInsolvent | LP vault cannot pay | Fund liquidity vault |

---

## 3. Frontend Checklist

| Issue | Check |
|-------|-------|
| Quote shows wrong price | Verify session exists; q vector correct |
| User cannot trade | Credit balance; check maxOI, maxPosPerUser |
| Checkpoint signing fails | EIP-712 domain: ShadowPool v1, chainId 43113, verifyingContract = ChannelSettlement |
| Positions not updating | Subscribe CheckpointFinalized; refresh OutcomeToken1155.balanceOf |
| Trading after close | Fetch MarketRegistry.tradingClose; disable UI when now >= tradingClose |

---

## 4. CRE Workflow Checklist

| Issue | Check |
|-------|-------|
| writeReport reverts | Target CREReceiver, not CREPublishReceiver; payload 0x03-prefixed |
| No sessions in GET /cre/checkpoints | Create session, run trades; hasDeltas true only with deltas |
| User sigs missing | Frontend must send all users in POST body; CRE cannot sign for users |
| Finalize too early | Wait challenge window; check block.timestamp |
| Wrong chain | evms[0].chainSelectorName must match deployment (e.g. avalanche-fuji) |

---

## 5. Contract Verification

| Verification | Method |
|--------------|--------|
| Operator matches | `ChannelSettlement.operator()` == address from OPERATOR_PRIVATE_KEY |
| Latest nonce | `ChannelSettlement.latestNonce(marketId, sessionId)` |
| Market exists | `MarketRegistry.markets(marketId)` or status |
| Trading closed | `MarketRegistry.markets(marketId).tradingClose` |
| Pending checkpoint | `ChannelSettlement.getPending(marketId, sessionId)` |

---

## 6. Related Documents

- [SESSION_LIFECYCLE.md](SESSION_LIFECYCLE.md) — Timing issues
- [CONTRACT_MAPPING.md](CONTRACT_MAPPING.md) — Field mapping
- [cre/CHECKPOINT_FLOW.md](cre/CHECKPOINT_FLOW.md) — Submit and finalize
- [frontend/CHECKPOINT_SIGNING.md](frontend/CHECKPOINT_SIGNING.md) — EIP-712
