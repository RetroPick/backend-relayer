# RetroPick Relayer

Standalone off-chain trading engine for RetroPick prediction markets (V3). Implements LS-LMSR pricing, session state, checkpoint building, and finalizer integration. No Nitrolite or Yellow Network required.

## Architecture

| Component | Role |
|----------|------|
| **Trading** | LS-LMSR pricing; BuyShares, SwapShares; in-memory session state |
| **Checkpoint** | Build signed payloads (operator + user EIP-712); serve CRE workflow via `GET/POST /cre/checkpoints/:sessionId` |
| **Chain Client** | `latestNonce` sync, `finalizeCheckpoint`, `cancelPendingCheckpoint` via ChannelSettlement ABI |

The relayer does **not** send checkpoint submit transactions. It prepares signed data; the CRE workflow delivers it via Chainlink Forwarder → CREReceiver → ChannelSettlement. The relayer can optionally submit `finalizeCheckpoint` after the 30 min challenge window via `POST /cre/finalize/:sessionId`.

## Features

- **LS-LMSR Pricing**: Cost function, prices, BuyShares, SwapShares
- **Session State**: q, balances, positions, nonce, lastTradeAt, prevStateHash
- **Trading API**: `POST /api/trade/buy`, `POST /api/trade/swap` with maxCost, minShares, maxOddsImpact
- **CRE Endpoints**: `GET /cre/sessions`, `GET /cre/sessions/:id`, `GET /cre/checkpoints`, `GET /cre/checkpoints/:sessionId`, `POST /cre/checkpoints/:sessionId`, `POST /cre/finalize/:sessionId`
- **Checkpointing**: Chain nonce sync, EIP-712 signatures, lastTradeAt tracking
- **Finalizer**: Optional `POST /cre/finalize/:sessionId` to submit finalizeCheckpoint tx (permissionless; relayer convenience)

## Install

```bash
npm install
```

## Config

Copy `.env.example` to `.env`:

| Variable | Purpose |
|----------|---------|
| `CHANNEL_SETTLEMENT_ADDRESS` | **Required** — ChannelSettlement contract (e.g. Fuji: `0xFA5D0e64B0B21374690345d4A88a9748C7E22182`) |
| `OPERATOR_PRIVATE_KEY` | Required for checkpoint signing (must match contract OPERATOR) |
| `FINALIZER_PRIVATE_KEY` | Optional — for `POST /cre/finalize`; defaults to `OPERATOR_PRIVATE_KEY` |
| `RPC_URL` | Required — for nonce sync and finalizer |
| `CHAIN_ID` | Chain ID (Fuji: 43113) |

## Run

```bash
npm run dev
```

## API

### Session

- `POST /api/session/create` – Create session (sessionId, marketId, vaultId, numOutcomes, b, resolveTime?, riskCaps?, b0?, alpha?)
- `POST /api/session/credit` – Credit user balance (for testing)
- `GET /api/session/:sessionId` – Session metadata (q, bParams, nonce, riskCaps, etc.)
- `GET /api/session/:sessionId/account/:address` – User balance, positions, initialBalance
- `GET /api/session/:sessionId/quote` – Pre-trade quote: `?type=buy&outcomeIndex=0&delta=10` or `?type=swap&fromOutcome=0&toOutcome=1&delta=10`
- `GET /api/session/:sessionId/prices` – Current marginal price vector

### Trades

- `POST /api/trade/buy` – BuyShares (sessionId, outcomeIndex, delta, maxCost?, minShares?, maxOddsImpactBps?, userAddress)
- `POST /api/trade/swap` – SwapShares (sessionId, fromOutcome, toOutcome, delta, maxCost?, minReceive?, userAddress)
- `POST /api/trade/sell` – SellShares (sessionId, outcomeIndex, delta, minReceive?, maxOddsImpactBps?, userAddress)

### Risk caps (optional)

Pass `riskCaps` in `POST /api/session/create`:

- `maxOI` – Max open interest Σ max(0, q_i)
- `maxPosPerUser` – Max position per outcome per user (in outcome units)
- `maxOddsImpactBps` – Session default for maxOddsImpact

