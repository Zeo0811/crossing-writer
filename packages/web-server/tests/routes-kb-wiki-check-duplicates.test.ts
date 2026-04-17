import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { ensureSchema, upsertMark } from "@crossing/kb";
import { registerKbWikiRoutes } from "../src/routes/kb-wiki.js";

async function mk() {
  const vault = mkdtempSync(join(tmpdir(), "cd-"));
  const sqlitePath = join(vault, "refs.sqlite");
  const db = new Database(sqlitePath);
  ensureSchema(db);
  upsertMark(db, { articleId: "a1", runId: "r1", now: "2026-04-17T10:00:00Z" });
  upsertMark(db, { articleId: "a2", runId: "r1", now: "2026-04-17T10:00:00Z" });
  db.close();
  const app = Fastify();
  registerKbWikiRoutes(app, { vaultPath: vault, sqlitePath });
  await app.ready();
  return { app };
}

describe("POST /api/kb/wiki/check-duplicates", () => {
  it("splits article ids into already_ingested vs fresh", async () => {
    const { app } = await mk();
    const res = await app.inject({
      method: "POST", url: "/api/kb/wiki/check-duplicates",
      payload: { article_ids: ["a1", "a2", "a3", "a4"] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { already_ingested: Array<{ article_id: string; first_ingested_at: string; last_ingested_at: string; last_run_id: string }>; fresh: string[] };
    expect(body.already_ingested.map((x) => x.article_id).sort()).toEqual(["a1", "a2"]);
    expect(body.fresh.sort()).toEqual(["a3", "a4"]);
    expect(body.already_ingested[0].first_ingested_at).toBe("2026-04-17T10:00:00Z");
    await app.close();
  });

  it("returns empty already_ingested when no ids match", async () => {
    const { app } = await mk();
    const res = await app.inject({
      method: "POST", url: "/api/kb/wiki/check-duplicates",
      payload: { article_ids: ["x", "y"] },
    });
    const body = res.json() as { already_ingested: unknown[]; fresh: string[] };
    expect(body.already_ingested).toEqual([]);
    expect(body.fresh).toEqual(["x", "y"]);
    await app.close();
  });

  it("returns 400 when article_ids missing or empty", async () => {
    const { app } = await mk();
    const res = await app.inject({
      method: "POST", url: "/api/kb/wiki/check-duplicates",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("treats missing db as all fresh", async () => {
    const vault = mkdtempSync(join(tmpdir(), "cdn-"));
    const sqlitePath = join(vault, "never.sqlite");
    const app = Fastify();
    registerKbWikiRoutes(app, { vaultPath: vault, sqlitePath });
    await app.ready();
    const res = await app.inject({
      method: "POST", url: "/api/kb/wiki/check-duplicates",
      payload: { article_ids: ["a1"] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { fresh: string[]; already_ingested: unknown[] };
    expect(body.fresh).toEqual(["a1"]);
    expect(body.already_ingested).toEqual([]);
    await app.close();
  });

  it("treats missing marks table as all fresh (db exists but schema not applied)", async () => {
    const vault = mkdtempSync(join(tmpdir(), "cdns-"));
    const sqlitePath = join(vault, "refs.sqlite");
    // Create sqlite file but DON'T run ensureSchema
    const db = new Database(sqlitePath);
    db.exec(`CREATE TABLE ref_articles (id TEXT PRIMARY KEY);`);
    db.close();
    const app = Fastify();
    registerKbWikiRoutes(app, { vaultPath: vault, sqlitePath });
    await app.ready();
    const res = await app.inject({
      method: "POST", url: "/api/kb/wiki/check-duplicates",
      payload: { article_ids: ["a1"] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ already_ingested: [], fresh: ["a1"] });
    await app.close();
  });
});
