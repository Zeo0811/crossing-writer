import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { ensureSchema, createRun, finishRun, appendRunOp } from "@crossing/kb";
import { registerKbWikiRunsRoutes } from "../src/routes/kb-wiki-runs.js";

let sqlitePath: string;
let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "runs-"));
  sqlitePath = join(dir, "refs.sqlite");
  const db = new Database(sqlitePath);
  ensureSchema(db);
  createRun(db, { runId: "r1", startedAt: "2026-04-17T10:00:00Z", accounts: ["acc"], articleIds: ["a1"], mode: "selected", model: "x" });
  appendRunOp(db, { runId: "r1", seq: 0, op: "upsert", path: "entities/A.md", articleId: "a1", createdPage: true });
  finishRun(db, { runId: "r1", finishedAt: "2026-04-17T10:05:00Z", status: "done", stats: { pages_created: 1 } });
  createRun(db, { runId: "r2", startedAt: "2026-04-17T11:00:00Z", accounts: [], articleIds: [], mode: "full", model: "y" });
  finishRun(db, { runId: "r2", finishedAt: "2026-04-17T11:01:00Z", status: "error", error: "boom" });
  db.close();
  app = Fastify();
  registerKbWikiRunsRoutes(app, { sqlitePath });
  await app.ready();
});

describe("GET /api/kb/wiki/runs", () => {
  it("lists runs newest first", async () => {
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/runs?limit=10" });
    expect(res.statusCode).toBe(200);
    const runs = res.json() as Array<{ id: string; status: string }>;
    expect(runs.map((r) => r.id)).toEqual(["r2", "r1"]);
    await app.close();
  });

  it("filters by status", async () => {
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/runs?status=error" });
    const runs = res.json() as Array<{ id: string }>;
    expect(runs.map((r) => r.id)).toEqual(["r2"]);
    await app.close();
  });

  it("returns empty array when sqlite missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rns-"));
    const app2 = Fastify();
    registerKbWikiRunsRoutes(app2, { sqlitePath: join(dir, "never.sqlite") });
    await app2.ready();
    const res = await app2.inject({ method: "GET", url: "/api/kb/wiki/runs" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app2.close();
  });

  it("returns empty array when runs table missing (db exists but no schema)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rns-"));
    const p = join(dir, "refs.sqlite");
    const db = new Database(p);
    db.exec("CREATE TABLE ref_articles (id TEXT PRIMARY KEY)");
    db.close();
    const app2 = Fastify();
    registerKbWikiRunsRoutes(app2, { sqlitePath: p });
    await app2.ready();
    const res = await app2.inject({ method: "GET", url: "/api/kb/wiki/runs" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app2.close();
  });
});

describe("GET /api/kb/wiki/runs/:id", () => {
  it("returns run + ops", async () => {
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/runs/r1" });
    expect(res.statusCode).toBe(200);
    const run = res.json() as { id: string; ops: Array<{ op: string; path: string }> };
    expect(run.id).toBe("r1");
    expect(run.ops).toHaveLength(1);
    expect(run.ops[0]).toMatchObject({ op: "upsert", path: "entities/A.md" });
    await app.close();
  });

  it("returns 404 for missing run", async () => {
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/runs/nope" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
