import { it, expect } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "kb-cli-"));
  const sqlitePath = join(dir, "refs.sqlite");
  const configPath = join(dir, "config.json");
  writeFileSync(configPath, JSON.stringify({
    vaultPath: dir, sqlitePath,
    importSources: { xlsxDir: "", htmlDir: "" },
    modelAdapter: { defaultCli: "claude", fallbackCli: "codex" },
  }));
  const db = new Database(sqlitePath);
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
      ('1','量子位','Claude Code 实测',NULL,'2025-06-01',1,1,'u1',NULL,NULL,
       100,'a.md','a.html','claude code','claude code','[]','[]','raw','h',
       '2026-01-01','2026-01-01');
    INSERT INTO ref_articles_fts(rowid,title,summary,body_segmented)
      SELECT rowid,title,summary,body_segmented FROM ref_articles;
  `);
  db.close();
  return { dir, configPath };
}

it("CLI returns JSON when --json", () => {
  const { configPath } = setup();
  const binPath = join(process.cwd(), "bin/crossing-kb");
  const out = execSync(
    `node ${binPath} search claude --config ${configPath} --json`,
    { encoding: "utf-8" }
  );
  const parsed = JSON.parse(out);
  expect(parsed).toHaveLength(1);
  expect(parsed[0].title).toBe("Claude Code 实测");
});
