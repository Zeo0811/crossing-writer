import type { FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { existsSync } from "node:fs";

export interface KbWikiRunsDeps {
  sqlitePath: string;
}

export function registerKbWikiRunsRoutes(app: FastifyInstance, deps: KbWikiRunsDeps) {
  app.get<{ Querystring: { limit?: string; status?: string; since?: string; until?: string } }>(
    "/api/kb/wiki/runs",
    async (req, reply) => {
      if (!existsSync(deps.sqlitePath)) return reply.send([]);
      const { listRuns } = await import("@crossing/kb");
      const db = new Database(deps.sqlitePath, { readonly: true, fileMustExist: true });
      try {
        const hasTable = db.prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='wiki_ingest_runs'`,
        ).get();
        if (!hasTable) return reply.send([]);
        const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 500);
        const status = req.query.status as ("running" | "done" | "error" | "cancelled" | undefined);
        const runs = listRuns(db, { limit, status, since: req.query.since, until: req.query.until });
        return reply.send(runs);
      } finally { db.close(); }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/kb/wiki/runs/:id",
    async (req, reply) => {
      if (!existsSync(deps.sqlitePath)) return reply.code(404).send({ error: "not found" });
      const { getRun } = await import("@crossing/kb");
      const db = new Database(deps.sqlitePath, { readonly: true, fileMustExist: true });
      try {
        const hasTable = db.prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='wiki_ingest_runs'`,
        ).get();
        if (!hasTable) return reply.code(404).send({ error: "not found" });
        const run = getRun(db, req.params.id);
        if (!run) return reply.code(404).send({ error: "not found" });
        return reply.send(run);
      } finally { db.close(); }
    },
  );
}
