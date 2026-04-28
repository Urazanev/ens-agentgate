import Fastify, { type FastifyInstance } from "fastify";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerToolRoutes } from "./routes/tool.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { env } from "./utils/env.js";

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 1024 * 64,
  });

  // Support application/x-www-form-urlencoded for dashboard forms
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_req, body, done) => {
      try {
        // Handle multiple values for same key (checkboxes)
        const raw = new URLSearchParams(body as string);
        const result: Record<string, string | string[]> = {};
        for (const [key] of raw) {
          const all = raw.getAll(key);
          result[key] = all.length > 1 ? all : all[0]!;
        }
        done(null, result);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.get("/health", async () => ({
    ok: true,
    service: "tool-gate",
    agentChainId: env.agentChainId,
    ensChainId: env.ensChainId,
  }));

  await registerAuthRoutes(app);
  await registerToolRoutes(app);
  await registerDashboardRoutes(app);

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
