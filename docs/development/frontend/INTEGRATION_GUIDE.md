# Frontend Integration Guide

**Audience:** Frontend engineers  
**Prerequisites:** Wallet connection (e.g. wagmi, viem), env config per [ENV_AND_CONFIG.md](ENV_AND_CONFIG.md)  
**Reference:** [CurrentSmartContract.md](../../../../front-end-v2/docs/abi/docs/CurrentSmartContract.md) Section 13 (Production Path), [E2E_FLOW.md](../E2E_FLOW.md)

---

## 1. Environment Setup

Add to `apps/front-end-v2/.env` or build environment:

```
VITE_RELAYER_URL=https://backend-relayer-production.up.railway.app
```

For local development:

```
VITE_RELAYER_URL=http://localhost:8790
```

---

## 2. Typical Flow

```
Create session (or reuse) -> Credit user (dev/test) -> Place orders (buy/swap/sell) -> Poll account
```

**Checkpoint path:** Frontend does NOT submit checkpoints on-chain. CRE delivers. Frontend provides user signatures when prompted. See [CHECKPOINT_SIGNING.md](CHECKPOINT_SIGNING.md).

---

## 3. Code Snippets

### 3.1 Create Session

```typescript
const RELAYER_URL = import.meta.env.VITE_RELAYER_URL;

async function createSession(sessionId: string, marketId: string | number) {
  const res = await fetch(`${RELAYER_URL}/api/session/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      marketId,
      vaultId: "0x" + "aa".repeat(20),
      numOutcomes: 2,
      b: 100,
      resolveTime: Math.floor(Date.now() / 1000) + 86400,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

### 3.2 Credit User (Dev/Test)

```typescript
async function creditUser(sessionId: string, userAddress: string, amount: number) {
  const res = await fetch(`${RELAYER_URL}/api/session/credit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, userAddress, amount }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

### 3.3 Get Quote

```typescript
async function getBuyQuote(sessionId: string, outcomeIndex: number, delta: number) {
  const params = new URLSearchParams({
    type: "buy",
    outcomeIndex: String(outcomeIndex),
    delta: String(delta),
  });
  const res = await fetch(
    `${RELAYER_URL}/api/session/${sessionId}/quote?${params}`
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

### 3.4 Place Buy Order

```typescript
async function buyShares(
  sessionId: string,
  outcomeIndex: number,
  delta: number,
  userAddress: string,
  opts?: { maxCost?: number; minShares?: number; maxOddsImpactBps?: number }
) {
  const res = await fetch(`${RELAYER_URL}/api/trade/buy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      outcomeIndex,
      delta,
      userAddress,
      ...opts,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

### 3.5 Get Account

```typescript
async function getAccount(sessionId: string, address: string) {
  const res = await fetch(
    `${RELAYER_URL}/api/session/${sessionId}/account/${address}`
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

---

## 4. Session ID Convention

Use a deterministic `sessionId` per market/session, e.g.:

- `keccak256(marketId + vaultId + "session")` truncated to 32 bytes
- Or a simple hex for single-session markets: `0x0000...0001`

**Contract correlation:** `sessionId` becomes `ChannelSettlement` session key and `ShadowTypes.Checkpoint.sessionId`. See [CONTRACT_MAPPING.md](../CONTRACT_MAPPING.md).

---

## 5. Contract Addresses

For EIP-712 checkpoint signing and contract reads, use addresses from [DeploymentConfig.md](../../../../../packages/contracts/docs/abi/docs/frontend/DeploymentConfig.md):

| Contract | Fuji Address |
|----------|-------------|
| ChannelSettlement | `0xFA5D0e64B0B21374690345d4A88a9748C7E22182` |
| OutcomeToken1155 | `0x9B413811ecfD0e0679A7Ba785de44E15E7482044` |
| MarketRegistry | `0x3235094A8826a6205F0A0b74E2370A4AC39c6Cc2` |

---

## 6. Checkpoint Path (Summary)

1. Relayer/CRE fetches `GET /cre/checkpoints/:sessionId` to get digest and users
2. Frontend prompts each user to sign checkpoint digest (EIP-712)
3. Frontend or workflow sends `POST /cre/checkpoints/:sessionId` with `{ userSigs }`
4. Relayer returns `0x03`-prefixed payload; CRE delivers on-chain
5. Frontend subscribes to `CheckpointFinalized` and refreshes positions and balances

See [CHECKPOINT_SIGNING.md](CHECKPOINT_SIGNING.md) for EIP-712 details.

**Related:** [EVENTS_REFERENCE.md](../EVENTS_REFERENCE.md) for event subscriptions; [SESSION_LIFECYCLE.md](../SESSION_LIFECYCLE.md) for tradingClose alignment.
