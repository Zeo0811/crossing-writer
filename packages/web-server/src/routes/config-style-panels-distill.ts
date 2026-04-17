import type { FastifyInstance } from "fastify";
import { join } from "node:path";
import type { StylePanelStore } from "../services/style-panel-store.js";
import {
  runRoleDistill as defaultRunRoleDistill,
  runRoleDistillAll as defaultRunRoleDistillAll,
  type RoleDistillEvent,
  type RoleDistillRole,
  type AllRolesDistillEvent,
} from "../services/style-distill-role-orchestrator.js";
import type { DistillRunStore } from "../services/distill-run-store.js";
import { runDistillV2 } from "@crossing/kb";
import { invokeAgent } from "@crossing/agents";

export interface ConfigStylePanelsDistillDeps {
  vaultPath: string;
  sqlitePath: string;
  stylePanelStore: StylePanelStore;
  runRoleDistill?: typeof defaultRunRoleDistill;
  runRoleDistillAll?: typeof defaultRunRoleDistillAll;
  distillRunStore?: DistillRunStore;
}

interface DistillBody {
  account?: string;
  role?: string;
  limit?: number;
}

interface DistillAllBody {
  account?: string;
  limit?: number;
}

const VALID_ROLES: RoleDistillRole[] = ["opening", "practice", "closing"];

export function registerConfigStylePanelsDistillRoutes(
  app: FastifyInstance,
  deps: ConfigStylePanelsDistillDeps,
): void {
  const runner = deps.runRoleDistill ?? defaultRunRoleDistill;
  const runnerAll = deps.runRoleDistillAll ?? defaultRunRoleDistillAll;

  app.post<{ Body: DistillBody }>(
    "/api/config/style-panels/distill",
    async (req, reply) => {
      const body = req.body ?? {};
      const account = (body.account ?? "").trim();
      const role = body.role;
      if (!account) {
        return reply.code(400).send({ error: "account is required" });
      }
      if (!role || !VALID_ROLES.includes(role as RoleDistillRole)) {
        return reply.code(400).send({ error: `invalid role: ${role}` });
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      reply.raw.flushHeaders?.();

      const send = (type: string, data: Record<string, unknown>) => {
        reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const onEvent = (ev: RoleDistillEvent) => {
        if (ev.phase === "started") {
          send("distill.started", { account: ev.account, role: ev.role, run_id: ev.run_id });
        } else if (ev.phase === "slicer_progress") {
          send("distill.slicer_progress", { processed: ev.processed, total: ev.total });
        } else if (ev.phase === "slicer_cache_hit") {
          // SP-15: surface per-article slicer cache hits to the client.
          send("distill.slicer_cache_hit", {
            article_id: ev.article_id,
            cache_key: ev.cache_key,
            cached_at: ev.cached_at,
          });
        } else if (ev.phase === "snippets_done") {
          send("distill.snippets_done", { count: ev.count });
        } else if (ev.phase === "structure_done") {
          send("distill.structure_done", {});
        } else if (ev.phase === "composer_done") {
          send("distill.composer_done", { panel_path: ev.panel_path });
        } else if (ev.phase === "failed") {
          send("distill.failed", { error: ev.error });
        }
      };

      try {
        const result = await runner(
          { account, role: role as RoleDistillRole },
          {
            vaultPath: deps.vaultPath,
            sqlitePath: deps.sqlitePath,
            limit: body.limit,
            onEvent,
          },
        );
        send("distill.finished", { panel_path: result.panelPath, version: result.version });
      } catch (err) {
        send("distill.failed", { error: (err as Error).message });
      } finally {
        reply.raw.end();
      }
    },
  );

  app.post<{ Body: DistillAllBody }>(
    "/api/config/style-panels/distill-all",
    async (req, reply) => {
      const body = req.body ?? {};
      const account = (body.account ?? "").trim();
      if (!account) {
        return reply.code(400).send({ error: "account is required" });
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      reply.raw.flushHeaders?.();

      const send = (type: string, data: Record<string, unknown>) => {
        reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const onEvent = (ev: AllRolesDistillEvent) => {
        if (ev.phase === "all.started") {
          send("distill_all.started", { account: ev.account, run_id: ev.run_id });
        } else if (ev.phase === "slicer_progress") {
          send("slicer_progress", { processed: ev.processed, total: ev.total });
        } else if (ev.phase === "slicer_cache_hit") {
          // SP-15: surface per-article slicer cache hits (all-roles variant).
          send("slicer_cache_hit", {
            article_id: ev.article_id,
            cache_key: ev.cache_key,
            cached_at: ev.cached_at,
          });
        } else if (ev.phase === "role_started") {
          send("role_started", { role: ev.role });
        } else if (ev.phase === "role_done") {
          send("role_done", {
            role: ev.role,
            panel_path: ev.panel_path,
            version: ev.version,
          });
        } else if (ev.phase === "role_failed") {
          send("role_failed", { role: ev.role, error: ev.error });
        } else if (ev.phase === "all.finished") {
          send("distill_all.finished", { results: ev.results });
        }
      };

      try {
        await runnerAll(
          { account },
          {
            vaultPath: deps.vaultPath,
            sqlitePath: deps.sqlitePath,
            limit: body.limit,
            onEvent,
          },
        );
      } catch (err) {
        send("distill_all.failed", { error: (err as Error).message });
      } finally {
        reply.raw.end();
      }
    },
  );

  app.post<{ Body: DistillAllBody }>(
    "/api/config/style-panels/distill-all-v2",
    async (req, reply) => {
      const body = req.body ?? {};
      const account = (body.account ?? "").trim();
      if (!account) {
        return reply.code(400).send({ error: "account is required" });
      }
      if (!deps.distillRunStore) {
        return reply.code(500).send({ error: "distill-run-store not wired" });
      }
      const runStore = deps.distillRunStore;
      const runId = `rdall-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Persist prompt / response artifacts for each opus call so we can
      // diagnose panel-shape or prompt-compliance failures after the fact.
      const runLogDir = join(deps.vaultPath, "08_experts/style-panel/_runs", runId, "artifacts");

      const invokeLabeler = async (o: { systemPrompt: string; userMessage: string; model?: string }) => {
        const r = await invokeAgent({
          agentKey: "style_distiller.labeler",
          cli: "claude",
          model: o.model ?? "claude-sonnet-4-5",
          systemPrompt: o.systemPrompt,
          userMessage: o.userMessage,
          runLogDir,
        });
        return { text: r.text, meta: { cli: r.meta.cli, durationMs: r.meta.durationMs } };
      };
      const invokeComposer = async (o: { systemPrompt: string; userMessage: string; model?: string }) => {
        const r = await invokeAgent({
          agentKey: "style_distiller.composer",
          cli: "claude",
          model: o.model ?? "claude-opus-4-6",
          systemPrompt: o.systemPrompt,
          userMessage: o.userMessage,
          runLogDir,
        });
        return { text: r.text, meta: { cli: r.meta.cli, durationMs: r.meta.durationMs } };
      };

      // Fire-and-forget; errors are captured as distill.failed events in the run log
      void runDistillV2(
        {
          account,
          sampleSize: body.limit ?? 50,
          runId,
          invokeLabeler,
          invokeComposer,
          onEvent: (ev: { type: string; data: Record<string, unknown> }) => { void runStore.append(runId, ev); },
        },
        { vaultPath: deps.vaultPath, sqlitePath: deps.sqlitePath },
      ).catch(() => { /* failure already emitted as distill.failed by the orchestrator */ });

      return reply.send({ run_id: runId });
    },
  );
}
