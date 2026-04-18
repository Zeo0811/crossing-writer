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

// An article counts as "ingested" if either:
//  - the legacy ref_articles.ingest_status moved past raw/tag_failed, OR
//  - the wiki ingestor left a row in wiki_ingest_marks (new flow)
// Both paths contribute, so the heatmap and the sidebar count stay in
// sync with reality regardless of which ingestor touched the article.
const HAS_MARKS_TABLE_SQL = `SELECT 1 FROM sqlite_master WHERE type='table' AND name='wiki_ingest_marks'`;

export function registerKbAccountsRoutes(app: FastifyInstance, deps: KbAccountsDeps) {
  app.get("/api/kb/accounts", async (_req, reply) => {
    if (!existsSync(deps.sqlitePath)) return reply.send([]);
    const db = new Database(deps.sqlitePath, { readonly: true, fileMustExist: true });
    try {
      const hasMarks = !!db.prepare(HAS_MARKS_TABLE_SQL).get();
      const ingestedExpr = hasMarks
        ? `CASE
             WHEN ingest_status NOT IN ('raw','tag_failed') THEN 1
             WHEN EXISTS (SELECT 1 FROM wiki_ingest_marks m WHERE m.article_id = ref_articles.id) THEN 1
             ELSE 0
           END`
        : `CASE WHEN ingest_status NOT IN ('raw','tag_failed') THEN 1 ELSE 0 END`;
      const rows = db.prepare(
        `SELECT account,
                COUNT(*) AS count,
                SUM(${ingestedExpr}) AS ingested_count,
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
        const hasMarks = !!db.prepare(HAS_MARKS_TABLE_SQL).get();
        const limit = Math.min(Number(req.query.limit) || 2000, 5000);
        // Left-join marks and promote the status string so the client can
        // keep treating anything outside {raw, tag_failed} as ingested.
        const rows = db.prepare(
          hasMarks
            ? `SELECT r.id, r.title, r.published_at,
                      CASE WHEN m.article_id IS NOT NULL
                           AND r.ingest_status IN ('raw','tag_failed')
                           THEN 'wiki_marked'
                           ELSE r.ingest_status
                      END AS ingest_status,
                      r.word_count
               FROM ref_articles r
               LEFT JOIN wiki_ingest_marks m ON m.article_id = r.id
               WHERE r.account = ? ORDER BY r.published_at DESC LIMIT ?`
            : `SELECT id, title, published_at, ingest_status, word_count
               FROM ref_articles WHERE account = ? ORDER BY published_at DESC LIMIT ?`,
        ).all(req.params.account, limit) as ArticleRow[];
        return reply.send(rows);
      } finally {
        db.close();
      }
    },
  );
}
