import type Database from "better-sqlite3";

export function ensureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wiki_ingest_marks (
      article_id         TEXT PRIMARY KEY,
      first_ingested_at  TEXT NOT NULL,
      last_ingested_at   TEXT NOT NULL,
      ingest_count       INTEGER NOT NULL DEFAULT 1,
      last_run_id        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wiki_ingest_runs (
      id                 TEXT PRIMARY KEY,
      started_at         TEXT NOT NULL,
      finished_at        TEXT,
      status             TEXT NOT NULL,
      accounts           TEXT NOT NULL,
      article_ids        TEXT NOT NULL,
      mode               TEXT NOT NULL,
      model              TEXT NOT NULL,
      pages_created      INTEGER DEFAULT 0,
      pages_updated      INTEGER DEFAULT 0,
      sources_appended   INTEGER DEFAULT 0,
      images_appended    INTEGER DEFAULT 0,
      conflict_count     INTEGER DEFAULT 0,
      skipped_count      INTEGER DEFAULT 0,
      error              TEXT
    );

    CREATE TABLE IF NOT EXISTS wiki_ingest_run_ops (
      run_id        TEXT NOT NULL,
      seq           INTEGER NOT NULL,
      op            TEXT NOT NULL,
      path          TEXT,
      article_id    TEXT,
      created_page  INTEGER DEFAULT 0,
      conflict      INTEGER DEFAULT 0,
      error         TEXT,
      PRIMARY KEY (run_id, seq)
    );

    CREATE INDEX IF NOT EXISTS idx_wiki_ingest_runs_started_at ON wiki_ingest_runs(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wiki_ingest_run_ops_run_id ON wiki_ingest_run_ops(run_id);
  `);
}
