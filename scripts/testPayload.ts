#!/usr/bin/env npx tsx
/**
 * Simple payload test script for the deployed relayer.
 * Usage: npx tsx scripts/testPayload.ts [BASE_URL]
 * Default: https://backend-relayer-production.up.railway.app
 */
const BASE_URL = process.argv[2] ?? "https://backend-relayer-production.up.railway.app";

const SESSION_ID = "0x0000000000000000000000000000000000000000000000000000000000000001";
const USER_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

async function fetchJson(
  path: string,
  options?: { method?: string; body?: object }
): Promise<{ status: number; data: unknown }> {
  const url = `${BASE_URL.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    method: options?.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => res.text());
  return { status: res.status, data };
}

async function main() {
  console.log(`Testing relayer at ${BASE_URL}\n`);

  // 1. Health check
  console.log("1. GET /health");
  const health = await fetchJson("/health");
  if (health.status !== 200 || (health.data as { ok?: boolean })?.ok !== true) {
    console.error("   FAIL:", health);
    process.exit(1);
  }
  console.log("   OK:", health.data);

  // 2. Debug (optional)
  console.log("\n2. GET /debug");
  const debug = await fetchJson("/debug");
  console.log("   OK:", debug.data);

  // 3. Create session
  console.log("\n3. POST /api/session/create");
  const create = await fetchJson("/api/session/create", {
    method: "POST",
    body: {
      sessionId: SESSION_ID,
      marketId: "1",
      vaultId: "0x" + "aa".repeat(20),
      numOutcomes: 2,
      b: 100,
    },
  });
  if (create.status !== 200) {
    console.error("   FAIL:", create);
    process.exit(1);
  }
  console.log("   OK");

  // 4. Credit user
  console.log("\n4. POST /api/session/credit");
  const credit = await fetchJson("/api/session/credit", {
    method: "POST",
    body: { sessionId: SESSION_ID, userAddress: USER_ADDRESS, amount: 10000 },
  });
  if (credit.status !== 200) {
    console.error("   FAIL:", credit);
    process.exit(1);
  }
  console.log("   OK");

  // 5. Buy
  console.log("\n5. POST /api/trade/buy");
  const buy = await fetchJson("/api/trade/buy", {
    method: "POST",
    body: {
      sessionId: SESSION_ID,
      outcomeIndex: 0,
      delta: 10,
      userAddress: USER_ADDRESS,
    },
  });
  if (buy.status !== 200) {
    console.error("   FAIL:", buy);
    process.exit(1);
  }
  console.log("   OK");

  // 6. Get account
  console.log("\n6. GET /api/session/:sessionId/account/:address");
  const account = await fetchJson(`/api/session/${SESSION_ID}/account/${USER_ADDRESS}`);
  if (account.status !== 200) {
    console.error("   FAIL:", account);
    process.exit(1);
  }
  console.log("   OK:", account.data);

  console.log("\n--- All payload tests passed ---");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
