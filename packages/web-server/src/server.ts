import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { loadServerConfig, type ServerConfig } from "./config.js";
import { resolve } from "node:path";

const configPath = process.env.CROSSING_CONFIG
  ?? resolve(process.cwd(), "../../config.json");

export function buildApp(overrideConfig?: ServerConfig): FastifyInstance {
  const cfg = overrideConfig ?? loadServerConfig(configPath);
  const app = Fastify({ logger: true });
  app.decorate("crossingConfig", cfg);

  app.register(cors, { origin: true });

  app.get("/api/health", async () => ({
    ok: true,
    vaultPath: cfg.vaultPath,
    defaultCli: cfg.defaultCli,
    ts: Date.now(),
  }));

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    crossingConfig: ServerConfig;
  }
}

// 入口
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = buildApp();
  const PORT = Number(process.env.PORT ?? 3001);
  app.listen({ port: PORT, host: "127.0.0.1" })
    .then(() => app.log.info(`listening on :${PORT}`))
    .catch((err) => { app.log.error(err); process.exit(1); });
}
