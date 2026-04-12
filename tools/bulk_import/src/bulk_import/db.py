from __future__ import annotations
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from datetime import datetime, timezone
import json
from typing import Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS ref_articles (
  id               TEXT PRIMARY KEY,
  account          TEXT NOT NULL,
  title            TEXT NOT NULL,
  author           TEXT,
  published_at     TEXT NOT NULL,
  is_original      INTEGER NOT NULL DEFAULT 0,
  position         INTEGER,
  url              TEXT NOT NULL UNIQUE,
  cover            TEXT,
  summary          TEXT,
  word_count       INTEGER,
  md_path          TEXT NOT NULL,
  html_path        TEXT NOT NULL,
  body_plain       TEXT,
  body_segmented   TEXT,
  topics_core_json TEXT,
  topics_fine_json TEXT,
  ingest_status    TEXT NOT NULL DEFAULT 'raw',
  content_hash     TEXT,
  imported_at      TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_refs_account       ON ref_articles(account);
CREATE INDEX IF NOT EXISTS idx_refs_published_at  ON ref_articles(published_at);
CREATE INDEX IF NOT EXISTS idx_refs_ingest_status ON ref_articles(ingest_status);

CREATE VIRTUAL TABLE IF NOT EXISTS ref_articles_fts USING fts5(
  title, summary, body_segmented,
  content='ref_articles',
  content_rowid='rowid',
  tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS ref_articles_ai AFTER INSERT ON ref_articles BEGIN
  INSERT INTO ref_articles_fts(rowid, title, summary, body_segmented)
  VALUES (new.rowid, new.title, new.summary, new.body_segmented);
END;
CREATE TRIGGER IF NOT EXISTS ref_articles_ad AFTER DELETE ON ref_articles BEGIN
  INSERT INTO ref_articles_fts(ref_articles_fts, rowid, title, summary, body_segmented)
  VALUES ('delete', old.rowid, old.title, old.summary, old.body_segmented);
END;
CREATE TRIGGER IF NOT EXISTS ref_articles_au AFTER UPDATE ON ref_articles BEGIN
  INSERT INTO ref_articles_fts(ref_articles_fts, rowid, title, summary, body_segmented)
  VALUES ('delete', old.rowid, old.title, old.summary, old.body_segmented);
  INSERT INTO ref_articles_fts(rowid, title, summary, body_segmented)
  VALUES (new.rowid, new.title, new.summary, new.body_segmented);
END;

CREATE TABLE IF NOT EXISTS ingest_issues (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  account    TEXT,
  xlsx_row   INTEGER,
  html_path  TEXT,
  error_kind TEXT NOT NULL,
  message    TEXT,
  created_at TEXT NOT NULL
);
"""

@dataclass
class Article:
    id: str
    account: str
    title: str
    author: Optional[str]
    published_at: str
    is_original: bool
    position: Optional[int]
    url: str
    cover: Optional[str]
    summary: Optional[str]
    word_count: Optional[int]
    md_path: str
    html_path: str
    body_plain: str
    body_segmented: str
    topics_core: Optional[list]
    topics_fine: Optional[list]
    ingest_status: str
    content_hash: str

def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")

def _connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(path))
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    return con

def init_db(path: Path) -> None:
    con = _connect(path)
    try:
        con.executescript(SCHEMA)
        con.commit()
    finally:
        con.close()

def upsert_article(path: Path, art: Article) -> None:
    con = _connect(path)
    try:
        now = _now()
        con.execute(
            """
            INSERT INTO ref_articles (
              id, account, title, author, published_at, is_original, position,
              url, cover, summary, word_count, md_path, html_path,
              body_plain, body_segmented, topics_core_json, topics_fine_json,
              ingest_status, content_hash, imported_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(url) DO UPDATE SET
              title=excluded.title, author=excluded.author,
              published_at=excluded.published_at, is_original=excluded.is_original,
              position=excluded.position, cover=excluded.cover, summary=excluded.summary,
              word_count=excluded.word_count, md_path=excluded.md_path,
              html_path=excluded.html_path, body_plain=excluded.body_plain,
              body_segmented=excluded.body_segmented,
              topics_core_json=excluded.topics_core_json,
              topics_fine_json=excluded.topics_fine_json,
              ingest_status=excluded.ingest_status, content_hash=excluded.content_hash,
              updated_at=excluded.updated_at
            """,
            (
                art.id, art.account, art.title, art.author, art.published_at,
                1 if art.is_original else 0, art.position, art.url, art.cover,
                art.summary, art.word_count, art.md_path, art.html_path,
                art.body_plain, art.body_segmented,
                json.dumps(art.topics_core, ensure_ascii=False) if art.topics_core is not None else None,
                json.dumps(art.topics_fine, ensure_ascii=False) if art.topics_fine is not None else None,
                art.ingest_status, art.content_hash, now, now,
            ),
        )
        con.commit()
    finally:
        con.close()

def get_by_url(path: Path, url: str) -> Optional[Article]:
    con = _connect(path)
    try:
        row = con.execute(
            "SELECT id,account,title,author,published_at,is_original,position,"
            "url,cover,summary,word_count,md_path,html_path,body_plain,"
            "body_segmented,topics_core_json,topics_fine_json,ingest_status,"
            "content_hash FROM ref_articles WHERE url=?", (url,)
        ).fetchone()
        if not row:
            return None
        return Article(
            id=row[0], account=row[1], title=row[2], author=row[3],
            published_at=row[4], is_original=bool(row[5]), position=row[6],
            url=row[7], cover=row[8], summary=row[9], word_count=row[10],
            md_path=row[11], html_path=row[12], body_plain=row[13],
            body_segmented=row[14],
            topics_core=json.loads(row[15]) if row[15] else None,
            topics_fine=json.loads(row[16]) if row[16] else None,
            ingest_status=row[17], content_hash=row[18],
        )
    finally:
        con.close()

def log_issue(path: Path, *, account: Optional[str], xlsx_row: Optional[int],
              html_path: Optional[str], error_kind: str, message: str) -> None:
    con = _connect(path)
    try:
        con.execute(
            "INSERT INTO ingest_issues (account, xlsx_row, html_path, error_kind, message, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (account, xlsx_row, html_path, error_kind, message, _now()),
        )
        con.commit()
    finally:
        con.close()
