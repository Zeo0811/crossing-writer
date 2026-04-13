import { searchRefs, type SearchCtx, type SearchResult } from "@crossing/kb";

export interface BuildRefsPackOpts {
  ctx: SearchCtx;
  queries: string[];
  limitPerQuery?: number;
  totalLimit?: number;
}

export function buildRefsPack(opts: BuildRefsPackOpts): string {
  const perQuery = opts.limitPerQuery ?? 10;
  const total = opts.totalLimit ?? 30;
  const seen = new Set<string>();
  const items: Array<SearchResult & { matchedQuery: string }> = [];

  outer: for (const q of opts.queries) {
    if (!q.trim()) continue;
    const hits = searchRefs(opts.ctx, { query: q, limit: perQuery }) ?? [];
    for (const h of hits) {
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      items.push({ ...h, matchedQuery: q });
      if (items.length >= total) break outer;
    }
  }

  const lines: string[] = [];
  const qList = opts.queries.map((q) => JSON.stringify(q)).join(", ");
  lines.push(
    `---\ntype: refs_pack\ngenerated_at: ${new Date().toISOString()}\nqueries: [${qList}]\ntotal: ${items.length}\n---\n`,
  );
  lines.push(`# Refs Pack (Top ${items.length})\n`);
  for (const [i, it] of items.entries()) {
    lines.push(`## ${i + 1}. ${it.title}`);
    lines.push(`- account: ${it.account}`);
    lines.push(`- published_at: ${it.publishedAt}`);
    lines.push(`- url: ${it.url}`);
    lines.push(`- md_path: ${it.mdPath}`);
    lines.push(`- matched_query: "${it.matchedQuery}"`);
    if (it.summary) lines.push(`- summary: ${it.summary}`);
    lines.push("");
  }
  return lines.join("\n");
}
