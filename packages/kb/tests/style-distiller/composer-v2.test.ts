import { describe, it, expect, vi } from 'vitest';
import { composePanel } from '../../src/style-distiller/composer-v2.js';
import type { AggregatedV2 } from '../../src/style-distiller/types.js';

// A minimal-but-valid v2 panel output
const MOCK_PANEL = `---
account: 十字路口Crossing
role: opening
version: 2
status: active
created_at: '2026-04-16T00:00:00Z'
source_article_count: 20
types:
  - key: 实测
    sample_count: 20
word_count_ranges:
  opening: [150, 260]
  article: [3500, 8000]
pronoun_policy:
  we_ratio: 0.4
  you_ratio: 0.3
  avoid: [笔者]
tone:
  primary: 客观克制
  humor_frequency: low
  opinionated: mid
bold_policy:
  frequency: 每段 0–2 处
  what_to_bold: [核心观点句]
  dont_bold: [整段]
transition_phrases:
  - 先说 XXX
data_citation:
  required: true
  format_style: 数字+单位+来源
  min_per_article: 1
heading_cadence:
  levels_used: [h2, h3]
  paragraphs_per_h3: [5, 10]
  h3_style: 疑问句
banned_vocabulary:
  - 笔者
---

# 十字路口Crossing · 开头 风格卡 v2

## 开头 · 实测模式

### 目标
给读者钩子

### 字数范围
150 – 260 字

### 结构骨架（三选一）
**A. 场景** · xxx
**B. 数据** · yyy
**C. 趋势** · zzz

### 高频锚词（用不是抄）
- "2013 年" — 场景切入

### 禁止出现（本账号从来不写）
- "本文将介绍"

### 示例（3 条真实样本，节奏模板）
**示例 1** · ColaOS · 结构 A
> 2013 年，xxx

**示例 2** · PixVerse · 结构 B
> 2026 年春节档 yyy

**示例 3** · Flowith · 结构 C
> 最近有一个趋势 zzz
`;

describe('composePanel', () => {
  it('returns the LLM markdown as panel file content', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({
      text: MOCK_PANEL,
      meta: { cli: 'claude', durationMs: 1000 },
    });
    const agg: AggregatedV2 = {
      account: '十字路口Crossing',
      buckets: [
        {
          role: 'opening',
          type: '实测',
          sample_count: 20,
          snippets: [{ article_id: 'a1', title: 'ColaOS', excerpt: '2013 年', word_count: 200 }],
          quant: { word_count_median: 200, word_count_p10: 150, word_count_p90: 260 },
        },
      ],
      banned_vocabulary_candidates: ['笔者'],
    };
    const out = await composePanel(agg, 'opening', { invoke: mockInvoke });
    expect(out).toContain('account: 十字路口Crossing');
    expect(out).toContain('## 开头 · 实测模式');
  });

  it('rejects output missing frontmatter', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({
      text: '# no frontmatter',
      meta: { cli: 'claude', durationMs: 1000 },
    });
    const agg: AggregatedV2 = { account: 'x', buckets: [], banned_vocabulary_candidates: [] };
    await expect(composePanel(agg, 'opening', { invoke: mockInvoke })).rejects.toThrow(/frontmatter/);
  });

  it('buildUserMessage filters out buckets with sample_count=0', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({
      text: MOCK_PANEL,
      meta: { cli: 'claude', durationMs: 1000 },
    });
    const agg: AggregatedV2 = {
      account: 'acc',
      buckets: [
        { role: 'opening', type: '实测', sample_count: 5, snippets: [], quant: { word_count_median: 100, word_count_p10: 80, word_count_p90: 150 } },
        { role: 'opening', type: '访谈', sample_count: 0, snippets: [], quant: { word_count_median: 0, word_count_p10: 0, word_count_p90: 0 } },
        { role: 'practice', type: '实测', sample_count: 8, snippets: [], quant: { word_count_median: 500, word_count_p10: 400, word_count_p90: 600 } },
      ],
      banned_vocabulary_candidates: [],
    };
    await composePanel(agg, 'opening', { invoke: mockInvoke });
    // inspect the userMessage passed to invoke
    const call = mockInvoke.mock.calls[0]![0];
    const um = call.userMessage as string;
    expect(um).toContain('type: 实测');
    expect(um).not.toContain('type: 访谈');
    // practice bucket filtered out (different role)
    expect(um).not.toContain('word_count_median: 500');
  });
});
