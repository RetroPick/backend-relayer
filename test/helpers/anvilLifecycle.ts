/**
 * Programmatic Anvil lifecycle for integration tests.
 * Requires anvil and forge on PATH.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

const ANVIL_PORT = 8545;
const ANVIL_RPC = `http://127.0.0.1:${ANVIL_PORT}`;

let anvilProc: ChildProcess | null = null;

async function waitForRpc(url: string, maxAttempts = 30): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_blockNumber",
          params: [],
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as { result?: string };
        if (json.result) return;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Anvil RPC not ready");
}

export async function startAnvil(port = ANVIL_PORT): Promise<string> {
  if (anvilProc) throw new Error("Anvil already running");
  const rpc = `http://127.0.0.1:${port}`;
  anvilProc = spawn("anvil", ["--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  anvilProc.unref();
  await waitForRpc(rpc);
  return rpc;
}

export async function stopAnvil(): Promise<void> {
  if (anvilProc) {
    anvilProc.kill("SIGKILL");
    anvilProc = null;
  }
}

const DEPLOY_SCRIPT = "script/DeployAnvilRelayerTest.s.sol";
const FORGE_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export interface DeployResult {
  channelSettlementAddress: string;
  marketId: string;
  multiAssetVault: string;
  settlementToken: string;
  outcomeToken: string;
  rpcUrl: string;
}

function parseDeployOutput(stdout: string, rpcUrl: string): DeployResult {
  const lines = stdout.split("\n");
  const get = (key: string): string => {
    const line = lines.find((l) => l.includes(key));
    if (!line) throw new Error(`Missing ${key} in forge output`);
    const match = line.match(/(0x[a-fA-F0-9]{40}|\d+)/);
    return match ? match[1].trim() : "";
  };
  return {
    channelSettlementAddress: get("CHANNEL_SETTLEMENT_ADDRESS"),
    marketId: get("MARKET_ID"),
    multiAssetVault: get("MULTI_ASSET_VAULT"),
    settlementToken: get("SETTLEMENT_TOKEN"),
    outcomeToken: get("OUTCOME_TOKEN"),
    rpcUrl,
  };
}

export async function deployAndSeed(rpcUrl: string): Promise<DeployResult> {
  const contractsDir = new URL("../../../../packages/contracts", import.meta.url).pathname;
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "forge",
      ["script", DEPLOY_SCRIPT, "--rpc-url", rpcUrl, "--broadcast", "--private-key", FORGE_PRIVATE_KEY],
      {
        cwd: contractsDir,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    let out = "";
    proc.stdout?.on("data", (ch) => (out += ch.toString()));
    proc.stderr?.on("data", (ch) => (out += ch.toString()));
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(`forge script failed: ${code}\n${out}`));
      else resolve(parseDeployOutput(out, rpcUrl));
    });
  });
}

export async function runWithAnvil<T>(
  fn: (deploy: DeployResult) => Promise<T>
): Promise<T> {
  const rpcUrl = await startAnvil();
  try {
    const deploy = await deployAndSeed(rpcUrl);
    return await fn(deploy);
  } finally {
    await stopAnvil();
  }
}
