# RetroPick Relayer

Yellow Session Execution Layer for RetroPick prediction markets. Implements the whitepaper's off-chain trading, LS-LMSR pricing, and CRE integration.

## Features

- **NitroliteClient**: Yellow Network state channel setup (custody, adjudicator)
- **EIP-712 Auth**: Session key management via `@erc7824/nitrolite`
- **LS-LMSR Pricing**: Cost function, prices, BuyShares, SwapShares
- **Session State**: q, balances, positions, nonce, prevStateHash
- **Trading API**: POST `/api/trade/buy`, POST `/api/trade/swap` with maxCost, minShares, maxOddsImpact
- **CRE Endpoints**: GET `/cre/sessions`, GET `/cre/sessions/:id`, GET `/cre/checkpoints`
- **Checkpointing**: Builds stateHash, accountsRoot for onchain commit

## Install

```bash
bun install
# or
npm install
```

## Run

```bash
bun run dev
# or
npm run dev
```

## API

### Session

- `POST /api/session/create` – Create session (sessionId, marketId, vaultId, numOutcomes, b, resolveTime)
- `POST /api/session/credit` – Credit user balance (for testing)

### Trades

- `POST /api/trade/buy` – BuyShares (sessionId, outcomeIndex, delta, maxCost?, minShares?, maxOddsImpactBps?, userAddress)
- `POST /api/trade/swap` – SwapShares (sessionId, fromOutcome, toOutcome, delta, userAddress)

### CRE (workflow integration)

- `GET /cre/sessions` – Sessions ready for finalization (resolveTime <= now)
- `GET /cre/sessions/:sessionId` – Session payload for CRE report
- `GET /cre/checkpoints` – Checkpoint payloads (stateHash, accountsRoot)

## Config

See `.env.example`. Set `OPERATOR_PRIVATE_KEY` to enable NitroliteClient. Set `relayerUrl` in workflow config to fetch sessions from relayer.
