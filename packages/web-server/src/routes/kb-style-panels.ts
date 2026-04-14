import type { FastifyInstance } from "fastify";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { runDistill, type DistillStep, type DistillStepEvent } from "@crossing/kb";

export interface KbStylePanelsDeps {
  vaultPath: string;
  sqlitePath: string;
}

export interface StylePanelEntry {
  id: string;
  path: string;
  last_updated_at: string;
}

interface DistillBody {
  sample_size?: number;
  since?: string;
  until?: string;
  only_step?: string;
  cli_model_per_step?: Partial<Record<"structure" | "snippets" | "composer", { cli: "claude" | "codex"; model?: string }>>;
}

function countAccount(sqlitePath: string, account: string, since?: string, until?: string): number {
  if (!existsSync(sqlitePath)) return 0;
  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  try {
    const where: string[] = ["account = @a"];
    const params: Record<string, unknown> = { a: account };
    if (since) { where.push("published_at >= @s"); params.s = since; }
    if (until) { where.push("published_at <= @u"); params.u = until; }
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ref_articles WHERE ${where.join(" AND ")}`).get(params) as { c: number };
    return row.c;
  } finally {
    db.close();
  }
}

export function registerKbStylePanelsRoutes(app: FastifyInstance, deps: KbStylePanelsDeps) {
  app.get("/api/kb/style-panels", async (_req, reply) => {
    const dir = join(deps.vaultPath, "08_experts", "style-panel");
    if (!existsSync(dir)) return reply.send([]);
    const entries: StylePanelEntry[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".md")) continue;
      const abs = join(dir, name);
      const st = statSync(abs);
      entries.push({ id: name.slice(0, -3), path: abs, last_updated_at: st.mtime.toISOString() });
    }
    entries.sort((a, b) => a.id.localeCompare(b.id));
    return reply.send(entries);
  });

  app.post<{ Params: { account: string }; Body: DistillBody }>(
    "/api/kb/style-panels/:account/distill",
    async (req, reply) => {
      const account = decodeURIComponent(req.params.account);
      const body = req.body ?? {};
      const sampleSize = body.sample_size ?? 200;
      if (!Number.isInteger(sampleSize) || sampleSize < 20) {
        return reply.code(400).send({ error: "sample_size must be integer >= 20" });
      }
      if (body.since && body.until && body.since > body.until) {
        return reply.code(400).send({ error: "since must be <= until" });
      }
      if (body.only_step && !["quant", "structure", "snippets", "composer"].includes(body.only_step)) {
        return reply.code(400).send({ error: `invalid only_step: ${body.only_step}` });
      }
      const totalInRange = countAccount(deps.sqlitePath, account, body.since, body.until);
      if (totalInRange === 0) {
        return reply.code(404).send({ error: `account not found or empty in date range: ${account}` });
      }
      if (totalInRange < 20) {
        return reply.code(400).send({ error: `only ${totalInRange} articles in range (need >= 20)` });
      }

      reply.raw.setHeader("Content-Type", "text/event-stream");
      reply.raw.setHeader("Cache-Control", "no-cache");
      reply.raw.setHeader("Connection", "keep-alive");
      reply.hijack();

      const send = (type: string, data: Record<string, unknown>) => {
        reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const onEvent = (ev: DistillStepEvent) => {
        if (ev.phase === "started") send("distill.step_started", { step: ev.step, account: ev.account });
        else if (ev.phase === "batch_progress") send("distill.batch_progress", { step: ev.step, ...ev.stats });
        else if (ev.phase === "completed") send("distill.step_completed", { step: ev.step, duration_ms: ev.duration_ms, stats: ev.stats });
        else if (ev.phase === "failed") send("distill.step_failed", { step: ev.step, error: ev.error });
      };

      try {
        const result = await runDistill({
          account,
          sampleSize,
          since: body.since,
          until: body.until,
          onlyStep: body.only_step as DistillStep | undefined,
          cliModelPerStep: body.cli_model_per_step,
          onEvent,
        }, { vaultPath: deps.vaultPath, sqlitePath: deps.sqlitePath });
        send("distill.all_completed", {
          account: result.account, kb_path: result.kb_path, sample_size_actual: result.sample_size_actual, steps_run: result.steps_run,
        });
      } catch (err) {
        send("distill.step_failed", { step: "unknown", error: (err as Error).message });
      } finally {
        reply.raw.end();
      }
    },
  );
}
