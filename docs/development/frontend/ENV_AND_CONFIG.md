# Frontend Environment and Configuration

**Audience:** Frontend engineers  
**Reference:** [DeploymentConfig.md](../../../../../packages/contracts/docs/abi/docs/frontend/DeploymentConfig.md)

---

## 1. Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_RELAYER_URL` | Yes | Base URL for all relayer API calls |

**Example (.env):**

```
VITE_RELAYER_URL=https://backend-relayer-production.up.railway.app
```

**Local development:**

```
VITE_RELAYER_URL=http://localhost:8790
```

---

## 2. Deployment Config (Fuji)

These values are used for EIP-712 signing and contract reads. Source: [DeploymentConfig.md](../../packages/contracts/docs/abi/docs/frontend/DeploymentConfig.md).

| Parameter | Value |
|-----------|-------|
| Chain ID | 43113 (Avalanche Fuji) |
| ChannelSettlement | `0xFA5D0e64B0B21374690345d4A88a9748C7E22182` |
| OutcomeToken1155 | `0x9B413811ecfD0e0679A7Ba785de44E15E7482044` |
| MarketRegistry | `0x3235094A8826a6205F0A0b74E2370A4AC39c6Cc2` |

---

## 3. TypeScript Env Declaration

In `vite-env.d.ts` or similar:

```typescript
interface ImportMetaEnv {
  readonly VITE_RELAYER_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

---

## 4. Usage in Code

```typescript
const RELAYER_URL = import.meta.env.VITE_RELAYER_URL;

if (!RELAYER_URL) {
  throw new Error("VITE_RELAYER_URL is required");
}
```

---

## 5. Relayer-Side vs Frontend

| Config | Where | Purpose |
|--------|-------|---------|
| `OPERATOR_PRIVATE_KEY` | Relayer only | Checkpoint signing; never exposed to frontend |
| `CHANNEL_SETTLEMENT_ADDRESS` | Relayer + frontend | Relayer uses for EIP-712; frontend gets from relayer response or config |
| `VITE_RELAYER_URL` | Frontend only | Base URL for API calls |
