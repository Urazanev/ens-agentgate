import Fastify, { type FastifyInstance } from "fastify";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerToolRoutes } from "./routes/tool.js";
import { env } from "./utils/env.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 1024 * 64,
  });

  app.get("/health", async () => ({
    ok: true,
    service: "tool-gate",
    agentChainId: env.agentChainId,
    ensChainId: env.ensChainId,
  }));

  await registerAuthRoutes(app);
  await registerToolRoutes(app);

  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ ok: false, error: "not_found" });
  });

  app.setErrorHandler((err, _req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    reply.code(status).send({
      ok: false,
      error: status >= 500 ? "internal_error" : "request_failed",
      details: err.message,
    });
  });

  return app;
}
