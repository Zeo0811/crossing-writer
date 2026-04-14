import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";

export interface KbAccountsDeps {
  sqlitePath: string;
}

export interface AccountRow {
  account: string;
  count: number;
  earliest_published_at: string;
  latest_published_at: string;
}

export function registerKbAccountsRoutes(app: FastifyInstance, deps: KbAccountsDeps) {
  app.get("/api/kb/accounts", async (_req, reply) => {
    if (!existsSync(deps.sqlitePath)) return reply.send([]);
    const db = new Database(deps.sqlitePath, { readonly: true, fileMustExist: true });
    try {
      const rows = db.prepare(
        `SELECT account, COUNT(*) AS count, MIN(published_at) AS earliest_published_at, MAX(published_at) AS latest_published_at
         FROM ref_articles GROUP BY account ORDER BY count DESC`,
      ).all() as AccountRow[];
      return reply.send(rows);
    } finally {
      db.close();
    }
  });
}
