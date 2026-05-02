import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Redis } from "@upstash/redis";
import { normalizeEnsName } from "./ensService.js";
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
    | "tool_not_allowed";
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
  const key = normalizeEnsName(ensName);
  policy.agents[key] = config;
  await savePolicy(policy);
}

export async function removeAgent(ensName: string): Promise<void> {
  const policy = await getPolicy();
  const key = normalizeEnsName(ensName);
  delete policy.agents[key];
  await savePolicy(policy);
}

export async function checkToolAccess(
  ensName: string,
  toolId: string,
): Promise<ToolAccessResult> {
  const policy = await getPolicy();
  const key = normalizeEnsName(ensName);
  const agent = policy.agents[key];

  if (!agent) {
    return { allowed: false, reason: "agent_not_in_policy" };
  }
  if (agent.status === "suspended") {
    return { allowed: false, reason: "agent_suspended" };
  }
  if (!agent.allowedTools.includes(toolId)) {
    return { allowed: false, reason: "tool_not_allowed" };
  }
  return { allowed: true, reason: "policy_allowed" };
}
