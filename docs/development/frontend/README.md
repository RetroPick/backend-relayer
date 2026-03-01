# Frontend Integration

Documentation for frontend engineers integrating with the RetroPick relayer API.

**Correlated with:** [CurrentSmartContract.md](../../../../front-end-v2/docs/abi/docs/CurrentSmartContract.md) (Section 6.3 Checkpoint, Section 13 Production Path)

---

## Index

| Document | Purpose |
|----------|---------|
| [API_REFERENCE.md](API_REFERENCE.md) | Full Trading API reference — endpoints, schemas, constraints, errors |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | Step-by-step integration with code snippets |
| [CHECKPOINT_SIGNING.md](CHECKPOINT_SIGNING.md) | EIP-712 checkpoint signing flow for user signatures |
| [ENV_AND_CONFIG.md](ENV_AND_CONFIG.md) | Environment variables and deployment config |

---

## Cross-References

| Topic | Document |
|-------|----------|
| Full E2E flow (Frontend + CRE + Contracts) | [E2E_FLOW.md](../E2E_FLOW.md) |
| Session vs market timing | [SESSION_LIFECYCLE.md](../SESSION_LIFECYCLE.md) |
| Events to subscribe to | [EVENTS_REFERENCE.md](../EVENTS_REFERENCE.md) |
| Error handling | [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) |
| CRE checkpoint delivery | [cre/WORKFLOW_INTEGRATION.md](../cre/WORKFLOW_INTEGRATION.md) |

---

## Quick Start

1. Set `VITE_RELAYER_URL=https://backend-relayer-production.up.railway.app`
2. Create or reuse session via `POST /api/session/create`
3. Credit user (dev/test) via `POST /api/session/credit`
4. Place orders via `POST /api/trade/buy`, `POST /api/trade/swap`, or `POST /api/trade/sell`
5. Get quotes via `GET /api/session/:sessionId/quote?type=buy&outcomeIndex=0&delta=10`

**Checkpoint delivery:** The frontend does not submit checkpoints on-chain. CRE fetches payloads from the relayer and delivers via Chainlink. Frontend only provides user signatures when prompted — see [CHECKPOINT_SIGNING.md](CHECKPOINT_SIGNING.md).

---

## Related

- [cre/](../cre/) — CRE workflow integration (checkpoint delivery)
- [DeploymentConfig.md](../../../../../packages/contracts/docs/abi/docs/frontend/DeploymentConfig.md) — Contract addresses (Fuji)
