import type { FastifyInstance } from "fastify";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ProjectStore } from "../services/project-store.js";
import type { ConfigStore } from "../services/config-store.js";
import { runWriter, type WriterAgentKey, type WriterConfig } from "../services/writer-orchestrator.js";
import { ArticleStore, type SectionKey } from "../services/article-store.js";
import {
  WriterOpeningAgent, WriterPracticeAgent, WriterClosingAgent,
  PracticeStitcherAgent, type ReferenceAccountKb,
} from "@crossing/agents";
import { readFile } from "node:fs/promises";
import { appendEvent } from "../services/event-log.js";

export interface WriterDeps {
  store: ProjectStore;
  projectsDir: string;
  vaultPath: string;
  sqlitePath: string;
  configStore: ConfigStore | { get(key: string): Promise<{ cli?: string; model?: string; reference_accounts?: string[] } | undefined> };
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
  const refs: WriterConfig["reference_accounts_per_agent"] = {};
  for (const key of AGENT_KEYS) {
    const override = body.cli_model_per_agent?.[key];
    const globalCfg = await (deps.configStore as any).get(key);
    cliModel[key] = override ?? (globalCfg ? { cli: (globalCfg.cli ?? "claude") as "claude" | "codex", model: globalCfg.model } : undefined);
    const refOverride = body.reference_accounts_per_agent?.[key];
    refs[key] = refOverride ?? (globalCfg?.reference_accounts ?? []);
  }
  return { cli_model_per_agent: cliModel, reference_accounts_per_agent: refs };
}

function validateReferenceAccounts(vaultPath: string, refs: Record<string, string[]>): string[] {
  const dir = join(vaultPath, "08_experts", "style-panel");
  const existing = new Set(
    existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)) : [],
  );
  const missing: string[] = [];
  for (const ids of Object.values(refs)) for (const id of ids) if (!existing.has(id)) missing.push(id);
  return [...new Set(missing)];
}

function sectionKeyToAgentKey(key: string): WriterAgentKey | null {
  if (key === "opening") return "writer.opening";
  if (key === "closing") return "writer.closing";
  if (key === "transitions") return "practice.stitcher";
  if (key.startsWith("practice.case-")) return "writer.practice";
  return null;
}

async function loadRefs(vault: string, ids: string[]): Promise<ReferenceAccountKb[]> {
  const out: ReferenceAccountKb[] = [];
  for (const id of ids) {
    const p = join(vault, "08_experts", "style-panel", `${id}.md`);
    if (existsSync(p)) out.push({ id, text: await readFile(p, "utf-8") });
  }
  return out;
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
      const body = req.body ?? {};
      const missing = validateReferenceAccounts(deps.vaultPath, body.reference_accounts_per_agent ?? {});
      if (missing.length > 0) {
        return reply.code(400).send({ error: `reference_accounts 不存在: ${missing.join(", ")}` });
      }
      const writerConfig = await mergeWriterConfig(deps, body);
      await deps.store.update(req.params.id, {
        status: "writing_configuring",
        writer_config: {
          cli_model_per_agent: Object.fromEntries(
            Object.entries(writerConfig.cli_model_per_agent).filter(([, v]) => v !== undefined),
          ) as Record<string, { cli: string; model?: string }>,
          reference_accounts_per_agent: writerConfig.reference_accounts_per_agent as Record<string, string[]>,
        },
      });
      void (async () => {
        try {
          await runWriter({
            projectId: req.params.id,
            projectsDir: deps.projectsDir,
            store: deps.store,
            vaultPath: deps.vaultPath,
            sqlitePath: deps.sqlitePath,
            writerConfig,
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

  app.put<{ Params: { id: string; key: string }; Body: { body?: string } }>(
    "/api/projects/:id/writer/sections/:key",
    async (req, reply) => {
      if (typeof req.body?.body !== "string") {
        return reply.code(400).send({ error: "body required" });
      }
      const as = new ArticleStore(join(deps.projectsDir, req.params.id));
      const existing = await as.readSection(req.params.key as SectionKey);
      if (!existing) return reply.code(404).send({ error: "section not found" });
      await as.writeSection(req.params.key as SectionKey, {
        key: existing.key,
        frontmatter: {
          ...existing.frontmatter,
          last_agent: "human",
          last_updated_at: new Date().toISOString(),
        },
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
        const refIds = cfg?.reference_accounts_per_agent?.[agentKey] ?? [];
        const refs = await loadRefs(deps.vaultPath, refIds);
        let newBody = "";
        const pDir = join(deps.projectsDir, req.params.id);

        if (agentKey === "writer.opening") {
          const brief = existsSync(join(pDir, "brief/brief.md")) ? await readFile(join(pDir, "brief/brief.md"), "utf-8") : "";
          const mission = existsSync(join(pDir, "mission/selected.md")) ? await readFile(join(pDir, "mission/selected.md"), "utf-8") : "";
          const po = existsSync(join(pDir, "context/product-overview.md")) ? await readFile(join(pDir, "context/product-overview.md"), "utf-8") : "";
          const agent = new WriterOpeningAgent({ cli: cliModel.cli as "claude" | "codex", model: cliModel.model });
          const out = await agent.write({ briefSummary: brief + hintBlock, missionSummary: mission, productOverview: po, referenceAccountsKb: refs });
          newBody = out.text;
        } else if (agentKey === "writer.closing") {
          const openingBody = (await as.readSection("opening"))?.body ?? "";
          const list = await as.listSections();
          const practiceText = list.filter((s) => s.key.startsWith("practice.case-")).map((s) => s.body).join("\n\n");
          const agent = new WriterClosingAgent({ cli: cliModel.cli as "claude" | "codex", model: cliModel.model });
          const out = await agent.write({ openingText: openingBody + hintBlock, stitchedPracticeText: practiceText, referenceAccountsKb: refs });
          newBody = out.text;
        } else if (agentKey === "writer.practice") {
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
          const agent = new WriterPracticeAgent({ cli: cliModel.cli as "claude" | "codex", model: cliModel.model });
          const out = await agent.write({
            caseId, caseName: caseId, caseDescription: existing.body + hintBlock,
            notesBody, notesFrontmatter: {}, screenshotPaths: shots, referenceAccountsKb: refs,
          });
          newBody = out.text;
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
          },
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
      const failed = project.writer_failed_sections ?? [];
      const cfg = project.writer_config;
      const writerConfig: WriterConfig = {
        cli_model_per_agent: (cfg?.cli_model_per_agent ?? {}) as WriterConfig["cli_model_per_agent"],
        reference_accounts_per_agent: (cfg?.reference_accounts_per_agent ?? {}) as WriterConfig["reference_accounts_per_agent"],
      };
      void (async () => {
        try {
          await runWriter({
            projectId: req.params.id, projectsDir: deps.projectsDir, store: deps.store,
            vaultPath: deps.vaultPath, sqlitePath: deps.sqlitePath,
            writerConfig, sectionsToRun: failed,
          });
        } catch {}
      })();
      return reply.send({ ok: true, retrying: failed });
    },
  );
}
