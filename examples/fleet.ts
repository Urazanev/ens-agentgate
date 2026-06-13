import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  zeroAddress,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { labelhash, namehash, normalize } from "viem/ens";
import { mainnet, sepolia, holesky } from "viem/chains";

/**
 * Fleet Passports: hire and fire worker agents as ENS subnames.
 *
 *   npm run fleet -- spawn <label>    create <label>.<root> with a fresh worker key
 *   npm run fleet -- revoke <label>   fire the worker: zero its addr record on-chain
 *   npm run fleet -- restore <label>  re-point the subname at the saved worker key
 *   npm run fleet -- list             show every local worker and its on-chain state
 *
 * The fleet root is DEMO_ENS_NAME (override with --root name.eth). The signer is
 * DEMO_PRIVATE_KEY and must own the root (wrapped via NameWrapper or unwrapped).
 * Worker keys are generated locally and saved to .fleet/<label>.json (gitignored);
 * workers never need gas, only the root owner pays for spawn/revoke transactions.
 *
 * Security model: the operator's AgentGate policy grants access to "*.<root>".
 * Only the root owner can create subnames under the root, so nobody can join the
 * fleet by themselves. Revoking a subname's address kills that worker's access
 * at every service that resolves ENS, mid-session, without touching any policy.
 */

const RPC = process.env.ENS_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const CHAIN_ID = Number.parseInt(process.env.ENS_CHAIN_ID ?? "11155111", 10);
const PRIVATE_KEY = (process.env.DEMO_PRIVATE_KEY ?? process.env.PRIVATE_KEY) as Hex | undefined;
const REGISTRY = (process.env.ENS_REGISTRY_ADDRESS ??
  "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e") as Address;
// Sepolia PublicResolver (supports text + addr). New workers are pinned here so
// ENSIP-26 records (agent-context, agent-endpoint) can be written to them.
const PUBLIC_RESOLVER = (process.env.ENS_PUBLIC_RESOLVER_ADDRESS ??
  "0x8FADE66B79cC9f707aB26799354482EB93a5B7dD") as Address;
const FLEET_DIR = resolve(process.cwd(), ".fleet");

function pickChain(chainId: number): Chain {
  if (chainId === mainnet.id) return mainnet;
  if (chainId === holesky.id) return holesky;
  return sepolia;
}

const REGISTRY_ABI = [
  {
    type: "function", name: "owner", stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function", name: "resolver", stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function", name: "setSubnodeRecord", stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "label", type: "bytes32" },
      { name: "owner", type: "address" },
      { name: "resolver", type: "address" },
      { name: "ttl", type: "uint64" },
    ],
    outputs: [],
  },
] as const;

const WRAPPER_ABI = [
  {
    type: "function", name: "ownerOf", stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function", name: "getData", stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "owner", type: "address" },
      { name: "fuses", type: "uint32" },
      { name: "expiry", type: "uint64" },
    ],
  },
  {
    type: "function", name: "setSubnodeRecord", stateMutability: "nonpayable",
    inputs: [
      { name: "parentNode", type: "bytes32" },
      { name: "label", type: "string" },
      { name: "owner", type: "address" },
      { name: "resolver", type: "address" },
      { name: "ttl", type: "uint64" },
      { name: "fuses", type: "uint32" },
      { name: "expiry", type: "uint64" },
    ],
    outputs: [{ type: "bytes32" }],
  },
] as const;

const RESOLVER_ABI = [
  {
    type: "function", name: "setAddr", stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "a", type: "address" },
    ],
    outputs: [],
  },
] as const;

interface WorkerFile {
  label: string;
  name: string;
  address: Address;
  privateKey: Hex;
  createdAt: string;
}

function die(msg: string): never {
  console.error(`[fleet] ${msg}`);
  process.exit(1);
}

function workerPath(label: string): string {
  return resolve(FLEET_DIR, `${label}.json`);
}

function loadWorker(label: string): WorkerFile | null {
  const p = workerPath(label);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8")) as WorkerFile;
}

function saveWorker(w: WorkerFile): void {
  mkdirSync(FLEET_DIR, { recursive: true });
  writeFileSync(workerPath(w.label), JSON.stringify(w, null, 2) + "\n", {
    mode: 0o600,
  });
}

