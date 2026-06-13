import {
  createPublicClient,
  http,
  type Address,
  type Chain,
  type PublicClient,
} from "viem";
import { namehash, normalize } from "viem/ens";
import { mainnet, sepolia, holesky } from "viem/chains";
import { env } from "../utils/env.js";
import { logger } from "../utils/logger.js";

/**
 * ENS resolution client, intentionally independent from any agent execution chain.
 *
 * For the MVP we use standard ENS resolution through viem:
 * - normalize ENS names with `viem/ens`
 * - resolve names with `getEnsAddress`
 * - optionally resolve reverse names with `getEnsName`
 *
 * The ENS RPC / chain is configured separately from the agent chain so the
 * service can verify ENS identity without assuming where the agent executes.
 */

function pickChain(chainId: number): Chain {
  switch (chainId) {
    case mainnet.id:
      return mainnet;
    case sepolia.id:
      return sepolia;
    case holesky.id:
      return holesky;
    default:
      return { ...mainnet, id: chainId, name: `custom-${chainId}` } as Chain;
  }
}

let cached: PublicClient | undefined;

export function getEnsClient(): PublicClient {
  if (cached) return cached;
  const chain = pickChain(env.ensChainId);
  cached = createPublicClient({
    chain,
    transport: http(env.ensRpcUrl),
  });
  logger.info("ens.client.init", {
    ensChainId: env.ensChainId,
    ensRpcUrl: env.ensRpcUrl,
    universalResolverOverride: env.ensUniversalResolverAddress ?? null,
  });
  return cached;
}

export function normalizeEnsName(name: string): string {
  return normalize(name.trim());
}

export class EnsResolutionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "EnsResolutionError";
  }
}

export async function resolveEnsAddress(name: string): Promise<Address | null> {
  const client = getEnsClient();
  const normalized = normalizeEnsName(name);
  try {
    const addr = await client.getEnsAddress({
      name: normalized,
      ...(env.ensUniversalResolverAddress
        ? { universalResolverAddress: env.ensUniversalResolverAddress as Address }
        : {}),
    });
    return addr;
  } catch (err) {
    throw new EnsResolutionError(
      `ENS resolution failed for ${normalized}: ${(err as Error).message}`,
      err,
    );
  }
}

export function addressesEqual(a: Address, b: Address): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

// The ENS registry is deployed at the same address on mainnet, Sepolia, Holesky.
const ENS_REGISTRY_ADDRESS = (process.env.ENS_REGISTRY_ADDRESS ??
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

const REVERSE_NAME_ABI = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ type: "string" }],
  },
] as const;

/**
 * Direct reverse lookup: read the `name` record of <address>.addr.reverse from
 * the resolver the registry assigns to that node. This is a fallback for setups
 * where viem's UniversalResolver path (getEnsName) returns null even though a
 * primary name IS set, which happens with custom/wildcard forward resolvers on
 * testnets. The caller still forward-verifies the returned name before trusting.
 */
async function reverseLookupViaRegistry(
  client: PublicClient,
  address: Address,
): Promise<string | null> {
  const reverseNode = namehash(`${address.slice(2).toLowerCase()}.addr.reverse`);
  const resolver = (await client.readContract({
    address: ENS_REGISTRY_ADDRESS,
    abi: REGISTRY_RESOLVER_ABI,
    functionName: "resolver",
    args: [reverseNode],
  })) as Address;
  if (!resolver || resolver === "0x0000000000000000000000000000000000000000") {
    return null;
  }
  const name = (await client.readContract({
    address: resolver,
    abi: REVERSE_NAME_ABI,
    functionName: "name",
    args: [reverseNode],
  })) as string;
  return name && name.length > 0 ? name : null;
}

export async function resolveEnsName(address: Address): Promise<string | null> {
  const client = getEnsClient();

  // 1. Standard UniversalResolver path (handles offchain/CCIP names too).
  try {
    const viaUniversal = await client.getEnsName({
      address,
      ...(env.ensUniversalResolverAddress
        ? { universalResolverAddress: env.ensUniversalResolverAddress as Address }
        : {}),
    });
    if (viaUniversal) return viaUniversal;
  } catch (err) {
    logger.warn("ens.reverse.universal_failed", {
      address,
      error: (err as Error).message,
    });
  }

  // 2. Fallback: read the reverse record directly from the registry.
  try {
    return await reverseLookupViaRegistry(client, address);
  } catch (err) {
    throw new EnsResolutionError(
      `Reverse ENS resolution failed for ${address}: ${(err as Error).message}`,
      err,
    );
  }
}

// ─── owner-held kill switch (ENSIP-5 text record) ────────────────────────────

/**
 * The single text-record key the agent's owner uses to revoke the agent.
 *
 * This is the ONLY authorization signal AgentGate reads from ENS, and it is
 * strictly subtractive: it can revoke access, never grant it. There is no
 * "active" value that would hand out privileges. An attacker setting records on
 * their own name gains nothing; an owner can only switch their own agent OFF.
 */
export const AGENT_REVOKED_KEY = "agentgate.revoked";

export interface AgentKillSwitch {
  /** true if the owner has revoked the agent on its ENS name */
  revoked: boolean;
  /** raw text-record value (null = not set / unreadable) */
  raw: string | null;
}

function parseRevoked(v: string | null | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "revoked";
}

/**
 * Reads the agentgate.revoked text record for an ENS name.
 *
 * Fail-open by design: a read failure (e.g. RPC down, no resolver) resolves to
 * `revoked: false` rather than throwing, so an outage cannot lock out every
 * agent. The operator policy remains the primary gate; this only adds an
 * owner-controlled OFF switch on top.
 */
export async function resolveAgentKillSwitch(name: string): Promise<AgentKillSwitch> {
  const client = getEnsClient();
  const normalized = normalizeEnsName(name);
  try {
    const raw = await client.getEnsText({
      name: normalized,
      key: AGENT_REVOKED_KEY,
      ...(env.ensUniversalResolverAddress
        ? { universalResolverAddress: env.ensUniversalResolverAddress as Address }
        : {}),
    });
    const revoked = parseRevoked(raw);
    if (revoked) logger.info("ens.killswitch.revoked", { name: normalized, raw });
    return { revoked, raw: raw ?? null };
  } catch (err) {
    logger.warn("ens.killswitch.read_failed", {
      name: normalized,
      error: (err as Error).message,
    });
    return { revoked: false, raw: null };
  }
}
