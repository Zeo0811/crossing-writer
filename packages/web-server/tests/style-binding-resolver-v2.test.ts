import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveStyleBindingV2,
  StyleVersionTooOldError,
  TypeNotInPanelError,
  StyleNotBoundError,
} from '../src/services/style-binding-resolver.js';
import { StylePanelStore } from '../src/services/style-panel-store.js';

function writeV2Panel(
  dir: string,
  account: string,
  role: string,
  types: Array<{ key: string; sample_count: number }>,
): string {
  const typesYaml = types
    .map((t) => `  - key: ${t.key}\n    sample_count: ${t.sample_count}`)
    .join('\n');
  const content = `---
account: ${account}
role: ${role}
version: 2
status: active
created_at: '2026-04-16T00:00:00Z'
source_article_count: 10
types:
${typesYaml}
word_count_ranges:
  opening: [150, 260]
  article: [3500, 8000]
pronoun_policy:
  we_ratio: 0.3
  you_ratio: 0.2
  avoid: []
tone:
  primary: 客观克制
  humor_frequency: low
  opinionated: mid
bold_policy:
  frequency: x
  what_to_bold: []
  dont_bold: []
transition_phrases: []
data_citation:
  required: false
  format_style: ''
  min_per_article: 0
heading_cadence:
  levels_used: [h2]
  paragraphs_per_h3: [5, 10]
  h3_style: ''
banned_vocabulary: []
---

# 风格卡

## ${roleCn(role)} · 实测模式

这是实测的内容。

## ${roleCn(role)} · 访谈模式

这是访谈的内容。
`;
  const fp = join(dir, `${role}-v2.md`);
  writeFileSync(fp, content);
  return fp;
}

function roleCn(role: string): string {
  return role === 'opening' ? '开头' : role === 'practice' ? '主体' : '结尾';
}

function writeV1Panel(dir: string, account: string, role: string): string {
  const content = `---
account: ${account}
role: ${role}
version: 1
status: active
created_at: '2026-01-01T00:00:00Z'
source_article_count: 10
---
# body
`;
  const fp = join(dir, `${role}-v1.md`);
  writeFileSync(fp, content);
  return fp;
}

describe('resolveStyleBindingV2', () => {
  it('resolves with articleType in panel', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'crx-bind-'));
    const acctDir = join(vault, '08_experts/style-panel/acc');
    mkdirSync(acctDir, { recursive: true });
    writeV2Panel(acctDir, 'acc', 'opening', [
      { key: '实测', sample_count: 10 },
      { key: '访谈', sample_count: 5 },
    ]);
    const store = new StylePanelStore(vault);
    const result = await resolveStyleBindingV2(
      { account: 'acc', role: 'opening' },
      '实测',
      store,
    );
    expect(result.panel.frontmatter.version).toBe(2);
    expect(result.typeSection).toContain('这是实测的内容');
    expect(result.typeSection).not.toContain('这是访谈的内容');
  });

  it('throws TypeNotInPanelError when type has zero samples', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'crx-bind-'));
    const acctDir = join(vault, '08_experts/style-panel/acc');
    mkdirSync(acctDir, { recursive: true });
    writeV2Panel(acctDir, 'acc', 'opening', [
      { key: '访谈', sample_count: 5 },
    ]);
    const store = new StylePanelStore(vault);
    await expect(
      resolveStyleBindingV2({ account: 'acc', role: 'opening' }, '实测', store),
    ).rejects.toBeInstanceOf(TypeNotInPanelError);
  });

  it('throws StyleVersionTooOldError for v1 panel', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'crx-bind-'));
    const acctDir = join(vault, '08_experts/style-panel/acc');
    mkdirSync(acctDir, { recursive: true });
    writeV1Panel(acctDir, 'acc', 'opening');
    const store = new StylePanelStore(vault);
    await expect(
      resolveStyleBindingV2({ account: 'acc', role: 'opening' }, '实测', store),
    ).rejects.toBeInstanceOf(StyleVersionTooOldError);
  });

  it('throws StyleNotBoundError when no panel exists', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'crx-bind-'));
    mkdirSync(join(vault, '08_experts/style-panel'), { recursive: true });
    const store = new StylePanelStore(vault);
    await expect(
      resolveStyleBindingV2({ account: 'nobody', role: 'opening' }, '实测', store),
    ).rejects.toBeInstanceOf(StyleNotBoundError);
  });
});
