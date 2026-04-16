import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { runDistillV2 } from '../../src/style-distiller/orchestrator-v2.js';

function buildDb(path: string) {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE ref_articles (
      id TEXT PRIMARY KEY, account TEXT, title TEXT,
      published_at TEXT, word_count INTEGER, body_plain TEXT
    );
  `);
  const ins = db.prepare(`INSERT INTO ref_articles VALUES (?,?,?,?,?,?)`);
  ins.run('a1', 'acc', '实测 X', '2026-01-01', 500, '开头段\n\n主体段\n\n结尾段');
  ins.run('a2', 'acc', '访谈 Y', '2026-02-01', 500, '访谈开头\n\n访谈主体\n\n访谈结尾');
  ins.run('a3', 'acc', '评论 Z', '2026-03-01', 500, '评论开头\n\n评论主体\n\n评论结尾');
  db.close();
}

function roleCn(role: string): string {
  return role === 'opening' ? '开头' : role === 'practice' ? '主体' : '结尾';
}

describe('runDistillV2', () => {
  it('writes 3 panel files under <vault>/08_experts/style-panel/<account>/', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'crx-v2orch-'));
    const sqlite = join(tmp, 'ref.db');
    buildDb(sqlite);

    // Mock labeler: returns type based on title keyword
    const invokeLabeler = vi.fn(async (opts: any) => {
      const text = opts.userMessage as string;
      let type: string;
      if (text.includes('实测')) type = '实测';
      else if (text.includes('访谈')) type = '访谈';
      else type = '评论';
      const pMatches = Array.from(text.matchAll(/P(\d+)\|/g)).map((m) => +m[1]!);
      const lines = pMatches.map((n, i) => {
        const role = i === 0 ? 'opening' : i === pMatches.length - 1 ? 'closing' : 'practice';
        return `  P${n}: ${role}`;
      }).join('\n');
      return {
        text: `article_type: ${type}\nparagraphs:\n${lines}`,
        meta: { cli: 'claude', durationMs: 50 },
      };
    });

    // Mock composer: returns a valid v2 panel
    const invokeComposer = vi.fn(async (opts: any) => {
      const um = opts.userMessage as string;
      const role = /role:\s*(\w+)/.exec(um)?.[1] ?? 'opening';
      return {
        text: `---
account: acc
role: ${role}
version: 2
status: active
created_at: '2026-04-16T00:00:00Z'
source_article_count: 3
types:
  - key: 实测
    sample_count: 1
  - key: 访谈
    sample_count: 1
  - key: 评论
    sample_count: 1
word_count_ranges:
  opening: [50, 200]
  article: [3500, 8000]
pronoun_policy:
  we_ratio: 0.3
  you_ratio: 0.2
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
  - 先说
data_citation:
  required: true
  format_style: 数字+单位
  min_per_article: 1
heading_cadence:
  levels_used: [h2, h3]
  paragraphs_per_h3: [5, 10]
  h3_style: 疑问句
banned_vocabulary:
  - 笔者
---

# acc · ${roleCn(role)} 风格卡 v2

## ${roleCn(role)} · 实测模式

### 目标
x

### 字数范围
50 – 200 字

### 结构骨架（三选一）
**A.** · x
**B.** · y
**C.** · z

### 高频锚词
- 锚词

### 禁止出现
- 禁止

### 示例
**示例 1** · 源 · A
> 示例正文
`,
        meta: { cli: 'claude', durationMs: 1000 },
      };
    });

    const events: any[] = [];
    const result = await runDistillV2(
      {
        account: 'acc',
        sampleSize: 3,
        runId: 'test-run',
        invokeLabeler,
        invokeComposer,
        onEvent: (e) => events.push(e),
      },
      { vaultPath: tmp, sqlitePath: sqlite },
    );

    expect(result.files).toHaveLength(3);
    expect(existsSync(join(tmp, '08_experts/style-panel/acc/opening-v2.md'))).toBe(true);
    expect(existsSync(join(tmp, '08_experts/style-panel/acc/practice-v2.md'))).toBe(true);
    expect(existsSync(join(tmp, '08_experts/style-panel/acc/closing-v2.md'))).toBe(true);

    const types = events.map((e) => e.type);
    expect(types).toContain('distill.started');
    expect(types).toContain('sampling.done');
    expect(types.filter((t) => t === 'labeling.article_done')).toHaveLength(3);
    expect(types).toContain('labeling.all_done');
    expect(types).toContain('aggregation.done');
    expect(types.filter((t) => t === 'composer.done')).toHaveLength(3);
    expect(types).toContain('distill.finished');
  });

  it('emits distill.failed on composer error', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'crx-v2orch-fail-'));
    const sqlite = join(tmp, 'ref.db');
    buildDb(sqlite);

    const invokeLabeler = vi.fn(async () => ({
      text: 'article_type: 实测\nparagraphs:\n  P1: opening\n  P2: practice\n  P3: closing',
      meta: { cli: 'claude', durationMs: 10 },
    }));
    const invokeComposer = vi.fn(async () => {
      throw new Error('llm exploded');
    });

    const events: any[] = [];
    await expect(
      runDistillV2(
        { account: 'acc', sampleSize: 1, runId: 'fail-run', invokeLabeler, invokeComposer, onEvent: (e) => events.push(e) },
        { vaultPath: tmp, sqlitePath: sqlite },
      ),
    ).rejects.toThrow(/llm exploded/);

    const types = events.map((e) => e.type);
    expect(types).toContain('distill.failed');
  });
});
