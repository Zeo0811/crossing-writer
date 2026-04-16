import type { ArticleSample, AggregatedV2, BucketV2 } from './types.js';
import type { LabeledArticle } from './article-labeler.js';
import { ARTICLE_TYPES, WRITER_ROLES, type ArticleType, type Role } from './panel-v2-schema.js';

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
    bucket.quant = computeQuant(bucket.snippets.map((s) => s.word_count));
  }

  return {
    account,
    buckets: Array.from(bucketMap.values()),
    banned_vocabulary_candidates: [],
  };
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
