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

async function http<T>(path: string, init: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(`${TOOL_GATE_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { status: res.status, body: body as T };
}

async function httpOk<T>(path: string, init: RequestInit): Promise<T> {
  const { status, body } = await http<T>(path, init);
  if (status >= 400) {
    console.error(`[demo] ${init.method ?? "GET"} ${path} -> ${status}`, body);
    process.exit(1);
  }
  return body;
}

async function main(): Promise<void> {
  if (!PRIVATE_KEY) die("DEMO_PRIVATE_KEY (or PRIVATE_KEY) is required in env.");
  if (!ENS_NAME) die("DEMO_ENS_NAME is required in env.");

  const account = privateKeyToAccount(PRIVATE_KEY);
  console.log("[demo] using ENS:", ENS_NAME);
  console.log("[demo] signer address:", account.address);
  console.log("[demo] tool-gate at:", TOOL_GATE_URL);

  // ── Step 1: Challenge ──────────────────────────────────────────────────
  console.log("\n[demo] step 1: POST /auth/challenge");
  const challenge = await httpOk<{
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

  // ── Step 2: Sign ───────────────────────────────────────────────────────
  console.log("\n[demo] step 2: signing challenge with wallet signer");
  const signature = await account.signMessage({ message: challenge.message });
  console.log("[demo] signature:", signature.slice(0, 20) + "...");

  // ── Step 3: Verify ─────────────────────────────────────────────────────
  console.log("\n[demo] step 3: POST /auth/verify");
  const verify = await httpOk<{
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

  // ── Step 4: /auth/me ───────────────────────────────────────────────────
  console.log("\n[demo] step 4: GET /auth/me");
  const me = await httpOk<unknown>("/auth/me", {
    method: "GET",
    headers: { authorization: `Bearer ${verify.sessionToken}` },
  });
  console.log("[demo] /auth/me ->", me);

  // ── Step 5: /tool/hello ────────────────────────────────────────────────
  console.log("\n[demo] step 5: GET /tool/hello (protected)");
  const { status: helloStatus, body: helloBody } = await http<unknown>("/tool/hello", {
    method: "GET",
    headers: { authorization: `Bearer ${verify.sessionToken}` },
  });
  if (helloStatus === 200) {
    console.log("[demo] /tool/hello -> ✅", helloBody);
  } else {
    console.log(`[demo] /tool/hello -> ❌ ${helloStatus}`, helloBody);
  }

  // ── Step 6: /tool/private-signal ───────────────────────────────────────
  console.log("\n[demo] step 6: GET /tool/private-signal (protected)");
  const { status: sigStatus, body: sigBody } = await http<unknown>("/tool/private-signal", {
    method: "GET",
    headers: { authorization: `Bearer ${verify.sessionToken}` },
  });
  if (sigStatus === 200) {
    console.log("[demo] /tool/private-signal -> ✅", sigBody);
  } else {
    console.log(`[demo] /tool/private-signal -> ❌ ${sigStatus}`, sigBody);
  }

  // ── Step 7: No-token test ──────────────────────────────────────────────
  console.log("\n[demo] step 7: GET /tool/hello WITHOUT token (must 401)");
  const res = await fetch(`${TOOL_GATE_URL}/tool/hello`);
  console.log("[demo] no-auth status:", res.status, await res.json());

  console.log("\n[demo] happy path complete.");
}

main().catch((err) => {
  console.error("[demo] fatal:", err);
  process.exit(1);
});
