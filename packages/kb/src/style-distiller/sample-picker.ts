import type { ArticleSample } from "./types.js";

function quartileIndex(values: number[], v: number): 0 | 1 | 2 | 3 {
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)]!;
  const q2 = sorted[Math.floor(sorted.length * 0.5)]!;
  const q3 = sorted[Math.floor(sorted.length * 0.75)]!;
  if (v <= q1) return 0;
  if (v <= q2) return 1;
  if (v <= q3) return 2;
  return 3;
}

function quarterOf(date: string): number {
  const m = Number(date.slice(5, 7));
  return Math.min(3, Math.floor((m - 1) / 3));
}

function timeBucketOf(date: string): string {
  const y = date.slice(0, 4);
  return `${y}-Q${quarterOf(date)}`;
}

export function stratifiedSample(pool: ArticleSample[], sampleSize: number): ArticleSample[] {
  if (pool.length <= sampleSize) return [...pool];

  const wcs = pool.map((p) => p.word_count);
  const buckets = new Map<string, ArticleSample[]>();
  for (const a of pool) {
    const key = `${quartileIndex(wcs, a.word_count)}|${timeBucketOf(a.published_at)}`;
    const arr = buckets.get(key) ?? [];
    arr.push(a);
    buckets.set(key, arr);
  }

  const bucketKeys = [...buckets.keys()].sort();
  const perBucket = Math.max(1, Math.floor(sampleSize / Math.max(1, bucketKeys.length)));
  const out: ArticleSample[] = [];
  const seen = new Set<string>();

  for (const key of bucketKeys) {
    const items = buckets.get(key)!;
    const step = Math.max(1, Math.floor(items.length / Math.max(1, perBucket)));
    for (let i = 0; i < items.length && out.length < sampleSize; i += step) {
      const it = items[i]!;
      if (!seen.has(it.id)) {
        out.push(it);
        seen.add(it.id);
        if (out.filter((o) => buckets.get(key)!.includes(o)).length >= perBucket) break;
      }
    }
  }

  if (out.length < sampleSize) {
    for (const a of pool) {
      if (out.length >= sampleSize) break;
      if (!seen.has(a.id)) {
        out.push(a);
        seen.add(a.id);
      }
    }
  }

  return out.slice(0, sampleSize);
}

export function pickDeepRead(pool: ArticleSample[], count: number): ArticleSample[] {
  const n = Math.min(count, pool.length);
  if (n === 0) return [];
  const byWc = [...pool].sort((a, b) => a.word_count - b.word_count);
  const step = Math.max(1, Math.floor(byWc.length / n));
  const picked: ArticleSample[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < byWc.length && picked.length < n; i += step) {
    const a = byWc[i]!;
    if (!seen.has(a.id)) {
      picked.push(a);
      seen.add(a.id);
    }
  }
  for (const a of pool) {
    if (picked.length >= n) break;
    if (!seen.has(a.id)) {
      picked.push(a);
      seen.add(a.id);
    }
  }
  return picked.slice(0, n);
}