function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const [cmd, label] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!cmd || !["spawn", "revoke", "restore", "list"].includes(cmd)) {
    die("usage: npm run fleet -- spawn|revoke|restore <label> | list [--root name.eth]");
  }
  if (!PRIVATE_KEY) die("DEMO_PRIVATE_KEY (or PRIVATE_KEY) is required in env.");

  const rootRaw = getArg("--root") ?? process.env.DEMO_ENS_NAME;
  if (!rootRaw) die("fleet root is required: set DEMO_ENS_NAME or pass --root name.eth");
  const root = normalize(rootRaw);

  const owner = privateKeyToAccount(PRIVATE_KEY);
  const chain = pickChain(CHAIN_ID);
  const publicClient = createPublicClient({ chain, transport: http(RPC) });
  const walletClient = createWalletClient({ account: owner, chain, transport: http(RPC) });

  const parentNode = namehash(root);
  const registryOwner = await publicClient.readContract({
    address: REGISTRY, abi: REGISTRY_ABI, functionName: "owner", args: [parentNode],
  });
  const resolverAddr = await publicClient.readContract({
    address: REGISTRY, abi: REGISTRY_ABI, functionName: "resolver", args: [parentNode],
  });
  if (resolverAddr === zeroAddress) die(`${root} has no resolver set; set one in the ENS app first.`);

  // Wrapped roots are owned by the NameWrapper in the registry; the wrapper
  // address is therefore simply the registry owner. Unwrapped roots are owned
  // by the signer directly.
  const wrapped = registryOwner.toLowerCase() !== owner.address.toLowerCase();
  if (wrapped) {
    const wrappedOwner = await publicClient.readContract({
      address: registryOwner, abi: WRAPPER_ABI, functionName: "ownerOf",
      args: [BigInt(parentNode)],
    }).catch(() => zeroAddress);
    if (wrappedOwner.toLowerCase() !== owner.address.toLowerCase()) {
      die(`signer ${owner.address} does not own ${root} (registry owner: ${registryOwner}).`);
    }
  }

  console.log("[fleet] root:    ", root, wrapped ? "(wrapped)" : "(unwrapped)");
  console.log("[fleet] chainId: ", CHAIN_ID);
  console.log("[fleet] owner:   ", owner.address);

  // ── list ─────────────────────────────────────────────────────────────────
  if (cmd === "list") {
    if (!existsSync(FLEET_DIR)) {
      console.log("[fleet] no workers yet. Spawn one: npm run fleet -- spawn worker1");
      return;
    }
    for (const f of readdirSync(FLEET_DIR).filter((f) => f.endsWith(".json"))) {
      const w = JSON.parse(readFileSync(resolve(FLEET_DIR, f), "utf-8")) as WorkerFile;
      const live = await publicClient.getEnsAddress({ name: w.name }).catch(() => null);
      const state = !live
        ? "REVOKED (no addr on-chain)"
        : live.toLowerCase() === w.address.toLowerCase()
          ? "live"
          : `MISMATCH (on-chain ${live})`;
      console.log(`[fleet]   ${w.name} -> ${w.address} [${state}]`);
    }
    return;
  }

  if (!label) die(`usage: npm run fleet -- ${cmd} <label>`);
  const name = normalize(`${label}.${root}`);
  const node = namehash(name);

  // New workers go on the text-capable PublicResolver so ENSIP-26 records can be
  // written to them. revoke/restore use whatever resolver the subname already has.
  let subnameResolver: Address = PUBLIC_RESOLVER;
  if (cmd === "revoke" || cmd === "restore") {
    const existing = (await publicClient.readContract({
      address: REGISTRY, abi: REGISTRY_ABI, functionName: "resolver", args: [node],
    })) as Address;
    subnameResolver = existing !== zeroAddress ? existing : resolverAddr;
  }

  async function setAddr(target: Address): Promise<void> {
    const hash = await walletClient.writeContract({
      address: subnameResolver, abi: RESOLVER_ABI, functionName: "setAddr",
      args: [node, target],
    });
    console.log(`[fleet] setAddr(${name}, ${target}) tx: ${hash}`);
    await publicClient.waitForTransactionReceipt({ hash });
  }

  // ── revoke ───────────────────────────────────────────────────────────────
  if (cmd === "revoke") {
    await setAddr(zeroAddress);
    const after = await publicClient.getEnsAddress({ name }).catch(() => null);
    console.log(`[fleet] ${name} now resolves to:`, after ?? "null (worker fired)");
    console.log("[fleet] done. The gate denies this worker on its next check (identity_revoked).");
    return;
  }

  // ── spawn / restore ──────────────────────────────────────────────────────
  let worker = loadWorker(label);
  if (cmd === "restore" && !worker) die(`no saved key for "${label}" in .fleet/`);
  if (!worker) {
    const pk = generatePrivateKey();
    const acct = privateKeyToAccount(pk);
    worker = {
      label,
      name,
      address: acct.address,
      privateKey: pk,
      createdAt: new Date().toISOString(),
    };
    saveWorker(worker);
    console.log(`[fleet] generated fresh worker key -> ${worker.address} (saved to .fleet/${label}.json)`);
  } else {
    console.log(`[fleet] reusing saved worker key -> ${worker.address}`);
  }

  if (cmd === "spawn") {
    console.log("[fleet] subname resolver:", subnameResolver, "(PublicResolver, text-capable)");
    if (wrapped) {
      const [, , expiry] = await publicClient.readContract({
        address: registryOwner, abi: WRAPPER_ABI, functionName: "getData",
        args: [BigInt(parentNode)],
      });
      const hash = await walletClient.writeContract({
        address: registryOwner, abi: WRAPPER_ABI, functionName: "setSubnodeRecord",
        args: [parentNode, label, owner.address, subnameResolver, 0n, 0, expiry],
      });
      console.log(`[fleet] create subname ${name} tx: ${hash}`);
      await publicClient.waitForTransactionReceipt({ hash });
    } else {
      const hash = await walletClient.writeContract({
        address: REGISTRY, abi: REGISTRY_ABI, functionName: "setSubnodeRecord",
        args: [parentNode, labelhash(label), owner.address, subnameResolver, 0n],
      });
      console.log(`[fleet] create subname ${name} tx: ${hash}`);
      await publicClient.waitForTransactionReceipt({ hash });
    }
  }

  await setAddr(worker.address);
  const resolved = await publicClient.getEnsAddress({ name }).catch(() => null);
  if (!resolved || resolved.toLowerCase() !== worker.address.toLowerCase()) {
    die(`verification failed: ${name} resolves to ${resolved ?? "null"}, expected ${worker.address}`);
  }
  console.log(`[fleet] verified: ${name} -> ${resolved}`);
  console.log(`[fleet] worker ready. Try it: npm run demo -- --worker ${label}`);
}

main().catch((err) => {
  console.error("[fleet] fatal:", err);
  process.exit(1);
});
