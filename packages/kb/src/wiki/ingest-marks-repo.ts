import type Database from "better-sqlite3";

export interface MarkRow {
  article_id: string;
  first_ingested_at: string;
  last_ingested_at: string;
  ingest_count: number;
  last_run_id: string;
}

export interface UpsertMarkInput {
  articleId: string;
  runId: string;
  now: string;
}

export function upsertMark(db: Database.Database, input: UpsertMarkInput): void {
  db.prepare(
    `INSERT INTO wiki_ingest_marks (article_id, first_ingested_at, last_ingested_at, ingest_count, last_run_id)
     VALUES (@id, @now, @now, 1, @run)
     ON CONFLICT(article_id) DO UPDATE SET
       last_ingested_at = @now,
       ingest_count = ingest_count + 1,
       last_run_id = @run`,
  ).run({ id: input.articleId, now: input.now, run: input.runId });
}

export function listMarks(db: Database.Database, articleIds: string[]): MarkRow[] {
  if (articleIds.length === 0) return [];
  const placeholders = articleIds.map(() => "?").join(",");
  return db
    .prepare(`SELECT * FROM wiki_ingest_marks WHERE article_id IN (${placeholders})`)
    .all(...articleIds) as MarkRow[];
}

export function filterAlreadyIngested(
  db: Database.Database,
  articleIds: string[],
): { alreadyIngested: string[]; fresh: string[] } {
  if (articleIds.length === 0) return { alreadyIngested: [], fresh: [] };
  const existing = new Set(listMarks(db, articleIds).map((m) => m.article_id));
  const alreadyIngested: string[] = [];
  const fresh: string[] = [];
  for (const id of articleIds) {
    (existing.has(id) ? alreadyIngested : fresh).push(id);
  }
  return { alreadyIngested, fresh };
}
