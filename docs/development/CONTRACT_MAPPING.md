# Contract Mapping: Relayer ↔ Smart Contracts

**Audience:** Protocol and integration engineers  
**Reference:** [CurrentSmartContract.md](../../../front-end-v2/docs/abi/docs/CurrentSmartContract.md) Section 5 (Data Models), Section 7 (Contract Mechanics)

---

## 1. Relayer Session State vs On-Chain

The relayer maintains **off-chain session state** that mirrors and eventually commits to on-chain state via checkpoints.

| Relayer Field | Type | On-Chain Equivalent | Notes |
|---------------|------|---------------------|-------|
| sessionId | Hex (32 bytes) | `ChannelSettlement` session key; `Checkpoint.sessionId` | Unique per (marketId, vault/session) |
| marketId | BigInt | `MarketRegistry.marketId`; `ChannelSettlement.pendingCheckpoint` | Must exist in MarketRegistry |
| vaultId | Hex | Logical; maps to `MultiAssetVault` or `CollateralVault` via `MarketRegistry` | Settlement asset from `getSettlementAsset(marketId)` |
| q | number[] | Outcome share vector; `ExecutionLedger` positions; `OutcomeToken1155` balances | Checkpoint deltas drive mint/burn |
| nonce | BigInt | `ChannelSettlement.latestNonce(marketId, sessionId)` | Strictly increasing; replay protection |
| lastTradeAt | number | `Checkpoint.lastTradeAt` | Must be `<= market.tradingClose` at finalize |
| stateHash | Hex | `Checkpoint.stateHash` | Off-chain state commitment |
| deltasHash | Hex | `Checkpoint.deltasHash` | keccak256 of Delta[] |
| accounts (balance, positions) | Map | `MultiAssetVault` free/reserved; `OutcomeToken1155.balanceOf` | Deltas convert to sharesDelta, cashDelta |

---

## 2. Checkpoint and Delta (CurrentSmartContract §5.3)

### 2.1 ShadowTypes.Checkpoint

| Field | Relayer Source | Solidity |
|-------|----------------|----------|
| marketId | session.marketId | uint256 |
| sessionId | session.sessionId | bytes32 |
| nonce | session.nonce | uint64 |
| validAfter | 0 | uint64 |
| validBefore | 0 | uint64 |
| lastTradeAt | session.lastTradeAt | uint48 |
| stateHash | hashSessionState(state) | bytes32 |
| deltasHash | hashDeltas(deltas) | bytes32 |
| riskHash | 0x0 | bytes32 |

### 2.2 ShadowTypes.Delta

| Field | Relayer Source | Solidity |
|-------|----------------|----------|
| user | account address | address |
| outcomeIndex | outcome index | uint32 |
| sharesDelta | position change (1e6 scale) | int128 |
| cashDelta | balance change (1e6 scale) | int128 |

**Conversion:** Relayer uses `sessionStateToDeltas()` — `cashDelta = initialBalance - balance`; position deltas from account positions.

---

## 3. ChannelSettlement Flow (CurrentSmartContract §6.3, §7.4)

```
submitCheckpointFromPayload(payload)
  → decode Checkpoint, Delta[], operatorSig, users, userSigs
  → verify operator sig recovers to operator
  → verify each user sig over checkpoint digest
  → store Pending (nonce, challengeDeadline, hashes)
  → V3-Escrow: reserve(user, netDebit) per debtor

finalizeCheckpoint(marketId, sessionId, deltas) [after challenge window]
  → verify pending exists, window elapsed
  → ExecutionLedger.applyDeltas (share positions)
  → _applyCashDeltasAndFees
    → FeeManager.computeSplit (protocolFeeBps, lpFeeShareBps, creatorFeeShareBps)
    → netTraderDelta reconciliation with LP vault (if exists)
    → protocol fee → FeePool
    → lp fee → LP vault or TreasuryPool
    → creator fee → market creator
  → release reserves
```

---

## 4. MarketRegistry and Timing

| MarketRegistry Field | Relayer Use |
|----------------------|-------------|
| tradingOpen, tradingClose | Relayer session `resolveTime` can align; `lastTradeAt <= tradingClose` enforced at finalize |
| settled | When true, no more checkpoints for that market |
| liquidityVaultByMarketId | LP vault for net trader delta; `MarketRegistry.getSettlementAsset` |
| settlementAssetByMarketId | Settlement token for cash deltas |

---

## 5. Vault Mapping

| Vault | Role | Relayer Relation |
|-------|------|-----------------|
| MultiAssetVault | Per-asset custody; free/reserved/available | Cash deltas apply here; `redeemPayout` for winners |
| CollateralVault | Single-token fallback | Alternative when MAV not used |
| LiquidityVault4626 | Per-draft LP; ERC-4626 | `payToTradingLedger` when netTraderDelta > 0; receives when < 0 |
| FeePool | Protocol fees | ChannelSettlement routes protocol fee |
| TreasuryPool | LP fee fallback | When LP vault has zero supply |

---

## 6. OutcomeToken1155 (V3)

| Concept | Relayer | Contract |
|---------|---------|----------|
| Position | account.positions[outcomeIndex] | OutcomeToken1155.balanceOf(user, tokenId(marketId, outcomeIndex)) |
| Mint | sharesDelta > 0 in Delta | ChannelSettlement mints on finalize |
| Burn | sharesDelta < 0 in Delta | ChannelSettlement burns on finalize |
| Transfer lock | N/A (off-chain) | Transfer locked until resolved |

---

## 7. Fee Model (CurrentSmartContract §7.4, §7.5)

Relayer `feeParams.tau` is the **trader fee** (e.g. 0.01 = 1%). On-chain, `FeeManager` splits:

- **protocolFeeBps** — total fee cap (2%)
- **lpFeeShareBps**, **creatorFeeShareBps** — split of total fee
- Applied only to **positive** cashDelta (trader profit)

Relayer does not compute protocol/LP/creator split; `ChannelSettlement` does during `_applyCashDeltasAndFees`.

---

## 8. Related Documents

- [E2E_FLOW.md](E2E_FLOW.md) — Full sequence
- [SESSION_LIFECYCLE.md](SESSION_LIFECYCLE.md) — Session vs market timing
- [CurrentSmartContract.md](../../../front-end-v2/docs/abi/docs/CurrentSmartContract.md)
