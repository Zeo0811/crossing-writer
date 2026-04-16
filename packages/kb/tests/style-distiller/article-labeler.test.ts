import { describe, it, expect, vi } from 'vitest';
import { labelArticle } from '../../src/style-distiller/article-labeler.js';
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

describe('labelArticle', () => {
  it('parses valid YAML response', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({
      text: `article_type: 实测
paragraphs:
  P1: other
  P2: opening
  P3: practice
  P4: closing`,
      meta: { cli: 'claude', durationMs: 100 },
    });

    const out = await labelArticle(
      mkSample('a1'),
      { invoke: mockInvoke, paragraphs: ['P1', 'P2', 'P3', 'P4'] },
    );

    expect(out.articleId).toBe('a1');
    expect(out.type).toBe('实测');
    expect(out.paragraphRoles.get('P1')).toBe('other');
    expect(out.paragraphRoles.get('P2')).toBe('opening');
    expect(out.paragraphRoles.get('P4')).toBe('closing');
    expect(out.durationMs).toBe(100);
  });

  it('strips code fences defensively', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({
      text: '```yaml\narticle_type: 访谈\nparagraphs:\n  P1: opening\n```',
      meta: { cli: 'claude', durationMs: 50 },
    });
    const out = await labelArticle(
      mkSample('a2'),
      { invoke: mockInvoke, paragraphs: ['P1'] },
    );
    expect(out.type).toBe('访谈');
    expect(out.paragraphRoles.get('P1')).toBe('opening');
  });

  it('throws on invalid article_type', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({
      text: `article_type: 混合\nparagraphs:\n  P1: opening`,
      meta: { cli: 'claude', durationMs: 100 },
    });
    await expect(
      labelArticle(mkSample('a1'), { invoke: mockInvoke, paragraphs: ['P1'] })
    ).rejects.toThrow(/article_type/);
  });

  it('throws if a paragraph has no label', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({
      text: `article_type: 实测\nparagraphs:\n  P1: opening`,
      meta: { cli: 'claude', durationMs: 100 },
    });
    await expect(
      labelArticle(mkSample('a1'), { invoke: mockInvoke, paragraphs: ['P1', 'P2'] })
    ).rejects.toThrow(/missing label/);
  });

  it('throws if paragraph label is invalid', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({
      text: `article_type: 实测\nparagraphs:\n  P1: garbage`,
      meta: { cli: 'claude', durationMs: 100 },
    });
    await expect(
      labelArticle(mkSample('a1'), { invoke: mockInvoke, paragraphs: ['P1'] })
    ).rejects.toThrow();
  });
});
