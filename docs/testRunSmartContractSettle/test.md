# Relayer Integration Tests — Smart Contract Settlement

This document explains the integration test output, why some tests pass while others are skipped, and how to run the full suite against a local blockchain (Anvil).

---

## 1. What the Test Output Means

### Example Output

```
 Test Files  1 passed | 7 skipped (8)
      Tests  4 passed | 9 skipped (13)
   Duration  1.60s
```

### Interpretation

| Metric | Meaning |
|--------|---------|
| **1 passed** | 1 test file ran successfully |
| **7 skipped** | 7 test files did not run |
| **4 passed** | 4 individual tests passed |
| **9 skipped** | 9 individual tests were skipped |

### Why Tests Are Skipped

Integration tests use **conditional skipping** based on environment variables:

- **Gasless tests** (`anvilGaslessTrading.test.ts`): Run always — no RPC or chain required
- **All other tests**: Require `RPC_URL` and `CHANNEL_SETTLEMENT_ADDRESS` (and for some, `OPERATOR_PRIVATE_KEY` / `FINALIZER_PRIVATE_KEY`)

When those env vars are missing, tests are skipped with `{ skip: !hasE2EConfig }` or `{ skip: !hasContractConfig }`.

---

## 2. Test File Overview

| File | Tests | Requires | Description |
|------|-------|----------|-------------|
| `anvilGaslessTrading.test.ts` | 4 | — | Off-chain only: session, credit, buy, sell, swap. No blockchain. |
| `anvilE2E.test.ts` | 1 | RPC, contract, operator key | Create → credit → trade → checkpoint spec → build payload (finalize may revert NoPending) |
| `anvilTradingFlow.test.ts` | 1 | RPC, contract, operator key | Full flow: create → credit → buy → checkpoint → submit → warp → finalize → verify outcome token |
| `anvilChallengeWindow.test.ts` | 1 | RPC, contract, operator key | Asserts `finalize` reverts before 30-min warp, succeeds after |
| `anvilResolution.test.ts` | 1 | RPC, contract, operator key | Session with past `resolveTime` in getReadyForFinalization, finalize increments nonce |
| `anvilMultiUser.test.ts` | 1 | RPC, contract, operator key | Two users trade, single checkpoint, both positions on-chain |
| `anvilSwapAndSell.test.ts` | 1 | RPC, contract, operator key | buy 0 → swap 0→1 → sell 1, final state on-chain |
| `contractIntegration.test.ts` | 3 | RPC, contract (operator for finalize) | `readLatestNonce`, `finalizeCheckpoint` (NoPending revert, success after submit) |

---

## 3. Required Environment Variables

To run the **non-skipped** (blockchain) tests, set these in `apps/relayer/.env`:

| Variable | Required For | Description |
|----------|---------------|-------------|
| `RPC_URL` | All chain tests | JSON-RPC endpoint (e.g. `http://127.0.0.1:8545` for Anvil) |
| `CHANNEL_SETTLEMENT_ADDRESS` | All chain tests | Deployed `ChannelSettlement` contract address |
| `OPERATOR_PRIVATE_KEY` or `FINALIZER_PRIVATE_KEY` | Write tests (finalize, submit) | Key for submitting/finalizing checkpoints |
| `MARKET_ID` | Contract integration, multi-user, etc. | Market ID from deployment (default `0`) |
| `CHAIN_ID` | Optional | Chain ID (default Anvil: `31337`) |
| `OUTCOME_TOKEN_ADDRESS` | Optional | For verifying outcome token balances on-chain |

> **Note:** The `.env` file may use `SETTLEMENT_ADDRESS` for the relayer API; the integration tests specifically require `CHANNEL_SETTLEMENT_ADDRESS`. Ensure both are set consistently with the deployed `ChannelSettlement` address if they differ.

---

## 4. Running All Integration Tests Against Anvil

### Step 1: Start Anvil

```bash
anvil
```

Keep this running in a separate terminal. Default RPC: `http://127.0.0.1:8545`.

### Step 2: Deploy Contracts

From the `packages/contracts` directory:

