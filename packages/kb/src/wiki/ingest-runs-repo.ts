import type Database from "better-sqlite3";

export type RunStatus = "running" | "done" | "error" | "cancelled";

export interface CreateRunInput {
  runId: string;
  startedAt: string;
  accounts: string[];
  articleIds: string[];
  mode: string;
  model: string;
}

export interface FinishRunInput {
  runId: string;
  finishedAt: string;
  status: RunStatus;
  stats?: {
    pages_created?: number;
    pages_updated?: number;
    sources_appended?: number;
    images_appended?: number;
    conflict_count?: number;
    skipped_count?: number;
  };
  error?: string;
}

export interface AppendRunOpInput {
  runId: string;
  seq: number;
  op: string;
  path?: string | null;
  articleId?: string | null;
  createdPage?: boolean;
  conflict?: boolean;
  error?: string | null;
}

export interface RunOpRow {
  run_id: string;
  seq: number;
  op: string;
  path: string | null;
  article_id: string | null;
  created_page: number;
  conflict: number;
  error: string | null;
}

export interface RunSummary {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: RunStatus;
  accounts: string[];
  article_ids: string[];
  mode: string;
  model: string;
  pages_created: number;
  pages_updated: number;
  sources_appended: number;
  images_appended: number;
  conflict_count: number;
  skipped_count: number;
  error: string | null;
}

export interface RunRow extends RunSummary {
  ops: RunOpRow[];
}

export interface ListRunsInput {
  limit: number;
  status?: RunStatus;
  since?: string;
  until?: string;
}

function parseRun(row: any): RunSummary {
  return {
    id: row.id,
    started_at: row.started_at,
    finished_at: row.finished_at,
    status: row.status,
    accounts: JSON.parse(row.accounts ?? "[]"),
    article_ids: JSON.parse(row.article_ids ?? "[]"),
    mode: row.mode,
    model: row.model,
    pages_created: row.pages_created,
    pages_updated: row.pages_updated,
    sources_appended: row.sources_appended,
    images_appended: row.images_appended,
    conflict_count: row.conflict_count,
    skipped_count: row.skipped_count,
    error: row.error,
  };
}

export function createRun(db: Database.Database, input: CreateRunInput): void {
  db.prepare(
    `INSERT INTO wiki_ingest_runs (id, started_at, status, accounts, article_ids, mode, model)
     VALUES (@runId, @startedAt, 'running', @accounts, @articleIds, @mode, @model)`,
  ).run({
    runId: input.runId,
    startedAt: input.startedAt,
    accounts: JSON.stringify(input.accounts),
    articleIds: JSON.stringify(input.articleIds),
    mode: input.mode,
    model: input.model,
  });
}

export function finishRun(db: Database.Database, input: FinishRunInput): void {
  const s = input.stats ?? {};
  db.prepare(
    `UPDATE wiki_ingest_runs SET
       finished_at = @finishedAt,
       status = @status,
       pages_created = @pagesCreated,
       pages_updated = @pagesUpdated,
       sources_appended = @sourcesAppended,
       images_appended = @imagesAppended,
       conflict_count = @conflictCount,
       skipped_count = @skippedCount,
       error = @error
     WHERE id = @runId`,
  ).run({
    runId: input.runId,
    finishedAt: input.finishedAt,
    status: input.status,
    pagesCreated: s.pages_created ?? 0,
    pagesUpdated: s.pages_updated ?? 0,
    sourcesAppended: s.sources_appended ?? 0,
    imagesAppended: s.images_appended ?? 0,
    conflictCount: s.conflict_count ?? 0,
    skippedCount: s.skipped_count ?? 0,
    error: input.error ?? null,
  });
}

export function appendRunOp(db: Database.Database, input: AppendRunOpInput): void {
  db.prepare(
    `INSERT INTO wiki_ingest_run_ops (run_id, seq, op, path, article_id, created_page, conflict, error)
     VALUES (@runId, @seq, @op, @path, @articleId, @createdPage, @conflict, @error)`,
  ).run({
    runId: input.runId,
    seq: input.seq,
    op: input.op,
    path: input.path ?? null,
    articleId: input.articleId ?? null,
    createdPage: input.createdPage ? 1 : 0,
    conflict: input.conflict ? 1 : 0,
    error: input.error ?? null,
  });
}

export function listRuns(db: Database.Database, input: ListRunsInput): RunSummary[] {
  const where: string[] = [];
  const params: Record<string, unknown> = { limit: input.limit };
  if (input.status) { where.push("status = @status"); params.status = input.status; }
  if (input.since) { where.push("started_at >= @since"); params.since = input.since; }
  if (input.until) { where.push("started_at <= @until"); params.until = input.until; }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db.prepare(
    `SELECT * FROM wiki_ingest_runs ${whereSql} ORDER BY started_at DESC LIMIT @limit`,
  ).all(params) as any[];
  return rows.map(parseRun);
}

export function getRun(db: Database.Database, runId: string): RunRow | null {
  const row = db.prepare(`SELECT * FROM wiki_ingest_runs WHERE id = ?`).get(runId) as any;
  if (!row) return null;
  const ops = db.prepare(
    `SELECT * FROM wiki_ingest_run_ops WHERE run_id = ? ORDER BY seq ASC`,
  ).all(runId) as RunOpRow[];
  return { ...parseRun(row), ops };
}
