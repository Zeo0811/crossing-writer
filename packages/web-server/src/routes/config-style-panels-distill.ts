import type { FastifyInstance } from "fastify";
import type { StylePanelStore } from "../services/style-panel-store.js";
import {
  runRoleDistill as defaultRunRoleDistill,
  type RoleDistillEvent,
  type RoleDistillRole,
} from "../services/style-distill-role-orchestrator.js";

export interface ConfigStylePanelsDistillDeps {
  vaultPath: string;
  sqlitePath: string;
  stylePanelStore: StylePanelStore;
  runRoleDistill?: typeof defaultRunRoleDistill;
}

interface DistillBody {
  account?: string;
  role?: string;
  limit?: number;
}

const VALID_ROLES: RoleDistillRole[] = ["opening", "practice", "closing"];

export function registerConfigStylePanelsDistillRoutes(
  app: FastifyInstance,
  deps: ConfigStylePanelsDistillDeps,
): void {
  const runner = deps.runRoleDistill ?? defaultRunRoleDistill;

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
}
