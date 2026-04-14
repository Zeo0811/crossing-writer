import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { loadServerConfig, type ServerConfig } from "./config.js";
import { resolve } from "node:path";
import { ProjectStore } from "./services/project-store.js";
import { ImageStore } from "./services/image-store.js";
import { registerProjectsRoutes } from "./routes/projects.js";
import { registerBriefRoutes } from "./routes/brief.js";
import { registerOverviewRoutes } from "./routes/overview.js";
import { registerCasePlanRoutes } from "./routes/case-plan.js";
import { ExpertRegistry } from "./services/expert-registry.js";
import { registerExpertsRoutes } from "./routes/experts.js";
import { registerMissionRoutes } from "./routes/mission.js";
import { registerStreamRoutes } from "./routes/stream.js";
import { createConfigStore } from "./services/config-store.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerEvidenceRoutes } from "./routes/evidence.js";
import { registerKbStylePanelsRoutes } from "./routes/kb-style-panels.js";
import { registerKbAccountsRoutes } from "./routes/kb-accounts.js";
import { registerKbWikiRoutes } from "./routes/kb-wiki.js";
import { registerWriterRoutes } from "./routes/writer.js";
import { registerWriterSuggestRoutes } from "./routes/writer-suggest.js";
import { registerWriterRewriteSelectionRoutes } from "./routes/writer-rewrite-selection.js";

const configPath = process.env.CROSSING_CONFIG
  ?? resolve(process.cwd(), "../../config.json");

export async function buildApp(overrideConfig?: ServerConfig): Promise<FastifyInstance> {
  const cfg = overrideConfig ?? loadServerConfig(configPath);
  const app = Fastify({ logger: true });
  app.decorate("crossingConfig", cfg);

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 1.5 * 1024 * 1024 * 1024 } });

  const store = new ProjectStore(cfg.projectsDir);
  app.decorate("projectStore", store);
  const imageStore = new ImageStore(cfg.projectsDir);
  app.decorate("imageStore", imageStore);
  registerProjectsRoutes(app, { store });
  registerBriefRoutes(app, {
    store,
    projectsDir: cfg.projectsDir,
    cli: cfg.defaultCli,
    agents: cfg.agents,
    defaultCli: cfg.defaultCli,
    fallbackCli: cfg.fallbackCli,
  });

  const registry = new ExpertRegistry(cfg.expertsDir);
  app.decorate("expertRegistry", registry);
  registerExpertsRoutes(app, { registry });

  registerMissionRoutes(app, {
    store,
    registry,
    projectsDir: cfg.projectsDir,
    cli: cfg.defaultCli,
    agents: cfg.agents,
    defaultCli: cfg.defaultCli,
    fallbackCli: cfg.fallbackCli,
    searchCtx: { sqlitePath: cfg.sqlitePath, vaultPath: cfg.vaultPath },
  });

  registerStreamRoutes(app, { projectsDir: cfg.projectsDir });

  const configStore = createConfigStore(configPath);
  registerConfigRoutes(app, { configStore });

  const vaultRegistry = new ExpertRegistry(cfg.vaultPath);
  registerCasePlanRoutes(app, {
    store,
    expertRegistry: vaultRegistry,
    projectsDir: configStore.current.projectsDir,
    orchestratorDeps: {
      vaultPath: configStore.current.vaultPath,
      sqlitePath: configStore.current.sqlitePath,
      configStore,
    },
  });

  registerEvidenceRoutes(app, {
    store,
    projectsDir: configStore.current.projectsDir,
  });

  registerKbStylePanelsRoutes(app, {
    vaultPath: configStore.current.vaultPath,
    sqlitePath: configStore.current.sqlitePath,
  });

  registerKbAccountsRoutes(app, { sqlitePath: configStore.current.sqlitePath });

  registerKbWikiRoutes(app, {
    vaultPath: configStore.current.vaultPath,
    sqlitePath: configStore.current.sqlitePath,
  });

  registerWriterRoutes(app, {
    store,
    projectsDir: configStore.current.projectsDir,
    vaultPath: configStore.current.vaultPath,
    sqlitePath: configStore.current.sqlitePath,
    configStore: { get: async (key: string) => configStore.current.agents?.[key] } as any,
  });

  registerWriterSuggestRoutes(app, {
    vaultPath: configStore.current.vaultPath,
    sqlitePath: configStore.current.sqlitePath,
  });
  registerWriterRewriteSelectionRoutes(app, {
    store,
    projectsDir: configStore.current.projectsDir,
    vaultPath: configStore.current.vaultPath,
    sqlitePath: configStore.current.sqlitePath,
    configStore,
  });

  registerOverviewRoutes(app, {
    store, imageStore, projectsDir: configStore.current.projectsDir,
    analyzeOverviewDeps: {
      vaultPath: configStore.current.vaultPath,
      sqlitePath: configStore.current.sqlitePath,
      configStore,
    },
  });

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
    expertRegistry: ExpertRegistry;
    imageStore: ImageStore;
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
