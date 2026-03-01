# Smart Contract Events: Frontend Subscriptions

**Audience:** Frontend engineers  
**Reference:** [CurrentSmartContract.md](../../../../front-end-v2/docs/abi/docs/CurrentSmartContract.md), [ChannelSettlement.sol](../../../../packages/contracts/src/execution/ChannelSettlement.sol)

---

## 1. Overview

The frontend should subscribe to on-chain events to keep UI in sync with relayer and settlement state. This document lists the key events and their correlation with relayer flows.

---

## 2. Checkpoint Flow Events

### 2.1 CheckpointSubmitted (ChannelSettlement)

Emitted when `submitCheckpointFromPayload` succeeds.

| Field | Type | Use |
|-------|------|-----|
| marketId | uint256 | Filter by market |
| sessionId | bytes32 | Filter by session |
| nonce | uint64 | Checkpoint nonce |

**Frontend:** Indicates CRE delivered payload; challenge window started. Show "Checkpoint submitted, finalizing in ~30 min".

### 2.2 CheckpointFinalized (ChannelSettlement)

Emitted when `finalizeCheckpoint` succeeds.

| Field | Type | Use |
|-------|------|-----|
| marketId | uint256 | Filter by market |
| sessionId | bytes32 | Filter by session |
| nonce | uint64 | Finalized nonce |

**Frontend:** Refresh `OutcomeToken1155.balanceOf(user, tokenId)` for all users in the checkpoint deltas. Refresh vault balances (`MultiAssetVault.freeBalance`, `availableBalance`).

### 2.3 CheckpointChallenged (ChannelSettlement)

Emitted when a user challenges with a newer nonce (if implemented).

**Frontend:** Show challenge notice; checkpoint may be replaced.

---

## 3. Market and Resolution Events

### 3.1 MarketResolved (MarketRegistry)

Emitted when market is resolved via oracle (0x01 report path).

| Field | Type | Use |
|-------|------|-----|
| marketId | uint256 | Filter |
| winningOutcome | uint256 | Winning outcome index |
| confidence | uint256 | Resolution confidence |

**Frontend:** Market is resolved; enable redeem UI. Resolution is oracle-driven, not relayer.

### 3.2 MarketCreated (MarketRegistry)

Emitted when market is created (e.g. via `createFromDraft`).

**Frontend:** New market available; can create relayer session if using this market.

---

## 4. OutcomeToken1155 Events

### 4.1 TransferSingle (ERC-1155)

Emitted on mint/burn during checkpoint finalize.

| Field | Type | Use |
|-------|------|-----|
| operator | address | ChannelSettlement |
| from | address | 0x0 for mint |
| to | address | user for mint; 0x0 for burn |
| id | uint256 | tokenId(marketId, outcomeIndex) |
| value | uint256 | sharesDelta amount |

**Frontend:** Can use as alternative to polling `balanceOf` after CheckpointFinalized.

---

## 5. Subscription Pattern (Example)

```typescript
import { createPublicClient, parseAbiItem } from "viem";

const client = createPublicClient({ ... });

// Subscribe to CheckpointFinalized for a market
client.watchContractEvent({
  address: CHANNEL_SETTLEMENT_ADDRESS,
  abi: [
    parseAbiItem("event CheckpointFinalized(uint256 marketId, bytes32 sessionId, uint64 nonce)"),
  ],
  eventName: "CheckpointFinalized",
  args: { marketId: marketId },
  onLogs: (logs) => {
    for (const log of logs) {
      // Refresh OutcomeToken1155 balances for affected users
      // Refresh vault balances
    }
  },
});
```

---

## 6. Correlation with Relayer

| Relayer State | Event to React |
|---------------|----------------|
| User traded; checkpoint not yet submitted | None (off-chain) |
| CRE submitted payload | CheckpointSubmitted |
| Relayer called POST /cre/finalize | CheckpointFinalized |
| Oracle resolved market | MarketResolved |

---

## 7. ABI Locations

| Contract | ABI Path |
|----------|----------|
| ChannelSettlement | `packages/contracts/docs/abi/ChannelSettlement.json` |
| MarketRegistry | `packages/contracts/docs/abi/MarketRegistry.json` |
| OutcomeToken1155 | `packages/contracts/docs/abi/OutcomeToken1155.json` |

---

## 8. Related Documents

- [frontend/INTEGRATION_GUIDE.md](frontend/INTEGRATION_GUIDE.md) Section 6
- [frontend/CHECKPOINT_SIGNING.md](frontend/CHECKPOINT_SIGNING.md) Section 5
- [E2E_FLOW.md](E2E_FLOW.md)
