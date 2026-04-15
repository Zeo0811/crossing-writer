import Database from "better-sqlite3";
import { resolve } from "node:path";
import type { SearchOptions, SearchResult } from "./types.js";

export interface SearchCtx {
  sqlitePath: string;
  vaultPath: string;
}

export function searchRefs(ctx: SearchCtx, opts: SearchOptions): SearchResult[] {
  const db = new Database(ctx.sqlitePath, { readonly: true, fileMustExist: true });
  try {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    let fromClause = "ref_articles a";
    let scoreExpr = "0 AS score";
    let snippetExpr = "'' AS snippet";
    let orderBy = "a.published_at DESC";

    if (opts.query && opts.query.trim()) {
      fromClause = "ref_articles_fts f JOIN ref_articles a ON a.rowid = f.rowid";
      where.push("ref_articles_fts MATCH @q");
      // FTS5 MATCH has its own mini-syntax. Slashes, quotes, colons, parens, stars all break the
      // parser. Sanitize by splitting on non-alnum (keep CJK + digits + letters) and quoting each
      // token. Empty token list → fall back to matching anything (which we surface as no-op).
      const tokens = opts.query
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t.length > 0)
        .map((t) => `"${t.replace(/"/g, '""')}"`);
      params.q = tokens.length > 0 ? tokens.join(" OR ") : '""';
      scoreExpr = "bm25(ref_articles_fts) AS score";
      snippetExpr = "snippet(ref_articles_fts, 2, '<mark>', '</mark>', '…', 20) AS snippet";
      orderBy = "score";
    }
    if (opts.account) {
      const accounts = Array.isArray(opts.account) ? opts.account : [opts.account];
      const keys = accounts.map((_, i) => `@acc${i}`);
      accounts.forEach((v, i) => { params[`acc${i}`] = v; });
      where.push(`a.account IN (${keys.join(",")})`);
    }
    if (opts.author) {
      where.push("a.author = @author"); params.author = opts.author;
    }
    if (opts.dateFrom) {
      where.push("a.published_at >= @dateFrom"); params.dateFrom = opts.dateFrom;
    }
    if (opts.dateTo) {
      where.push("a.published_at <= @dateTo"); params.dateTo = opts.dateTo;
    }
    if (typeof opts.isOriginal === "boolean") {
      where.push("a.is_original = @orig"); params.orig = opts.isOriginal ? 1 : 0;
    }
    if (opts.topicsCore && opts.topicsCore.length) {
      const inList = opts.topicsCore.map((_, i) => `@tc${i}`);
      opts.topicsCore.forEach((v, i) => { params[`tc${i}`] = v; });
      where.push(`EXISTS (SELECT 1 FROM json_each(a.topics_core_json) WHERE value IN (${inList.join(",")}))`);
    }
    if (opts.topicsFine && opts.topicsFine.length) {
      const inList = opts.topicsFine.map((_, i) => `@tf${i}`);
      opts.topicsFine.forEach((v, i) => { params[`tf${i}`] = v; });
      where.push(`EXISTS (SELECT 1 FROM json_each(a.topics_fine_json) WHERE value IN (${inList.join(",")}))`);
    }

    const limit = opts.limit ?? 20;
    const offset = opts.offset ?? 0;
    const sql = `
      SELECT a.id, a.account, a.title, a.author, a.published_at, a.url,
             a.summary, a.md_path, a.topics_core_json, a.topics_fine_json,
             a.word_count, ${scoreExpr}, ${snippetExpr}
      FROM ${fromClause}
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY ${orderBy}
      LIMIT @limit OFFSET @offset
    `;
    params.limit = limit;
    params.offset = offset;

    const rows = db.prepare(sql).all(params) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as string,
      account: r.account as string,
      title: r.title as string,
      author: (r.author as string | null) ?? null,
      publishedAt: r.published_at as string,
      url: r.url as string,
      summary: (r.summary as string | null) ?? null,
      mdPath: resolve(ctx.vaultPath, r.md_path as string),
      snippet: (r.snippet as string) ?? "",
      topicsCore: r.topics_core_json ? (JSON.parse(r.topics_core_json as string) as string[]) : [],
      topicsFine: r.topics_fine_json ? (JSON.parse(r.topics_fine_json as string) as string[]) : [],
      wordCount: (r.word_count as number | null) ?? null,
      score: (r.score as number) ?? 0,
    }));
  } finally {
    db.close();
  }
}

export function getRefByUrl(ctx: SearchCtx, url: string): SearchResult | null {
  const db = new Database(ctx.sqlitePath, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare("SELECT * FROM ref_articles WHERE url=?").get(url) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      account: row.account as string,
      title: row.title as string,
      author: (row.author as string | null) ?? null,
      publishedAt: row.published_at as string,
      url: row.url as string,
      summary: (row.summary as string | null) ?? null,
      mdPath: resolve(ctx.vaultPath, row.md_path as string),
      snippet: "",
      topicsCore: row.topics_core_json ? (JSON.parse(row.topics_core_json as string) as string[]) : [],
      topicsFine: row.topics_fine_json ? (JSON.parse(row.topics_fine_json as string) as string[]) : [],
      wordCount: (row.word_count as number | null) ?? null,
      score: 0,
    };
  } finally { db.close(); }
}
