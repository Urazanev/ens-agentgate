import "dotenv/config";
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
import { namehash, normalize } from "viem/ens";
import { mainnet, sepolia, holesky } from "viem/chains";

/**
 * Toggles the owner-held kill switch (agentgate.revoked text record) on a name
 * you control. Signs with DEMO_PRIVATE_KEY.
 *
 * Usage:
 *   npm run killswitch -- <ens-name> on     # revoke the agent
 *   npm run killswitch -- <ens-name> off    # clear the revoke
 *
 * The record can only revoke, never grant. Reading is free; writing costs gas.
 * The signer must own or manage the name on ENS_CHAIN_ID (default Sepolia).
 */

const RPC = process.env.ENS_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const CHAIN_ID = Number.parseInt(process.env.ENS_CHAIN_ID ?? "11155111", 10);
const PRIVATE_KEY = (process.env.DEMO_PRIVATE_KEY ?? process.env.PRIVATE_KEY) as Hex | undefined;

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

function pickChain(chainId: number): Chain {
  if (chainId === mainnet.id) return mainnet;
  if (chainId === holesky.id) return holesky;
  return sepolia;
}

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

function die(msg: string): never {
  console.error(`[killswitch] ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const [rawName, mode] = process.argv.slice(2);
  if (!rawName || (mode !== "on" && mode !== "off")) {
    die("usage: npm run killswitch -- <ens-name> on|off");
  }
  if (!PRIVATE_KEY) die("DEMO_PRIVATE_KEY (or PRIVATE_KEY) is required in env.");

  const name = normalize(rawName);
  const node = namehash(name);
  const value = mode === "on" ? "true" : "";
  const account = privateKeyToAccount(PRIVATE_KEY);
  const chain = pickChain(CHAIN_ID);

  const publicClient = createPublicClient({ chain, transport: http(RPC) });
  const walletClient = createWalletClient({ account, chain, transport: http(RPC) });

  // Read the resolver set on this exact node from the registry. viem's
  // getEnsResolver can return a parent wildcard resolver that rejects writes.
  let resolver = (await publicClient.readContract({
    address: REGISTRY,
    abi: REGISTRY_RESOLVER_ABI,
    functionName: "resolver",
    args: [node],
  })) as Address;
  if (resolver === zeroAddress) resolver = await publicClient.getEnsResolver({ name });

  console.log("[killswitch] name:    ", name);
  console.log("[killswitch] chainId: ", CHAIN_ID);
  console.log("[killswitch] resolver:", resolver);
  console.log("[killswitch] signer:  ", account.address);
  console.log(`[killswitch] ${mode === "on" ? "REVOKING" : "clearing revoke on"} ${name} (${REVOKED_KEY} = "${value}")`);

  const hash = await walletClient.writeContract({
    address: resolver as Address,
    abi: SET_TEXT_ABI,
    functionName: "setText",
    args: [node, REVOKED_KEY, value],
  });
  console.log("[killswitch] tx:", hash);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log("[killswitch] confirmed. Click 'Sync from ENS' in the dashboard to apply immediately.");
}

main().catch((err) => {
  console.error("[killswitch] fatal:", err);
  process.exit(1);
});
