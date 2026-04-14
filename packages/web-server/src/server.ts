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
import { registerEvidenceRoutes } from "./routes/evidence.js";
import { registerKbStylePanelsRoutes } from "./routes/kb-style-panels.js";
import { registerKbAccountsRoutes } from "./routes/kb-accounts.js";
import { registerKbWikiRoutes } from "./routes/kb-wiki.js";
import { registerWriterRoutes } from "./routes/writer.js";
import { registerWriterRewriteSelectionRoutes } from "./routes/writer-rewrite-selection.js";
import { createAgentConfigStore } from "./services/agent-config-store.js";
import { StylePanelStore } from "./services/style-panel-store.js";
import { ProjectOverrideStore } from "./services/project-override-store.js";
import { registerConfigAgentsRoutes } from "./routes/config-agents.js";
import { registerConfigStylePanelsRoutes } from "./routes/config-style-panels.js";
import { registerConfigStylePanelsDistillRoutes } from "./routes/config-style-panels-distill.js";
import { registerConfigProjectOverridesRoutes } from "./routes/config-project-overrides.js";

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
  // NOTE: legacy registerConfigRoutes superseded by SP-10 config-agents + config-project-overrides routes.

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

  // SP-10 config workbench stores (created here so both writer + config routes share them)
  const agentConfigStore = createAgentConfigStore(configStore);
  const stylePanelStore = new StylePanelStore(configStore.current.vaultPath);
  try {
    const migrated = stylePanelStore.migrateLegacy();
    if (migrated > 0) {
      console.log(
        `[server] migrated ${migrated} legacy SP-06 style panel(s) to sp10 frontmatter`,
      );
    }
  } catch (err) {
    console.warn(
      `[server] style-panel legacy migration failed: ${(err as Error).message}`,
    );
  }
  const projectOverrideStore = new ProjectOverrideStore(configStore.current.projectsDir);

  registerWriterRoutes(app, {
    store,
    projectsDir: configStore.current.projectsDir,
    vaultPath: configStore.current.vaultPath,
    sqlitePath: configStore.current.sqlitePath,
    configStore: { get: async (key: string) => configStore.current.agents?.[key] } as any,
    agentConfigStore,
    projectOverrideStore,
    stylePanelStore,
  });

  registerWriterRewriteSelectionRoutes(app, {
    store,
    projectsDir: configStore.current.projectsDir,
    vaultPath: configStore.current.vaultPath,
    sqlitePath: configStore.current.sqlitePath,
    configStore: { get: async (key: string) => configStore.current.agents?.[key] } as any,
  });

  registerOverviewRoutes(app, {
    store, imageStore, projectsDir: configStore.current.projectsDir,
    analyzeOverviewDeps: {
      vaultPath: configStore.current.vaultPath,
      sqlitePath: configStore.current.sqlitePath,
      configStore,
    },
  });

  // SP-10 config workbench routes (stores created above, shared with writer routes)
  registerConfigAgentsRoutes(app, { agentConfigStore });
  registerConfigStylePanelsRoutes(app, { stylePanelStore });
  registerConfigStylePanelsDistillRoutes(app, {
    vaultPath: configStore.current.vaultPath,
    sqlitePath: configStore.current.sqlitePath,
    stylePanelStore,
  });
  registerConfigProjectOverridesRoutes(app, {
    projectOverrideStore,
    projectStore: store,
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
