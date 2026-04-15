import type { FastifyInstance } from "fastify";
import { join } from "node:path";
import type { ProjectStore } from "../services/project-store.js";
import type { ConfigStore } from "../services/config-store.js";
import { ArticleStore, type SectionKey } from "../services/article-store.js";
import {
  runWriterOpening,
  runWriterPractice,
  runWriterClosing,
  invokeAgent,
  type ChatMessage,
  type WriterToolEvent,
} from "@crossing/agents";
import { dispatchSkill } from "@crossing/kb";
import { buildSelectionRewriteUserMessage } from "../services/selection-rewrite-builder.js";
import { appendEvent } from "../services/event-log.js";
import {
  type ContextBundleService,
  renderContextBlock,
  trimToBudget,
} from "../services/context-bundle-service.js";

export interface RewriteSelectionDeps {
  store: ProjectStore;
  projectsDir: string;
  vaultPath: string;
  sqlitePath: string;
  configStore:
    | ConfigStore
    | {
        get(
          key: string,
        ): Promise<{ cli?: string; model?: string } | undefined>;
      };
  /** SP-19: optional unified ContextBundle service — when supplied, a
   *  `[Project Context]` block is prepended to the rewrite user message. */
  contextBundleService?: ContextBundleService;
}

interface Body {
  selected_text: string;
  user_prompt: string;
}

type RunnerFn = typeof runWriterOpening;

function pickRunner(
  sectionKey: string,
): { run: RunnerFn; agentKey: string } | null {
  if (sectionKey === "opening")
    return { run: runWriterOpening, agentKey: "writer.opening" };
  if (sectionKey === "closing")
    return { run: runWriterClosing, agentKey: "writer.closing" };
  if (sectionKey.startsWith("practice.case-"))
    return { run: runWriterPractice, agentKey: "writer.practice" };
  return null;
}

export function registerWriterRewriteSelectionRoutes(
  app: FastifyInstance,
  deps: RewriteSelectionDeps,
) {
  app.post<{ Params: { id: string; key: string }; Body: Body }>(
    "/api/projects/:id/writer/sections/:key/rewrite-selection",
    async (req, reply) => {
      const project = await deps.store.get(req.params.id);
      if (!project)
        return reply.code(404).send({ error: "project not found" });
      const { selected_text, user_prompt } = (req.body ?? {}) as Body;
      if (!selected_text || !user_prompt)
        return reply
          .code(400)
          .send({ error: "selected_text and user_prompt required" });
      const runner = pickRunner(req.params.key);
      if (!runner)
        return reply.code(400).send({ error: "unsupported section key" });

      const projectDir = join(deps.projectsDir, project.id);
      const articles = new ArticleStore(projectDir);
      const current = await articles
        .readSection(req.params.key as SectionKey)
        .catch(() => null);
      if (!current)
        return reply.code(404).send({ error: "section not found" });
      const body = current.body ?? "";
      const matchIndex = body.indexOf(selected_text);
      if (matchIndex < 0)
        return reply.code(400).send({ error: "selected_text not found" });

      reply.raw.setHeader("content-type", "text/event-stream");
      reply.raw.setHeader("cache-control", "no-cache");
      reply.raw.setHeader("connection", "keep-alive");
      reply.hijack();
      const send = (event: string, data: Record<string, unknown>) => {
        reply.raw.write(`event: ${event}\n`);
        reply.raw.write(
          `data: ${JSON.stringify({ ts: Date.now(), ...data })}\n\n`,
        );
      };

      try {
        send("writer.started", {
          sectionKey: req.params.key,
          mode: "rewrite-selection",
          match_index: 0,
        });

        let userMessage = buildSelectionRewriteUserMessage({
          sectionBody: body,
          selectedText: selected_text,
          userPrompt: user_prompt,
        });
        // SP-19: prepend unified project-context block so the selection-rewrite
        // agent shares the same project snapshot as the main writer run.
        if (deps.contextBundleService) {
          try {
            const bundle = trimToBudget(
              await deps.contextBundleService.build(project.id),
            );
            userMessage = `${renderContextBlock(bundle)}\n\n${userMessage}`;
          } catch {
            /* degrade silently to legacy prompt */
          }
        }

        const cfg = (await (deps.configStore as any).get(runner.agentKey)) ?? {};
        const cli = (cfg.cli ?? "claude") as "claude" | "codex";
        const model = cfg.model as string | undefined;

        const invoker = async (
          messages: ChatMessage[],
          invokeOpts?: { images?: string[] },
        ) => {
          const sys = messages.find((m) => m.role === "system")?.content ?? "";
          const userParts = messages
            .filter((m) => m.role !== "system")
            .map((m) => `[${m.role}]\n${m.content}`)
            .join("\n\n");
          const r = invokeAgent({
            agentKey: `${runner.agentKey}.selection`,
            cli,
            model,
            systemPrompt: sys,
            userMessage: userParts,
            images: invokeOpts?.images,
          });
          return {
            text: r.text,
            meta: {
              cli: r.meta.cli,
              model: r.meta.model ?? undefined,
              durationMs: r.meta.durationMs,
            },
          };
        };

        const dispatchTool = (call: { command: string; args: string[] }) =>
          dispatchSkill(call, {
            vaultPath: deps.vaultPath,
            sqlitePath: deps.sqlitePath,
          });

        const result = await (runner.run as any)({
          invokeAgent: invoker,
          userMessage,
          dispatchTool,
          sectionKey: req.params.key,
          onEvent: (ev: WriterToolEvent) => {
            const { type, ...rest } = ev;
            send(`writer.${type}`, { ...rest, section_key: req.params.key });
          },
          maxRounds: 3,
        });

        const newText = ((result?.finalText ?? result?.content ?? "") as string).trim();
        const newBody =
          body.slice(0, matchIndex) +
          newText +
          body.slice(matchIndex + selected_text.length);

        const prevTools = Array.isArray(
          (current.frontmatter as any).tools_used,
        )
          ? ((current.frontmatter as any).tools_used as unknown[])
          : [];
        const mergedTools = [...prevTools, ...(result?.toolsUsed ?? [])];
        await articles.writeSection(req.params.key as SectionKey, {
          key: req.params.key as SectionKey,
          frontmatter: {
            ...current.frontmatter,
            last_agent: runner.agentKey,
            last_updated_at: new Date().toISOString(),
            ...(mergedTools.length > 0 ? { tools_used: mergedTools } : {}),
          } as any,
          body: newBody,
        });

        send("writer.selection_rewritten", {
          section_key: req.params.key,
          selected_text,
          new_text: newText,
          match_index: 0,
          content_full: newBody,
        });
        try {
          await appendEvent(projectDir, {
            type: "writer.selection_rewritten",
            section_key: req.params.key,
          });
        } catch {}
        send("writer.completed", {
          sectionKey: req.params.key,
          section_key: req.params.key,
        });
      } catch (e) {
        send("writer.failed", {
          section_key: req.params.key,
          error: (e as Error).message,
        });
      } finally {
        reply.raw.end();
      }
    },
  );
}
