import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { registerKbRawArticlesRoutes } from "../src/routes/kb-raw-articles.js";

function makeSqlite(dir: string) {
  const p = join(dir, "refs.sqlite");
  const db = new Database(p);
  db.exec(`
    CREATE TABLE ref_articles (
      id TEXT PRIMARY KEY,
      account TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT,
      published_at TEXT NOT NULL,
      url TEXT,
      summary TEXT,
      word_count INTEGER,
      body_plain TEXT,
      md_path TEXT,
      html_path TEXT,
      ingest_status TEXT DEFAULT 'raw'
    );
  `);
  db.prepare(`INSERT INTO ref_articles (id, account, title, published_at, url, body_plain, md_path, word_count)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    "abc123", "测试账号", "一篇文章", "2026-04-15",
    "https://mp.example.com/s/xxx",
    "这是正文内容。",
    "10_refs/测试账号/2026/2026-04-15-一篇文章-xxx.md",
    150,
  );
  db.close();
  return p;
}

async function mk() {
  const dir = mkdtempSync(join(tmpdir(), "ra-"));
  const sqlitePath = makeSqlite(dir);
  const app = Fastify();
  registerKbRawArticlesRoutes(app, { sqlitePath });
  await app.ready();
  return { app };
}

describe("GET /api/kb/raw-articles/:account/:id", () => {
  it("returns article fields", async () => {
    const { app } = await mk();
    const res = await app.inject({ method: "GET", url: "/api/kb/raw-articles/%E6%B5%8B%E8%AF%95%E8%B4%A6%E5%8F%B7/abc123" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { title: string; published_at: string; url: string; body_plain: string; word_count: number };
    expect(body.title).toBe("一篇文章");
    expect(body.url).toContain("mp.example.com");
    expect(body.body_plain).toContain("正文");
    expect(body.word_count).toBe(150);
    await app.close();
  });

  it("returns 404 for missing id", async () => {
    const { app } = await mk();
    const res = await app.inject({ method: "GET", url: "/api/kb/raw-articles/%E6%B5%8B%E8%AF%95%E8%B4%A6%E5%8F%B7/nope" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 404 when sqlite missing", async () => {
    const app = Fastify();
    registerKbRawArticlesRoutes(app, { sqlitePath: "/tmp/does-not-exist.sqlite" });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/kb/raw-articles/x/y" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
