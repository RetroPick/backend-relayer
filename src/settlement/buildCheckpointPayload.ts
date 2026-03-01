/**
 * Build ChannelSettlement checkpoint payload for CRE workflow.
 * Matches abi.decode(payload, (Checkpoint, Delta[], bytes operatorSig, address[] users, bytes[] userSigs)).
 * Payload is prefixed with 0x03 for CREReceiver routing.
 */
import {
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  toHex,
  concat,
  type Address,
  type Hex,
} from "viem";
import { hashSessionState } from "../state/sessionStore.js";
import type { SessionState } from "../state/sessionStore.js";

/** keccak256("Delta(address user,uint32 outcomeIndex,int128 sharesDelta,int128 cashDelta)") */
const DELTA_TYPEHASH = keccak256(
  toHex(new TextEncoder().encode("Delta(address user,uint32 outcomeIndex,int128 sharesDelta,int128 cashDelta)"))
);
/** keccak256("Checkpoint(uint256 marketId,bytes32 sessionId,uint64 nonce,...)") */
const CHECKPOINT_TYPEHASH = keccak256(
  toHex(
    new TextEncoder().encode(
      "Checkpoint(uint256 marketId,bytes32 sessionId,uint64 nonce,uint64 validAfter,uint64 validBefore,uint48 lastTradeAt,bytes32 stateHash,bytes32 deltasHash,bytes32 riskHash)"
    )
  )
);
const EIP712_DOMAIN_TYPEHASH = keccak256(
  toHex(
    new TextEncoder().encode(
      "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    )
  )
);

export interface DeltaInput {
  user: Address;
  outcomeIndex: number;
  sharesDelta: bigint; // int128
  cashDelta: bigint; // int128
}

export interface CheckpointInput {
  marketId: bigint;
  sessionId: Hex;
  nonce: bigint;
  validAfter?: bigint;
  validBefore?: bigint;
  lastTradeAt?: number;
  stateHash: Hex;
  deltasHash: Hex;
  riskHash?: Hex;
}

function hashDelta(d: DeltaInput): Hex {
  const encoded = encodeAbiParameters(
    parseAbiParameters("bytes32, address, uint32, int128, int128"),
    [DELTA_TYPEHASH, d.user, d.outcomeIndex, d.sharesDelta, d.cashDelta]
  );
  return keccak256(encoded as Hex);
}

/** Match Solidity: keccak256(concat of 32-byte hashes, no length prefix) */
export function hashDeltas(deltas: DeltaInput[]): Hex {
  if (deltas.length === 0) return keccak256("0x" as Hex);
  const hashes = deltas.map(hashDelta);
  return keccak256(concat(hashes) as Hex);
}

function hashCheckpointStruct(cp: CheckpointInput): Hex {
  const encoded = encodeAbiParameters(
    parseAbiParameters(
      "bytes32, uint256, bytes32, uint64, uint64, uint64, uint48, bytes32, bytes32, bytes32"
    ),
    [
      CHECKPOINT_TYPEHASH,
      cp.marketId,
      cp.sessionId as `0x${string}`,
      cp.nonce,
      cp.validAfter ?? 0n,
      cp.validBefore ?? 0n,
      BigInt(cp.lastTradeAt ?? 0),
      cp.stateHash as `0x${string}`,
      cp.deltasHash as `0x${string}`,
      (cp.riskHash ?? "0x0000000000000000000000000000000000000000000000000000000000000000") as Hex,
    ]
  );
  return keccak256(encoded as Hex);
}

/** EIP-712 digest for checkpoint signing (matches ShadowEIP712._hashTypedDataV4). */
export function getCheckpointDigest(
  cp: CheckpointInput,
  chainId: number,
  verifyingContract: Address
): Hex {
  const structHash = hashCheckpointStruct(cp);
  const nameHash = keccak256(toHex(new TextEncoder().encode("ShadowPool")));
  const versionHash = keccak256(toHex(new TextEncoder().encode("1")));
  const domainEncoded = encodeAbiParameters(
    parseAbiParameters("bytes32, bytes32, bytes32, uint256, address"),
    [EIP712_DOMAIN_TYPEHASH, nameHash, versionHash, BigInt(chainId), verifyingContract]
  );
  const domainSeparator = keccak256(domainEncoded as Hex);
  return keccak256(concat(["0x1901" as Hex, domainSeparator, structHash]) as Hex);
}

/**
 * Convert SessionState to Delta[] for checkpoint.
 * cashDelta = initialBalance - balance (net spend). One Delta per (user, outcome) with non-zero shares;
 * cash-only users get one Delta with outcomeIndex 0, sharesDelta 0.
 */
export function sessionStateToDeltas(state: SessionState): DeltaInput[] {
  const deltas: DeltaInput[] = [];
  for (const [addr, acc] of state.accounts) {
    const initial = acc.initialBalance ?? 0n;
    const cashDelta = initial - acc.balance;
    const positions = acc.positions ?? [];

    const hasPosition = positions.some((p) => p !== 0n);
    if (!hasPosition && cashDelta === 0n) continue;

    if (hasPosition) {
      let first = true;
      for (let i = 0; i < positions.length; i++) {
        const shares = positions[i] ?? 0n;
        if (shares === 0n) continue;
        deltas.push({
          user: addr as Address,
          outcomeIndex: i,
          sharesDelta: shares,
          cashDelta: first ? cashDelta : 0n,
        });
        first = false;
      }
    } else {
      deltas.push({
        user: addr as Address,
        outcomeIndex: 0,
        sharesDelta: 0n,
        cashDelta,
      });
    }
  }
  return deltas;
}

/**
 * Build checkpoint payload for ChannelSettlement.
 * @param state - Session state
 * @param userSigs - Map of user address -> EIP-712 signature on checkpoint digest
 * @param operatorSign - Function to sign checkpoint (EIP-712 digest); use signTypedData or sign hash directly
 * @param chainId - Chain ID for EIP-712
 * @param channelSettlementAddress - ChannelSettlement contract address
 */
export interface BuildCheckpointPayloadOpts {
  state: SessionState;
  userSigs: Map<string, Hex>;
  operatorSign: (digest: Hex, cp: CheckpointInput) => Promise<Hex>;
  chainId: number;
  channelSettlementAddress: Address;
  lastTradeAt?: number;
}

export async function buildCheckpointPayload(opts: BuildCheckpointPayloadOpts): Promise<Hex> {
  const {
    state,
    userSigs,
    operatorSign,
    chainId,
    channelSettlementAddress,
    lastTradeAt = 0,
  } = opts;

  const deltas = sessionStateToDeltas(state);
  const deltasHash = hashDeltas(deltas);
  const stateHash = hashSessionState(state);

  const cp: CheckpointInput = {
    marketId: state.marketId,
    sessionId: state.sessionId as Hex,
    nonce: state.nonce,
    validAfter: 0n,
    validBefore: 0n,
    lastTradeAt,
    stateHash,
    deltasHash,
    riskHash: "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
  };

  const digest = getCheckpointDigest(cp, chainId, channelSettlementAddress);

  const users = Array.from(new Set(deltas.map((d) => d.user)));
  const userSigsArr: Hex[] = [];
  for (const u of users) {
    const sig = userSigs.get(u.toLowerCase()) ?? userSigs.get(u);
    if (!sig) throw new Error(`Missing signature for user ${u}`);
    userSigsArr.push(sig);
  }

  const operatorSig = await operatorSign(digest, cp);

  const CHECKPOINT_ABI =
    "(uint256 marketId, bytes32 sessionId, uint64 nonce, uint64 validAfter, uint64 validBefore, uint48 lastTradeAt, bytes32 stateHash, bytes32 deltasHash, bytes32 riskHash)";
  const DELTA_ABI = "(address user, uint32 outcomeIndex, int128 sharesDelta, int128 cashDelta)";

  const checkpointTuple = {
    marketId: cp.marketId,
    sessionId: cp.sessionId,
    nonce: cp.nonce,
    validAfter: cp.validAfter ?? 0n,
    validBefore: cp.validBefore ?? 0n,
    lastTradeAt: BigInt(cp.lastTradeAt ?? 0),
    stateHash: cp.stateHash,
    deltasHash: cp.deltasHash,
    riskHash: cp.riskHash ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
  };
  const deltasFormatted = deltas.map((d) => ({
    user: d.user,
    outcomeIndex: d.outcomeIndex,
    sharesDelta: d.sharesDelta,
    cashDelta: d.cashDelta,
  }));
  const payload = encodeAbiParameters(
    parseAbiParameters(
      `(${CHECKPOINT_ABI}), (${DELTA_ABI})[], bytes, address[], bytes[]`
    ),
    [
      checkpointTuple,
      deltasFormatted,
      operatorSig,
      users,
      userSigsArr,
    ]
  );

  return ("0x03" + payload.slice(2)) as Hex;
}
