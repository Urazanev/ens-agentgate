import { buildApp } from "./app.js";
import { env } from "./utils/env.js";
import { logger } from "./utils/logger.js";

async function main(): Promise<void> {
  const app = await buildApp();
  await app.listen({ port: env.port, host: "0.0.0.0" });
  logger.info("agent-gate.listening", {
    port: env.port,
    appUri: env.appUri,
    agentChainId: env.agentChainId,
    ensChainId: env.ensChainId,
    ensRpcUrl: env.ensRpcUrl,
  });
}

main().catch((err) => {
  logger.error("agent-gate.fatal", { err: (err as Error).message });
  process.exit(1);
});
