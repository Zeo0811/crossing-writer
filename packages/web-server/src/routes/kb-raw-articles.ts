import type { FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { existsSync } from "node:fs";

export interface KbRawArticlesDeps {
  sqlitePath: string;
}

interface Row {
  id: string;
  account: string;
  title: string;
  author: string | null;
  published_at: string;
  url: string | null;
  body_plain: string | null;
  md_path: string | null;
  word_count: number | null;
}

export function registerKbRawArticlesRoutes(app: FastifyInstance, deps: KbRawArticlesDeps) {
  app.get<{ Params: { account: string; id: string } }>(
    "/api/kb/raw-articles/:account/:id",
    async (req, reply) => {
      if (!existsSync(deps.sqlitePath)) return reply.code(404).send({ error: "db missing" });
      const db = new Database(deps.sqlitePath, { readonly: true, fileMustExist: true });
      try {
        const row = db.prepare(
          `SELECT id, account, title, author, published_at, url, body_plain, md_path, word_count
           FROM ref_articles WHERE account = ? AND id = ? LIMIT 1`,
        ).get(req.params.account, req.params.id) as Row | undefined;
        if (!row) return reply.code(404).send({ error: "not found" });
        return reply.send({
          id: row.id,
          account: row.account,
          title: row.title,
          author: row.author,
          published_at: row.published_at,
          url: row.url,
          body_plain: row.body_plain ?? "",
          md_path: row.md_path,
          word_count: row.word_count,
        });
      } finally {
        db.close();
      }
    },
  );
}
