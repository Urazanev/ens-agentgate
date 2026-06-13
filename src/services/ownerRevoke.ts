import {
  createPublicClient,
  createWalletClient,
  http,
  zeroAddress,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { namehash } from "viem/ens";
import { mainnet, sepolia, holesky } from "viem/chains";
import { env } from "../utils/env.js";
import { normalizeEnsName } from "./ensService.js";
import { logger } from "../utils/logger.js";

/**
 * Demo-only helper: lets the dashboard trigger the OWNER's on-chain kill switch
 * (the agentgate.revoked text record) by signing with DEMO_PRIVATE_KEY. This is
 * exactly what `npm run killswitch` does, surfaced as a button. The gate itself
 * never signs and never imports this; it only READS agentgate.revoked.
 */

const REVOKED_KEY = "agentgate.revoked";
const REGISTRY = (process.env.ENS_REGISTRY_ADDRESS ??
  "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e") as Address;

const REGISTRY_RESOLVER_ABI = [
  {
    type: "function",
    name: "resolver",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
] as const;

const SET_TEXT_ABI = [
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
] as const;

function pickChain(chainId: number): Chain {
  if (chainId === mainnet.id) return mainnet;
  if (chainId === holesky.id) return holesky;
  return sepolia;
}

function ownerKey(): Hex | undefined {
  const k = process.env.DEMO_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
  return k ? (k as Hex) : undefined;
}

/** True when DEMO_PRIVATE_KEY is configured, so the dashboard can show the button. */
export function ownerRevokeAvailable(): boolean {
  return Boolean(ownerKey());
}

/** Signs agentgate.revoked = true/"" on the agent's ENS name and waits for the receipt. */
export async function setAgentRevoked(ensName: string, revoked: boolean): Promise<Hex> {
  const key = ownerKey();
  if (!key) throw new Error("owner key not configured (set DEMO_PRIVATE_KEY)");

  const name = normalizeEnsName(ensName);
  const node = namehash(name);
  const account = privateKeyToAccount(key);
  const chain = pickChain(env.ensChainId);
  const publicClient = createPublicClient({ chain, transport: http(env.ensRpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(env.ensRpcUrl) });

  // Write to the resolver the registry assigns to this exact node (viem's
  // getEnsResolver can return a parent wildcard resolver that rejects writes).
  const resolver = (await publicClient.readContract({
    address: REGISTRY,
    abi: REGISTRY_RESOLVER_ABI,
    functionName: "resolver",
    args: [node],
  })) as Address;
  if (resolver === zeroAddress) throw new Error(`no resolver set for ${name}`);

  const hash = await walletClient.writeContract({
    address: resolver,
    abi: SET_TEXT_ABI,
    functionName: "setText",
    args: [node, REVOKED_KEY, revoked ? "true" : ""],
  });
  logger.info("owner.revoke.tx", { ensName: name, revoked, hash });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
