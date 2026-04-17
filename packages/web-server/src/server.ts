import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { loadServerConfig, type ServerConfig } from "./config.js";
import { resolve, join } from "node:path";
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
import { registerKbRawArticlesRoutes } from "./routes/kb-raw-articles.js";
import { registerKbWikiRunsRoutes } from "./routes/kb-wiki-runs.js";
import { registerKbWikiRoutes } from "./routes/kb-wiki.js";
import { ensureSchema } from "@crossing/kb";
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { registerWriterRoutes } from "./routes/writer.js";
import { registerWriterRewriteSelectionRoutes } from "./routes/writer-rewrite-selection.js";
import { createAgentConfigStore } from "./services/agent-config-store.js";
import { StylePanelStore } from "./services/style-panel-store.js";
import { ProjectOverrideStore } from "./services/project-override-store.js";
import { ProjectChecklistService } from "./services/project-checklist-service.js";
import { registerConfigAgentsRoutes } from "./routes/config-agents.js";
import { registerConfigStylePanelsRoutes } from "./routes/config-style-panels.js";
import { registerConfigStylePanelsDistillRoutes } from "./routes/config-style-panels-distill.js";
import { registerStylePanelsCleanupRoutes } from "./routes/config-style-panels-cleanup.js";
import { registerConfigProjectOverridesRoutes } from "./routes/config-project-overrides.js";
import { DistillRunStore } from "./services/distill-run-store.js";
import { registerDistillRunsRoutes } from "./routes/config-distill-runs.js";
import { createCliHealthProber } from "./services/cli-health.js";
import { registerSystemHealthRoutes } from "./routes/system-health.js";
import { registerProjectImageRoutes } from "./routes/project-images.js";
import { registerBriefAttachmentsRoutes } from "./routes/brief-attachments.js";
import { TopicExpertStore } from "./services/topic-expert-store.js";
import { registerTopicExpertsRoutes } from "./routes/topic-experts.js";
import { registerTopicExpertConsultRoutes } from "./routes/topic-expert-consult.js";
import { invokeTopicExpert } from "@crossing/agents";
import { ContextBundleService } from "./services/context-bundle-service.js";
import { registerContextRoutes } from "./routes/context.js";
import { registerProjectTreeRoutes } from "./routes/project-tree.js";
import { HardRulesStore } from "./services/hard-rules-store.js";
import { registerWritingHardRulesRoutes } from "./routes/config-writing-hard-rules.js";

const configPath = process.env.CROSSING_CONFIG
  ?? resolve(process.cwd(), "../../config.json");

