import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Redis } from "@upstash/redis";
import type { Address } from "viem";
import {
  addressesEqual,
  normalizeEnsName,
  resolveAgentKillSwitch,
  resolveEnsAddress,
  type AgentKillSwitch,
} from "./ensService.js";
import { env } from "../utils/env.js";
import { logger } from "../utils/logger.js";

// ─── types ──────────────────────────────────────────────────────────────────

export interface AgentConfig {
  status: "active" | "suspended";
  allowedTools: string[];
  label?: string;
}

export interface Policy {
  agents: Record<string, AgentConfig>;
}

export interface ToolAccessResult {
  allowed: boolean;
  reason:
    | "policy_allowed"
    | "agent_not_in_policy"
    | "agent_suspended"
    | "tool_not_allowed"
    | "revoked_by_owner"
    | "identity_revoked"
    | "fleet_paused";
}

/**
 * Policy keys come in two forms:
 *   "myagent1.eth"    exact agent name
 *   "*.myagent1.eth"  fleet entry: matches every subname under the root
 *
 * ENSIP-15 normalization rejects "*", so wildcard keys normalize the base
 * name only and keep the "*." prefix verbatim.
 */
export function normalizePolicyKey(key: string): string {
  const k = key.trim();
  if (k.startsWith("*.")) return `*.${normalizeEnsName(k.slice(2))}`;
  return normalizeEnsName(k);
}

export interface PolicyMatch {
  /** the policy entry key that matched (may be a "*." fleet key) */
  key: string;
  config: AgentConfig;
  /** set when matched via a fleet entry: the namespace root, e.g. "myagent1.eth" */
  fleetRoot?: string;
}

function findPolicyMatch(policy: Policy, name: string): PolicyMatch | null {
  const exact = policy.agents[name];
  if (exact) return { key: name, config: exact };

  for (const [key, config] of Object.entries(policy.agents)) {
    if (!key.startsWith("*.")) continue;
    const suffix = key.slice(1); // ".myagent1.eth"
    if (name.endsWith(suffix) && name.length > suffix.length) {
      return { key, config, fleetRoot: key.slice(2) };
    }
  }
  return null;
}

// ─── storage backend ────────────────────────────────────────────────────────

const REDIS_KEY = "agent-gate:policy";

const redisUrl =
  process.env.UPSTASH_REDIS_REST_URL ??
  process.env.AGENT_KV_REST_API_URL;

const redisToken =
  process.env.UPSTASH_REDIS_REST_TOKEN ??
  process.env.AGENT_KV_REST_API_TOKEN;

const redis =
  redisUrl && redisToken
    ? new Redis({ url: redisUrl, token: redisToken })
    : null;

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLICY_PATH = resolve(__dirname, "../../config/policy.json");

// ─── in-memory cache ────────────────────────────────────────────────────────

let cached: Policy | null = null;

function readFromDisk(): Policy {
  try {
    const raw = readFileSync(POLICY_PATH, "utf-8");
    return JSON.parse(raw) as Policy;
  } catch {
    logger.warn("policy.load_failed", { path: POLICY_PATH });
    return { agents: {} };
  }
}

function writeToDiskSafe(policy: Policy): void {
  try {
    writeFileSync(POLICY_PATH, JSON.stringify(policy, null, 2) + "\n", "utf-8");
  } catch {
    // Vercel / serverless: filesystem is read-only (EROFS) — skip silently
  }
}

// ─── persistence layer ──────────────────────────────────────────────────────

async function loadPolicy(): Promise<Policy> {
  if (cached) return cached;

  // try Redis first
  if (redis) {
    try {
      const data = await redis.get<Policy>(REDIS_KEY);
      if (data && data.agents) {
        logger.info("policy.loaded_from_redis");
        cached = data;
        return cached;
      }
    } catch (err) {
      logger.warn("policy.redis_read_failed", {
        error: (err as Error).message,
      });
    }
  }

  // fallback to local file
  cached = readFromDisk();
  logger.info("policy.loaded_from_disk");

  // seed Redis if available and was empty
  if (redis) {
    try {
      await redis.set(REDIS_KEY, cached);
      logger.info("policy.seeded_redis");
    } catch {
      // non-critical
    }
  }

  return cached;
}

async function persistPolicy(policy: Policy): Promise<void> {
  cached = policy;

  if (redis) {
    try {
      await redis.set(REDIS_KEY, policy);
      logger.info("policy.saved_to_redis");
    } catch (err) {
      logger.warn("policy.redis_write_failed", {
        error: (err as Error).message,
      });
    }
  }

  // also try disk (works locally, no-op on Vercel)
  writeToDiskSafe(policy);
}

