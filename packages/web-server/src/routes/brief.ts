import type { FastifyInstance } from "fastify";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectStore } from "../services/project-store.js";
import { extractToMarkdown } from "../services/file-extractor.js";
import { appendEvent } from "../services/event-log.js";
import { analyzeBrief } from "../services/brief-analyzer-service.js";
import type { AgentConfig } from "@crossing/agents";

export interface BriefDeps {
  store: ProjectStore;
  projectsDir: string;
  cli: "claude" | "codex";
  model?: string;
  agents: Record<string, AgentConfig>;
  defaultCli: "claude" | "codex";
  fallbackCli: "claude" | "codex";
}

interface TextBody {
  text?: string;
  productName?: string | null;
  productUrl?: string | null;
  productDocsUrl?: string | null;
  productTrialUrl?: string | null;
  notes?: string | null;
}

export function registerBriefRoutes(app: FastifyInstance, deps: BriefDeps) {
  app.post<{ Params: { id: string }; Body: TextBody }>(
    "/api/projects/:id/brief",
    async (req, reply) => {
      const { id } = req.params;
      const project = await deps.store.get(id);
      if (!project) return reply.code(404).send({ error: "project not found" });

      const ct = req.headers["content-type"] ?? "";
      const projectDir = join(deps.projectsDir, id);
      const briefDir = join(projectDir, "brief");
      const rawDir = join(briefDir, "raw");
      await mkdir(rawDir, { recursive: true });

      let sourceType = "text";
      let rawPath = "";
      let markdown = "";
      let extra: TextBody = {};

      if (ct.startsWith("multipart/form-data")) {
        const data = await (req as any).file();
        if (!data) return reply.code(400).send({ error: "no file" });
        const ext = data.filename.split(".").pop()!.toLowerCase();
        sourceType = ext;
        rawPath = join("brief/raw", data.filename);
        const abs = join(projectDir, rawPath);
        const buf = await data.toBuffer();
        await writeFile(abs, buf);
        markdown = await extractToMarkdown(buf, data.filename, {
          imageSaveDir: join(briefDir, "images"),
          imageUrlPrefix: "images/",
        });
        extra = {
          productName: data.fields?.productName?.value ?? null,
          productUrl: data.fields?.productUrl?.value ?? null,
          productDocsUrl: data.fields?.productDocsUrl?.value ?? null,
          productTrialUrl: data.fields?.productTrialUrl?.value ?? null,
          notes: data.fields?.notes?.value ?? null,
        };
      } else {
        const body = (req.body ?? {}) as TextBody;
        if (!body.text || typeof body.text !== "string" || !body.text.trim()) {
          return reply.code(400).send({ error: "text required" });
        }
        markdown = body.text;
        sourceType = "text";
        rawPath = "brief/raw/brief.txt";
        await writeFile(join(projectDir, rawPath), body.text, "utf-8");
        extra = body;
      }

      const mdRel = "brief/brief.md";
      await writeFile(join(projectDir, mdRel), markdown, "utf-8");

      const now = new Date().toISOString();
      const fromStatus = project.status;
      await deps.store.update(id, {
        status: "brief_uploaded",
        brief: {
          source_type: sourceType,
          raw_path: rawPath,
          md_path: mdRel,
          summary_path: null,
          uploaded_at: now,
        },
        product_info: {
          name: extra.productName ?? null,
          official_url: extra.productUrl ?? null,
          trial_url: extra.productTrialUrl ?? null,
          docs_url: extra.productDocsUrl ?? null,
          fetched_path: null,
          notes: extra.notes ?? null,
        },
      });

      await appendEvent(projectDir, {
        type: "state_changed",
        from: fromStatus,
        to: "brief_uploaded",
      });

      // 异步触发 Brief Analyst，不阻塞 HTTP 响应
      setImmediate(() => {
        analyzeBrief({
          projectId: id,
          projectsDir: deps.projectsDir,
          store: deps.store,
          cli: deps.cli,
          agents: deps.agents,
          defaultCli: deps.defaultCli,
          fallbackCli: deps.fallbackCli,
        }).catch((err) => app.log.error({ err, projectId: id }, "analyzeBrief failed"));
      });

      return reply.send({ ok: true });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/brief-summary",
    async (req, reply) => {
      const project = await deps.store.get(req.params.id);
      if (!project || !project.brief?.summary_path) {
        return reply.code(404).send({ error: "no summary yet" });
      }
      const buf = await readFile(
        join(deps.projectsDir, req.params.id, project.brief.summary_path),
        "utf-8",
      );
      reply.header("content-type", "text/markdown; charset=utf-8");
      return buf;
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/brief/reanalyze",
    async (req, reply) => {
      const { id } = req.params;
      const project = await deps.store.get(id);
      if (!project) return reply.code(404).send({ error: "project not found" });
      if (!project.brief?.md_path) return reply.code(400).send({ error: "no brief uploaded" });
      setImmediate(() => {
        analyzeBrief({
          projectId: id,
          projectsDir: deps.projectsDir,
          store: deps.store,
          cli: deps.cli,
          agents: deps.agents,
          defaultCli: deps.defaultCli,
          fallbackCli: deps.fallbackCli,
        }).catch((err) => app.log.error({ err, projectId: id }, "reanalyzeBrief failed"));
      });
      return reply.code(202).send({ ok: true, status: "reanalyzing" });
    },
  );
}
