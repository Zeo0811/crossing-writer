import type { SnippetCandidate } from "./types.js";

function normalize(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

function typicalPosition(tag: string): number {
  if (tag.startsWith("opening")) return 0.05;
  if (tag.startsWith("closing")) return 0.95;
  if (tag.startsWith("bold")) return 0.5;
  if (tag.startsWith("quote")) return 0.4;
  if (tag.startsWith("transition")) return 0.5;
  return 0.5;
}

function score(c: SnippetCandidate): number {
  const target = typicalPosition(c.tag);
  const positionPenalty = Math.abs(c.position_ratio - target);
  const lengthBonus = Math.min(1, c.length / 80);
  return lengthBonus - positionPenalty;
}

export function aggregateSnippets(
  candidates: SnippetCandidate[],
  perTagLimit = 10,
): Record<string, SnippetCandidate[]> {
  const byTag = new Map<string, SnippetCandidate[]>();
  for (const c of candidates) {
    const arr = byTag.get(c.tag) ?? [];
    arr.push(c);
    byTag.set(c.tag, arr);
  }

  const out: Record<string, SnippetCandidate[]> = {};
  for (const [tag, arr] of byTag.entries()) {
    const seen = new Set<string>();
    const deduped: SnippetCandidate[] = [];
    for (const c of arr) {
      const h = normalize(c.excerpt);
      if (seen.has(h)) continue;
      seen.add(h);
      deduped.push(c);
    }
    deduped.sort((a, b) => score(b) - score(a));
    out[tag] = deduped.slice(0, perTagLimit);
  }
  return out;
}
