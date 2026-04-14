import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchRaw } from "../src/skills/search-raw.js";

let tmp: string;
let dbPath: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "sp08-raw-"));
  dbPath = join(tmp, "refs.sqlite");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE ref_articles (
      id TEXT PRIMARY KEY,
      account TEXT,
      title TEXT,
      published_at TEXT,
      body_segmented TEXT
    );
    CREATE VIRTUAL TABLE ref_articles_fts USING fts5(
      title, account, body_segmented, content='ref_articles', content_rowid='rowid'
    );
    CREATE TRIGGER ref_articles_ai AFTER INSERT ON ref_articles BEGIN
      INSERT INTO ref_articles_fts(rowid, title, account, body_segmented)
        VALUES (new.rowid, new.title, new.account, new.body_segmented);
    END;
  `);
  db.prepare("INSERT INTO ref_articles (id,account,title,published_at,body_segmented) VALUES (?,?,?,?,?)")
    .run("a1", "十字路口Crossing", "AI 漫剧爆了", "2026-04-08", "AI 漫剧 PixVerse 分镜 生成效果非常好");
  db.prepare("INSERT INTO ref_articles (id,account,title,published_at,body_segmented) VALUES (?,?,?,?,?)")
    .run("a2", "赛博禅心", "Sora 炸裂", "2026-04-10", "Sora 视频 模型 现象 级");
  db.close();
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("searchRaw", () => {
  it("returns hits for matching query", () => {
    const hits = searchRaw({ query: "漫剧" }, { sqlitePath: dbPath });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.article_id).toBe("a1");
    expect(hits[0]!.account).toBe("十字路口Crossing");
    expect(hits[0]!.snippet).toContain("<b>");
  });

  it("filters by account", () => {
    const hits = searchRaw({ query: "模型", account: "赛博禅心" }, { sqlitePath: dbPath });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.account).toBe("赛博禅心");
  });

  it("returns empty when no match", () => {
    const hits = searchRaw({ query: "不存在的词xyz" }, { sqlitePath: dbPath });
    expect(hits).toEqual([]);
  });

  it("returns [] when sqlite file missing", () => {
    const hits = searchRaw({ query: "任意" }, { sqlitePath: "/tmp/does-not-exist.sqlite" });
    expect(hits).toEqual([]);
  });

  it("respects limit", () => {
    const hits = searchRaw({ query: "漫剧 OR 模型", limit: 1 }, { sqlitePath: dbPath });
    expect(hits.length).toBeLessThanOrEqual(1);
  });
});
