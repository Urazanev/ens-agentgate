import type { FastifyInstance } from "fastify";
import { requireSession } from "../middleware/requireSession.js";
import { checkToolAccess } from "../services/policyService.js";
import { addEvent } from "../services/eventLog.js";

function policyGate(toolId: string) {
  return async function (req: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply): Promise<void> {
    const s = req.session!;
    const result = checkToolAccess(s.ensName, toolId);

    if (!result.allowed) {
      addEvent({
        type: "tool_denied",
        ensName: s.ensName,
        address: s.address,
        tool: toolId,
        result: "denied",
        reason: result.reason,
      });
      reply.code(403).send({
        ok: false,
        error: "policy_denied",
        reason: result.reason,
      });
      return;
    }

    addEvent({
      type: "tool_allowed",
      ensName: s.ensName,
      address: s.address,
      tool: toolId,
      result: "allowed",
      reason: result.reason,
    });
  };
}

export async function registerToolRoutes(app: FastifyInstance): Promise<void> {
  // ── /tool/hello ─────────────────────────────────────────────────────────
  app.get(
    "/tool/hello",
    { preHandler: [requireSession, policyGate("hello")] },
    async (req, reply) => {
      const s = req.session!;
      return reply.send({
        ok: true,
        tool: "hello",
        message: `hello, authorized agent ${s.ensName}`,
        ensName: s.ensName,
        address: s.address,
      });
    },
  );

  // ── /tool/private-signal ────────────────────────────────────────────────
  app.get(
    "/tool/private-signal",
    { preHandler: [requireSession, policyGate("private-signal")] },
    async (req, reply) => {
      const s = req.session!;
      return reply.send({
        ok: true,
        tool: "private-signal",
        message: "private signal for authorized ENS agent",
        ensName: s.ensName,
        address: s.address,
      });
    },
  );
}
