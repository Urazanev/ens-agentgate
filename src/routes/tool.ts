import type { FastifyInstance } from "fastify";
import { requireSession } from "../middleware/requireSession.js";

export async function registerToolRoutes(app: FastifyInstance): Promise<void> {
  app.get("/tool/hello", { preHandler: requireSession }, async (req, reply) => {
    const s = req.session!;
    return reply.send({
      ok: true,
      message: `hello, authorized agent ${s.ensName}`,
      ensName: s.ensName,
      address: s.address,
    });
  });
}
