import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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

// ─── path ───────────────────────────────────────────────────────────────────

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

function writeToDisk(policy: Policy): void {
  writeFileSync(POLICY_PATH, JSON.stringify(policy, null, 2) + "\n", "utf-8");
}

// ─── public API ─────────────────────────────────────────────────────────────

export function getPolicy(): Policy {
  if (!cached) cached = readFromDisk();
  return cached;
}

export function savePolicy(policy: Policy): void {
  cached = policy;
  writeToDisk(policy);
  logger.info("policy.saved");
}

export function addOrUpdateAgent(ensName: string, config: AgentConfig): void {
  const policy = getPolicy();
  const key = normalizeEnsName(ensName);
  policy.agents[key] = config;
  savePolicy(policy);
}

export function removeAgent(ensName: string): void {
  const policy = getPolicy();
  const key = normalizeEnsName(ensName);
  delete policy.agents[key];
  savePolicy(policy);
}

export function checkToolAccess(
  ensName: string,
  toolId: string,
): ToolAccessResult {
  const policy = getPolicy();
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
