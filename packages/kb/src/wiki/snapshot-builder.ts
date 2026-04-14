import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WikiStore } from "./wiki-store.js";
import type { ExistingPageSnapshot } from "@crossing/agents";

export interface BatchArticleLite {
  id: string; title: string; published_at: string; body_plain: string;
}

export interface Snapshot {
  pages: ExistingPageSnapshot[];
  indexMd: string;
}

function keywordsFromArticle(a: BatchArticleLite): string[] {
  const text = `${a.title}\n${a.body_plain.slice(0, 2000)}`;
  const tokens = text.split(/[\s,.。，！？!?、：；:;()\[\]【】「」『』"'""''<>《》/\\|—\-]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t.length <= 20);
  return tokens;
}

export function buildSnapshot(vaultPath: string, articles: BatchArticleLite[], topK: number): Snapshot {
  const store = new WikiStore(vaultPath);
  const pages = store.listPages();
  const indexPath = join(vaultPath, "index.md");
  const indexMd = existsSync(indexPath) ? readFileSync(indexPath, "utf-8") : "";
  if (pages.length === 0 || articles.length === 0) return { pages: [], indexMd };

  const kws = new Set<string>();
  for (const a of articles) for (const k of keywordsFromArticle(a)) kws.add(k);

  const scored = pages.map((p) => {
    const needles: string[] = [p.frontmatter.title, ...(p.frontmatter.aliases ?? [])]
      .filter((x): x is string => typeof x === "string" && x.length > 0);
    let score = 0;
    for (const n of needles) {
      for (const k of kws) {
        if (k === n) score += 5;
        else if (n.length >= 2 && (k.includes(n) || n.includes(k))) score += 2;
      }
    }
    return { p, score };
  }).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score);

  return {
    pages: scored.slice(0, topK).map(({ p }) => ({
      path: p.path,
      frontmatter: p.frontmatter as unknown as Record<string, unknown>,
      first_chars: p.body.slice(0, 500),
    })),
    indexMd,
  };
}
