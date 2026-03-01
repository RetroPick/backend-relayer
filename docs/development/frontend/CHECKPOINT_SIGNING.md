# Checkpoint Signing (Frontend)

**Audience:** Frontend engineers  
**Context:** [CREWorkflowCheckpoints.md](../../../../../packages/contracts/docs/abi/docs/cre/CREWorkflowCheckpoints.md) | [CheckpointEIP712.md](../../../../../packages/contracts/docs/abi/docs/relayer/CheckpointEIP712.md) | [CurrentSmartContract.md](../../../../../front-end-v2/docs/abi/docs/CurrentSmartContract.md) Section 5.3 (Checkpoint types)

---

## 1. When Checkpoint Is Ready

When a session has new trades, the relayer can build a checkpoint. The CRE workflow or frontend fetches the checkpoint spec via:

```
GET {relayerUrl}/cre/checkpoints/:sessionId
```

**Response (key fields):**

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

| Field | Use |
|-------|-----|
| digest | EIP-712 digest to sign (or build typed data from checkpoint) |
| users | List of addresses that must sign |
| channelSettlementAddress | EIP-712 `verifyingContract` |
| chainId | EIP-712 domain chainId |
| checkpoint | Full struct for typed data signing |

---

## 2. Frontend Responsibility

For each user in `users`, prompt them to sign the checkpoint. Two options:

### Option A: Sign Digest Directly (personal_sign)

```typescript
const sig = await signMessage({ message: { raw: digest } });
```

### Option B: EIP-712 Typed Data (Recommended)

Build typed data from `checkpoint` and domain:

```typescript
const domain = {
  name: "ShadowPool",
  version: "1",
  chainId: chainId,
  verifyingContract: channelSettlementAddress,
};

const types = {
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
};

const message = {
  marketId: BigInt(checkpoint.marketId),
  sessionId: checkpoint.sessionId,
  nonce: BigInt(checkpoint.nonce),
  validAfter: BigInt(checkpoint.validAfter),
  validBefore: BigInt(checkpoint.validBefore),
  lastTradeAt: Number(checkpoint.lastTradeAt),
  stateHash: checkpoint.stateHash,
  deltasHash: checkpoint.deltasHash,
  riskHash: checkpoint.riskHash ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
};

const sig = await signTypedDataAsync({
  domain,
  types,
  primaryType: "Checkpoint",
  message,
  account: userAddress,
});
```

---

## 3. Send Signatures

**POST** `{relayerUrl}/cre/checkpoints/:sessionId`

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

**Important:** The frontend does NOT submit this payload on-chain. The CRE workflow fetches it (or receives it via your integration) and delivers via `writeReport` to the Chainlink Forwarder.

---

## 4. Domain and Struct (Reference)

| Domain Field | Value |
|--------------|-------|
| name | `ShadowPool` |
| version | `1` |
| chainId | 43113 (Fuji) |
| verifyingContract | `0xFA5D0e64B0B21374690345d4A88a9748C7E22182` (ChannelSettlement) |

**Checkpoint struct:** marketId, sessionId, nonce, validAfter, validBefore, lastTradeAt, stateHash, deltasHash, riskHash.

See [CheckpointEIP712.md](../../../../../packages/contracts/docs/abi/docs/relayer/CheckpointEIP712.md) for full spec.

---

## 5. After Finalize

- Subscribe to `ChannelSettlement.CheckpointFinalized(marketId, sessionId, nonce)`
- Refresh `OutcomeToken1155.balanceOf(user, tokenId)` for affected users
- Refresh vault balances (freeBalance, availableBalance)
