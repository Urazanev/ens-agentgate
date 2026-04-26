import "dotenv/config";

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optional(value: string | undefined, fallback: string): string {
  return value && value.trim() !== "" ? value : fallback;
}

function int(value: string, name: string): number {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) throw new Error(`Env ${name} must be an integer, got: ${value}`);
  return n;
}

export const env = {
  port: int(optional(process.env.PORT, "3001"), "PORT"),
  appDomain: optional(process.env.APP_DOMAIN, "localhost:3001"),
  appUri: optional(process.env.APP_URI, "http://localhost:3001"),

  // Agent execution chain. Used only as the SIWE Chain ID; tool-gate sends no transactions.
  agentChainId: int(optional(process.env.AGENT_CHAIN_ID, "11155111"), "AGENT_CHAIN_ID"),
  agentRpcUrl: optional(
    process.env.AGENT_RPC_URL,
    "https://ethereum-sepolia-rpc.publicnode.com",
  ),

  // ENS resolution. Independent client, configurable per deployment.
  ensChainId: int(optional(process.env.ENS_CHAIN_ID, "11155111"), "ENS_CHAIN_ID"),
  ensRpcUrl: required(
    "ENS_RPC_URL",
    optional(process.env.ENS_RPC_URL, "https://ethereum-sepolia-rpc.publicnode.com"),
  ),
  ensUniversalResolverAddress: process.env.ENS_UNIVERSAL_RESOLVER_ADDRESS?.trim() || undefined,

  challengeTtlSec: int(optional(process.env.CHALLENGE_TTL_SECONDS, "300"), "CHALLENGE_TTL_SECONDS"),
  sessionTtlSec: int(optional(process.env.SESSION_TTL_SECONDS, "1800"), "SESSION_TTL_SECONDS"),

  logLevel: optional(process.env.LOG_LEVEL, "info"),
} as const;

export type Env = typeof env;
