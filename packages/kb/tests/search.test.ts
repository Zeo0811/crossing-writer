import { describe, it, expect, beforeAll } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchRefs } from "../src/search.js";

let dir: string;
let dbPath: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "kb-test-"));
  dbPath = join(dir, "refs.sqlite");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE ref_articles (
      id TEXT PRIMARY KEY, account TEXT, title TEXT, author TEXT,
      published_at TEXT, is_original INTEGER, position INTEGER, url TEXT UNIQUE,
      cover TEXT, summary TEXT, word_count INTEGER, md_path TEXT, html_path TEXT,
      body_plain TEXT, body_segmented TEXT, topics_core_json TEXT,
      topics_fine_json TEXT, ingest_status TEXT, content_hash TEXT,
      imported_at TEXT, updated_at TEXT
    );
    CREATE VIRTUAL TABLE ref_articles_fts USING fts5(
      title, summary, body_segmented,
      content='ref_articles', content_rowid='rowid', tokenize='unicode61'
    );
    INSERT INTO ref_articles VALUES
      ('1','量子位','Claude Code 实测','A','2025-06-01',1,1,'u1','c','s1',
       100,'量子位/2025/a.md','量子位/2025/a.html','claude code 很强',
       'claude code 很 强','[]','[]','raw','h','2026-01-01','2026-01-01'),
      ('2','智东西','Agent 产品评测','B','2025-07-10',0,2,'u2','c','s2',
       200,'智东西/2025/b.md','智东西/2025/b.html','agent 测评',
       'agent 测评','[]','[]','raw','h','2026-01-01','2026-01-01');
    INSERT INTO ref_articles_fts(rowid,title,summary,body_segmented)
      SELECT rowid,title,summary,body_segmented FROM ref_articles;
  `);
  db.close();
});

it("searches by query", () => {
  const results = searchRefs({ sqlitePath: dbPath, vaultPath: "/vault" }, { query: "claude" });
  expect(results.length).toBe(1);
  expect(results[0].title).toBe("Claude Code 实测");
  expect(results[0].mdPath).toBe("/vault/量子位/2025/a.md");
});

it("filters by account", () => {
  const results = searchRefs({ sqlitePath: dbPath, vaultPath: "/vault" }, { account: "智东西" });
  expect(results.length).toBe(1);
  expect(results[0].account).toBe("智东西");
});

it("filters by date range", () => {
  const results = searchRefs({ sqlitePath: dbPath, vaultPath: "/vault" },
    { dateFrom: "2025-07-01" });
  expect(results.length).toBe(1);
  expect(results[0].account).toBe("智东西");
});

it("returns empty for no match", () => {
  const results = searchRefs({ sqlitePath: dbPath, vaultPath: "/vault" }, { query: "notexist" });
  expect(results).toEqual([]);
});

it("respects limit", () => {
  const results = searchRefs({ sqlitePath: dbPath, vaultPath: "/vault" }, { limit: 1 });
  expect(results.length).toBe(1);
});
