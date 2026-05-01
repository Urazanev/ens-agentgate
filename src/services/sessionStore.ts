import { randomBytes } from "node:crypto";
import type { Address } from "viem";
import type { Session } from "../types/session.js";
import { addSeconds, nowMs } from "../utils/time.js";
import { env } from "../utils/env.js";

const store = new Map<string, Session>();

function newSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export function createSession(ensName: string, address: Address): Session {
  const createdAt = nowMs();
  const session: Session = {
    token: newSessionToken(),
    ensName,
    address,
    createdAt,
    expiresAt: addSeconds(createdAt, env.sessionTtlSec),
  };
  store.set(session.token, session);
  return session;
}

export function getSession(token: string): Session | undefined {
  const s = store.get(token);
  if (!s) return undefined;
  if (s.expiresAt <= nowMs()) {
    store.delete(token);
    return undefined;
  }
  return s;
}

export function clearSessions(): number {
  const count = store.size;
  store.clear();
  return count;
}
