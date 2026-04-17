import type { FastifyInstance } from "fastify";
import { join } from "node:path";
import type { ProjectStore } from "../services/project-store.js";
import type { ConfigStore } from "../services/config-store.js";
import type { AgentConfigStore } from "../services/agent-config-store.js";
import type { StylePanelStore } from "../services/style-panel-store.js";
import type { HardRulesStore } from "../services/hard-rules-store.js";
import type { ProjectOverrideStore } from "../services/project-override-store.js";
import { ArticleStore, type SectionKey } from "../services/article-store.js";
import {
  runWriterBookend,
  runWriterPractice,
  renderHardRulesBlock,
  invokeAgent,
  type ChatMessage,
  type WriterToolEvent,
  type RunWriterBookendOpts,
  type RunWriterPracticeOpts,
} from "@crossing/agents";
import { dispatchSkill } from "@crossing/kb";
import { buildSelectionRewriteUserMessage } from "../services/selection-rewrite-builder.js";
import { appendEvent } from "../services/event-log.js";
import { collectProjectImages } from "../services/brief-images.js";
import {
  type ContextBundleService,
  renderContextBlock,
  trimToBudget,
} from "../services/context-bundle-service.js";
import { resolveStyleBindingV2 } from "../services/style-binding-resolver.js";

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
  /** SP-B: v2 style binding resolution */
  agentConfigStore?: AgentConfigStore;
  stylePanelStore?: StylePanelStore;
  hardRulesStore?: HardRulesStore;
  projectOverrideStore?: ProjectOverrideStore;
}

interface Body {
  selected_text: string;
  user_prompt: string;
}

type ResolvedRunnerKind =
  | { kind: 'bookend'; role: 'opening' | 'closing'; agentKey: 'writer.opening' | 'writer.closing' }
  | { kind: 'practice'; agentKey: 'writer.practice' };

function resolveRunner(sectionKey: string): ResolvedRunnerKind | null {
  if (sectionKey === 'opening') return { kind: 'bookend', role: 'opening', agentKey: 'writer.opening' };
  if (sectionKey === 'closing') return { kind: 'bookend', role: 'closing', agentKey: 'writer.closing' };
  if (sectionKey.startsWith('practice.case-')) return { kind: 'practice', agentKey: 'writer.practice' };
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
      const resolved = resolveRunner(req.params.key);
      if (!resolved)
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

        const cfg = (await (deps.configStore as any).get(resolved.agentKey)) ?? {};
        const cli = (cfg.cli ?? "claude") as "claude" | "codex";
        const model = cfg.model as string | undefined;

        const invoker = async (
          messages: ChatMessage[],
          invokeOpts?: { images?: string[]; addDirs?: string[] },
        ) => {
          const sys = messages.find((m) => m.role === "system")?.content ?? "";
          const userParts = messages
            .filter((m) => m.role !== "system")
            .map((m) => `[${m.role}]\n${m.content}`)
            .join("\n\n");
          const r = await invokeAgent({
            agentKey: `${resolved.agentKey}.selection`,
            cli,
            model,
            systemPrompt: sys,
            userMessage: userParts,
            images: invokeOpts?.images,
            addDirs: invokeOpts?.addDirs,
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

        const onEvent = (ev: WriterToolEvent) => {
          const { type, ...rest } = ev;
          send(`writer.${type}`, { ...rest, section_key: req.params.key });
        };

        const { images: projectImages, addDirs: projectAddDirs } =
          await collectProjectImages(projectDir);

        let result: { finalText: string; toolsUsed?: unknown[] };

        if (resolved.kind === 'bookend') {
          if (!project.article_type) {
            send("writer.failed", {
              section_key: req.params.key,
              error: "project.article_type is required",
            });
            reply.raw.end();
            return;
          }
          const agentCfg = deps.agentConfigStore?.get(resolved.agentKey);
          const binding = agentCfg?.styleBinding;
          if (!binding) {
            send("writer.failed", {
              section_key: req.params.key,
              error: `no styleBinding for ${resolved.agentKey}`,
            });
            reply.raw.end();
            return;
          }
          const resolvedStyle = await resolveStyleBindingV2(
            binding,
            project.article_type as '实测' | '访谈' | '评论',
            deps.stylePanelStore!,
          );
          const rules = await deps.hardRulesStore!.read();
          const hardRulesBlock = renderHardRulesBlock(
            rules,
            (resolvedStyle.panel.frontmatter as any).banned_vocabulary ?? [],
          );

          result = await runWriterBookend({
            role: resolved.role,
            sectionKey: req.params.key,
            account: binding.account,
            articleType: project.article_type as '实测' | '访谈' | '评论',
            typeSection: resolvedStyle.typeSection,
            panelFrontmatter: resolvedStyle.panel.frontmatter as any,
            hardRulesBlock,
            projectContextBlock: '',
            product_name: (project as any).product_info?.name ?? undefined,
            invokeAgent: invoker,
            userMessage,
            images: projectImages,
            addDirs: projectAddDirs,
            dispatchTool,
            onEvent,
            maxRounds: 5,
          });
        } else {
          result = await runWriterPractice({
            invokeAgent: invoker,
            userMessage,
            images: projectImages,
            addDirs: projectAddDirs,
            dispatchTool,
            sectionKey: req.params.key,
            onEvent,
            maxRounds: 3,
          } as RunWriterPracticeOpts);
        }

        const newText = ((result?.finalText ?? (result as any)?.content ?? "") as string).trim();
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
            last_agent: resolved.agentKey,
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
