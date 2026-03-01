# Relayer PaaS Deployment Guide

Deploy the RetroPick relayer to a PaaS (Railway or Render) so it runs 24/7 and is callable by the frontend, CRE workflow, and smart contracts.

## Prerequisites

- **Deployed ChannelSettlement** on the target chain (e.g. Avalanche Fuji). See [DeploymentConfig](../../packages/contracts/docs/abi/docs/frontend/DeploymentConfig.md).
- **Operator private key** — the key that matches `ChannelSettlement.operator`. Used for checkpoint signing and `finalizeCheckpoint`.
- **GitHub repo** with the relayer code (monorepo with `apps/relayer`).

## Environment Variables

Set these in your PaaS project (Railway Variables or Render Environment):

| Variable | Required | Description |
|----------|----------|-------------|
| `RPC_URL` | Yes | JSON-RPC URL (e.g. `https://api.avax-test.network/ext/bc/C/rpc` for Fuji) |
| `CHANNEL_SETTLEMENT_ADDRESS` | Yes | ChannelSettlement contract address (e.g. Fuji: `0xFA5D0e64B0B21374690345d4A88a9748C7E22182`) |
| `OPERATOR_PRIVATE_KEY` | Yes | Private key matching ChannelSettlement `operator` |
| `CHAIN_ID` | Yes | Chain ID (Fuji: `43113`) |
| `FINALIZER_PRIVATE_KEY` | No | For `POST /cre/finalize`; defaults to `OPERATOR_PRIVATE_KEY` |
| `HOST` | No | Bind host; defaults to `0.0.0.0` for PaaS |
| `PORT` | No | PaaS sets this automatically; relayer uses `PORT ?? RELAYER_PORT ?? 8790` |

---

## Railway Deployment

1. Go to [railway.app](https://railway.app) and create a project.
2. Connect your GitHub repository.
3. **Add a service** → Deploy from GitHub repo.
4. **Settings**:
   - **Root directory**: `apps/relayer`
   - **Build command**: `npm install`
   - **Start command**: `npm start`
5. **Variables** → Add all required env vars (see table above).
6. **Deploy**. Railway assigns a public URL (e.g. `https://retropick-relayer-production.up.railway.app`).
7. **Generate domain**: In the service, open Settings → Networking → Generate Domain.

---

## Render Deployment

1. Go to [render.com](https://render.com) and create an account.
2. **New** → **Web Service**.
3. Connect your GitHub repository.
4. **Settings**:
   - **Root directory**: `apps/relayer`
   - **Build command**: `npm install`
   - **Start command**: `npm start`
5. **Environment** → Add all required env vars.
6. **Deploy**. Render assigns a `*.onrender.com` URL.

---

## Health Checks

After deployment, verify the relayer is running:

**Health (minimal):**
```bash
curl https://your-relayer.up.railway.app/health
# {"ok":true}
```

**Debug (config status):**
```bash
curl https://your-relayer.up.railway.app/debug
# {"port":"8790","channelSettlementConfigured":true,"operatorConfigured":true}
```

---

## Post-Deploy: Wire Integration

### 1. CRE Workflow Config

Update `apps/workflow/config.staging.json` and `config.production.json`:

```json
"relayerUrl": "https://your-actual-relayer-url.up.railway.app"
```

Replace `https://YOUR-RELAYER-URL` with the real PaaS URL. The checkpoint job (when implemented) will use this to fetch payloads from the relayer.

### 2. Frontend

Add to `apps/front-end-v2/.env` or your build environment:

```
VITE_RELAYER_URL=https://your-actual-relayer-url.up.railway.app
```

Any trading or checkpoint code should use `import.meta.env.VITE_RELAYER_URL` as the base URL for relayer API calls.

---

## ABI Sync (Optional)

If ChannelSettlement ABI changes, run before redeploying:

```bash
cd apps/relayer
npm run sync-abi
```

Commit the updated `src/contracts/abis/ChannelSettlement.json` before deploying.

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| 503 on CRE endpoints | `CHANNEL_SETTLEMENT_ADDRESS` or `OPERATOR_PRIVATE_KEY` not set | Add env vars in PaaS |
| Connection refused from frontend | CORS or wrong URL | Relayer uses `origin: true`; verify frontend URL is correct |
| Nonce sync fails | Wrong `RPC_URL` or `CHAIN_ID` | Use chain-matching RPC and CHAIN_ID |
| Finalize reverts | Challenge window not elapsed | Wait 30 min after checkpoint submit, or check `challengeDeadline` |
