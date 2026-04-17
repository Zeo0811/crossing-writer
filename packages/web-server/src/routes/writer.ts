import type { FastifyInstance } from "fastify";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ProjectStore } from "../services/project-store.js";
import type { ConfigStore } from "../services/config-store.js";
import type { AgentConfigStore } from "../services/agent-config-store.js";
import type { ProjectOverrideStore } from "../services/project-override-store.js";
import type { StylePanelStore } from "../services/style-panel-store.js";
import { mergeAgentConfig } from "../services/config-merger.js";
import { resolveStyleBindingV2 } from "../services/style-binding-resolver.js";
import { runWriter, runBookendWithValidation, type WriterAgentKey, type WriterConfig, type ResolveStyleForAgent } from "../services/writer-orchestrator.js";
import type { ContextBundleService } from "../services/context-bundle-service.js";
import type { HardRulesStore } from "../services/hard-rules-store.js";
import { ArticleStore, type SectionKey } from "../services/article-store.js";
import {
  WriterPracticeAgent,
  PracticeStitcherAgent, invokeAgent,
  runWriterPractice, runWriterBookend, renderHardRulesBlock,
  type RunWriterBookendOpts, type ChatMessage, type WriterToolEvent,
} from "@crossing/agents";
import { dispatchSkill, type ArticleType } from "@crossing/kb";
import { readFile } from "node:fs/promises";
import { appendEvent } from "../services/event-log.js";

export interface WriterDeps {
  store: ProjectStore;
  projectsDir: string;
  vaultPath: string;
  sqlitePath: string;
  configStore: ConfigStore | { get(key: string): Promise<{ cli?: string; model?: string } | undefined> };
  agentConfigStore?: AgentConfigStore;
  projectOverrideStore?: ProjectOverrideStore;
  stylePanelStore?: StylePanelStore;
  /** SP-19 optional — when provided, the orchestrator prepends a unified
   *  [Project Context] block to every writer user message. */
  contextBundleService?: ContextBundleService;
  /** SP-A optional — when provided, hard rules are merged into the style reference block. */
  hardRulesStore?: HardRulesStore;
}

const SECTION_AGENT_TO_CONFIG_KEY: Record<string, string> = {
  "writer.opening": "writer.opening",
  "writer.practice": "writer.practice",
  "writer.closing": "writer.closing",
};


function buildResolveStyleForAgent(
  deps: WriterDeps,
  projectId: string,
  articleType: ArticleType,
): ResolveStyleForAgent | undefined {
  if (!deps.agentConfigStore || !deps.stylePanelStore || !deps.hardRulesStore) return undefined;
  const agentConfigStore = deps.agentConfigStore;
  const projectOverrideStore = deps.projectOverrideStore;
  const stylePanelStore = deps.stylePanelStore;
  const hardRulesStore = deps.hardRulesStore;

  return async (agentKey) => {
    const cfgKey = SECTION_AGENT_TO_CONFIG_KEY[agentKey] ?? agentKey;
    const global = agentConfigStore.get(cfgKey);
    if (!global) return null;
    const override = projectOverrideStore?.get(projectId)?.agents?.[cfgKey];
    const merged = mergeAgentConfig(global, override as any);
    if (!merged.styleBinding) return null;
    const resolved = await resolveStyleBindingV2(
      merged.styleBinding,
      articleType,
      stylePanelStore,
    );
    const rules = await hardRulesStore.read();
    // v2 resolver returns PanelV2; downstream formatStyleReference only reads
    // frontmatter.{account, role, version} which exist on both shapes. Cast is
    // a pragmatic bridge until the whole orchestrator moves to v2-only types.
    const panelBannedVocab: string[] = (resolved.panel.frontmatter as any).banned_vocabulary ?? [];
    const hardRulesBlock = renderHardRulesBlock(rules, panelBannedVocab);
    return {
      panel: resolved.panel as any,
      typeSection: resolved.typeSection,
      hardRulesBlock,
    };
  };
}

const AGENT_KEYS: WriterAgentKey[] = [
  "writer.opening", "writer.practice", "writer.closing",
  "practice.stitcher", "style_critic",
];

