import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import type { SearchRawInput, SearchRawHit } from "./types.js";

const DEFAULT_LIMIT = 5;

export function searchRaw(
  input: SearchRawInput,
  ctx: { sqlitePath: string },
): SearchRawHit[] {
  if (!ctx.sqlitePath || !existsSync(ctx.sqlitePath)) return [];
  const limit = Math.max(1, Math.min(50, input.limit ?? DEFAULT_LIMIT));
  const db = new Database(ctx.sqlitePath, { readonly: true, fileMustExist: true });
  try {
    const wantAccount = typeof input.account === "string" && input.account.length > 0;
    const whereClause = wantAccount ? "AND ra.account = ?" : "";
    const sql = `SELECT ra.id AS article_id,
                        ra.account AS account,
                        ra.title AS title,
                        ra.published_at AS published_at,
                        snippet(ref_articles_fts, 2, '<b>', '</b>', '...', 32) AS snippet
                 FROM ref_articles_fts
                 JOIN ref_articles ra ON ra.rowid = ref_articles_fts.rowid
                 WHERE ref_articles_fts MATCH ?
                 ${whereClause}
                 ORDER BY rank
                 LIMIT ?`;
    const stmt = db.prepare(sql);
    const params: unknown[] = [input.query];
    if (wantAccount) params.push(input.account);
    params.push(limit);

    try {
      const rows = stmt.all(...params) as SearchRawHit[];
      return rows;
    } catch {
      return [];
    }
  } finally {
    db.close();
  }
}
