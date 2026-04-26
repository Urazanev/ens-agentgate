import { randomBytes } from "node:crypto";
import type { Address } from "viem";
import type { Challenge } from "../types/auth.js";

const store = new Map<string, Challenge>();

export function findLatestActive(
  ensName: string,
  address: Address,
): Challenge | undefined {
  const lcAddr = address.toLowerCase();
  let best: Challenge | undefined;
  for (const c of store.values()) {
    if (c.used) continue;
    if (c.ensName !== ensName) continue;
    if (c.address.toLowerCase() !== lcAddr) continue;
    if (!best || c.createdAt > best.createdAt) best = c;
  }
  return best;
}

export function newNonce(): string {
  return randomBytes(16).toString("hex");
}

export function putChallenge(c: Challenge): void {
  store.set(c.nonce, c);
}

export function markUsed(nonce: string): void {
  const c = store.get(nonce);
  if (c) {
    c.used = true;
    store.set(nonce, c);
  }
}