// ─── public API ─────────────────────────────────────────────────────────────

export async function getPolicy(): Promise<Policy> {
  return loadPolicy();
}

export async function savePolicy(policy: Policy): Promise<void> {
  await persistPolicy(policy);
}

export async function addOrUpdateAgent(
  ensName: string,
  config: AgentConfig,
): Promise<void> {
  const policy = await getPolicy();
  const key = normalizePolicyKey(ensName);
  policy.agents[key] = config;
  await savePolicy(policy);
}

export async function removeAgent(ensName: string): Promise<void> {
  const policy = await getPolicy();
  const key = normalizePolicyKey(ensName);
  delete policy.agents[key];
  await savePolicy(policy);
}

// ─── owner-held controls via ENS (subtractive only) ──────────────────────────
//
// The operator policy above is the only thing that GRANTS access. A fleet entry
// ("*.root.eth") grants once to a whole namespace; only the root's owner can
// create subnames under it, so self-granting stays impossible by construction.
// On top of the grant, the owner holds three subtractive controls:
//   1. liveness: the agent name must still resolve to the session address.
//      Zeroing/removing the subname's addr record fires that worker on-chain.
//   2. kill switch on the agent's own name (agentgate.revoked).
//   3. kill switch on the fleet root: pauses every worker in the namespace.

interface KillSwitchCacheEntry {
  value: AgentKillSwitch;
  expiresAt: number;
}

const killSwitchCache = new Map<string, KillSwitchCacheEntry>();

interface AddressCacheEntry {
  value: Address | null;
  expiresAt: number;
}

const addressCache = new Map<string, AddressCacheEntry>();

/** Reads agentgate.revoked with a short TTL cache. Name must not be a "*." key. */
export async function getAgentKillSwitch(ensName: string): Promise<AgentKillSwitch> {
  const key = normalizeEnsName(ensName);
  const now = Date.now();
  const hit = killSwitchCache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  const value = await resolveAgentKillSwitch(key);
  killSwitchCache.set(key, { value, expiresAt: now + env.ensRevokeTtlSec * 1000 });
  return value;
}

/**
 * Re-resolves the agent's ENS address with a short TTL cache. A clean null
 * (no addr record) is cached too: that is the on-chain "worker fired" state.
 * RPC failures propagate so the caller can fail open.
 */
async function getAgentAddressCached(name: string): Promise<Address | null> {
  const now = Date.now();
  const hit = addressCache.get(name);
  if (hit && hit.expiresAt > now) return hit.value;

  const value = await resolveEnsAddress(name);
  addressCache.set(name, { value, expiresAt: now + env.ensRevokeTtlSec * 1000 });
  return value;
}

/**
 * Drops cached on-chain reads (kill switches, address liveness) so the next
 * check re-reads from chain. Used by the dashboard "Sync from ENS" button.
 */
export function clearEnsCaches(): void {
  killSwitchCache.clear();
  addressCache.clear();
}

export async function checkToolAccess(
  ensName: string,
  toolId: string,
  sessionAddress?: Address,
): Promise<ToolAccessResult> {
  const policy = await getPolicy();
  const name = normalizeEnsName(ensName);
  const match = findPolicyMatch(policy, name);

  // ── operator policy: the grant ──────────────────────────────────────────
  if (!match) {
    return { allowed: false, reason: "agent_not_in_policy" };
  }
  if (match.config.status === "suspended") {
    return { allowed: false, reason: "agent_suspended" };
  }
  if (!match.config.allowedTools.includes(toolId)) {
    return { allowed: false, reason: "tool_not_allowed" };
  }

  // ── owner liveness: the name must still resolve to the session signer ───
  if (sessionAddress) {
    try {
      const live = await getAgentAddressCached(name);
      if (!live || !addressesEqual(live, sessionAddress)) {
        return { allowed: false, reason: "identity_revoked" };
      }
    } catch (err) {
      // RPC failure: fail open, the operator grant remains the primary gate.
      logger.warn("policy.liveness_check_failed", {
        ensName: name,
        error: (err as Error).message,
      });
    }
  }

  // ── owner kill switches: can only override to deny ──────────────────────
  const ks = await getAgentKillSwitch(name);
  if (ks.revoked) {
    return { allowed: false, reason: "revoked_by_owner" };
  }
  if (match.fleetRoot) {
    const rootKs = await getAgentKillSwitch(match.fleetRoot);
    if (rootKs.revoked) {
      return { allowed: false, reason: "fleet_paused" };
    }
  }

  return { allowed: true, reason: "policy_allowed" };
}
