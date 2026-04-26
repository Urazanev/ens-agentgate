import type { FastifyReply, FastifyRequest } from "fastify";
import { getSession } from "../services/sessionStore.js";
import type { Session } from "../types/session.js";

declare module "fastify" {
  interface FastifyRequest {
    session?: Session;
  }
}

export async function requireSession(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    reply.code(401).send({ ok: false, error: "unauthorized", reason: "missing_bearer_token" });
    return;
  }
  const token = auth.slice("Bearer ".length).trim();
  const session = getSession(token);
  if (!session) {
    reply.code(401).send({ ok: false, error: "unauthorized", reason: "invalid_or_expired_session" });
    return;
  }
  req.session = session;
}
