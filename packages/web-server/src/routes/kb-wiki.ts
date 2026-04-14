import type { FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { runIngest, type IngestMode, type IngestStepEvent } from "@crossing/kb";

export interface KbWikiDeps { vaultPath: string; sqlitePath: string }

interface IngestBody {
  accounts?: string[];
  per_account_limit?: number;
  batch_size?: number;
  mode?: IngestMode;
  since?: string;
  until?: string;
  cli_model?: { cli: "claude" | "codex"; model?: string };
}

function countAccount(sqlitePath: string, account: string): number {
  if (!existsSync(sqlitePath)) return 0;
  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ref_articles WHERE account = ?`).get(account) as { c: number };
    return row.c;
  } finally { db.close(); }
}

export function registerKbWikiRoutes(app: FastifyInstance, deps: KbWikiDeps) {
  app.post<{ Body: IngestBody }>("/api/kb/wiki/ingest", async (req, reply) => {
    const body = req.body ?? {};
    const accounts = body.accounts ?? [];
    if (!Array.isArray(accounts) || accounts.length === 0) {
      return reply.code(400).send({ error: "accounts must be a non-empty array" });
    }
    const perAccountLimit = body.per_account_limit ?? 50;
    if (!Number.isInteger(perAccountLimit) || perAccountLimit < 1 || perAccountLimit > 500) {
      return reply.code(400).send({ error: "per_account_limit must be integer in [1, 500]" });
    }
    const batchSize = body.batch_size ?? 5;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 20) {
      return reply.code(400).send({ error: "batch_size must be integer in [1, 20]" });
    }
    const mode: IngestMode = body.mode ?? "full";
    if (mode !== "full" && mode !== "incremental") {
      return reply.code(400).send({ error: `invalid mode: ${mode}` });
    }
    for (const a of accounts) {
      if (countAccount(deps.sqlitePath, a) === 0) {
        return reply.code(404).send({ error: `account not found: ${a}` });
      }
    }

    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.hijack();

    const send = (type: string, data: Record<string, unknown>) => {
      reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const onEvent = (ev: IngestStepEvent) => {
      send(`ingest.${ev.type}`, {
        account: ev.account, batchIndex: ev.batchIndex, totalBatches: ev.totalBatches,
        op: ev.op, path: ev.path, duration_ms: ev.duration_ms, stats: ev.stats, error: ev.error,
      });
    };

    try {
      const result = await runIngest({
        accounts, perAccountLimit, batchSize, mode,
        since: body.since, until: body.until, cliModel: body.cli_model, onEvent,
      }, { vaultPath: deps.vaultPath, sqlitePath: deps.sqlitePath });
      send("ingest.result", result as unknown as Record<string, unknown>);
    } catch (err) {
      send("ingest.error", { error: (err as Error).message });
    } finally {
      reply.raw.end();
    }
  });

  app.get<{ Querystring: { kind?: string } }>("/api/kb/wiki/pages", async (req, reply) => {
    const { WikiStore } = await import("@crossing/kb");
    const store = new WikiStore(deps.vaultPath);
    const pages = store.listPages();
    const kind = req.query.kind;
    const out = pages
      .filter((p) => (kind ? p.frontmatter.type === kind : true))
      .map((p) => ({
        path: p.path,
        kind: p.frontmatter.type,
        title: p.frontmatter.title,
        aliases: p.frontmatter.aliases ?? [],
        sources_count: (p.frontmatter.sources ?? []).length,
        backlinks_count: (p.frontmatter.backlinks ?? []).length,
        last_ingest: p.frontmatter.last_ingest,
      }));
    return reply.send(out);
  });

  app.get<{ Params: { "*": string } }>("/api/kb/wiki/pages/*", async (req, reply) => {
    const rel = (req.params as { "*": string })["*"];
    if (!rel || rel.includes("..")) return reply.code(400).send({ error: "invalid path" });
    const { WikiStore } = await import("@crossing/kb");
    const store = new WikiStore(deps.vaultPath);
    let abs: string;
    try { abs = store.absPath(rel); } catch { return reply.code(400).send({ error: "invalid path" }); }
    const { existsSync, readFileSync } = await import("node:fs");
    if (!existsSync(abs)) return reply.code(404).send({ error: "not found" });
    reply.header("Content-Type", "text/markdown; charset=utf-8");
    return reply.send(readFileSync(abs, "utf-8"));
  });
}
