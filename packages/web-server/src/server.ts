import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { loadServerConfig, type ServerConfig } from "./config.js";
import { resolve } from "node:path";
import { ProjectStore } from "./services/project-store.js";
import { registerProjectsRoutes } from "./routes/projects.js";
import { registerBriefRoutes } from "./routes/brief.js";

const configPath = process.env.CROSSING_CONFIG
  ?? resolve(process.cwd(), "../../config.json");

export async function buildApp(overrideConfig?: ServerConfig): Promise<FastifyInstance> {
  const cfg = overrideConfig ?? loadServerConfig(configPath);
  const app = Fastify({ logger: true });
  app.decorate("crossingConfig", cfg);

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

  const store = new ProjectStore(cfg.projectsDir);
  app.decorate("projectStore", store);
  registerProjectsRoutes(app, { store });
  registerBriefRoutes(app, { store, projectsDir: cfg.projectsDir });

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
    projectStore: ProjectStore;
  }
}

// 入口
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildApp();
  const PORT = Number(process.env.PORT ?? 3001);
  app.listen({ port: PORT, host: "127.0.0.1" })
    .then(() => app.log.info(`listening on :${PORT}`))
    .catch((err) => { app.log.error(err); process.exit(1); });
}
