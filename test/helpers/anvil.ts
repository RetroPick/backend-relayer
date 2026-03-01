/**
 * Anvil-specific RPC helpers for integration tests.
 * Uses evm_increaseTime and evm_mine (Anvil/Hardhat) for time warp.
 */
export async function evmIncreaseTime(rpcUrl: string, seconds: number): Promise<void> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "evm_increaseTime",
      params: [seconds],
    }),
  });
  if (!res.ok) throw new Error(`evm_increaseTime failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { error?: { message: string } };
  if (json.error) throw new Error(`evm_increaseTime RPC error: ${json.error.message}`);
}

export async function evmMine(rpcUrl: string): Promise<void> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "evm_mine",
      params: [],
    }),
  });
  if (!res.ok) throw new Error(`evm_mine failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { error?: { message: string } };
  if (json.error) throw new Error(`evm_mine RPC error: ${json.error.message}`);
}

/**
 * Warp past the 30-minute challenge window, then mine a block.
 */
export async function warpPastChallengeWindow(rpcUrl: string): Promise<void> {
  const CHALLENGE_WINDOW_SECONDS = 30 * 60;
  await evmIncreaseTime(rpcUrl, CHALLENGE_WINDOW_SECONDS + 1);
  await evmMine(rpcUrl);
}
