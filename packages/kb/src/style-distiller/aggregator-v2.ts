import type { ArticleSample, AggregatedV2, BucketV2 } from './types.js';
import type { LabeledArticle } from './article-labeler.js';
import { ARTICLE_TYPES, WRITER_ROLES, type ArticleType, type Role } from './panel-v2-schema.js';

/**
 * Max snippets per (role × type) bucket handed to composer-v2. More than this
 * wastes context window without improving the panel — composer needs variety,
 * not volume. Hit this cap and we trim via round-robin across articles to
 * preserve breadth.
 */
const MAX_SNIPPETS_PER_BUCKET = 30;

export function aggregateBuckets(
  account: string,
  samples: ArticleSample[],
  paragraphsByArticle: Map<string, string[]>,
  labeled: LabeledArticle[],
): AggregatedV2 {
  // Seed all 9 buckets so downstream always finds the slot
  const bucketMap = new Map<string, BucketV2>();
  for (const role of WRITER_ROLES) {
    for (const type of ARTICLE_TYPES) {
      bucketMap.set(bucketKey(role, type), {
        role, type, sample_count: 0, snippets: [], quant: zeroQuant(),
      });
    }
  }

  const contributorsPerBucket = new Map<string, Set<string>>();

  for (const lab of labeled) {
    const sample = samples.find((s) => s.id === lab.articleId);
    if (!sample) continue;
    const paragraphs = paragraphsByArticle.get(lab.articleId) ?? [];

    for (let i = 0; i < paragraphs.length; i++) {
      const key = `P${i + 1}`;
      const role = lab.paragraphRoles.get(key) as Role | undefined;
      if (!role || role === 'other') continue;
      const bkey = bucketKey(role, lab.type);
      const bucket = bucketMap.get(bkey);
      if (!bucket) continue;
      const paragraph = paragraphs[i]!;
      bucket.snippets.push({
        article_id: sample.id,
        title: sample.title,
        excerpt: paragraph.slice(0, 800),
        word_count: paragraph.length,
      });
      if (!contributorsPerBucket.has(bkey)) contributorsPerBucket.set(bkey, new Set());
      contributorsPerBucket.get(bkey)!.add(lab.articleId);
    }
  }

  for (const [k, bucket] of bucketMap.entries()) {
    bucket.sample_count = contributorsPerBucket.get(k)?.size ?? 0;
    bucket.snippets = selectDiverseSnippets(bucket.snippets, MAX_SNIPPETS_PER_BUCKET);
    bucket.quant = computeQuant(bucket.snippets.map((s) => s.word_count));
  }

  return {
    account,
    buckets: Array.from(bucketMap.values()),
    banned_vocabulary_candidates: [],
  };
}

/**
 * Keep up to `max` snippets, prioritizing breadth (snippets from distinct
 * articles) over depth (many from the same article). Round-robin by article:
 * pass 1 takes snippet #0 from each article, pass 2 takes snippet #1, etc.
 * Returns at most `max` snippets in article-stable order.
 */
function selectDiverseSnippets<T extends { article_id: string }>(snippets: T[], max: number): T[] {
  if (snippets.length <= max) return snippets;
  // Group by article_id preserving original order
  const perArticle = new Map<string, T[]>();
  for (const s of snippets) {
    const arr = perArticle.get(s.article_id) ?? [];
    arr.push(s);
    perArticle.set(s.article_id, arr);
  }
  const groups = Array.from(perArticle.values());
  const out: T[] = [];
  for (let passIdx = 0; out.length < max; passIdx++) {
    let anyPicked = false;
    for (const g of groups) {
      if (out.length >= max) break;
      if (g[passIdx] !== undefined) {
        out.push(g[passIdx]!);
        anyPicked = true;
      }
    }
    if (!anyPicked) break;
  }
  return out;
}

function bucketKey(role: string, type: string): string { return `${role}::${type}`; }

function zeroQuant() {
  return { word_count_median: 0, word_count_p10: 0, word_count_p90: 0 };
}

function computeQuant(values: number[]) {
  if (values.length === 0) return zeroQuant();
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (p: number) => sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * p)))]!;
  return {
    word_count_median: pick(0.5),
    word_count_p10: pick(0.1),
    word_count_p90: pick(0.9),
  };
}
