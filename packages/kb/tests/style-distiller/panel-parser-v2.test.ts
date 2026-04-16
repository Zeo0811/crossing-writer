import { describe, it, expect } from 'vitest';
import { parsePanelV2, extractTypeSection } from '../../src/style-distiller/panel-parser-v2.js';

const SAMPLE = `---
account: 十字路口Crossing
role: opening
version: 2
status: active
created_at: '2026-04-16T00:00:00Z'
source_article_count: 30
types:
  - key: 实测
    sample_count: 20
  - key: 访谈
    sample_count: 10
word_count_ranges:
  opening: [150, 260]
  article: [3500, 8000]
pronoun_policy:
  we_ratio: 0.4
  you_ratio: 0.3
  avoid: [笔者, 本人]
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
  - 这里补充一点：
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
  - 鉴于
---

# 标题

## 开头 · 实测模式

### 目标
给读者钩子

### 字数范围
150 – 260 字

## 开头 · 访谈模式

### 目标
引语钩子
`;

describe('parsePanelV2', () => {
  it('parses a full v2 panel', () => {
    const p = parsePanelV2('/tmp/opening-v2.md', SAMPLE);
    expect(p.frontmatter.account).toBe('十字路口Crossing');
    expect(p.frontmatter.version).toBe(2);
    expect(p.frontmatter.types).toHaveLength(2);
    expect(p.frontmatter.types[0]!.key).toBe('实测');
    expect(p.frontmatter.tone.primary).toBe('客观克制');
    expect(p.frontmatter.word_count_ranges.opening).toEqual([150, 260]);
    expect(p.body).toContain('## 开头 · 实测模式');
  });

  it('throws on missing frontmatter', () => {
    expect(() => parsePanelV2('/tmp/x.md', '# no yaml here\n')).toThrow(/frontmatter/);
  });

  it('throws on version != 2', () => {
    const bad = SAMPLE.replace('version: 2', 'version: 1');
    expect(() => parsePanelV2('/tmp/x.md', bad)).toThrow(/version/);
  });
});

describe('extractTypeSection', () => {
  it('extracts the 实测 section body', () => {
    const p = parsePanelV2('/tmp/opening-v2.md', SAMPLE);
    const section = extractTypeSection(p.body, '实测');
    expect(section).toContain('### 目标');
    expect(section).toContain('给读者钩子');
    expect(section).not.toContain('引语钩子');
  });

  it('returns null when type section missing', () => {
    const p = parsePanelV2('/tmp/opening-v2.md', SAMPLE);
    const section = extractTypeSection(p.body, '评论');
    expect(section).toBeNull();
  });
});
