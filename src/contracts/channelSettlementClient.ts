/**
 * ChannelSettlement contract client for relayer chain integration.
 * Provides latestNonce (read) and finalizeCheckpoint / cancelPendingCheckpoint (write).
 */
import { createPublicClient, createWalletClient, http, keccak256, encodeAbiParameters, parseAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hash, Hex } from "viem";
import ChannelSettlementAbi from "./abis/ChannelSettlement.json";

export interface DeltaForContract {
  user: Address;
  outcomeIndex: number;
  sharesDelta: bigint;
  cashDelta: bigint;
}

let publicClient: ReturnType<typeof createPublicClient> | null = null;
let walletClient: ReturnType<typeof createWalletClient> | null = null;

function getChainConfig() {
  const chainId = Number(process.env.CHAIN_ID ?? 43113);
  return {
    id: chainId,
    name: "Custom",
    nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
    rpcUrls: { default: { http: [process.env.RPC_URL ?? "https://api.avax-test.network/ext/bc/C/rpc"] } },
  };
}

function ensurePublicClient() {
  if (!publicClient) {
    const chain = getChainConfig();
    const transport = http(process.env.RPC_URL);
    publicClient = createPublicClient({
      chain: chain as any,
      transport,
    });
  }
  return publicClient;
}

function ensureWalletClient(): ReturnType<typeof createWalletClient> {
  if (!walletClient) {
    const pk = process.env.FINALIZER_PRIVATE_KEY ?? process.env.OPERATOR_PRIVATE_KEY;
    if (!pk) throw new Error("FINALIZER_PRIVATE_KEY or OPERATOR_PRIVATE_KEY required for write operations");
    const chain = getChainConfig();
    const account = privateKeyToAccount(pk as Hex);
    walletClient = createWalletClient({
      chain: chain as any,
      transport: http(process.env.RPC_URL),
      account,
    });
  }
  return walletClient!;
}

export function getChannelSettlementAddress(): Address | null {
  const addr = process.env.CHANNEL_SETTLEMENT_ADDRESS;
  if (!addr || addr === "0x0000000000000000000000000000000000000000") return null;
  return addr as Address;
}

const CHALLENGE_WINDOW_SECONDS = 30 * 60;
const CANCEL_DELAY_SECONDS = 6 * 60 * 60;

function computePendingKey(marketId: bigint, sessionId: Hex): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("uint256, bytes32"), [marketId, sessionId])
  ) as Hex;
}

export interface PendingCheckpointInfo {
  exists: boolean;
  createdAt: number;
  canFinalize: boolean;
  canCancel: boolean;
}

/**
 * Read pending checkpoint info for (marketId, sessionId) from ChannelSettlement.
 * Used to pre-filter finalize/cancel calls.
 */
export async function readPendingCheckpointInfo(
  marketId: bigint,
  sessionId: Hex
): Promise<PendingCheckpointInfo> {
  const address = getChannelSettlementAddress();
  if (!address) {
    return { exists: false, createdAt: 0, canFinalize: false, canCancel: false };
  }

  const client = ensurePublicClient();
  const key = computePendingKey(marketId, sessionId);
  const result = await client.readContract({
    address,
    abi: ChannelSettlementAbi as any,
    functionName: "pendingByKey",
    args: [key],
  }) as [bigint, bigint, bigint, Hex, Hex, Hex, boolean, Address, bigint];
  const [/* nonce */, /* challengeDeadline */, /* lastTradeAt */, /* stateHash */,
    /* deltasHash */, /* riskHash */, exists, /* settlementAsset */, createdAt] = result;

  const now = Math.floor(Date.now() / 1000);
  const createdAtNum = Number(createdAt);
  const canFinalize = exists && now >= createdAtNum + CHALLENGE_WINDOW_SECONDS;
  const canCancel = exists && now >= createdAtNum + CANCEL_DELAY_SECONDS;

  return {
    exists,
    createdAt: createdAtNum,
    canFinalize,
    canCancel,
  };
}

/**
 * Read latest finalized nonce for (marketId, sessionId) from ChannelSettlement.
 * Relayer must use nonce > this when building new checkpoints.
 */
export async function readLatestNonce(marketId: bigint, sessionId: Hex): Promise<bigint> {
  const address = getChannelSettlementAddress();
  if (!address) throw new Error("CHANNEL_SETTLEMENT_ADDRESS not configured");

  const client = ensurePublicClient();
  const result = await client.readContract({
    address,
    abi: ChannelSettlementAbi as any,
    functionName: "latestNonce",
    args: [marketId, sessionId],
  });
  return result as bigint;
}

/**
 * Submit checkpoint from CRE-style payload (0x03-prefixed).
 * Strips 0x03 routing byte and calls submitCheckpointFromPayload.
 * For integration tests only; production path goes via CRE workflow.
 */
export async function submitCheckpointFromPayload(payload: Hex): Promise<Hash> {
  const address = getChannelSettlementAddress();
  if (!address) throw new Error("CHANNEL_SETTLEMENT_ADDRESS not configured");

  const rawPayload = (payload.startsWith("0x03") ? ("0x" + payload.slice(4)) : payload) as Hex;

  const client = ensureWalletClient();
  const hash = await client.writeContract({
    address,
    abi: ChannelSettlementAbi as any,
    functionName: "submitCheckpointFromPayload",
    args: [rawPayload],
  });
  return hash;
}

/**
 * Submit finalizeCheckpoint transaction. Permissionless; anyone can call.
 * Reverts if challenge window not elapsed or no pending checkpoint.
 */
export async function finalizeCheckpoint(
  marketId: bigint,
  sessionId: Hex,
  deltas: DeltaForContract[]
): Promise<Hash> {
  const address = getChannelSettlementAddress();
  if (!address) throw new Error("CHANNEL_SETTLEMENT_ADDRESS not configured");

  const client = ensureWalletClient();
  const hash = await client.writeContract({
    address,
    abi: ChannelSettlementAbi as any,
    functionName: "finalizeCheckpoint",
    args: [
      marketId,
      sessionId,
      deltas.map((d) => ({
        user: d.user,
        outcomeIndex: d.outcomeIndex,
        sharesDelta: d.sharesDelta,
        cashDelta: d.cashDelta,
      })),
    ],
  });
  return hash;
}

/**
 * Cancel stuck pending checkpoint after CANCEL_DELAY (6 hours). Permissionless.
 */
export async function cancelPendingCheckpoint(marketId: bigint, sessionId: Hex): Promise<Hash> {
  const address = getChannelSettlementAddress();
  if (!address) throw new Error("CHANNEL_SETTLEMENT_ADDRESS not configured");

  const client = ensureWalletClient();
  const hash = await client.writeContract({
    address,
    abi: ChannelSettlementAbi as any,
    functionName: "cancelPendingCheckpoint",
    args: [marketId, sessionId],
  });
  return hash;
}