### CRE (workflow integration)

- `GET /cre/sessions` – Sessions ready for finalization (resolveTime <= now)
- `GET /cre/sessions/:sessionId` – Session payload for legacy SessionFinalizer path
- `GET /cre/checkpoints` – Checkpoint metadata list (sessionId, marketId, nonce, hasDeltas)
- `GET /cre/checkpoints/:sessionId` – Checkpoint spec for ChannelSettlement (digest, users, deltas); syncs nonce from chain
- `POST /cre/checkpoints/:sessionId` – Build full payload; body `{ userSigs: { [address]: "0x..." } }`; returns `0x03`-prefixed payload for CRE
- `POST /cre/finalize/:sessionId` – Submit `finalizeCheckpoint` tx (permissionless; requires RPC_URL and FINALIZER_PRIVATE_KEY or OPERATOR_PRIVATE_KEY)

## Precision and scaling

- **Balance and positions** use **1e6** scaling (6 decimals). One unit = 1,000,000 internal units.
- **Delta conversion**: Checkpoint deltas use `int128` for sharesDelta and cashDelta. The relayer passes values in 1e6 scale; the contract may expect the same (verify OutcomeToken1155 / vault decimals).
- **Overflow**: `int128` max ≈ 2^127; 1e6 × typical amounts is safe for most use cases.

## ABI Sync

The relayer uses `ChannelSettlement.json` from `packages/contracts/docs/abi/`. After contract changes, run:

```bash
npm run sync-abi
```

## Tests

```bash
npm run test
npm run test:coverage
npm run test:integration   # Integration tests only (requires RPC + deployed contract)
```

Unit tests cover LMSR, session store, checkpoint building, and API routes. Gasless trading tests run without RPC:
- `test/integration/anvilGaslessTrading.test.ts` – Create session, credit, buy/sell/swap (no chain; proves gasless)

### Anvil local testing (real trading + resolution)

Full integration tests require Anvil + `DeployAnvilRelayerTest` (creates market, funds users):

1. **Start Anvil:** `anvil`
2. **Deploy:** `cd packages/contracts && source .env.anvil.example && forge script script/DeployAnvilRelayerTest.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
3. **Configure relayer:** Create `apps/relayer/.env` from `.env.anvil.example`. Set from deploy output:
   - `CHANNEL_SETTLEMENT_ADDRESS`
   - `MARKET_ID` (0)
   - `OUTCOME_TOKEN_ADDRESS` (optional; for on-chain balance assertions)
4. **Run:** `cd apps/relayer && npm run test:integration`

Integration tests (skip when env not set):
- `contractIntegration.test.ts` – `readLatestNonce`, `finalizeCheckpoint` (NoPending revert, success after submit+warp)
- `anvilTradingFlow.test.ts` – Full E2E: create → trade → submit → warp → finalize → verify OutcomeToken
- `anvilResolution.test.ts` – Past resolveTime, nonce increments
- `anvilChallengeWindow.test.ts` – Finalize reverts before 30 min warp, succeeds after
- `anvilMultiUser.test.ts` – Two users, single checkpoint
- `anvilSwapAndSell.test.ts` – Buy, swap, sell paths
- `anvilE2E.test.ts` – Legacy flow (checkpoint spec → build payload)

Alternative deploy: `DeployBetaTestnet.s.sol` for full beta stack (no market created; use `MARKET_ID=0` if you seed a market separately).

## Documentation

| Doc | Description |
|-----|-------------|
| [docs/DEPLOY_PAAS.md](docs/DEPLOY_PAAS.md) | PaaS deployment (Railway, Render) — 24/7 hosting |
| [packages/contracts/docs/abi/docs/relayer/RelayerArchitecture.md](../../packages/contracts/docs/abi/docs/relayer/RelayerArchitecture.md) | Architecture and lifecycle |
| [packages/contracts/docs/abi/docs/cre/CREWorkflowCheckpoints.md](../../packages/contracts/docs/abi/docs/cre/CREWorkflowCheckpoints.md) | How CRE workflow fetches and delivers checkpoints |
