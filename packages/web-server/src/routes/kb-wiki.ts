import type { FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { runIngest, type IngestMode, type IngestStepEvent } from "@crossing/kb";

export interface KbWikiDeps { vaultPath: string; sqlitePath: string }

interface IngestBody {
  accounts?: string[];
  article_ids?: string[];
  per_account_limit?: number;
  batch_size?: number;
  mode?: IngestMode;
  since?: string;
  until?: string;
  cli_model?: { cli: "claude" | "codex"; model?: string };
  max_articles?: number;
  force_reingest?: boolean;
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
    const articleIds = body.article_ids ?? [];
    const forceReingest = body.force_reingest ?? false;
    const mode: IngestMode = body.mode ?? "full";

    // Mode check
    if (mode !== "full" && mode !== "incremental" && mode !== "selected") {
      return reply.code(400).send({ error: `invalid mode: ${mode}` });
    }

    // Cross-field validation
    if (articleIds.length > 0 && mode !== "selected") {
      return reply.code(400).send({ error: "article_ids implies mode=selected" });
    }
    if (mode === "selected" && articleIds.length === 0) {
      return reply.code(400).send({ error: "article_ids required for mode=selected" });
    }

    // Accounts required for non-selected modes
    if (mode !== "selected" && accounts.length === 0) {
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
    const maxArticles = body.max_articles ?? 50;
    if (!Number.isInteger(maxArticles) || maxArticles < 1 || maxArticles > 500) {
      return reply.code(400).send({ error: "max_articles must be integer in [1, 500]" });
    }

    // Project count check (before expensive DB scans)
    const projectedCount = mode === "selected" ? articleIds.length : accounts.length * perAccountLimit;
    if (projectedCount > maxArticles) {
      return reply.code(413).send({
        error: `max_articles exceeded: cap=${maxArticles} projected=${projectedCount}`,
        cap: maxArticles, projected: projectedCount,
      });
    }

    // Account existence check (only for non-selected modes)
    if (mode !== "selected") {
      for (const a of accounts) {
        if (countAccount(deps.sqlitePath, a) === 0) {
          return reply.code(404).send({ error: `account not found: ${a}` });
        }
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
        runId: ev.runId, account: ev.account, articleId: ev.articleId,
        batchIndex: ev.batchIndex, totalBatches: ev.totalBatches,
        op: ev.op, path: ev.path, duration_ms: ev.duration_ms, stats: ev.stats, error: ev.error,
      });
    };

    try {
      const result = await runIngest({
        accounts, articleIds, perAccountLimit, batchSize, mode,
        since: body.since, until: body.until,
        cliModel: body.cli_model,
        maxArticles, forceReingest,
        onEvent,
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

  app.get<{ Params: { "*": string }; Querystring: { meta?: string } }>(
    "/api/kb/wiki/pages/*",
    async (req, reply) => {
      const rel = (req.params as { "*": string })["*"];
      if (!rel || rel.includes("..")) return reply.code(400).send({ error: "invalid path" });
      const { WikiStore, parseFrontmatter } = await import("@crossing/kb");
      const store = new WikiStore(deps.vaultPath);
      let abs: string;
      try { abs = store.absPath(rel); } catch { return reply.code(400).send({ error: "invalid path" }); }
      const { existsSync, readFileSync } = await import("node:fs");
      if (!existsSync(abs)) return reply.code(404).send({ error: "not found" });
      const text = readFileSync(abs, "utf-8");
      if (req.query.meta === "1") {
        const { frontmatter, body } = parseFrontmatter(text);
        return reply.send({ frontmatter, body });
      }
      reply.header("Content-Type", "text/markdown; charset=utf-8");
      return reply.send(text);
    },
  );

  app.get("/api/kb/wiki/index.json", async (_req, reply) => {
    const { WikiStore } = await import("@crossing/kb");
    const store = new WikiStore(deps.vaultPath);
    const pages = store.listPages();
    const out = pages.map((p) => ({
      path: p.path,
      title: p.frontmatter.title ?? "",
      aliases: p.frontmatter.aliases ?? [],
    }));
    reply.header("Cache-Control", "public, max-age=60");
    return reply.send(out);
  });

  app.get<{ Querystring: { q?: string; kind?: string; limit?: string } }>("/api/kb/wiki/search", async (req, reply) => {
    const q = (req.query.q ?? "").trim();
    if (!q) return reply.code(400).send({ error: "q required" });
    const kind = req.query.kind as ("entity" | "concept" | "case" | "observation" | "person" | undefined);
    const limit = req.query.limit ? Math.max(1, Math.min(50, Number(req.query.limit))) : 10;
    const { searchWiki } = await import("@crossing/kb");
    const results = await searchWiki({ query: q, kind, limit }, { vaultPath: deps.vaultPath });
    return reply.send(results);
  });

  app.get("/api/kb/wiki/status", async (_req, reply) => {
    const { WikiStore } = await import("@crossing/kb");
    const store = new WikiStore(deps.vaultPath);
    const pages = store.listPages();
    const by_kind: Record<string, number> = { entity: 0, concept: 0, case: 0, observation: 0, person: 0 };
    let last: string | null = null;
    for (const p of pages) {
      by_kind[p.frontmatter.type] = (by_kind[p.frontmatter.type] ?? 0) + 1;
      const li = p.frontmatter.last_ingest;
      if (li && (!last || li > last)) last = li;
    }
    return reply.send({ total: pages.length, by_kind, last_ingest_at: last });
  });

  app.post<{ Body: { article_ids?: string[] } }>("/api/kb/wiki/check-duplicates", async (req, reply) => {
    const ids = req.body?.article_ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return reply.code(400).send({ error: "article_ids required" });
    }
    if (!existsSync(deps.sqlitePath)) {
      return reply.send({ already_ingested: [], fresh: ids });
    }
    const { listMarks } = await import("@crossing/kb");
    const db = new Database(deps.sqlitePath, { readonly: true, fileMustExist: true });
    try {
      const hasTable = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='wiki_ingest_marks'`,
      ).get();
      if (!hasTable) return reply.send({ already_ingested: [], fresh: ids });
      const marks = listMarks(db, ids);
      const markedSet = new Set(marks.map((m) => m.article_id));
      return reply.send({
        already_ingested: marks.map((m) => ({
          article_id: m.article_id,
          first_ingested_at: m.first_ingested_at,
          last_ingested_at: m.last_ingested_at,
          last_run_id: m.last_run_id,
        })),
        fresh: ids.filter((id) => !markedSet.has(id)),
      });
    } finally { db.close(); }
  });
}
