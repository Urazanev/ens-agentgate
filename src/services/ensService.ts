import {
  createPublicClient,
  http,
  type Address,
  type Chain,
  type PublicClient,
} from "viem";
import { normalize } from "viem/ens";
import { mainnet, sepolia, holesky } from "viem/chains";
import { env } from "../utils/env.js";
import { logger } from "../utils/logger.js";

/**
 * ENS resolution client, intentionally independent from any agent execution chain.
 *
 * ENSv2-ready: resolution goes through viem's `getEnsAddress`, which calls the
 * on-chain Universal Resolver (ENSIP-10) and supports wildcard / CCIP-Read /
 * offchain resolvers. Names are normalized via `viem/ens` `normalize`
 * (UTS-46 / @adraffy/ens-normalize). The Universal Resolver address can be
 * overridden per deployment.
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

export async function resolveEnsName(address: Address): Promise<string | null> {
  const client = getEnsClient();
  try {
    return await client.getEnsName({
      address,
      ...(env.ensUniversalResolverAddress
        ? { universalResolverAddress: env.ensUniversalResolverAddress as Address }
        : {}),
    });
  } catch (err) {
    throw new EnsResolutionError(
      `Reverse ENS resolution failed for ${address}: ${(err as Error).message}`,
      err,
    );
  }
}