```bash
cd packages/contracts
source .env.anvil.example   # if needed for extra config
forge script script/DeployAnvilRelayerTest.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

The script deploys:

- MockUSDC, OutcomeToken1155, ChannelSettlement
- MultiAssetVault, MarketRegistry, RelayerTestMarketFactory
- A test market and funded users (Anvil accounts 0, 1, 2)

It will print suggested values for `.env`, for example:

```
CHANNEL_SETTLEMENT_ADDRESS= 0x...
MARKET_ID= 0
OUTCOME_TOKEN= 0x...
...
```

### Step 3: Configure Relayer `.env`

Create or update `apps/relayer/.env` with values from the deploy output:

```env
RPC_URL=http://127.0.0.1:8545
CHAIN_ID=31337
CHANNEL_SETTLEMENT_ADDRESS=<from deploy output>
OPERATOR_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
MARKET_ID=0
OUTCOME_TOKEN_ADDRESS=<from deploy output>
```

### Step 4: Run Integration Tests

```bash
cd apps/relayer
npm run test:integration
```

### Step 5: Run with Verbose Output (Optional)

```bash
npm run test:integration -- --reporter=verbose
```

### Step 6: Capture Output to Log File (Optional)

```bash
npm run test:integration 2>&1 | tee integration.log
```

---

## 5. Test Flows in Detail

### 5.1 Gasless Trading (Always Runs)

- **Purpose:** Validate relayer API logic without any chain calls
- **Flow:** Create session → credit user → buy/sell/swap
- **State:** In-memory only

### 5.2 Anvil E2E (Chain Required)

- **Flow:** Create session → credit → trade → `GET /cre/checkpoints/{sessionId}` → build payload from spec
- **Note:** Finalize is not exercised here; it may revert `NoPending` until a checkpoint is submitted (handled in `contractIntegration.test.ts`)

### 5.3 Anvil Trading Flow (Chain Required)

- **Flow:** create → credit → buy → get checkpoint spec → sign → build payload → `submitCheckpointFromPayload` → `warpPastChallengeWindow` (30 min) → finalize → verify outcome token balance

### 5.4 Contract Integration (Chain Required)

- **readLatestNonce:** Asserts nonce is returned when RPC and contract are configured
- **finalizeCheckpoint (NoPending):** Asserts revert when no checkpoint has been submitted
- **finalizeCheckpoint (success):** Submits checkpoint, warps time, finalizes, verifies nonce increments

### 5.5 Challenge Window

- Submits checkpoint
- Asserts finalize reverts before warp (error hints at challenge/window/early)
- Warps past 30-minute window via `evm_increaseTime`
- Asserts finalize succeeds after warp

### 5.6 Multi-User

- Credits two users, each trades outcome 0 or 1
- Single checkpoint includes both in deltas
- Verifies both users’ outcome token balances on-chain (if `OUTCOME_TOKEN_ADDRESS` set)

### 5.7 Swap and Sell

- buy outcome 0 → swap 0→1 → sell outcome 1
- Checkpoint, submit, warp, finalize
- Verifies relayer state and on-chain balances

---

## 6. Anvil Helpers

Tests use `test/helpers/anvil.ts`:

| Function | Purpose |
|----------|---------|
| `evmIncreaseTime(rpcUrl, seconds)` | Advance block.timestamp by `seconds` |
| `evmMine(rpcUrl)` | Mine one block |
| `warpPastChallengeWindow(rpcUrl)` | Increase time by 30 min + 1 s, then mine |

These rely on Anvil-specific JSON-RPC methods (`evm_increaseTime`, `evm_mine`).

---

## 7. Troubleshooting

| Issue | Possible Cause | Fix |
|-------|----------------|-----|
| All chain tests skipped | `RPC_URL` or `CHANNEL_SETTLEMENT_ADDRESS` missing | Set both in `.env` |
| Finalize tests skipped | `OPERATOR_PRIVATE_KEY` / `FINALIZER_PRIVATE_KEY` missing | Add operator key to `.env` |
| Connection refused | Anvil not running | Run `anvil` in another terminal |
| NoPending revert | No checkpoint submitted | Ensure `submitCheckpointFromPayload` is called before finalize |
| Challenge window revert | Not enough time passed | Use `warpPastChallengeWindow(rpcUrl)` before finalize |
| Wrong nonce | Stale chain state | Redeploy and reset `.env` from deploy output |

---

## 8. Summary

- **4 tests pass** without any chain: gasless session creation, credit, buy, sell, swap.
- **9 tests are skipped** when `RPC_URL` and `CHANNEL_SETTLEMENT_ADDRESS` are not set.
- To run the full integration suite:
  1. Start Anvil
  2. Deploy with `DeployAnvilRelayerTest.s.sol`
  3. Set `RPC_URL`, `CHANNEL_SETTLEMENT_ADDRESS`, `OPERATOR_PRIVATE_KEY`, `MARKET_ID` in `apps/relayer/.env`
  4. Run `npm run test:integration`
