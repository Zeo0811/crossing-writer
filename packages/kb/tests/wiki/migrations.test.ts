import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSchema } from "../../src/wiki/migrations.js";

function mkdb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), "mig-"));
  const db = new Database(join(dir, "refs.sqlite"));
  db.exec(`CREATE TABLE ref_articles (id TEXT PRIMARY KEY, account TEXT, title TEXT, published_at TEXT);`);
  return db;
}

describe("ensureSchema", () => {
  it("creates the three wiki_ingest tables", () => {
    const db = mkdb();
    ensureSchema(db);
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'wiki_ingest_%' ORDER BY name`
    ).all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toEqual([
      "wiki_ingest_marks",
      "wiki_ingest_run_ops",
      "wiki_ingest_runs",
    ]);
  });

  it("is idempotent (safe to call twice)", () => {
    const db = mkdb();
    ensureSchema(db);
    expect(() => ensureSchema(db)).not.toThrow();
  });

  it("marks table has expected columns", () => {
    const db = mkdb();
    ensureSchema(db);
    const cols = db.prepare(`PRAGMA table_info(wiki_ingest_marks)`).all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name).sort()).toEqual([
      "article_id", "first_ingested_at", "ingest_count", "last_ingested_at", "last_run_id",
    ]);
  });

  it("runs table has expected columns", () => {
    const db = mkdb();
    ensureSchema(db);
    const cols = db.prepare(`PRAGMA table_info(wiki_ingest_runs)`).all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name).sort()).toEqual([
      "accounts", "article_ids", "conflict_count", "error", "finished_at",
      "id", "images_appended", "mode", "model", "pages_created", "pages_updated",
      "skipped_count", "sources_appended", "started_at", "status",
    ]);
  });

  it("run_ops table has expected columns + compound PK", () => {
    const db = mkdb();
    ensureSchema(db);
    const cols = db.prepare(`PRAGMA table_info(wiki_ingest_run_ops)`).all() as Array<{ name: string; pk: number }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual([
      "article_id", "conflict", "created_page", "error", "op", "path", "run_id", "seq",
    ]);
    const pk = cols.filter((c) => c.pk > 0).map((c) => c.name).sort();
    expect(pk).toEqual(["run_id", "seq"]);
  });
});