async function mergeWriterConfig(
  deps: WriterDeps,
  body: Partial<WriterConfig>,
): Promise<WriterConfig> {
  const cliModel: WriterConfig["cli_model_per_agent"] = {};
  for (const key of AGENT_KEYS) {
    const override = body.cli_model_per_agent?.[key];
    const globalCfg = await (deps.configStore as any).get(key);
    const nestedModel = globalCfg?.model;
    const isNewFormat = nestedModel && typeof nestedModel === "object" && "cli" in nestedModel;
    const cli: "claude" | "codex" = (isNewFormat ? nestedModel.cli : globalCfg?.cli) ?? "claude";
    const model: string | undefined = isNewFormat ? nestedModel.model : (typeof nestedModel === "string" ? nestedModel : undefined);
    cliModel[key] = override ?? (globalCfg ? { cli, model } : undefined);
  }
  return { cli_model_per_agent: cliModel };
}

function sectionKeyToAgentKey(key: string): WriterAgentKey | null {
  if (key === "opening") return "writer.opening";
  if (key === "closing") return "writer.closing";
  if (key === "transitions") return "practice.stitcher";
  if (key.startsWith("practice.case-")) return "writer.practice";
  return null;
}

export function registerWriterRoutes(app: FastifyInstance, deps: WriterDeps) {
  app.post<{ Params: { id: string }; Body: Partial<WriterConfig> }>(
    "/api/projects/:id/writer/start",
    async (req, reply) => {
      const project = await deps.store.get(req.params.id);
      if (!project) return reply.code(404).send({ error: "project not found" });
      if (project.status !== "evidence_ready" && project.status !== "writing_configuring") {
        return reply.code(400).send({ error: `invalid status: ${project.status}` });
      }
      if (!project.article_type) {
        return reply.code(400).send({ error: 'project.article_type is required; please set it in Brief stage' });
      }
      const body = req.body ?? {};
      const writerConfig = await mergeWriterConfig(deps, body);
      await deps.store.update(req.params.id, {
        status: "writing_configuring",
        writer_config: {
          cli_model_per_agent: Object.fromEntries(
            Object.entries(writerConfig.cli_model_per_agent).filter(([, v]) => v !== undefined),
          ) as Record<string, { cli: string; model?: string }>,
        },
      });
      const resolveStyleForAgent = buildResolveStyleForAgent(deps, req.params.id, project.article_type);
      void (async () => {
        try {
          await runWriter({
            projectId: req.params.id,
            projectsDir: deps.projectsDir,
            store: deps.store,
            vaultPath: deps.vaultPath,
            sqlitePath: deps.sqlitePath,
            writerConfig,
            ...(resolveStyleForAgent ? { resolveStyleForAgent } : {}),
            ...(deps.contextBundleService ? { contextBundleService: deps.contextBundleService } : {}),
            ...(deps.hardRulesStore ? { hardRulesStore: deps.hardRulesStore } : {}),
            onEvent: async (ev) => {
              try {
                const { appendEvent } = await import("../services/event-log.js");
                await appendEvent(join(deps.projectsDir, req.params.id), ev as any);
              } catch {}
            },
          });
        } catch {
          // runWriter itself sets writing_failed
        }
      })();
      return reply.send({ ok: true });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/writer/sections",
    async (req, reply) => {
      const project = await deps.store.get(req.params.id);
      if (!project) return reply.code(404).send({ error: "project not found" });
      if (project.status === "evidence_ready") {
        await deps.store.update(req.params.id, { status: "writing_configuring" });
      }
      const as = new ArticleStore(join(deps.projectsDir, req.params.id));
      await as.init();
      const list = await as.listSections();
      return reply.send({
        sections: list.map((s) => ({
          key: s.key,
          frontmatter: s.frontmatter,
          preview: s.body.slice(0, 200),
        })),
      });
    },
  );

  app.get<{ Params: { id: string; key: string } }>(
    "/api/projects/:id/writer/sections/:key",
    async (req, reply) => {
      const as = new ArticleStore(join(deps.projectsDir, req.params.id));
      const file = await as.readSection(req.params.key as SectionKey);
      if (!file) return reply.code(404).send({ error: "section not found" });
      return reply.send({ key: file.key, frontmatter: file.frontmatter, body: file.body });
    },
  );

  app.put<{
    Params: { id: string; key: string };
    Body: { body?: string; frontmatter?: Record<string, unknown> };
  }>(
    "/api/projects/:id/writer/sections/:key",
    async (req, reply) => {
      if (typeof req.body?.body !== "string") {
        return reply.code(400).send({ error: "body required" });
      }
      const as = new ArticleStore(join(deps.projectsDir, req.params.id));
      const existing = await as.readSection(req.params.key as SectionKey);
      if (!existing) return reply.code(404).send({ error: "section not found" });
      const extra = req.body.frontmatter ?? {};
      await as.writeSection(req.params.key as SectionKey, {
        key: existing.key,
        frontmatter: {
          ...existing.frontmatter,
          ...extra,
          last_agent: "human",
          last_updated_at: new Date().toISOString(),
        } as any,
        body: req.body.body,
      });
      return reply.send({ ok: true });
    },
  );

  app.post<{ Params: { id: string; key: string }; Body: { user_hint?: string; selected_text?: string } }>(
    "/api/projects/:id/writer/sections/:key/rewrite",
    async (req, reply) => {
      const project = await deps.store.get(req.params.id);
      if (!project) return reply.code(404).send({ error: "project not found" });
      const as = new ArticleStore(join(deps.projectsDir, req.params.id));
      const existing = await as.readSection(req.params.key as SectionKey);
      if (!existing) return reply.code(404).send({ error: "section not found" });
      const agentKey = sectionKeyToAgentKey(req.params.key);
      if (!agentKey) return reply.code(400).send({ error: "unsupported section key" });

      const selected = req.body?.selected_text?.trim();
      const userHint = req.body?.user_hint?.trim();
      const augmentedHintParts: string[] = [];
      if (userHint) augmentedHintParts.push(`用户提示：${userHint}`);
      if (selected) {
        augmentedHintParts.push(
          `**只改写下面这段片段，保留段落其它内容逐字不变**。输出完整段落 markdown（仅把这段替换为改后的版本）：\n<<<\n${selected}\n>>>`,
        );
      }
      const hintBlock = augmentedHintParts.length ? `\n\n${augmentedHintParts.join("\n\n")}` : "";

      reply.raw.setHeader("Content-Type", "text/event-stream");
      reply.raw.setHeader("Cache-Control", "no-cache");
      reply.raw.setHeader("Connection", "keep-alive");
      reply.hijack();

      const send = (type: string, data: Record<string, unknown>) => {
        reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      try {
        await deps.store.update(req.params.id, { status: "writing_editing" });
        const cfg = project.writer_config;
        const cliModel = cfg?.cli_model_per_agent?.[agentKey] ?? { cli: "claude" };
        let newBody = "";
        const pDir = join(deps.projectsDir, req.params.id);

        // Surgical edit mode: bypass section agent, use a minimal "editor" prompt.
        if (selected) {
          const systemPrompt = [
            "你是\"十字路口文本外科医生\"。任务：接收一段 markdown + 要改的片段 + 改写要求，输出**原段落的完整 markdown，仅把指定片段替换为修改后的版本，其余字符（含标点、换行、空格）逐字保留**。",
            "",
            "严格规则：",
            "- 不许改其他句子、不许加段、不许删段",
            "- 不许前言、不许说明、不许元评论",
            "- 直接输出修改后的完整段落，第一个字符就是段落第一个字符",
            "- 如果片段在段落中找不到，原样输出输入段落",
          ].join("\n");
          const userMessage = [
            "# 原段落",
            existing.body,
            "",
            "# 要替换的片段",
            "<<<",
            selected,
            ">>>",
            "",
            "# 改写要求",
            userHint || "(无额外要求，请让这段更简练、保持原意)",
            "",
            "输出完整段落 markdown。",
          ].join("\n");
          const out = await invokeAgent({
            agentKey: `${agentKey}.surgical`,
            cli: cliModel.cli as "claude" | "codex",
            model: cliModel.model,
            systemPrompt,
            userMessage,
          });
          newBody = out.text;
        } else if (agentKey === "writer.opening" || agentKey === "writer.practice" || agentKey === "writer.closing") {
          const invoker = async (messages: ChatMessage[], invokeOpts?: { images?: string[] }) => {
            const sys = messages.find((m) => m.role === "system")?.content ?? "";
            const userParts = messages.filter((m) => m.role !== "system")
              .map((m) => `[${m.role}]\n${m.content}`).join("\n\n");
            const r = await invokeAgent({
              agentKey,
              cli: cliModel.cli as "claude" | "codex",
              model: cliModel.model,
              systemPrompt: sys,
              userMessage: userParts,
              images: invokeOpts?.images,
            });
            return { text: r.text, meta: { cli: r.meta.cli, model: r.meta.model ?? undefined, durationMs: r.meta.durationMs } };
          };
          const dispatchTool = (call: { command: string; args: string[] }) =>
            dispatchSkill(call, { vaultPath: deps.vaultPath, sqlitePath: deps.sqlitePath });
          const onEvent = (ev: WriterToolEvent) => {
            const { type, ...rest } = ev;
            send(`writer.${type}`, { ...rest, section_key: req.params.key });
          };

          if (agentKey === "writer.opening" || agentKey === "writer.closing") {
            if (!project.article_type) {
              return reply.code(400).send({ error: 'project.article_type is required' });
            }
            const role: 'opening' | 'closing' = agentKey === 'writer.opening' ? 'opening' : 'closing';
            const bookendAgentKey: 'writer.opening' | 'writer.closing' = agentKey as 'writer.opening' | 'writer.closing';
            const agentCfg = deps.agentConfigStore?.get(bookendAgentKey);
            const binding = agentCfg?.styleBinding;
            if (!binding) {
              return reply.code(400).send({ error: `no styleBinding for ${bookendAgentKey}` });
            }
            const resolvedStyle = await resolveStyleBindingV2(
              binding,
              project.article_type,
              deps.stylePanelStore!,
            );
            const rules = await deps.hardRulesStore!.read();
            const hardRulesBlock = renderHardRulesBlock(
              rules,
              (resolvedStyle.panel.frontmatter as any).banned_vocabulary ?? [],
            );

            let userMessage: string;
            if (role === 'opening') {
              const brief = existsSync(join(pDir, "brief/brief.md")) ? await readFile(join(pDir, "brief/brief.md"), "utf-8") : "";
              const mission = existsSync(join(pDir, "mission/selected.md")) ? await readFile(join(pDir, "mission/selected.md"), "utf-8") : "";
              const po = existsSync(join(pDir, "context/product-overview.md")) ? await readFile(join(pDir, "context/product-overview.md"), "utf-8") : "";
              userMessage = [
                "# Brief 摘要", (brief + hintBlock) || "(无)", "",
                "# Mission 摘要", mission || "(无)", "",
                "# 产品概览", po || "(无)", "",
                "请按 system prompt 要求产出开头段正文。",
              ].join("\n");
            } else {
              const openingBody = (await as.readSection("opening"))?.body ?? "";
              const list = await as.listSections();
              const practiceText = list.filter((s) => s.key.startsWith("practice.case-")).map((s) => s.body).join("\n\n");
              userMessage = [
                "# 开头段", openingBody + hintBlock, "",
                "# 实测主体（含过渡）", practiceText, "",
                "请按 system prompt 要求产出结尾段。",
              ].join("\n");
            }

            const wordOverride = rules.word_count_overrides?.[role];
            const publishEvent = async (type: string, data: Record<string, unknown>) => {
              send(type, data);
              try { await appendEvent(pDir, { type, ...data } as any); } catch { /* ignore */ }
            };
            const out = await runBookendWithValidation({
              role,
              sectionKey: req.params.key,
              publishEvent,
              hardRules: rules,
              wordOverride,
              runBookend: (retry) => runWriterBookend({
                role,
                sectionKey: req.params.key,
                account: binding.account,
                articleType: project.article_type!,
                typeSection: resolvedStyle.typeSection,
                panelFrontmatter: resolvedStyle.panel.frontmatter as any,
                hardRulesBlock,
                projectContextBlock: '',
                wordOverride,
                retryFeedback: retry,
                product_name: project.product_info?.name ?? undefined,
                invokeAgent: invoker,
                userMessage,
                dispatchTool,
                onEvent,
                maxRounds: 5,
              }),
            });
            newBody = out.finalText;
          } else {
            const caseId = req.params.key.slice("practice.".length);
            const notesPath = join(pDir, "evidence", caseId, "notes.md");
            let notesBody = "";
            if (existsSync(notesPath)) {
              const raw = await readFile(notesPath, "utf-8");
              const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
              notesBody = m ? m[2]! : raw;
            }
            const shotsDir = join(pDir, "evidence", caseId, "screenshots");
            const shots = existsSync(shotsDir) ? readdirSync(shotsDir).map((f) => join(shotsDir, f)) : [];
            const userMessage = [
              `# Case 编号：${caseId}`,
              `# Case 名：${caseId}`, "",
              "# Case 详细描述", existing.body + hintBlock, "",
              "# 实测笔记 frontmatter", "```yaml", "{}", "```", "",
              "# 实测笔记正文", notesBody || "(无)", "",
              "# 截图清单",
              shots.length === 0 ? "(无)" : shots.map((p, i) => `- screenshot-${i + 1}: ${p}`).join("\n"), "",
              "请按 system prompt 要求产出该 case 实测小节。",
            ].join("\n");
            const out = await runWriterPractice({
              invokeAgent: invoker, userMessage, images: shots, dispatchTool, onEvent, sectionKey: req.params.key,
            });
            newBody = out.finalText;
          }
        } else if (agentKey === "practice.stitcher") {
          const list = await as.listSections();
          const cases = list.filter((s) => s.key.startsWith("practice.case-"));
          const agent = new PracticeStitcherAgent({ cli: cliModel.cli as "claude" | "codex", model: cliModel.model });
          const stitcherOut = await agent.stitch({
            cases: cases.map((c) => ({
              caseId: c.key.slice("practice.".length),
              firstLines: c.body.split("\n").slice(0, 3).join(" "),
              lastLines: c.body.split("\n").slice(-3).join(" "),
            })),
          });
          newBody = Object.entries(stitcherOut.transitions).map(([k, v]) => `## transition.${k}\n${v}`).join("\n\n");
        }

        send("writer.rewrite_chunk", { section_key: req.params.key, chunk: newBody });

        await as.writeSection(req.params.key as SectionKey, {
          key: existing.key,
          frontmatter: {
            ...existing.frontmatter,
            last_agent: agentKey,
            last_updated_at: new Date().toISOString(),
          } as any,
          body: newBody,
        });
        try { await appendEvent(pDir, { type: "writer.rewrite_completed", section_key: req.params.key, last_agent: agentKey } as any); } catch {}
        send("writer.rewrite_completed", { section_key: req.params.key, last_agent: agentKey });
        try { await appendEvent(pDir, { type: "writer.final_rebuilt", at: new Date().toISOString() } as any); } catch {}
      } catch (err) {
        send("writer.rewrite_failed", { section_key: req.params.key, error: (err as Error).message });
        try { await appendEvent(join(deps.projectsDir, req.params.id), { type: "writer.rewrite_failed", section_key: req.params.key, error: (err as Error).message } as any); } catch {}
      } finally {
        await deps.store.update(req.params.id, { status: "writing_ready" });
        reply.raw.end();
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/writer/final",
    async (req, reply) => {
      const as = new ArticleStore(join(deps.projectsDir, req.params.id));
      const merged = await as.mergeFinal();
      reply.header("Content-Type", "text/markdown; charset=utf-8");
      return reply.send(merged);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/writer/retry-failed",
    async (req, reply) => {
      const project = await deps.store.get(req.params.id);
      if (!project) return reply.code(404).send({ error: "project not found" });
      if (project.status !== "writing_failed") {
        return reply.code(400).send({ error: `invalid status: ${project.status}` });
      }
      if (!project.article_type) {
        return reply.code(400).send({ error: 'project.article_type is required; please set it in Brief stage' });
      }
      const failed = project.writer_failed_sections ?? [];
      const cfg = project.writer_config;
      const writerConfig: WriterConfig = {
        cli_model_per_agent: (cfg?.cli_model_per_agent ?? {}) as WriterConfig["cli_model_per_agent"],
      };
      const resolveStyleForAgent = buildResolveStyleForAgent(deps, req.params.id, project.article_type);
      void (async () => {
        try {
          await runWriter({
            projectId: req.params.id, projectsDir: deps.projectsDir, store: deps.store,
            vaultPath: deps.vaultPath, sqlitePath: deps.sqlitePath,
            writerConfig, sectionsToRun: failed,
            ...(resolveStyleForAgent ? { resolveStyleForAgent } : {}),
            ...(deps.contextBundleService ? { contextBundleService: deps.contextBundleService } : {}),
            ...(deps.hardRulesStore ? { hardRulesStore: deps.hardRulesStore } : {}),
          });
        } catch {}
      })();
      return reply.send({ ok: true, retrying: failed });
    },
  );
}
