import "dotenv/config";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

const TOOL_GATE_URL = process.env.TOOL_GATE_URL ?? "http://localhost:3001";
const PRIVATE_KEY = (process.env.DEMO_PRIVATE_KEY ?? process.env.PRIVATE_KEY) as Hex | undefined;
const ENS_NAME = process.env.DEMO_ENS_NAME;

function die(msg: string): never {
  console.error(`[demo] ${msg}`);
  process.exit(1);
}

async function http<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${TOOL_GATE_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!res.ok) {
    console.error(`[demo] ${init.method ?? "GET"} ${path} -> ${res.status}`, body);
    process.exit(1);
  }
  return body as T;
}

async function main(): Promise<void> {
  if (!PRIVATE_KEY) die("DEMO_PRIVATE_KEY (or PRIVATE_KEY) is required in env.");
  if (!ENS_NAME) die("DEMO_ENS_NAME is required in env.");

  const account = privateKeyToAccount(PRIVATE_KEY);
  console.log("[demo] using ENS:", ENS_NAME);
  console.log("[demo] signer address:", account.address);
  console.log("[demo] tool-gate at:", TOOL_GATE_URL);

  console.log("\n[demo] step 1: POST /auth/challenge");
  const challenge = await http<{
    ok: true;
    message: string;
    nonce: string;
    expiresAt: string;
  }>("/auth/challenge", {
    method: "POST",
    body: JSON.stringify({ ensName: ENS_NAME, address: account.address }),
  });
  console.log("[demo] nonce:", challenge.nonce);
  console.log("[demo] message to sign:\n---\n" + challenge.message + "\n---");

  console.log("\n[demo] step 2: signing challenge with wallet signer");
  const signature = await account.signMessage({ message: challenge.message });
  console.log("[demo] signature:", signature.slice(0, 20) + "...");

  console.log("\n[demo] step 3: POST /auth/verify");
  const verify = await http<{
    ok: true;
    sessionToken: string;
    expiresAt: string;
    ensName: string;
    address: string;
  }>("/auth/verify", {
    method: "POST",
    body: JSON.stringify({
      ensName: ENS_NAME,
      address: account.address,
      signature,
    }),
  });
  console.log("[demo] session token (truncated):", verify.sessionToken.slice(0, 16) + "...");
  console.log("[demo] session expires:", verify.expiresAt);

  console.log("\n[demo] step 4: GET /auth/me");
  const me = await http<unknown>("/auth/me", {
    method: "GET",
    headers: { authorization: `Bearer ${verify.sessionToken}` },
  });
  console.log("[demo] /auth/me ->", me);

  console.log("\n[demo] step 5: GET /tool/hello (protected)");
  const hello = await http<unknown>("/tool/hello", {
    method: "GET",
    headers: { authorization: `Bearer ${verify.sessionToken}` },
  });
  console.log("[demo] /tool/hello ->", hello);

  console.log("\n[demo] step 6: GET /tool/hello WITHOUT token (must 401)");
  const res = await fetch(`${TOOL_GATE_URL}/tool/hello`);
  console.log("[demo] no-auth status:", res.status, await res.json());

  console.log("\n[demo] happy path complete.");
}

main().catch((err) => {
  console.error("[demo] fatal:", err);
  process.exit(1);
});
