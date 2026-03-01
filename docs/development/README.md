# RetroPick Development Documentation

Consolidated integration documentation for frontend and CRE (Chainlink Runtime Environment) engineers integrating with the RetroPick relayer API.

---

## Overview

The RetroPick relayer is the off-chain trading engine for prediction markets. It provides:

- **Trading API** — Gasless trading: sessions, buy/swap/sell, quotes, prices
- **CRE API** — Checkpoint payloads for Chainlink workflow delivery to on-chain settlement

**Architecture reference:** [CurrentSmartContract.md](../../../front-end-v2/docs/abi/docs/CurrentSmartContract.md) | [packages/contracts/README.md](../../../../packages/contracts/README.md)

---

## Correlated Documentation (Frontend ↔ CRE ↔ Smart Contracts)

| Document | Purpose |
|----------|---------|
| [E2E_FLOW.md](E2E_FLOW.md) | End-to-end sequence: Frontend, Relayer, CRE, Smart Contracts |
| [CONTRACT_MAPPING.md](CONTRACT_MAPPING.md) | Relayer fields ↔ CurrentSmartContract data models |
| [SESSION_LIFECYCLE.md](SESSION_LIFECYCLE.md) | Session vs MarketRegistry timing (tradingClose, lastTradeAt) |
| [EVENTS_REFERENCE.md](EVENTS_REFERENCE.md) | Smart contract events for frontend subscriptions |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Correlated error handling and diagnostics |

---

## Live API

| Environment | Base URL | Status |
|-------------|----------|--------|
| **Production** | `https://backend-relayer-production.up.railway.app` | Deployed (Railway) |

**Railway project:** [51e455a9-a345-4552-97c9-60420fee6bbf](https://railway.com/project/51e455a9-a345-4552-97c9-60420fee6bbf)

**Health check:**
```bash
curl https://backend-relayer-production.up.railway.app/health
# {"ok":true}
```

---

## Documentation Index

| Area | Documents |
|------|-----------|
| **Frontend** | [development/frontend/](frontend/) — Trading API, integration guide, checkpoint signing, env config |
| **CRE** | [development/cre/](cre/) — CRE API, workflow integration, checkpoint flow, architecture |

---

## Quick Links

| Topic | Document |
|-------|----------|
| Relayer source | [apps/relayer/](../../) |
| Smart contracts | [packages/contracts/](../../../../packages/contracts/) |
| Frontend deployment config | [DeploymentConfig.md](../../../../packages/contracts/docs/abi/docs/frontend/DeploymentConfig.md) |
| CRE workflow | [apps/workflow/](../../../workflow/) |
