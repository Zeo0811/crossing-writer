import { describe, it, expect, vi } from 'vitest';
import { labelArticle, labelArticlesBatch } from '../../src/style-distiller/article-labeler.js';
import type { ArticleSample } from '../../src/style-distiller/types.js';

function mkSample(id: string): ArticleSample {
  return {
    id,
    account: 'acc',
    title: `T-${id}`,
    published_at: '2026-01-01',
    word_count: 100,
    body_plain: 'x',
  };
}

describe('labelArticlesBatch', () => {
  it('parses valid batch YAML response', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({
      text: `articles:
  a1:
    article_type: 实测
    paragraphs:
      P1: other
      P2: opening
      P3: practice
  a2:
    article_type: 访谈
    paragraphs:
      P1: opening
      P2: closing`,
      meta: { cli: 'claude', durationMs: 200 },
    });
    const out = await labelArticlesBatch(
      [
        { sample: mkSample('a1'), paragraphs: ['P1', 'P2', 'P3'] },
        { sample: mkSample('a2'), paragraphs: ['P1', 'P2'] },
      ],
      mockInvoke,
    );
    expect(out).toHaveLength(2);
    expect(out[0]!.articleId).toBe('a1');
    expect(out[0]!.type).toBe('实测');
    expect(out[0]!.paragraphRoles.get('P2')).toBe('opening');
    expect(out[1]!.type).toBe('访谈');
  });

  it('uses sonnet model by default', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({
      text: `articles:\n  a1:\n    article_type: 实测\n    paragraphs:\n      P1: opening`,
      meta: { cli: 'claude', durationMs: 10 },
    });
    await labelArticlesBatch([{ sample: mkSample('a1'), paragraphs: ['P1'] }], mockInvoke);
    expect(mockInvoke.mock.calls[0]![0].model).toBe('claude-sonnet-4-5');
  });

  it('strips outer code fences', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({
      text: '```yaml\narticles:\n  a1:\n    article_type: 访谈\n    paragraphs:\n      P1: opening\n```',
      meta: { cli: 'claude', durationMs: 50 },
    });
    const out = await labelArticlesBatch([{ sample: mkSample('a1'), paragraphs: ['P1'] }], mockInvoke);
    expect(out[0]!.type).toBe('访谈');
  });

  it('throws on missing articles map', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({
      text: `foo: bar`,
      meta: { cli: 'claude', durationMs: 10 },
    });
    await expect(
      labelArticlesBatch([{ sample: mkSample('a1'), paragraphs: ['P1'] }], mockInvoke),
    ).rejects.toThrow(/articles/);
  });

  it('throws on missing entry for some article', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({
      text: `articles:\n  a1:\n    article_type: 实测\n    paragraphs:\n      P1: opening`,
      meta: { cli: 'claude', durationMs: 10 },
    });
    await expect(
      labelArticlesBatch(
        [
          { sample: mkSample('a1'), paragraphs: ['P1'] },
          { sample: mkSample('a2'), paragraphs: ['P1'] },
        ],
        mockInvoke,
      ),
    ).rejects.toThrow(/missing entry for article a2/);
  });

  it('throws on invalid article_type', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({
      text: `articles:\n  a1:\n    article_type: 混合\n    paragraphs:\n      P1: opening`,
      meta: { cli: 'claude', durationMs: 10 },
    });
    await expect(
      labelArticlesBatch([{ sample: mkSample('a1'), paragraphs: ['P1'] }], mockInvoke),
    ).rejects.toThrow(/article_type/);
  });

  it('defaults missing paragraph labels to other (sonnet-tolerant)', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({
      text: `articles:\n  a1:\n    article_type: 实测\n    paragraphs:\n      P1: opening`,
      meta: { cli: 'claude', durationMs: 10 },
    });
    const out = await labelArticlesBatch(
      [{ sample: mkSample('a1'), paragraphs: ['P1', 'P2', 'P3'] }],
      mockInvoke,
    );
    expect(out[0]!.paragraphRoles.get('P1')).toBe('opening');
    expect(out[0]!.paragraphRoles.get('P2')).toBe('other');
    expect(out[0]!.paragraphRoles.get('P3')).toBe('other');
  });

  it('still throws on invalid paragraph label value', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({
      text: `articles:\n  a1:\n    article_type: 实测\n    paragraphs:\n      P1: garbage`,
      meta: { cli: 'claude', durationMs: 10 },
    });
    await expect(
      labelArticlesBatch([{ sample: mkSample('a1'), paragraphs: ['P1'] }], mockInvoke),
    ).rejects.toThrow(/invalid label/);
  });
});

describe('labelArticle (single-article convenience)', () => {
  it('delegates to batch API', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({
      text: `articles:\n  a1:\n    article_type: 实测\n    paragraphs:\n      P1: opening`,
      meta: { cli: 'claude', durationMs: 10 },
    });
    const out = await labelArticle(mkSample('a1'), { invoke: mockInvoke, paragraphs: ['P1'] });
    expect(out.articleId).toBe('a1');
    expect(out.type).toBe('实测');
    expect(out.paragraphRoles.get('P1')).toBe('opening');
  });
});
