import { describe, it, expect } from 'vitest';
import { aggregateBuckets } from '../../src/style-distiller/aggregator-v2.js';
import type { LabeledArticle } from '../../src/style-distiller/article-labeler.js';
import type { ArticleSample } from '../../src/style-distiller/types.js';

function mkSample(id: string, body: string): ArticleSample {
  return { id, account: 'acc', title: `T-${id}`, published_at: '2026-01-01', word_count: body.length, body_plain: body };
}
function mkLabeled(id: string, type: '实测'|'访谈'|'评论', roles: Record<string, any>): LabeledArticle {
  return { articleId: id, type, paragraphRoles: new Map(Object.entries(roles)), durationMs: 10 };
}

describe('aggregateBuckets', () => {
  it('groups snippets by (role × type)', () => {
    const samples = [mkSample('a1', 'x'), mkSample('a2', 'y')];
    const paragraphsByArticle = new Map([
      ['a1', ['开头1', '主体1a', '主体1b', '结尾1']],
      ['a2', ['开头2', '主体2', '结尾2']],
    ]);
    const labeled = [
      mkLabeled('a1', '实测', { P1: 'opening', P2: 'practice', P3: 'practice', P4: 'closing' }),
      mkLabeled('a2', '访谈', { P1: 'opening', P2: 'practice', P3: 'closing' }),
    ];

    const out = aggregateBuckets('acc', samples, paragraphsByArticle, labeled);
    expect(out.account).toBe('acc');

    const shice_opening = out.buckets.find(b => b.role === 'opening' && b.type === '实测')!;
    expect(shice_opening.sample_count).toBe(1);
    expect(shice_opening.snippets).toHaveLength(1);
    expect(shice_opening.snippets[0]!.excerpt).toBe('开头1');

    const shice_practice = out.buckets.find(b => b.role === 'practice' && b.type === '实测')!;
    expect(shice_practice.sample_count).toBe(1);           // still 1 article contributed
    expect(shice_practice.snippets).toHaveLength(2);       // but 2 snippets

    const fangtan_practice = out.buckets.find(b => b.role === 'practice' && b.type === '访谈')!;
    expect(fangtan_practice.sample_count).toBe(1);
    expect(fangtan_practice.snippets[0]!.excerpt).toBe('主体2');
  });

  it('includes empty buckets for missing (role, type) combos', () => {
    const samples = [mkSample('a1', 'x')];
    const paragraphsByArticle = new Map([['a1', ['开头']]]);
    const labeled = [mkLabeled('a1', '实测', { P1: 'opening' })];
    const out = aggregateBuckets('acc', samples, paragraphsByArticle, labeled);
    // 3 roles × 3 types = 9
    expect(out.buckets).toHaveLength(9);
    const pinglun_closing = out.buckets.find(b => b.role === 'closing' && b.type === '评论')!;
    expect(pinglun_closing.sample_count).toBe(0);
    expect(pinglun_closing.snippets).toEqual([]);
  });

  it('does not include "other" paragraphs in any bucket', () => {
    const samples = [mkSample('a1', 'x')];
    const paragraphsByArticle = new Map([['a1', ['标题', '开头', '[图]']]]);
    const labeled = [mkLabeled('a1', '实测', { P1: 'other', P2: 'opening', P3: 'other' })];
    const out = aggregateBuckets('acc', samples, paragraphsByArticle, labeled);
    const shice_opening = out.buckets.find(b => b.role === 'opening' && b.type === '实测')!;
    expect(shice_opening.snippets.map(s => s.excerpt)).toEqual(['开头']);
  });

  it('truncates long excerpts to ≤ 800 chars', () => {
    const longPara = 'a'.repeat(1200);
    const samples = [mkSample('a1', longPara)];
    const paragraphsByArticle = new Map([['a1', [longPara]]]);
    const labeled = [mkLabeled('a1', '实测', { P1: 'opening' })];
    const out = aggregateBuckets('acc', samples, paragraphsByArticle, labeled);
    const bucket = out.buckets.find(b => b.role === 'opening' && b.type === '实测')!;
    expect(bucket.snippets[0]!.excerpt.length).toBeLessThanOrEqual(800);
  });

  it('sample_count dedupes by article (2 openings from same article = 1 sample)', () => {
    const samples = [mkSample('a1', 'x')];
    const paragraphsByArticle = new Map([['a1', ['开头1', '开头2']]]);
    const labeled = [mkLabeled('a1', '实测', { P1: 'opening', P2: 'opening' })];
    const out = aggregateBuckets('acc', samples, paragraphsByArticle, labeled);
    const bucket = out.buckets.find(b => b.role === 'opening' && b.type === '实测')!;
    expect(bucket.snippets).toHaveLength(2);
    expect(bucket.sample_count).toBe(1);
  });
});
