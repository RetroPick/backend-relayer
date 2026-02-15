/**
 * NitroliteClient setup for Yellow Network state channels.
 * Manages custody, adjudicator, and channel lifecycle per whitepaper Section 3.2.4.
 * Configurable via env: CUSTODY_ADDRESS, ADJUDICATOR_ADDRESS, CHAIN_ID, RPC_URL, OPERATOR_PRIVATE_KEY
 */
import {
  NitroliteClient,
  WalletStateSigner,
  type NitroliteClientConfig,
  type ContractAddresses,
} from "@erc7824/nitrolite";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import type { Address } from "viem";

const SEPOLIA_CHAIN_ID = 11155111;

export function getChain(): typeof sepolia {
  const chainId = Number(process.env.CHAIN_ID ?? SEPOLIA_CHAIN_ID);
  if (chainId === SEPOLIA_CHAIN_ID) return sepolia;
  return sepolia;
}

export function getContractAddresses(): ContractAddresses {
  const custody = (process.env.CUSTODY_ADDRESS ??
    "0x0000000000000000000000000000000000000001") as Address;
  const adjudicator = (process.env.ADJUDICATOR_ADDRESS ??
    "0x0000000000000000000000000000000000000002") as Address;
  return { custody, adjudicator };
}

export function createNitroliteClient(): NitroliteClient | null {
  const privateKey = process.env.OPERATOR_PRIVATE_KEY as `0x${string}` | undefined;
  if (!privateKey) {
    console.warn("[Nitrolite] OPERATOR_PRIVATE_KEY not set; NitroliteClient disabled");
    return null;
  }

  const chain = getChain();
  const rpcUrl = process.env.RPC_URL ?? process.env.ALCHEMY_RPC_URL ?? "";
  const transport = rpcUrl ? http(rpcUrl) : http();

  const publicClient = createPublicClient({ chain, transport });
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    chain,
    transport,
    account,
  });

  if (!walletClient) return null;

  const stateSigner = new WalletStateSigner(walletClient);
  const addresses = getContractAddresses();
  const challengeDuration = BigInt(process.env.CHALLENGE_DURATION ?? "3600");

  const config: NitroliteClientConfig = {
    publicClient,
    walletClient,
    stateSigner,
    addresses,
    chainId: chain.id,
    challengeDuration,
  };

  return new NitroliteClient(config);
}

let nitroliteClientInstance: NitroliteClient | null | undefined = undefined;

export async function getNitroliteClient(): Promise<NitroliteClient | null> {
  if (nitroliteClientInstance !== undefined) return nitroliteClientInstance;
  nitroliteClientInstance = createNitroliteClient();
  return nitroliteClientInstance;
}
