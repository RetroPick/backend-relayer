# CRE Integration

Documentation for Chainlink CRE (Chainlink Runtime Environment) workflow engineers integrating with the RetroPick relayer.

**Correlated with:** [CurrentSmartContract.md](../../../../front-end-v2/docs/abi/docs/CurrentSmartContract.md) (Section 6.1 Oracle, Section 6.3 Checkpoint, Section 4 Trust Boundaries)

---

## Index

| Document | Purpose |
|----------|---------|
| [API_REFERENCE.md](API_REFERENCE.md) | Full CRE API reference |
| [WORKFLOW_INTEGRATION.md](WORKFLOW_INTEGRATION.md) | CRE workflow steps, config, relayerUrl |
| [CHECKPOINT_FLOW.md](CHECKPOINT_FLOW.md) | Submit, challenge window, finalize sequence |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Relayer, CRE, Chainlink, ChannelSettlement pipeline |

---

## Cross-References

| Topic | Document |
|-------|----------|
| Full E2E flow (Frontend + CRE + Contracts) | [E2E_FLOW.md](../E2E_FLOW.md) |
| Relayer ↔ contract field mapping | [CONTRACT_MAPPING.md](../CONTRACT_MAPPING.md) |
| Session vs tradingClose | [SESSION_LIFECYCLE.md](../SESSION_LIFECYCLE.md) |
| Error handling | [TROUBLESHOOTING.md](../TROUBLESHOOTING.md) |
| Frontend signature collection | [frontend/CHECKPOINT_SIGNING.md](../frontend/CHECKPOINT_SIGNING.md) |

---

## Quick Start

1. Set `relayerUrl` in workflow config: `https://backend-relayer-production.up.railway.app`
2. Poll `GET {relayerUrl}/cre/checkpoints` to discover sessions with checkpointable deltas
3. For each session: `GET /cre/checkpoints/:sessionId` for digest and users
4. Collect user signatures (frontend or signing service)
5. `POST /cre/checkpoints/:sessionId` with `{ userSigs }` to get 0x03-prefixed payload
6. Call `evmClient.writeReport(payload)` targeting CREReceiver
7. After 30 min challenge window: relayer `POST /cre/finalize/:sessionId` or workflow submits finalize

---

## Related

- [frontend/](../frontend/) — Frontend signature collection
- [CREWorkflowCheckpoints.md](../../../../../packages/contracts/docs/abi/docs/cre/CREWorkflowCheckpoints.md)
