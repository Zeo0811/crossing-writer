import { WikiStore } from "./wiki-store.js";
import type { SearchWikiInput, SearchWikiResult, WikiKind } from "./types.js";

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,.。，！？!?、：；:;()\[\]【】「」『』"'""''<>《》/\\|—\-]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 1 && t.length <= 30);
}

function queryTokens(q: string): string[] {
  const base = tokenize(q);
  const extra: string[] = [];
  for (const t of base) {
    if (/[\u4e00-\u9fff]/.test(t) && t.length >= 2) {
      for (let i = 0; i < t.length - 1; i += 1) extra.push(t.slice(i, i + 2));
    }
  }
  return Array.from(new Set([...base, ...extra])).filter((x) => x.length > 0);
}

export async function searchWiki(input: SearchWikiInput, ctx: { vaultPath: string }): Promise<SearchWikiResult[]> {
  const store = new WikiStore(ctx.vaultPath);
  const pages = store.listPages();
  if (pages.length === 0) return [];
  const limit = input.limit ?? 5;
  const qtokens = queryTokens(input.query);
  if (qtokens.length === 0) return [];

  const df: Record<string, number> = {};
  const docTokens: Map<string, Set<string>> = new Map();

  function expandWithBigrams(tokens: string[]): string[] {
    const result = [...tokens];
    for (const t of tokens) {
      if (/[\u4e00-\u9fff]/.test(t) && t.length >= 2) {
        for (let i = 0; i < t.length - 1; i += 1) result.push(t.slice(i, i + 2));
      }
    }
    return result;
  }

  for (const p of pages) {
    const titleTokens = tokenize(p.frontmatter.title);
    const aliasTokens = (p.frontmatter.aliases ?? []).flatMap(tokenize);
    const bodyTokens = tokenize(p.body.slice(0, 500));
    const bag = new Set<string>([
      ...expandWithBigrams(titleTokens),
      ...expandWithBigrams(aliasTokens),
      ...expandWithBigrams(bodyTokens),
    ]);
    docTokens.set(p.path, bag);
    for (const t of bag) df[t] = (df[t] ?? 0) + 1;
  }
  const N = pages.length;

  const scored = pages.map((p) => {
    const bag = docTokens.get(p.path)!;
    let score = 0;
    const title = p.frontmatter.title.toLowerCase();
    const aliases = (p.frontmatter.aliases ?? []).map((a) => a.toLowerCase());
    for (const qt of qtokens) {
      if (title === qt || aliases.includes(qt)) score += 20;
      else if (title.includes(qt)) score += 10;
      else if (aliases.some((a) => a.includes(qt))) score += 8;
      if (bag.has(qt)) {
        const idf = Math.log(1 + N / (df[qt] ?? 1));
        score += idf;
      }
    }
    return { p, score };
  }).filter((x) => x.score > 0);

  scored.sort((a, b) => b.score - a.score);

  const filtered = input.kind ? scored.filter((x) => x.p.frontmatter.type === input.kind) : scored;

  return filtered.slice(0, limit).map(({ p, score }) => ({
    path: p.path,
    kind: p.frontmatter.type as WikiKind,
    title: p.frontmatter.title,
    aliases: p.frontmatter.aliases ?? [],
    excerpt: p.body.slice(0, 300),
    frontmatter: p.frontmatter,
    score,
  }));
}
