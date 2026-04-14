import type { FastifyInstance } from "fastify";
import { searchWiki, searchRaw } from "@crossing/kb";

export interface SuggestItem {
  kind: "wiki" | "raw";
  id: string;
  title: string;
  excerpt: string;
  account?: string;
  published_at?: string;
}

export interface WriterSuggestDeps {
  vaultPath: string;
  sqlitePath: string;
}

export function registerWriterSuggestRoutes(app: FastifyInstance, deps: WriterSuggestDeps) {
  app.get<{ Querystring: { q?: string; limit?: string } }>(
    "/api/writer/suggest",
    async (req) => {
      const q = (req.query.q ?? "").trim();
      const limit = Math.max(1, Math.min(30, Number(req.query.limit) || 12));
      if (q.length < 1) return { items: [] as SuggestItem[] };
      const [wiki, raw] = await Promise.all([
        searchWiki({ query: q, limit: Math.min(6, limit) }, { vaultPath: deps.vaultPath }).catch(() => []),
        Promise.resolve(searchRaw({ query: q, limit: Math.min(6, limit) }, { sqlitePath: deps.sqlitePath })).catch(() => []),
      ]);
      const wikiItems: SuggestItem[] = wiki.map((w: any) => ({
        kind: "wiki",
        id: w.path,
        title: w.frontmatter?.title ?? w.path,
        excerpt: (w.excerpt ?? w.frontmatter?.summary ?? "").slice(0, 200),
      }));
      const rawItems: SuggestItem[] = raw.map((r: any) => ({
        kind: "raw",
        id: r.article_id,
        title: r.title,
        excerpt: (r.snippet ?? "").slice(0, 200),
        account: r.account,
        published_at: r.published_at,
      }));
      const merged = [...wikiItems, ...rawItems].slice(0, limit);
      return { items: merged };
    },
  );
}