export async function buildApp(overrideConfig?: ServerConfig): Promise<FastifyInstance> {
  const cfg = overrideConfig ?? loadServerConfig(configPath);
  // Grant all agent CLI invocations access to vault files (brief images, style panels, wiki, refs).
  // Claude CLI's --add-dir whitelist is read from this env by model-adapter on every spawn.
  if (cfg.vaultPath) process.env.CROSSING_VAULT_PATH = cfg.vaultPath;
  const app = Fastify({ logger: true });
  app.decorate("crossingConfig", cfg);

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 1.5 * 1024 * 1024 * 1024 } });

  const store = new ProjectStore(cfg.projectsDir);
  app.decorate("projectStore", store);
  const imageStore = new ImageStore(cfg.projectsDir);
  app.decorate("imageStore", imageStore);
  registerBriefRoutes(app, {
    store,
    projectsDir: cfg.projectsDir,
    cli: cfg.defaultCli,
    agents: cfg.agents,
    defaultCli: cfg.defaultCli,
    fallbackCli: cfg.fallbackCli,
  });

  registerProjectTreeRoutes(app, {
    store,
    projectsDir: cfg.projectsDir,
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
  // Legacy routes/config.ts was removed — SP-10 config-agents + config-project-overrides
  // are the active config routes; defaultModel GET/PATCH lives on /api/config/agents.

  // Ensure wiki_ingest_* schema is applied idempotently at startup.
  if (existsSync(configStore.current.sqlitePath)) {
    const schemaDb = new Database(configStore.current.sqlitePath);
    try { ensureSchema(schemaDb); } finally { schemaDb.close(); }
  }

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
  registerKbRawArticlesRoutes(app, { sqlitePath: configStore.current.sqlitePath });
  registerKbWikiRunsRoutes(app, { sqlitePath: configStore.current.sqlitePath });

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

  // SP-19 unified ContextBundle service — shared by writer/rewrite/topic-expert
  // routes (injected below) plus the /api/projects/:id/context debug endpoint.
  const contextBundleService = new ContextBundleService({
    projectStore: store,
    projectsDir: configStore.current.projectsDir,
    stylePanelStore,
    agentConfigStore,
    projectOverrideStore,
  });
  registerContextRoutes(app, { contextBundleService });

  const checklistService = new ProjectChecklistService({
    projectStore: store,
    stylePanelStore,
    agentConfigStore,
    projectOverrideStore,
    projectsDir: configStore.current.projectsDir,
  });
  registerProjectsRoutes(app, { store, checklistService });

  const hardRulesStore = new HardRulesStore(
    join(configStore.current.vaultPath, '08_experts'),
  );

  registerWriterRoutes(app, {
    store,
    projectsDir: configStore.current.projectsDir,
    vaultPath: configStore.current.vaultPath,
    sqlitePath: configStore.current.sqlitePath,
    configStore,
    agentConfigStore,
    projectOverrideStore,
    stylePanelStore,
    contextBundleService,
    hardRulesStore,
  });

  registerWriterRewriteSelectionRoutes(app, {
    store,
    projectsDir: configStore.current.projectsDir,
    vaultPath: configStore.current.vaultPath,
    sqlitePath: configStore.current.sqlitePath,
    configStore: { get: async (key: string) => configStore.current.agents?.[key] } as any,
    contextBundleService,
    agentConfigStore,
    stylePanelStore,
    hardRulesStore,
    projectOverrideStore,
  });

  registerOverviewRoutes(app, {
    store, imageStore, projectsDir: configStore.current.projectsDir,
    analyzeOverviewDeps: {
      vaultPath: configStore.current.vaultPath,
      sqlitePath: configStore.current.sqlitePath,
      configStore,
    },
  });

  const distillRunStore = new DistillRunStore(
    join(configStore.current.vaultPath, '08_experts/style-panel/_runs'),
  );

  // SP-10 config workbench routes (stores created above, shared with writer routes)
  registerConfigAgentsRoutes(app, { agentConfigStore, configStore });
  registerConfigStylePanelsRoutes(app, { stylePanelStore });
  registerConfigStylePanelsDistillRoutes(app, {
    vaultPath: configStore.current.vaultPath,
    sqlitePath: configStore.current.sqlitePath,
    stylePanelStore,
    distillRunStore,
  });
  registerDistillRunsRoutes(app, { runStore: distillRunStore });
  registerStylePanelsCleanupRoutes(app, { vaultPath: configStore.current.vaultPath });
  registerConfigProjectOverridesRoutes(app, {
    projectOverrideStore,
    projectStore: store,
  });

  registerWritingHardRulesRoutes(app, { hardRulesStore });

  registerProjectImageRoutes(app, { projectsRoot: configStore.current.projectsDir });
  registerBriefAttachmentsRoutes(app, { projectsRoot: configStore.current.projectsDir });

  const topicExpertStore = new TopicExpertStore(cfg.vaultPath);
  app.decorate("topicExpertStore", topicExpertStore);
  registerTopicExpertsRoutes(app, { store: topicExpertStore });
  registerTopicExpertConsultRoutes(app, {
    store: topicExpertStore,
    invoke: invokeTopicExpert,
    contextBundleService,
    projectsDir: cfg.projectsDir,
  });

  const cliHealthProber = createCliHealthProber();
  registerSystemHealthRoutes(app, { prober: cliHealthProber });

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
    topicExpertStore: TopicExpertStore;
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
