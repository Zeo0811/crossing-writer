import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";

export interface KbAccountsDeps {
  sqlitePath: string;
}

export interface AccountRow {
  account: string;
  count: number;
  ingested_count: number;
  earliest_published_at: string;
  latest_published_at: string;
}

export interface ArticleRow {
  id: string;
  title: string;
  published_at: string;
  ingest_status: string;
  word_count: number | null;
}

export function registerKbAccountsRoutes(app: FastifyInstance, deps: KbAccountsDeps) {
  app.get("/api/kb/accounts", async (_req, reply) => {
    if (!existsSync(deps.sqlitePath)) return reply.send([]);
    const db = new Database(deps.sqlitePath, { readonly: true, fileMustExist: true });
    try {
      const rows = db.prepare(
        `SELECT account,
                COUNT(*) AS count,
                SUM(CASE WHEN ingest_status NOT IN ('raw','tag_failed') THEN 1 ELSE 0 END) AS ingested_count,
                MIN(published_at) AS earliest_published_at,
                MAX(published_at) AS latest_published_at
         FROM ref_articles GROUP BY account ORDER BY count DESC`,
      ).all() as AccountRow[];
      return reply.send(rows);
    } finally {
      db.close();
    }
  });

  app.get<{ Params: { account: string }; Querystring: { limit?: string } }>(
    "/api/kb/accounts/:account/articles",
    async (req, reply) => {
      if (!existsSync(deps.sqlitePath)) return reply.send([]);
      const db = new Database(deps.sqlitePath, { readonly: true, fileMustExist: true });
      try {
        const limit = Math.min(Number(req.query.limit) || 2000, 5000);
        const rows = db.prepare(
          `SELECT id, title, published_at, ingest_status, word_count
           FROM ref_articles WHERE account = ? ORDER BY published_at DESC LIMIT ?`,
        ).all(req.params.account, limit) as ArticleRow[];
        return reply.send(rows);
      } finally {
        db.close();
      }
    },
  );
}
