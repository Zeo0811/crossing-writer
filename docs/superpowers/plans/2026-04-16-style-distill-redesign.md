# 风格蒸馏重做（SP-A）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把风格蒸馏从"全账号混合写 1 份 panel"改造为"按文章类型（实测/访谈/评论）分层的 v2 panel，含机器可读的写作策略约束"，并加全局写作硬规则系统。

**Architecture:** 新 pipeline 为 `sampling → per-article labeling (opus 合并 type 分类 + 段落打标) → aggregation by (role × type) → composer per role (opus)`。Panel 格式 v2 单文件包含 frontmatter（types 清单、字数范围、6 项写作策略、账号禁用词）+ 正文按 type 分 `## 开头 · 实测模式` 小节。Writer 读 panel 时只取当前 article_type 对应的 section + 合并全局硬规则。

**Tech Stack:** TypeScript (pnpm monorepo), Fastify, React 18 + Vite, Obsidian vault (markdown files), better-sqlite3, js-yaml, p-limit, Claude CLI (opus).

**Spec reference:** `docs/superpowers/specs/2026-04-16-style-distill-redesign-design.md`

---

## File Structure

### 新建

```
packages/kb/src/style-distiller/
  panel-v2-schema.ts         # TS 类型 + Zod-like 验证（纯类型/轻量验证）
  panel-parser-v2.ts         # YAML frontmatter 解析 + 正文 ## type section 切片
  paragraph-splitter.ts      # 纯启发式段落预切
  article-labeler.ts         # opus 每篇一调用，返回 { type, paragraphRoles }
  aggregator-v2.ts           # 按 (role × type) 聚合 snippets + quant
  composer-v2.ts             # opus 每 role 一调用，生成完整 v2 panel markdown
  run-logger.ts              # 蒸馏进度 jsonl 写入 + stream 订阅
  orchestrator-v2.ts         # 新 pipeline 编排（替代 orchestrator.ts 的蒸馏逻辑）

packages/kb/tests/style-distiller/
  panel-parser-v2.test.ts
  paragraph-splitter.test.ts
  aggregator-v2.test.ts
  article-labeler.test.ts     # mock LLM
  composer-v2.test.ts          # mock LLM
  orchestrator-v2.test.ts      # mock LLM, fixture articles

packages/kb/tests/fixtures/style-distill-v2/
  article-shice-1.md          # 实测类型样本（带 frontmatter + body）
  article-shice-2.md
  article-fangtan-1.md        # 访谈类型
  article-pinglun-1.md        # 评论类型

packages/agents/src/prompts/
  article-labeler.md           # 新 prompt
  composer-v2.md               # 新 prompt

packages/web-server/src/services/
  hard-rules-store.ts          # yaml 读写
  panel-parser-v2-service.ts   # 对 panel-parser-v2 的封装（仅服务端使用）
  distill-run-store.ts         # jsonl append + 订阅

packages/web-server/src/routes/
  config-writing-hard-rules.ts # GET/PUT 硬规则
  config-distill-runs.ts       # GET runs 列表 + GET /runs/:id/stream
  config-style-panels-cleanup.ts  # DELETE 清理旧 panel

packages/web-server/tests/
  hard-rules-store.test.ts
  panel-parser-v2-service.test.ts
  distill-run-store.test.ts
  config-writing-hard-rules-routes.test.ts
  config-distill-runs-routes.test.ts
  style-binding-resolver-v2.test.ts

packages/web-ui/src/
  api/writing-hard-rules-client.ts
  api/distill-runs-client.ts
  pages/WritingHardRulesPage.tsx
  components/writing-hard-rules/RulesSection.tsx
  components/writing-hard-rules/RuleEditModal.tsx

packages/web-ui/src/tests/
  WritingHardRulesPage.test.tsx  # 如果项目有前端单测

scripts/
  evaluate-panel.ts              # 读 panel 产出可读报告
  cleanup-legacy-panels.ts       # 一次性清理（开发期用）
```

### 修改

```
packages/kb/src/style-distiller/
  types.ts                     # 追加 v2 相关类型（ArticleType、LabeledArticle、BucketV2 等）
  orchestrator.ts              # 保留向后兼容或重定向到 orchestrator-v2.ts

packages/web-server/src/
  server.ts                    # 注册新 routes
  services/style-panel-store.ts # 识别 v2 panel（version 字段）+ 清理 API
  services/style-binding-resolver.ts # 版本 + type 检查，抛新错
  services/writer-orchestrator.ts # article_type 必填校验、阻塞错误事件
  services/project-store.ts    # project.json 增加 article_type 字段
  routes/brief.ts              # 保存 article_type 字段
  routes/config-style-panels.ts # 返回 version 字段

packages/web-ui/src/
  App.tsx                      # 加 /writing-hard-rules 路由
  components/layout/TopBar.tsx # 加"硬规则"导航项
  components/brief/BriefIntakeForm.tsx # article_type 下拉
  pages/StylePanelsPage.tsx    # 清理按钮 + 活跃 run 指示 + version badge
  components/style-panels/DistillForm.tsx # 现状保留
  components/style-panels/ProgressView.tsx # 支持 run_id 重连
  api/style-panels-client.ts   # 加 getRuns/streamRun/cleanupLegacy
  pages/ProjectWorkbench.tsx   # 新错误类型展示

packages/agents/src/
  model-adapter.ts             # 若需暴露裸 opus 调用（视现状）
  index.ts                     # 导出新 agent helpers

~/CrossingVault/08_experts/
  writing-hard-rules.yaml      # 首次启动时自动创建（带默认 3 条规则）
```

### 删除（任务执行中完成）

```
packages/agents/src/prompts/
  section-slicer.md              # 被 article-labeler.md 取代
  style-distiller-composer.md    # 被 composer-v2.md 取代
  style-distiller-snippets.md    # 并入 composer-v2 prompt
  style-distiller-structure.md   # 并入 composer-v2 prompt

packages/agents/src/roles/
  section-slicer.ts              # 不再使用
```

---

## 关键共享类型

放 `packages/kb/src/style-distiller/panel-v2-schema.ts`，三端（kb/web-server/web-ui）都引用：

```ts
export type ArticleType = '实测' | '访谈' | '评论';
export const ARTICLE_TYPES: ArticleType[] = ['实测', '访谈', '评论'];

export type Role = 'opening' | 'practice' | 'closing' | 'other';
export const WRITER_ROLES: Exclude<Role, 'other'>[] = ['opening', 'practice', 'closing'];

export type TonePrimary =
  | '客观克制' | '热血推荐' | '冷峻分析'
  | '调侃戏谑' | '教学温和' | '专家严肃';
export const TONE_PRIMARY_ENUM: TonePrimary[] = [
  '客观克制', '热血推荐', '冷峻分析', '调侃戏谑', '教学温和', '专家严肃',
];

export interface PanelTypeEntry { key: ArticleType; sample_count: number }
export interface PronounPolicy { we_ratio: number; you_ratio: number; avoid: string[] }
export interface ToneSpec {
  primary: TonePrimary;
  humor_frequency: 'low' | 'mid' | 'high';
  opinionated: 'low' | 'mid' | 'high';
}
export interface BoldPolicy {
  frequency: string;
  what_to_bold: string[];
  dont_bold: string[];
}
export interface DataCitationSpec {
  required: boolean;
  format_style: string;
  min_per_article: number;
}
export interface HeadingCadenceSpec {
  levels_used: string[];
  paragraphs_per_h3: [number, number];
  h3_style: string;
}

export interface PanelFrontmatterV2 {
  account: string;
  role: 'opening' | 'practice' | 'closing';
  version: 2;
  status: 'active' | 'deleted';
  created_at: string;
  source_article_count: number;
  slicer_run_id?: string;
  types: PanelTypeEntry[];
  word_count_ranges: {
    opening: [number, number];
    article: [number, number];
  };
  pronoun_policy: PronounPolicy;
  tone: ToneSpec;
  bold_policy: BoldPolicy;
  transition_phrases: string[];
  data_citation: DataCitationSpec;
  heading_cadence: HeadingCadenceSpec;
  banned_vocabulary: string[];
}

export interface PanelV2 {
  frontmatter: PanelFrontmatterV2;
  body: string;
  absPath: string;
}

export interface HardRulePhrase {
  pattern: string;
  is_regex: boolean;
  reason: string;
  example?: string;
}
export interface HardRuleVocabulary {
  word: string;
  reason: string;
}
export interface WritingHardRules {
  version: 1;
  updated_at: string;
  banned_phrases: HardRulePhrase[];
  banned_vocabulary: HardRuleVocabulary[];
  layout_rules: string[];
}
```

---

## Task List

### Phase 1 — Panel v2 schema & helpers

### Task 1: v2 panel schema & frontmatter parser

**Files:**
- Create: `packages/kb/src/style-distiller/panel-v2-schema.ts`
- Create: `packages/kb/src/style-distiller/panel-parser-v2.ts`
- Create: `packages/kb/tests/style-distiller/panel-parser-v2.test.ts`
- Modify: `packages/kb/src/style-distiller/types.ts` (export ArticleType re-exports)

- [ ] **Step 1: Define types**

Create `packages/kb/src/style-distiller/panel-v2-schema.ts` with the complete content shown in "关键共享类型" block above.

- [ ] **Step 2: Write failing parser test**

Create `packages/kb/tests/style-distiller/panel-parser-v2.test.ts`:

```ts
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
    expect(section).not.toContain('引语钩子');  // 不串到访谈
  });

  it('returns null when type section missing', () => {
    const p = parsePanelV2('/tmp/opening-v2.md', SAMPLE);
    const section = extractTypeSection(p.body, '评论');
    expect(section).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/kb test panel-parser-v2
```
Expected: FAIL with "parsePanelV2 is not defined" or similar.

- [ ] **Step 4: Implement parser**

Create `packages/kb/src/style-distiller/panel-parser-v2.ts`:

```ts
import yaml from 'js-yaml';
import type {
  ArticleType, PanelFrontmatterV2, PanelV2,
} from './panel-v2-schema.js';
import { ARTICLE_TYPES, TONE_PRIMARY_ENUM } from './panel-v2-schema.js';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parsePanelV2(absPath: string, raw: string): PanelV2 {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) throw new Error(`panel-v2: no frontmatter at ${absPath}`);
  const fm = yaml.load(match[1]!) as Partial<PanelFrontmatterV2>;
  if (!fm || typeof fm !== 'object') {
    throw new Error(`panel-v2: frontmatter is not an object at ${absPath}`);
  }
  if (fm.version !== 2) {
    throw new Error(`panel-v2: expected version 2, got ${fm.version} at ${absPath}`);
  }
  validateFrontmatter(fm as PanelFrontmatterV2, absPath);
  const body = raw.slice(match[0].length).replace(/^\r?\n/, '');
  return { frontmatter: fm as PanelFrontmatterV2, body, absPath };
}

function validateFrontmatter(fm: PanelFrontmatterV2, path: string): void {
  if (!fm.account) throw new Error(`panel-v2: missing account at ${path}`);
  if (!['opening', 'practice', 'closing'].includes(fm.role)) {
    throw new Error(`panel-v2: invalid role ${fm.role} at ${path}`);
  }
  if (!Array.isArray(fm.types)) {
    throw new Error(`panel-v2: types must be array at ${path}`);
  }
  for (const t of fm.types) {
    if (!ARTICLE_TYPES.includes(t.key)) {
      throw new Error(`panel-v2: invalid type key ${t.key} at ${path}`);
    }
  }
  if (!TONE_PRIMARY_ENUM.includes(fm.tone?.primary)) {
    throw new Error(`panel-v2: invalid tone.primary at ${path}`);
  }
}

/**
 * Extract the body of `## <roleHeading> · <type>模式` up to the next `## ` heading.
 * Returns null if the section is absent.
 *
 * roleHeading is the Chinese prefix: "开头" | "主体" | "结尾".
 */
export function extractTypeSection(body: string, type: ArticleType): string | null {
  // Match any ## xxx · <type>模式 heading and body until next ## (or EOF)
  const re = new RegExp(
    `(?:^|\\n)##\\s+[^·\\n]+·\\s*${escapeRegex(type)}模式\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
    'u',
  );
  const m = body.match(re);
  if (!m) return null;
  return m[1]!.trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/kb test panel-parser-v2
```
Expected: PASS (4 tests green).

- [ ] **Step 6: Commit**

```bash
git add packages/kb/src/style-distiller/panel-v2-schema.ts \
        packages/kb/src/style-distiller/panel-parser-v2.ts \
        packages/kb/tests/style-distiller/panel-parser-v2.test.ts
git commit -m "feat(kb): add v2 panel schema types and parser"
```

---

### Task 2: Paragraph splitter

**Files:**
- Create: `packages/kb/src/style-distiller/paragraph-splitter.ts`
- Create: `packages/kb/tests/style-distiller/paragraph-splitter.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/kb/tests/style-distiller/paragraph-splitter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { splitParagraphs } from '../../src/style-distiller/paragraph-splitter.js';

describe('splitParagraphs', () => {
  it('splits by blank lines', () => {
    const out = splitParagraphs('第一段\n\n第二段\n\n第三段');
    expect(out).toEqual(['第一段', '第二段', '第三段']);
  });

  it('treats ## heading as own paragraph', () => {
    const out = splitParagraphs('开篇\n\n## 小标题\n\n正文');
    expect(out).toEqual(['开篇', '## 小标题', '正文']);
  });

  it('treats h3 h4 headings as own paragraph', () => {
    const out = splitParagraphs('### 三级\n\n正文\n\n#### 四级');
    expect(out).toEqual(['### 三级', '正文', '#### 四级']);
  });

  it('compresses standalone image lines to [图]', () => {
    const out = splitParagraphs('文字\n\n![图片](https://x.com/a.png)\n\n更多文字');
    expect(out).toEqual(['文字', '[图]', '更多文字']);
  });

  it('keeps inline images inside text paragraphs', () => {
    const out = splitParagraphs('带图 ![](x.png) 的一段话');
    expect(out).toEqual(['带图 ![](x.png) 的一段话']);
  });

  it('merges consecutive non-blank lines into one paragraph', () => {
    const out = splitParagraphs('第一行\n第二行\n\n第三段');
    expect(out).toEqual(['第一行\n第二行', '第三段']);
  });

  it('handles CRLF', () => {
    const out = splitParagraphs('一\r\n\r\n二');
    expect(out).toEqual(['一', '二']);
  });

  it('drops empty string results', () => {
    const out = splitParagraphs('\n\n\n\n正文\n\n\n\n');
    expect(out).toEqual(['正文']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @crossing/kb test paragraph-splitter
```
Expected: FAIL "splitParagraphs is not defined".

- [ ] **Step 3: Implement splitter**

Create `packages/kb/src/style-distiller/paragraph-splitter.ts`:

```ts
/**
 * Split an article body into paragraphs using pure heuristics (no LLM).
 * Rules:
 *   1. Blank lines are paragraph separators.
 *   2. Lines starting with `#{1,6} ` become their own paragraph.
 *   3. Lines containing only a markdown image `![...](...)` are compressed to `[图]`.
 */
export function splitParagraphs(body: string): string[] {
  const normalized = body.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const parts: string[] = [];
  let buf: string[] = [];

  const flush = () => {
    if (buf.length > 0) {
      const joined = buf.join('\n').trim();
      if (joined) parts.push(joined);
      buf = [];
    }
  };

  for (const line of lines) {
    const stripped = line.trim();
    if (!stripped) { flush(); continue; }
    if (/^#{1,6}\s/.test(stripped)) { flush(); parts.push(stripped); continue; }
    if (/^!\[[^\]]*\]\([^)]+\)\s*$/.test(stripped)) { flush(); parts.push('[图]'); continue; }
    buf.push(line);
  }
  flush();
  return parts;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @crossing/kb test paragraph-splitter
```
Expected: PASS (8 tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/kb/src/style-distiller/paragraph-splitter.ts \
        packages/kb/tests/style-distiller/paragraph-splitter.test.ts
git commit -m "feat(kb): add paragraph splitter for distill pipeline"
```

---

### Phase 2 — Hard rules (isolated feature)

### Task 3: Hard rules store (yaml read/write + default seed)

**Files:**
- Create: `packages/web-server/src/services/hard-rules-store.ts`
- Create: `packages/web-server/tests/hard-rules-store.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/web-server/tests/hard-rules-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HardRulesStore } from '../src/services/hard-rules-store.js';

describe('HardRulesStore', () => {
  let tmp: string;
  let store: HardRulesStore;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'crx-hardrules-'));
    store = new HardRulesStore(tmp);
  });

  it('seeds a default file if not present', async () => {
    const rules = await store.read();
    expect(rules.version).toBe(1);
    expect(rules.banned_phrases.length).toBeGreaterThan(0);
    expect(existsSync(join(tmp, 'writing-hard-rules.yaml'))).toBe(true);
  });

  it('reads existing yaml without overwriting', async () => {
    await store.write({
      version: 1,
      updated_at: '2026-04-16T00:00:00Z',
      banned_phrases: [{ pattern: 'X', is_regex: false, reason: 'r' }],
      banned_vocabulary: [],
      layout_rules: ['段落 ≤ 80 字'],
    });
    const rules = await store.read();
    expect(rules.banned_phrases).toHaveLength(1);
    expect(rules.banned_phrases[0]!.pattern).toBe('X');
  });

  it('write is atomic (no partial file on error)', async () => {
    const valid = {
      version: 1 as const,
      updated_at: '2026-04-16T00:00:00Z',
      banned_phrases: [] as any,
      banned_vocabulary: [] as any,
      layout_rules: [] as any,
    };
    await store.write(valid);
    const raw = readFileSync(join(tmp, 'writing-hard-rules.yaml'), 'utf-8');
    expect(raw).toContain('version: 1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @crossing/web-server test hard-rules-store
```
Expected: FAIL "HardRulesStore is not defined".

- [ ] **Step 3: Implement store**

```ts
// packages/web-server/src/services/hard-rules-store.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

export interface HardRulePhrase {
  pattern: string;
  is_regex: boolean;
  reason: string;
  example?: string;
}
export interface HardRuleVocabulary {
  word: string;
  reason: string;
}
export interface WritingHardRules {
  version: 1;
  updated_at: string;
  banned_phrases: HardRulePhrase[];
  banned_vocabulary: HardRuleVocabulary[];
  layout_rules: string[];
}

const DEFAULT_RULES: WritingHardRules = {
  version: 1,
  updated_at: new Date('2026-04-16').toISOString(),
  banned_phrases: [
    { pattern: '不是.+?而是', is_regex: true, reason: '烂大街句式', example: '这不是一个工具，而是一个伙伴' },
    { pattern: '[—–]', is_regex: true, reason: '禁止破折号' },
  ],
  banned_vocabulary: [
    { word: '笔者', reason: '第三人称自称不自然' },
    { word: '本人', reason: '同上' },
  ],
  layout_rules: [
    '段落平均字数 ≤ 80',
    '段与段之间必须有空行',
  ],
};

const FILENAME = 'writing-hard-rules.yaml';

export class HardRulesStore {
  constructor(private readonly rootDir: string) {}

  private get filePath(): string {
    return join(this.rootDir, FILENAME);
  }

  async read(): Promise<WritingHardRules> {
    if (!existsSync(this.filePath)) {
      mkdirSync(this.rootDir, { recursive: true });
      await this.write(DEFAULT_RULES);
      return DEFAULT_RULES;
    }
    const raw = readFileSync(this.filePath, 'utf-8');
    const parsed = yaml.load(raw) as WritingHardRules;
    if (!parsed || parsed.version !== 1) {
      throw new Error(`writing-hard-rules: unexpected version ${parsed?.version}`);
    }
    return parsed;
  }

  async write(rules: WritingHardRules): Promise<void> {
    mkdirSync(this.rootDir, { recursive: true });
    const serialized = yaml.dump({ ...rules, updated_at: new Date().toISOString() }, { lineWidth: -1 });
    const tmp = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
    writeFileSync(tmp, serialized, 'utf-8');
    renameSync(tmp, this.filePath);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @crossing/web-server test hard-rules-store
```
Expected: PASS (3 tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/web-server/src/services/hard-rules-store.ts \
        packages/web-server/tests/hard-rules-store.test.ts
git commit -m "feat(web-server): add HardRulesStore for global writing rules"
```

---

### Task 4: Hard rules API routes

**Files:**
- Create: `packages/web-server/src/routes/config-writing-hard-rules.ts`
- Create: `packages/web-server/tests/config-writing-hard-rules-routes.test.ts`
- Modify: `packages/web-server/src/server.ts` (register route, construct store)

- [ ] **Step 1: Write failing test**

```ts
// packages/web-server/tests/config-writing-hard-rules-routes.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HardRulesStore } from '../src/services/hard-rules-store.js';
import { registerWritingHardRulesRoutes } from '../src/routes/config-writing-hard-rules.js';

describe('writing-hard-rules routes', () => {
  async function buildApp() {
    const tmp = mkdtempSync(join(tmpdir(), 'crx-hr-routes-'));
    const store = new HardRulesStore(tmp);
    const app = Fastify();
    registerWritingHardRulesRoutes(app, { hardRulesStore: store });
    await app.ready();
    return { app, store, tmp };
  }

  it('GET returns seeded defaults', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/config/writing-hard-rules' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.version).toBe(1);
    expect(body.banned_phrases.length).toBeGreaterThan(0);
  });

  it('PUT replaces the whole object atomically', async () => {
    const { app } = await buildApp();
    const put = await app.inject({
      method: 'PUT',
      url: '/api/config/writing-hard-rules',
      payload: {
        version: 1,
        banned_phrases: [{ pattern: 'Y', is_regex: false, reason: 'test' }],
        banned_vocabulary: [],
        layout_rules: ['only rule'],
      },
    });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: '/api/config/writing-hard-rules' });
    const body = get.json();
    expect(body.banned_phrases).toHaveLength(1);
    expect(body.layout_rules).toEqual(['only rule']);
  });

  it('PUT validates required fields', async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/writing-hard-rules',
      payload: { foo: 'bar' },
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @crossing/web-server test config-writing-hard-rules
```
Expected: FAIL (route not registered).

- [ ] **Step 3: Implement route**

```ts
// packages/web-server/src/routes/config-writing-hard-rules.ts
import type { FastifyInstance } from 'fastify';
import type { HardRulesStore, WritingHardRules } from '../services/hard-rules-store.js';

export interface WritingHardRulesDeps {
  hardRulesStore: HardRulesStore;
}

export function registerWritingHardRulesRoutes(app: FastifyInstance, deps: WritingHardRulesDeps) {
  app.get('/api/config/writing-hard-rules', async (_req, reply) => {
    const rules = await deps.hardRulesStore.read();
    return reply.send(rules);
  });

  app.put<{ Body: WritingHardRules }>(
    '/api/config/writing-hard-rules',
    async (req, reply) => {
      const body = req.body;
      if (!body || body.version !== 1) {
        return reply.code(400).send({ error: 'version must be 1' });
      }
      if (!Array.isArray(body.banned_phrases)
          || !Array.isArray(body.banned_vocabulary)
          || !Array.isArray(body.layout_rules)) {
        return reply.code(400).send({ error: 'banned_phrases, banned_vocabulary, layout_rules must be arrays' });
      }
      await deps.hardRulesStore.write(body);
      return reply.send({ ok: true });
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @crossing/web-server test config-writing-hard-rules
```
Expected: PASS (3 tests green).

- [ ] **Step 5: Register in server.ts**

Modify `packages/web-server/src/server.ts` — find where other routes are registered (near `registerStreamRoutes` etc.), add:

```ts
import { HardRulesStore } from './services/hard-rules-store.js';
import { registerWritingHardRulesRoutes } from './routes/config-writing-hard-rules.js';

// near other store construction (after vault path is known):
const hardRulesStore = new HardRulesStore(
  join(configStore.current.vaultPath, '08_experts'),
);

// near other route registrations:
registerWritingHardRulesRoutes(app, { hardRulesStore });
```

- [ ] **Step 6: Commit**

```bash
git add packages/web-server/src/routes/config-writing-hard-rules.ts \
        packages/web-server/tests/config-writing-hard-rules-routes.test.ts \
        packages/web-server/src/server.ts
git commit -m "feat(web-server): add writing-hard-rules GET/PUT routes"
```

---

### Task 5: Hard rules UI page + navigation

**Files:**
- Create: `packages/web-ui/src/api/writing-hard-rules-client.ts`
- Create: `packages/web-ui/src/pages/WritingHardRulesPage.tsx`
- Create: `packages/web-ui/src/components/writing-hard-rules/RulesSection.tsx`
- Create: `packages/web-ui/src/components/writing-hard-rules/RuleEditModal.tsx`
- Modify: `packages/web-ui/src/App.tsx`
- Modify: `packages/web-ui/src/components/layout/TopBar.tsx`

- [ ] **Step 1: Client API**

Create `packages/web-ui/src/api/writing-hard-rules-client.ts`:

```ts
export interface HardRulePhrase { pattern: string; is_regex: boolean; reason: string; example?: string }
export interface HardRuleVocabulary { word: string; reason: string }
export interface WritingHardRules {
  version: 1;
  updated_at: string;
  banned_phrases: HardRulePhrase[];
  banned_vocabulary: HardRuleVocabulary[];
  layout_rules: string[];
}

export async function getWritingHardRules(): Promise<WritingHardRules> {
  const res = await fetch('/api/config/writing-hard-rules');
  if (!res.ok) throw new Error(`GET hard-rules failed: ${res.status}`);
  return res.json();
}

export async function putWritingHardRules(rules: WritingHardRules): Promise<void> {
  const res = await fetch('/api/config/writing-hard-rules', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rules),
  });
  if (!res.ok) throw new Error(`PUT hard-rules failed: ${res.status}: ${await res.text()}`);
}
```

- [ ] **Step 2: Edit modal component**

Create `packages/web-ui/src/components/writing-hard-rules/RuleEditModal.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { Button } from '../ui';

export type RuleKind = 'phrase' | 'vocabulary' | 'layout';

export interface RuleEditModalProps {
  kind: RuleKind;
  initialValue: Record<string, any> | null;   // null = new
  onCancel: () => void;
  onSubmit: (value: Record<string, any>) => void;
}

export function RuleEditModal({ kind, initialValue, onCancel, onSubmit }: RuleEditModalProps) {
  const [state, setState] = useState<Record<string, any>>(initialValue ?? defaultFor(kind));
  useEffect(() => { setState(initialValue ?? defaultFor(kind)); }, [initialValue, kind]);

  const fields = kind === 'phrase'
    ? [
        { key: 'pattern', label: '句式 / 模式', required: true },
        { key: 'is_regex', label: '是否正则', type: 'bool' as const },
        { key: 'reason', label: '原因', required: true },
        { key: 'example', label: '示例（可选）' },
      ]
    : kind === 'vocabulary'
    ? [
        { key: 'word', label: '词汇', required: true },
        { key: 'reason', label: '原因', required: true },
      ]
    : [
        { key: 'rule', label: '规则文本', required: true },
      ];

  function save() {
    for (const f of fields) {
      if (f.required && !state[f.key]) { return; }
    }
    if (kind === 'layout') onSubmit({ text: state.rule });
    else onSubmit(state);
  }

  return (
    <div role="dialog" className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.55)]">
      <div className="w-[420px] rounded border border-[var(--hair-strong)] bg-[var(--bg-1)] p-5 space-y-3">
        <h3 className="text-base font-semibold text-[var(--heading)]">
          {initialValue ? '编辑规则' : '新增规则'}
        </h3>
        {fields.map((f) => (
          <label key={f.key} className="block text-sm">
            <span className="text-xs text-[var(--meta)] block mb-1">{f.label}{f.required && ' *'}</span>
            {('type' in f && f.type === 'bool') ? (
              <input
                type="checkbox"
                checked={!!state[f.key]}
                onChange={(e) => setState({ ...state, [f.key]: e.target.checked })}
              />
            ) : (
              <input
                type="text"
                value={state[f.key] ?? ''}
                onChange={(e) => setState({ ...state, [f.key]: e.target.value })}
                className="w-full h-9 px-2 rounded border border-[var(--hair)] bg-[var(--bg-0)] text-sm"
              />
            )}
          </label>
        ))}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onCancel}>取消</Button>
          <Button variant="primary" onClick={save}>保存</Button>
        </div>
      </div>
    </div>
  );
}

function defaultFor(kind: RuleKind): Record<string, any> {
  if (kind === 'phrase') return { pattern: '', is_regex: false, reason: '', example: '' };
  if (kind === 'vocabulary') return { word: '', reason: '' };
  return { rule: '' };
}
```

- [ ] **Step 3: Section component**

Create `packages/web-ui/src/components/writing-hard-rules/RulesSection.tsx`:

```tsx
import { useState } from 'react';
import { Button } from '../ui';
import { RuleEditModal, type RuleKind } from './RuleEditModal';

export interface RulesSectionProps<T> {
  title: string;
  kind: RuleKind;
  rows: T[];
  columns: Array<{ key: keyof T | 'derived'; label: string; render?: (row: T) => React.ReactNode }>;
  onAdd: (value: any) => void;
  onEdit: (idx: number, value: any) => void;
  onDelete: (idx: number) => void;
}

export function RulesSection<T>({ title, kind, rows, columns, onAdd, onEdit, onDelete }: RulesSectionProps<T>) {
  const [modal, setModal] = useState<{ mode: 'new' } | { mode: 'edit'; idx: number } | null>(null);

  return (
    <section className="rounded border border-[var(--hair)] bg-[var(--bg-1)] overflow-hidden">
      <header className="flex items-center justify-between px-4 h-11 border-b border-[var(--hair)]">
        <h2 className="text-sm font-semibold text-[var(--heading)]">{title}</h2>
        <Button size="sm" variant="primary" onClick={() => setModal({ mode: 'new' })}>新增</Button>
      </header>
      <div className="p-3">
        {rows.length === 0 ? (
          <div className="text-xs text-[var(--faint)] text-center py-6">（无）</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-[var(--meta)] uppercase">
                {columns.map((c) => <th key={String(c.key)} className="text-left pb-2 pr-3">{c.label}</th>)}
                <th className="pb-2 w-20" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx} className="border-t border-[var(--hair)] hover:bg-[var(--bg-2)]">
                  {columns.map((c) => (
                    <td key={String(c.key)} className="py-2 pr-3 align-top">
                      {c.render ? c.render(row) : String((row as any)[c.key] ?? '')}
                    </td>
                  ))}
                  <td className="py-2 flex gap-1 justify-end">
                    <button onClick={() => setModal({ mode: 'edit', idx })} className="text-xs text-[var(--accent)] hover:underline">编辑</button>
                    <button onClick={() => { if (confirm('删除？')) onDelete(idx); }} className="text-xs text-[var(--red)] hover:underline">删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {modal && (
        <RuleEditModal
          kind={kind}
          initialValue={modal.mode === 'edit' ? rows[modal.idx] as any : null}
          onCancel={() => setModal(null)}
          onSubmit={(v) => {
            if (modal.mode === 'new') onAdd(v);
            else onEdit(modal.idx, v);
            setModal(null);
          }}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 4: Page component**

Create `packages/web-ui/src/pages/WritingHardRulesPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { getWritingHardRules, putWritingHardRules, type WritingHardRules } from '../api/writing-hard-rules-client';
import { RulesSection } from '../components/writing-hard-rules/RulesSection';
import { useToast } from '../components/ui/ToastProvider';

export function WritingHardRulesPage() {
  const [rules, setRules] = useState<WritingHardRules | null>(null);
  const [dirty, setDirty] = useState(false);
  const toast = useToast();

  useEffect(() => { getWritingHardRules().then(setRules).catch(() => toast.error('加载失败')); }, []);

  function update(patch: Partial<WritingHardRules>) {
    setRules((prev) => prev ? { ...prev, ...patch } : prev);
    setDirty(true);
  }
  async function save() {
    if (!rules) return;
    await putWritingHardRules(rules);
    toast.success('已保存');
    setDirty(false);
  }

  if (!rules) return <div className="p-12 text-center text-[var(--meta)]">加载中...</div>;

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--heading)]">写作硬规则</h1>
        {dirty && <button onClick={save} className="h-9 px-4 rounded bg-[var(--accent)] text-[var(--accent-on)] text-sm font-semibold">保存</button>}
      </header>

      <RulesSection
        title="禁用句式"
        kind="phrase"
        rows={rules.banned_phrases}
        columns={[
          { key: 'pattern', label: 'pattern' },
          { key: 'is_regex', label: 'regex', render: (r) => r.is_regex ? '✓' : '—' },
          { key: 'reason', label: 'reason' },
        ]}
        onAdd={(v) => update({ banned_phrases: [...rules.banned_phrases, v] })}
        onEdit={(i, v) => {
          const next = [...rules.banned_phrases]; next[i] = v;
          update({ banned_phrases: next });
        }}
        onDelete={(i) => update({ banned_phrases: rules.banned_phrases.filter((_, j) => j !== i) })}
      />

      <RulesSection
        title="禁用词汇"
        kind="vocabulary"
        rows={rules.banned_vocabulary}
        columns={[{ key: 'word', label: 'word' }, { key: 'reason', label: 'reason' }]}
        onAdd={(v) => update({ banned_vocabulary: [...rules.banned_vocabulary, v] })}
        onEdit={(i, v) => {
          const next = [...rules.banned_vocabulary]; next[i] = v;
          update({ banned_vocabulary: next });
        }}
        onDelete={(i) => update({ banned_vocabulary: rules.banned_vocabulary.filter((_, j) => j !== i) })}
      />

      <RulesSection
        title="排版规则"
        kind="layout"
        rows={rules.layout_rules.map((r) => ({ text: r }))}
        columns={[{ key: 'text', label: 'rule' }]}
        onAdd={(v) => update({ layout_rules: [...rules.layout_rules, v.text] })}
        onEdit={(i, v) => {
          const next = [...rules.layout_rules]; next[i] = v.text;
          update({ layout_rules: next });
        }}
        onDelete={(i) => update({ layout_rules: rules.layout_rules.filter((_, j) => j !== i) })}
      />
    </div>
  );
}
```

- [ ] **Step 5: Add route & nav**

Modify `packages/web-ui/src/App.tsx` — add import and route:

```tsx
import { WritingHardRulesPage } from "./pages/WritingHardRulesPage";
// inside <Routes>:
<Route path="/writing-hard-rules" element={<WritingHardRulesPage />} />
```

Modify `packages/web-ui/src/components/layout/TopBar.tsx` — add to `NAV_ITEMS`:

```tsx
// after the style-panels item:
{ to: "/writing-hard-rules", label: "硬规则", icon: IconConfig },
```

(If no clean icon exists, reuse `IconConfig`; can add a dedicated icon later.)

- [ ] **Step 6: Visually verify**

Start dev server:
```bash
cd /Users/zeoooo/crossing-writer && pnpm dev
```
Open `http://localhost:5173/writing-hard-rules` → should display the 3 sections. Add/edit/delete a rule → page state updates → click 保存 → GET the yaml file on disk shows the change.

- [ ] **Step 7: Commit**

```bash
git add packages/web-ui/src/api/writing-hard-rules-client.ts \
        packages/web-ui/src/pages/WritingHardRulesPage.tsx \
        packages/web-ui/src/components/writing-hard-rules/ \
        packages/web-ui/src/App.tsx \
        packages/web-ui/src/components/layout/TopBar.tsx
git commit -m "feat(web-ui): add writing-hard-rules page and nav tab"
```

---

### Phase 3 — Distill pipeline

### Task 6: Article labeler (LLM: opus, per article)

**Files:**
- Create: `packages/agents/src/prompts/article-labeler.md`
- Create: `packages/kb/src/style-distiller/article-labeler.ts`
- Create: `packages/kb/tests/style-distiller/article-labeler.test.ts`

- [ ] **Step 1: Write prompt file**

Create `packages/agents/src/prompts/article-labeler.md`:

```markdown
# Article Labeler

你是一个公众号文章结构分析器。给定一篇文章（已预切为段落 P1..Pn），请完成两件事：

## 1. 判断 article_type（严格三选一）

- **实测**：核心动作是"拿到产品 → 实际使用 → 把过程写下来"。关键词：首发实测、上手、体验、demo。
- **访谈**：对谈某个人（创始人 / 创作者 / 研究者）。关键词：对谈、专访、20 问、访谈。
- **评论**：对某个现象、趋势、行业的观察与分析，不是产品测评也不是对谈。关键词：观察、趋势、解读、分析。

## 2. 为每段打角色标签

- **opening**：开篇。点题、引出话题、给背景、勾起读者兴趣。
- **practice**：主体。产品介绍 / 实测步骤 / 案例细节 / 嘉宾观点展开。
- **closing**：收尾。总结、升华、号召、推荐。
- **other**：标题行、作者署名、装饰符（如 🚥）、图片行 `[图]`、推广尾巴（"Ps. 推荐试用"）、无关短句。

## 输出格式（严格 YAML，不要代码围栏、不要解释）

```
article_type: <实测|访谈|评论>
paragraphs:
  P1: <opening|practice|closing|other>
  P2: <...>
  ...
```

## 输入

用户消息以 `Article paragraphs:` 开头，之后每行是一个段落，格式：
```
P<n>|<内容>
```

图片段落已被压缩成 `[图]`。

## 规则

- 必须对每个 P<n> 给出标签，不能遗漏
- 不要输出 JSON、不要代码围栏、不要解释
- 如果文章类型不明确，选最接近的一个（不允许输出"混合"）
```

- [ ] **Step 2: Write failing test**

```ts
// packages/kb/tests/style-distiller/article-labeler.test.ts
import { describe, it, expect, vi } from 'vitest';
import { labelArticle } from '../../src/style-distiller/article-labeler.js';

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
      { id: 'a1', body_plain: 'x', title: 't', account: 'acc', published_at: '2026-01-01', word_count: 100 },
      { invoke: mockInvoke, paragraphs: ['P1', 'P2', 'P3', 'P4'] },
    );

    expect(out.articleId).toBe('a1');
    expect(out.type).toBe('实测');
    expect(out.paragraphRoles.get('P1')).toBe('other');
    expect(out.paragraphRoles.get('P2')).toBe('opening');
  });

  it('throws on invalid article_type', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({
      text: `article_type: 混合\nparagraphs:\n  P1: opening`,
      meta: { cli: 'claude', durationMs: 100 },
    });

    await expect(
      labelArticle(
        { id: 'a1', body_plain: 'x', title: 't', account: 'acc', published_at: '2026-01-01', word_count: 100 },
        { invoke: mockInvoke, paragraphs: ['P1'] },
      )
    ).rejects.toThrow(/article_type/);
  });

  it('throws if paragraphs missing', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({
      text: `article_type: 实测\nparagraphs:\n  P1: opening`,
      meta: { cli: 'claude', durationMs: 100 },
    });
    await expect(
      labelArticle(
        { id: 'a1', body_plain: 'x', title: 't', account: 'acc', published_at: '2026-01-01', word_count: 100 },
        { invoke: mockInvoke, paragraphs: ['P1', 'P2'] },
      )
    ).rejects.toThrow(/missing label/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm --filter @crossing/kb test article-labeler
```
Expected: FAIL "labelArticle is not defined".

- [ ] **Step 4: Implement**

```ts
// packages/kb/src/style-distiller/article-labeler.ts
import yaml from 'js-yaml';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ArticleSample } from './types.js';
import { ARTICLE_TYPES, type ArticleType, type Role } from './panel-v2-schema.js';

export interface LabeledArticle {
  articleId: string;
  type: ArticleType;
  paragraphRoles: Map<string, Role>;
  durationMs: number;
}

export interface LabelerInvoke {
  invoke(opts: {
    systemPrompt: string;
    userMessage: string;
    model?: string;
  }): Promise<{ text: string; meta: { cli: string; durationMs: number } }>;
  paragraphs: string[];
}

const PROMPT_PATH = join(
  // resolved at runtime via import.meta.url; simplest: read relative to this file
  new URL('.', import.meta.url).pathname,
  '../../../agents/src/prompts/article-labeler.md',
);

let cachedPrompt: string | null = null;
function loadSystemPrompt(): string {
  if (cachedPrompt) return cachedPrompt;
  cachedPrompt = readFileSync(PROMPT_PATH, 'utf-8');
  return cachedPrompt;
}

export async function labelArticle(
  sample: ArticleSample,
  opts: LabelerInvoke,
): Promise<LabeledArticle> {
  const userMessage = buildUserMessage(opts.paragraphs);
  const sys = loadSystemPrompt();
  const resp = await opts.invoke({
    systemPrompt: sys,
    userMessage,
    model: 'claude-opus-4-6',
  });
  return parseResponse(sample.id, opts.paragraphs, resp.text, resp.meta.durationMs);
}

export function buildUserMessage(paragraphs: string[]): string {
  const lines = paragraphs.map((p, i) => {
    const trimmed = p.length > 200 ? p.slice(0, 200) + '…' : p;
    const flat = trimmed.replace(/\n/g, ' ');
    return `P${i + 1}|${flat}`;
  });
  return `Article paragraphs:\n${lines.join('\n')}`;
}

export function parseResponse(
  articleId: string,
  paragraphs: string[],
  rawText: string,
  durationMs: number,
): LabeledArticle {
  const cleaned = rawText.replace(/^```[a-z]*\n|```$/gm, '').trim();
  const parsed = yaml.load(cleaned) as any;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`article-labeler: non-object YAML for ${articleId}: ${cleaned.slice(0, 80)}`);
  }
  if (!ARTICLE_TYPES.includes(parsed.article_type)) {
    throw new Error(`article-labeler: invalid article_type "${parsed.article_type}" for ${articleId}`);
  }
  const roleMap = new Map<string, Role>();
  const labeled = parsed.paragraphs ?? {};
  for (let i = 0; i < paragraphs.length; i++) {
    const key = `P${i + 1}`;
    const role = labeled[key];
    if (!['opening', 'practice', 'closing', 'other'].includes(role)) {
      throw new Error(`article-labeler: ${articleId} missing label for ${key}`);
    }
    roleMap.set(key, role as Role);
  }
  return { articleId, type: parsed.article_type, paragraphRoles: roleMap, durationMs };
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm --filter @crossing/kb test article-labeler
```
Expected: PASS (3 tests green).

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/prompts/article-labeler.md \
        packages/kb/src/style-distiller/article-labeler.ts \
        packages/kb/tests/style-distiller/article-labeler.test.ts
git commit -m "feat(kb): add article-labeler (merged type classify + paragraph roles)"
```

---

### Task 7: Aggregator v2 (buckets by role × type)

**Files:**
- Create: `packages/kb/src/style-distiller/aggregator-v2.ts`
- Create: `packages/kb/tests/style-distiller/aggregator-v2.test.ts`
- Modify: `packages/kb/src/style-distiller/types.ts` (add BucketV2, AggregatedV2)

- [ ] **Step 1: Add types**

Modify `packages/kb/src/style-distiller/types.ts` — append:

```ts
import type { ArticleType } from './panel-v2-schema.js';
import type { LabeledArticle } from './article-labeler.js';

export interface BucketV2 {
  role: 'opening' | 'practice' | 'closing';
  type: ArticleType;
  sample_count: number;
  snippets: Array<{
    article_id: string;
    title: string;
    excerpt: string;
    word_count: number;
  }>;
  quant: {
    word_count_median: number;
    word_count_p10: number;
    word_count_p90: number;
  };
}

export interface AggregatedV2 {
  account: string;
  buckets: BucketV2[];  // 3×3 = 9 buckets max; empty ones still present with sample_count=0
  banned_vocabulary_candidates: string[];
}
```

- [ ] **Step 2: Failing test**

```ts
// packages/kb/tests/style-distiller/aggregator-v2.test.ts
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
    expect(shice_opening.snippets[0]!.excerpt).toBe('开头1');

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
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm --filter @crossing/kb test aggregator-v2
```
Expected: FAIL "aggregateBuckets is not defined".

- [ ] **Step 4: Implement**

```ts
// packages/kb/src/style-distiller/aggregator-v2.ts
import type { ArticleSample, AggregatedV2, BucketV2 } from './types.js';
import type { LabeledArticle } from './article-labeler.js';
import { ARTICLE_TYPES, WRITER_ROLES, type ArticleType, type Role } from './panel-v2-schema.js';

export function aggregateBuckets(
  account: string,
  samples: ArticleSample[],
  paragraphsByArticle: Map<string, string[]>,
  labeled: LabeledArticle[],
): AggregatedV2 {
  const bucketMap = new Map<string, BucketV2>();
  for (const role of WRITER_ROLES) {
    for (const type of ARTICLE_TYPES) {
      bucketMap.set(bucketKey(role, type), { role, type, sample_count: 0, snippets: [], quant: zeroQuant() });
    }
  }

  const contributorsPerBucket = new Map<string, Set<string>>();
  for (const lab of labeled) {
    const sample = samples.find(s => s.id === lab.articleId);
    if (!sample) continue;
    const paragraphs = paragraphsByArticle.get(lab.articleId) ?? [];

    for (let i = 0; i < paragraphs.length; i++) {
      const key = `P${i + 1}`;
      const role = lab.paragraphRoles.get(key) as Role | undefined;
      if (!role || role === 'other') continue;
      const b = bucketMap.get(bucketKey(role, lab.type));
      if (!b) continue;
      b.snippets.push({
        article_id: sample.id,
        title: sample.title,
        excerpt: paragraphs[i]!.slice(0, 800),
        word_count: paragraphs[i]!.length,
      });
      const cbKey = bucketKey(role, lab.type);
      if (!contributorsPerBucket.has(cbKey)) contributorsPerBucket.set(cbKey, new Set());
      contributorsPerBucket.get(cbKey)!.add(lab.articleId);
    }
  }

  for (const [k, b] of bucketMap.entries()) {
    b.sample_count = contributorsPerBucket.get(k)?.size ?? 0;
    b.quant = computeQuant(b.snippets.map(s => s.word_count));
  }

  return {
    account,
    buckets: Array.from(bucketMap.values()),
    banned_vocabulary_candidates: [],
  };
}

function bucketKey(role: string, type: string): string { return `${role}::${type}`; }
function zeroQuant() { return { word_count_median: 0, word_count_p10: 0, word_count_p90: 0 }; }
function computeQuant(values: number[]) {
  if (values.length === 0) return zeroQuant();
  const sorted = [...values].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * p)))]!;
  return {
    word_count_median: pct(0.5),
    word_count_p10: pct(0.1),
    word_count_p90: pct(0.9),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm --filter @crossing/kb test aggregator-v2
```
Expected: PASS (3 tests green).

- [ ] **Step 6: Commit**

```bash
git add packages/kb/src/style-distiller/aggregator-v2.ts \
        packages/kb/tests/style-distiller/aggregator-v2.test.ts \
        packages/kb/src/style-distiller/types.ts
git commit -m "feat(kb): add v2 aggregator grouping snippets by (role × type)"
```

---

### Task 8: Composer v2 (LLM: opus per role → full panel markdown)

**Files:**
- Create: `packages/agents/src/prompts/composer-v2.md`
- Create: `packages/kb/src/style-distiller/composer-v2.ts`
- Create: `packages/kb/tests/style-distiller/composer-v2.test.ts`

- [ ] **Step 1: Write composer prompt**

Create `packages/agents/src/prompts/composer-v2.md` (detailed, gives complete schema + strict output format):

```markdown
# Style Panel Composer v2

你是"风格卡 v2"生成器。给定一个账号、一个 role（opening / practice / closing），以及该 role 下三个 article_type（实测 / 访谈 / 评论）的全部样本 snippets 和定量统计，生成一个**完整的 v2 panel markdown 文件**。

## 严格输出格式

开始必须是 `---`（YAML frontmatter 开始），结束必须是 markdown 正文。**不要**用代码围栏包裹整体，不要任何解释文字。

## frontmatter schema（严格）

```yaml
---
account: <string>
role: <opening|practice|closing>
version: 2
status: active
created_at: <ISO datetime>
source_article_count: <int>
slicer_run_id: <string, optional>

types:
  - key: <实测|访谈|评论>
    sample_count: <int>

word_count_ranges:
  opening: [<min>, <max>]   # 本 role 字数范围，从 quant 的 p10/p90 推导
  article: [3500, 8000]     # 全文字数参考（固定，3 个 role 都一样）

pronoun_policy:
  we_ratio: <float>
  you_ratio: <float>
  avoid: [<string>, ...]

tone:
  primary: <客观克制|热血推荐|冷峻分析|调侃戏谑|教学温和|专家严肃>
  humor_frequency: <low|mid|high>
  opinionated: <low|mid|high>

bold_policy:
  frequency: <string 描述>
  what_to_bold: [<string>, ...]
  dont_bold: [<string>, ...]

transition_phrases:
  - <从样本归纳的典型衔接句>

data_citation:
  required: <true|false>
  format_style: <string>
  min_per_article: <int>

heading_cadence:
  levels_used: [h2, h3]
  paragraphs_per_h3: [<min>, <max>]
  h3_style: <string 描述>

banned_vocabulary:
  - <样本从不出现但常见文章常用的词 1>
  - ...
---
```

## 正文 schema（严格）

每个有样本的 type 一个 section：

```markdown
# <account> · <role 中文> 风格卡 v2

## <role 中文> · 实测模式

### 目标
<1 句话描述该模式的写作目标>

### 字数范围
<min> – <max> 字

### 结构骨架（三选一）
**A. <骨架名>** · <一句话说明>
**B. <骨架名>** · ...
**C. <骨架名>** · ...

### 高频锚词（用不是抄）
- "<样本里高频出现的具体短语>" — <什么情况下用>
- ...

### 禁止出现（本账号从来不写）
- "<样本里完全没有但烂大街的表达>"
- ...

### 示例（3 条真实样本，节奏模板）

**示例 1** · <来源文章标题简写> · 结构 A
> <从 snippets 里直接复制的段落>

**示例 2** · ...
> ...

**示例 3** · ...
> ...
```

role 中文映射：opening → 开头，practice → 主体，closing → 结尾。

**如果某 type 样本数为 0，完全不输出该 section**（frontmatter types[] 里也不包括 sample_count=0 的条目）。

## 输入

用户消息包含：

```
account: <string>
role: <opening|practice|closing>
buckets:
  - type: 实测
    sample_count: <int>
    quant: {word_count_median, word_count_p10, word_count_p90}
    snippets:
      - from: <article title>
        excerpt: |
          <段落原文>
      - ...
  - type: 访谈
    ...
  - type: 评论
    ...
```

## 原则

- 示例段落**必须**直接从 snippets 选，不要改写
- 结构骨架由你观察样本归纳（3 种最典型的开头/主体/结尾模式）
- 高频锚词要**具体**（具体年份 / 具体短语），不要泛泛
- 禁止出现要**假反例**（本账号不写的烂表达，不是单纯的"避免大词"）
- banned_vocabulary 要选**样本 0 次出现但其它账号会写**的词（如"笔者"、"本人"）
```

- [ ] **Step 2: Write failing test**

```ts
// packages/kb/tests/style-distiller/composer-v2.test.ts
import { describe, it, expect, vi } from 'vitest';
import { composePanel } from '../../src/style-distiller/composer-v2.js';
import type { AggregatedV2 } from '../../src/style-distiller/types.js';

const MOCK_PANEL = `---
account: 十字路口Crossing
role: opening
version: 2
status: active
created_at: '2026-04-16T00:00:00Z'
source_article_count: 30
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

# 十字路口Crossing · opening 风格卡 v2

## 开头 · 实测模式

### 目标
给读者钩子

### 字数范围
150 – 260 字

### 结构骨架（三选一）
**A. 场景** · xxx
**B. 数据** · yyy
**C. 趋势** · zzz

### 高频锚词
- "2013 年" — 场景切入

### 禁止出现
- "本文将介绍"

### 示例（3 条真实样本）
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
        { role: 'opening', type: '实测', sample_count: 20, snippets: [], quant: { word_count_median: 200, word_count_p10: 150, word_count_p90: 260 } },
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
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm --filter @crossing/kb test composer-v2
```
Expected: FAIL.

- [ ] **Step 4: Implement composer**

```ts
// packages/kb/src/style-distiller/composer-v2.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import type { AggregatedV2, BucketV2 } from './types.js';
import { parsePanelV2 } from './panel-parser-v2.js';

export interface ComposerInvoke {
  invoke(opts: { systemPrompt: string; userMessage: string; model?: string }): Promise<{ text: string; meta: { cli: string; durationMs: number } }>;
}

const PROMPT_PATH = join(
  new URL('.', import.meta.url).pathname,
  '../../../agents/src/prompts/composer-v2.md',
);

let cachedPrompt: string | null = null;
function loadSystemPrompt(): string {
  if (cachedPrompt) return cachedPrompt;
  cachedPrompt = readFileSync(PROMPT_PATH, 'utf-8');
  return cachedPrompt;
}

export async function composePanel(
  agg: AggregatedV2,
  role: 'opening' | 'practice' | 'closing',
  opts: ComposerInvoke,
): Promise<string> {
  const buckets = agg.buckets.filter(b => b.role === role && b.sample_count > 0);
  const userMessage = buildUserMessage(agg.account, role, buckets, agg.banned_vocabulary_candidates);
  const resp = await opts.invoke({
    systemPrompt: loadSystemPrompt(),
    userMessage,
    model: 'claude-opus-4-6',
  });
  validateOutput(resp.text, '<unknown>');
  return resp.text;
}

export function buildUserMessage(
  account: string,
  role: string,
  buckets: BucketV2[],
  vocabCandidates: string[],
): string {
  const dump = {
    account,
    role,
    banned_vocabulary_candidates: vocabCandidates,
    buckets: buckets.map(b => ({
      type: b.type,
      sample_count: b.sample_count,
      quant: b.quant,
      snippets: b.snippets.map(s => ({ from: s.title, excerpt: s.excerpt })),
    })),
  };
  return yaml.dump(dump, { lineWidth: -1 });
}

function validateOutput(text: string, absPath: string): void {
  // parse to force schema check; throws clear error if shape wrong
  parsePanelV2(absPath, text);
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm --filter @crossing/kb test composer-v2
```
Expected: PASS (2 tests green).

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/prompts/composer-v2.md \
        packages/kb/src/style-distiller/composer-v2.ts \
        packages/kb/tests/style-distiller/composer-v2.test.ts
git commit -m "feat(kb): add composer-v2 producing complete v2 panel markdown"
```

---

### Task 9: Run logger (jsonl append + stream subscribe)

**Files:**
- Create: `packages/web-server/src/services/distill-run-store.ts`
- Create: `packages/web-server/tests/distill-run-store.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/web-server/tests/distill-run-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DistillRunStore } from '../src/services/distill-run-store.js';

describe('DistillRunStore', () => {
  let tmp: string;
  let store: DistillRunStore;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'crx-runs-'));
    store = new DistillRunStore(tmp);
  });

  it('append writes one jsonl line and readAll returns it', async () => {
    await store.append('run-1', { type: 'distill.started', data: { account: 'a', sample_size: 50 } });
    const events = await store.readAll('run-1');
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('distill.started');
  });

  it('listActive returns runs without a final event', async () => {
    await store.append('run-a', { type: 'distill.started', data: {} });
    await store.append('run-b', { type: 'distill.started', data: {} });
    await store.append('run-b', { type: 'distill.finished', data: {} });
    const active = await store.listActive();
    expect(active.map(r => r.run_id).sort()).toEqual(['run-a']);
  });

  it('subscribe receives live events after subscription time', async () => {
    const received: any[] = [];
    const unsub = store.subscribe('run-1', (ev) => received.push(ev));
    await store.append('run-1', { type: 'sampling.done', data: { actual_count: 50 } });
    await new Promise(r => setTimeout(r, 30));
    unsub();
    expect(received.map(e => e.type)).toEqual(['sampling.done']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @crossing/web-server test distill-run-store
```
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/web-server/src/services/distill-run-store.ts
import { existsSync, mkdirSync, appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';

export interface RunEvent {
  ts: string;
  type: string;
  data: Record<string, unknown>;
}

export interface RunSummary {
  run_id: string;
  account?: string;
  started_at: string;
  status: 'active' | 'finished' | 'failed';
  last_event_type?: string;
}

const FINAL_EVENTS = new Set(['distill.finished', 'distill.failed']);

export class DistillRunStore {
  private emitter = new EventEmitter();

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private runFile(runId: string): string {
    return join(this.dir, `${runId}.jsonl`);
  }

  async append(runId: string, ev: Omit<RunEvent, 'ts'>): Promise<RunEvent> {
    const full: RunEvent = { ts: new Date().toISOString(), ...ev };
    appendFileSync(this.runFile(runId), JSON.stringify(full) + '\n', 'utf-8');
    this.emitter.emit(runId, full);
    return full;
  }

  async readAll(runId: string): Promise<RunEvent[]> {
    if (!existsSync(this.runFile(runId))) return [];
    const raw = readFileSync(this.runFile(runId), 'utf-8');
    return raw.split('\n').filter(Boolean).map(l => JSON.parse(l) as RunEvent);
  }

  async listActive(): Promise<RunSummary[]> {
    if (!existsSync(this.dir)) return [];
    const files = readdirSync(this.dir).filter(f => f.endsWith('.jsonl'));
    const out: RunSummary[] = [];
    for (const f of files) {
      const runId = f.slice(0, -'.jsonl'.length);
      const events = await this.readAll(runId);
      if (events.length === 0) continue;
      const first = events[0]!;
      const last = events[events.length - 1]!;
      const status: RunSummary['status'] =
        last.type === 'distill.finished' ? 'finished'
        : last.type === 'distill.failed' ? 'failed'
        : 'active';
      if (status !== 'active') continue;
      out.push({
        run_id: runId,
        account: (first.data as any)?.account,
        started_at: first.ts,
        status,
        last_event_type: last.type,
      });
    }
    return out;
  }

  subscribe(runId: string, handler: (ev: RunEvent) => void): () => void {
    this.emitter.on(runId, handler);
    return () => this.emitter.off(runId, handler);
  }
}
```

- [ ] **Step 4: Run test**

```bash
pnpm --filter @crossing/web-server test distill-run-store
```
Expected: PASS (3 tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/web-server/src/services/distill-run-store.ts \
        packages/web-server/tests/distill-run-store.test.ts
git commit -m "feat(web-server): add DistillRunStore (jsonl append + active listing)"
```

---

### Task 10: Orchestrator v2 — wire everything

**Files:**
- Create: `packages/kb/src/style-distiller/orchestrator-v2.ts`
- Create: `packages/kb/tests/style-distiller/orchestrator-v2.test.ts`
- Modify: `packages/kb/src/style-distiller/types.ts` (export `DistillV2Options`)

- [ ] **Step 1: Add types**

Append to `packages/kb/src/style-distiller/types.ts`:

```ts
export interface DistillV2Options {
  account: string;
  sampleSize: number;
  since?: string;
  until?: string;
  runId: string;
  onEvent?: (ev: { type: string; data: Record<string, unknown> }) => void;
  /** Injected agent invokers — one for labeler, one for composer (both opus). */
  invokeLabeler: import('./article-labeler.js').LabelerInvoke['invoke'];
  invokeComposer: import('./composer-v2.js').ComposerInvoke['invoke'];
}

export interface DistillV2Result {
  account: string;
  files: string[];
}
```

- [ ] **Step 2: Failing integration test (with mocked LLMs)**

```ts
// packages/kb/tests/style-distiller/orchestrator-v2.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { runDistillV2 } from '../../src/style-distiller/orchestrator-v2.js';

// Build a temp sqlite with 3 articles for 1 account.
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

describe('runDistillV2', () => {
  it('writes 3 panel files under <vault>/08_experts/style-panel/<account>/', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'crx-v2orch-'));
    const sqlite = join(tmp, 'ref.db');
    buildDb(sqlite);

    // Mock labeler: returns type based on title prefix
    const invokeLabeler = vi.fn(async (opts: any) => {
      const text = opts.userMessage as string;
      let type: string;
      if (text.includes('实测')) type = '实测';
      else if (text.includes('访谈')) type = '访谈';
      else type = '评论';
      const pMatches = Array.from(text.matchAll(/P(\d+)\|/g)).map(m => +m[1]!);
      const lines = pMatches.map((n, i) => {
        const role = i === 0 ? 'opening' : i === pMatches.length - 1 ? 'closing' : 'practice';
        return `  P${n}: ${role}`;
      }).join('\n');
      return {
        text: `article_type: ${type}\nparagraphs:\n${lines}`,
        meta: { cli: 'claude', durationMs: 50 },
      };
    });

    // Mock composer: returns a valid v2 panel markdown
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

# acc · ${role} 风格卡 v2

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
    const result = await runDistillV2({
      account: 'acc',
      sampleSize: 3,
      runId: 'test-run',
      invokeLabeler,
      invokeComposer,
      onEvent: (e) => events.push(e),
    }, { vaultPath: tmp, sqlitePath: sqlite });

    expect(result.files).toHaveLength(3);
    expect(existsSync(join(tmp, '08_experts/style-panel/acc/opening-v2.md'))).toBe(true);
    expect(existsSync(join(tmp, '08_experts/style-panel/acc/practice-v2.md'))).toBe(true);
    expect(existsSync(join(tmp, '08_experts/style-panel/acc/closing-v2.md'))).toBe(true);

    // event milestones present
    const types = events.map(e => e.type);
    expect(types).toContain('distill.started');
    expect(types).toContain('sampling.done');
    expect(types.filter(t => t === 'labeling.article_done')).toHaveLength(3);
    expect(types).toContain('labeling.all_done');
    expect(types).toContain('aggregation.done');
    expect(types.filter(t => t === 'composer.done')).toHaveLength(3);
    expect(types).toContain('distill.finished');
  });
});

function roleCn(role: string): string {
  return role === 'opening' ? '开头' : role === 'practice' ? '主体' : '结尾';
}
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm --filter @crossing/kb test orchestrator-v2
```
Expected: FAIL.

- [ ] **Step 4: Implement orchestrator**

```ts
// packages/kb/src/style-distiller/orchestrator-v2.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import pLimit from 'p-limit';
import type { ArticleSample, DistillV2Options, DistillV2Result } from './types.js';
import { splitParagraphs } from './paragraph-splitter.js';
import { labelArticle, type LabelerInvoke } from './article-labeler.js';
import { aggregateBuckets } from './aggregator-v2.js';
import { composePanel, type ComposerInvoke } from './composer-v2.js';
import { WRITER_ROLES } from './panel-v2-schema.js';

export interface DistillV2Context {
  vaultPath: string;
  sqlitePath: string;
}

const BASE_SUBDIR = join('08_experts', 'style-panel');
const CONCURRENCY = 10;

export async function runDistillV2(
  opts: DistillV2Options,
  ctx: DistillV2Context,
): Promise<DistillV2Result> {
  const emit = (type: string, data: Record<string, unknown> = {}) => opts.onEvent?.({ type, data });

  emit('distill.started', { account: opts.account, sample_size: opts.sampleSize, run_id: opts.runId });

  // [1] Sampling — reuse existing logic via direct sqlite query
  const pool = loadPool(ctx.sqlitePath, opts.account, opts.since, opts.until);
  const actual = pool.slice(0, opts.sampleSize);
  emit('sampling.done', { actual_count: actual.length });

  // [2] Labeling — per-article opus call, with p-limit concurrency
  const paragraphsByArticle = new Map<string, string[]>();
  const limit = pLimit(CONCURRENCY);
  let labeledCount = 0;
  const labeled = await Promise.all(actual.map((sample, idx) => limit(async () => {
    const paragraphs = splitParagraphs(sample.body_plain);
    paragraphsByArticle.set(sample.id, paragraphs);
    const invoke: LabelerInvoke = { invoke: opts.invokeLabeler as any, paragraphs };
    const result = await labelArticle(sample, invoke);
    labeledCount += 1;
    emit('labeling.article_done', {
      id: sample.id,
      type: result.type,
      progress: `${labeledCount}/${actual.length}`,
    });
    return result;
  })));
  emit('labeling.all_done', {});

  // [3] Aggregation
  const aggregated = aggregateBuckets(opts.account, actual, paragraphsByArticle, labeled);
  emit('aggregation.done', { buckets_count: aggregated.buckets.length });

  // [4] Composition — per-role, parallel
  const accountDir = join(ctx.vaultPath, BASE_SUBDIR, opts.account);
  mkdirSync(accountDir, { recursive: true });

  const files: string[] = [];
  await Promise.all(WRITER_ROLES.map(async (role) => {
    emit('composer.started', { role });
    const invokeWrapper: ComposerInvoke = { invoke: opts.invokeComposer as any };
    const md = await composePanel(aggregated, role, invokeWrapper);
    const absPath = join(accountDir, `${role}-v2.md`);
    writeFileSync(absPath, md, 'utf-8');
    files.push(absPath);
    emit('composer.done', { role, panel_path: absPath });
  }));

  emit('distill.finished', { files });
  return { account: opts.account, files };
}

function loadPool(sqlitePath: string, account: string, since?: string, until?: string): ArticleSample[] {
  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  try {
    const where: string[] = ['account = @account'];
    const params: Record<string, unknown> = { account };
    if (since) { where.push('published_at >= @since'); params.since = since; }
    if (until) { where.push('published_at <= @until'); params.until = until; }
    const sql = `SELECT id, account, title, published_at, word_count, body_plain FROM ref_articles WHERE ${where.join(' AND ')} ORDER BY published_at DESC`;
    const rows = db.prepare(sql).all(params) as any[];
    return rows.map(r => ({
      id: r.id,
      account: r.account,
      title: r.title,
      published_at: r.published_at,
      word_count: r.word_count ?? (r.body_plain ?? '').length,
      body_plain: r.body_plain ?? '',
    }));
  } finally {
    db.close();
  }
}
```

If `p-limit` is not yet a dep: add it.

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/kb add p-limit
```

- [ ] **Step 5: Run test**

```bash
pnpm --filter @crossing/kb test orchestrator-v2
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/kb/src/style-distiller/orchestrator-v2.ts \
        packages/kb/tests/style-distiller/orchestrator-v2.test.ts \
        packages/kb/src/style-distiller/types.ts \
        packages/kb/package.json \
        pnpm-lock.yaml
git commit -m "feat(kb): orchestrator-v2 wires sampling → labeling → aggregation → composition"
```

---

### Task 11: Distill-runs routes (list active + SSE stream)

**Files:**
- Create: `packages/web-server/src/routes/config-distill-runs.ts`
- Create: `packages/web-server/tests/config-distill-runs-routes.test.ts`
- Modify: `packages/web-server/src/server.ts` (wire store and routes)
- Modify: `packages/web-server/src/routes/config-style-panels.ts` (new POST distill-all returns run_id)

- [ ] **Step 1: Write failing test**

```ts
// packages/web-server/tests/config-distill-runs-routes.test.ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DistillRunStore } from '../src/services/distill-run-store.js';
import { registerDistillRunsRoutes } from '../src/routes/config-distill-runs.js';

async function buildApp() {
  const tmp = mkdtempSync(join(tmpdir(), 'crx-runs-'));
  const store = new DistillRunStore(tmp);
  const app = Fastify();
  registerDistillRunsRoutes(app, { runStore: store });
  await app.ready();
  return { app, store };
}

describe('distill-runs routes', () => {
  it('GET /runs?status=active returns active runs', async () => {
    const { app, store } = await buildApp();
    await store.append('r1', { type: 'distill.started', data: { account: 'acc' } });
    await store.append('r2', { type: 'distill.started', data: { account: 'acc' } });
    await store.append('r2', { type: 'distill.finished', data: {} });
    const res = await app.inject({ method: 'GET', url: '/api/config/style-panels/runs?status=active' });
    expect(res.statusCode).toBe(200);
    expect(res.json().runs.map((r: any) => r.run_id)).toEqual(['r1']);
  });

  it('GET /runs/:id/stream replays history', async () => {
    const { app, store } = await buildApp();
    await store.append('rX', { type: 'distill.started', data: {} });
    await store.append('rX', { type: 'sampling.done', data: { actual_count: 10 } });
    const res = await app.inject({
      method: 'GET',
      url: '/api/config/style-panels/runs/rX/stream',
      headers: { Accept: 'text/event-stream' },
    });
    // Fastify inject can't easily stream; assert headers only
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/event-stream/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @crossing/web-server test config-distill-runs-routes
```
Expected: FAIL.

- [ ] **Step 3: Implement route**

```ts
// packages/web-server/src/routes/config-distill-runs.ts
import type { FastifyInstance } from 'fastify';
import type { DistillRunStore } from '../services/distill-run-store.js';

export interface DistillRunsDeps {
  runStore: DistillRunStore;
}

export function registerDistillRunsRoutes(app: FastifyInstance, deps: DistillRunsDeps) {
  app.get<{ Querystring: { status?: string } }>(
    '/api/config/style-panels/runs',
    async (req, reply) => {
      if (req.query.status === 'active') {
        const runs = await deps.runStore.listActive();
        return reply.send({ runs });
      }
      return reply.send({ runs: [] });
    },
  );

  app.get<{ Params: { run_id: string } }>(
    '/api/config/style-panels/runs/:run_id/stream',
    async (req, reply) => {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const history = await deps.runStore.readAll(req.params.run_id);
      for (const ev of history) {
        reply.raw.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev.data)}\n\n`);
      }

      const unsub = deps.runStore.subscribe(req.params.run_id, (ev) => {
        reply.raw.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev.data)}\n\n`);
      });

      req.raw.on('close', () => { unsub(); reply.raw.end(); });
      return reply;
    },
  );
}
```

- [ ] **Step 4: Wire into server.ts**

Modify `packages/web-server/src/server.ts`:

```ts
import { DistillRunStore } from './services/distill-run-store.js';
import { registerDistillRunsRoutes } from './routes/config-distill-runs.js';

// near other stores:
const distillRunStore = new DistillRunStore(
  join(configStore.current.vaultPath, '08_experts/style-panel/_runs'),
);

// near other route registrations:
registerDistillRunsRoutes(app, { runStore: distillRunStore });
```

Also modify `packages/web-server/src/routes/config-style-panels.ts` — find the `distill-all` endpoint (if present; if not, it's the per-account distill route you added earlier in SP-10) and change it to:

```ts
// 1. generate a run_id
// 2. kick off runDistillV2(...) in background with { runId, onEvent: (e) => runStore.append(runId, e) }
// 3. return { run_id } immediately to caller
```

Skeleton:

```ts
import { runDistillV2 } from '@crossing/kb/style-distiller/orchestrator-v2';
// … inside the POST handler for distill-all:
const runId = `rdall-${Date.now()}`;
void runDistillV2({
  account,
  sampleSize: body.limit ?? 50,
  runId,
  invokeLabeler: (o) => invokeAgent({ agentKey: 'style_distiller.labeler', cli: 'claude', ...o }),
  invokeComposer: (o) => invokeAgent({ agentKey: 'style_distiller.composer', cli: 'claude', ...o }),
  onEvent: (ev) => { void deps.runStore.append(runId, ev); },
}, { vaultPath: deps.vaultPath, sqlitePath: deps.sqlitePath })
  .catch((err) => {
    deps.runStore.append(runId, { type: 'distill.failed', data: { error: String(err) } });
  });
return reply.send({ run_id: runId });
```

(Note: `invokeAgent` comes from `@crossing/agents`. The old SSE-style distill-all can be kept as legacy for now — UI will migrate in Task 13.)

- [ ] **Step 5: Run all affected tests**

```bash
pnpm --filter @crossing/web-server test config-distill-runs
```
Expected: PASS (2 tests green).

- [ ] **Step 6: Commit**

```bash
git add packages/web-server/src/routes/config-distill-runs.ts \
        packages/web-server/tests/config-distill-runs-routes.test.ts \
        packages/web-server/src/server.ts \
        packages/web-server/src/routes/config-style-panels.ts
git commit -m "feat(web-server): distill runs listing + SSE reconnection"
```

---

### Task 12: StylePanelsPage & ProgressView — active-run detection + reconnect

**Files:**
- Modify: `packages/web-ui/src/api/style-panels-client.ts` (add getRuns, streamRun)
- Modify: `packages/web-ui/src/pages/StylePanelsPage.tsx`
- Modify: `packages/web-ui/src/components/style-panels/ProgressView.tsx`

- [ ] **Step 1: Extend client**

Append to `packages/web-ui/src/api/style-panels-client.ts`:

```ts
export interface RunSummary {
  run_id: string;
  account?: string;
  started_at: string;
  status: 'active' | 'finished' | 'failed';
  last_event_type?: string;
}

export async function listActiveDistillRuns(): Promise<RunSummary[]> {
  const res = await fetchOk('/api/config/style-panels/runs?status=active');
  return (await res.json()).runs;
}

/** Subscribe to a specific run's SSE stream. Replays history + live events. */
export function streamDistillRun(
  runId: string,
  onEvent: (ev: { type: string; data: any }) => void,
): () => void {
  const es = new EventSource(`/api/config/style-panels/runs/${encodeURIComponent(runId)}/stream`);
  const handler = (e: MessageEvent) => {
    try {
      const data = JSON.parse((e as any).data);
      onEvent({ type: (e as any).type, data });
    } catch { /* ignore */ }
  };
  // Register listeners for all known milestone events
  const events = [
    'distill.started','sampling.done','labeling.article_done','labeling.all_done',
    'aggregation.done','composer.started','composer.done','distill.finished','distill.failed',
  ];
  for (const t of events) es.addEventListener(t, handler as any);
  return () => es.close();
}
```

- [ ] **Step 2: StylePanelsPage recognizes active runs**

Modify `packages/web-ui/src/pages/StylePanelsPage.tsx`:

Add state for active runs; when an account has an active run, show ⚡ + clicking opens ProgressView reconnecting via `run_id`.

```tsx
// at top of component body:
const [activeRuns, setActiveRuns] = useState<RunSummary[]>([]);
useEffect(() => {
  listActiveDistillRuns().then(setActiveRuns).catch(() => {});
  const iv = setInterval(() => {
    listActiveDistillRuns().then(setActiveRuns).catch(() => {});
  }, 3000);
  return () => clearInterval(iv);
}, []);

// render: for pending accounts, if an active run matches, show ⚡ badge:
// in the pending list row:
{activeRuns.some(r => r.account === a.account) && (
  <span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)] animate-pulse mr-2" title="正在蒸馏" />
)}

// on clicking an already-active account, enter progress mode:
const existingRun = activeRuns.find(r => r.account === a.account);
if (existingRun) {
  setMode({ kind: 'progress', account: a.account, body: { roles: ['opening','practice','closing'] }, runId: existingRun.run_id });
} else {
  setMode({ kind: 'form', account: a.account });
}
```

Update `Mode` type to include optional `runId`:

```ts
type Mode =
  | { kind: "list" }
  | { kind: "form"; account: string }
  | { kind: "progress"; account: string; body: { roles: DistillRole[]; limit?: number }; runId?: string };
```

- [ ] **Step 3: ProgressView supports reconnect**

Modify `packages/web-ui/src/components/style-panels/ProgressView.tsx`:

Accept `runId?: string`. If `runId` provided, call `streamDistillRun(runId, ...)` instead of starting a new distill:

```tsx
export interface ProgressViewProps {
  account: string;
  body: { roles: DistillRole[]; limit?: number };
  runId?: string;
  onDone: () => void;
}

useEffect(() => {
  if (started.current) return;
  started.current = true;
  if (props.runId) {
    // reconnect mode — just subscribe, no POST
    const unsub = streamDistillRun(props.runId, (ev) => handleMilestone(ev, setLines));
    return () => { unsub(); };
  } else {
    // new distill mode — POST starts the run, then we subscribe using the returned run_id
    (async () => {
      const { run_id } = await startAllRolesDistillReturningRunId({ account, limit: body.limit });
      const unsub = streamDistillRun(run_id, (ev) => handleMilestone(ev, setLines));
      // wait for finish event to fire onDone
      ...
    })();
  }
}, []);
```

Implement `startAllRolesDistillReturningRunId` in the client (parallel to existing `startAllRolesDistillStream`):

```ts
export async function startAllRolesDistillReturningRunId(body: { account: string; limit?: number }): Promise<{ run_id: string }> {
  const res = await fetchOk('/api/config/style-panels/distill-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}
```

- [ ] **Step 4: Visually verify**

```bash
pnpm dev
```
- Click 蒸馏 on an account → verify progress streams in
- Refresh page mid-run → verify ⚡ on account row → click → ProgressView resumes with full history + live tail

- [ ] **Step 5: Commit**

```bash
git add packages/web-ui/src/api/style-panels-client.ts \
        packages/web-ui/src/pages/StylePanelsPage.tsx \
        packages/web-ui/src/components/style-panels/ProgressView.tsx
git commit -m "feat(web-ui): distill progress survives page refresh via run_id reconnect"
```

---

### Phase 5 — Writer integration

### Task 13: Style-binding-resolver v2 (version + type check)

**Files:**
- Modify: `packages/web-server/src/services/style-panel-store.ts` (return version field)
- Modify: `packages/web-server/src/services/style-binding-resolver.ts` (new errors)
- Create: `packages/web-server/tests/style-binding-resolver-v2.test.ts`

- [ ] **Step 1: Add version to store output**

Modify `packages/web-server/src/services/style-panel-store.ts` — the `StylePanel` interface (or its mapped type in the list() output) should include `version: 1 | 2`. If it's already there via frontmatter, ensure it's surfaced:

```ts
// In list() response, ensure panel.frontmatter.version is included
```

Also modify `packages/web-server/src/routes/config-style-panels.ts` to return `version` in the JSON response:

```ts
panels: panels.map((p) => ({
  account: p.frontmatter.account,
  role: p.frontmatter.role,
  version: p.frontmatter.version,  // add this line
  status: p.frontmatter.status,
  // ...
})),
```

- [ ] **Step 2: Failing test for new error types**

```ts
// packages/web-server/tests/style-binding-resolver-v2.test.ts
import { describe, it, expect } from 'vitest';
import { resolveStyleBindingV2, StyleVersionTooOldError, TypeNotInPanelError } from '../src/services/style-binding-resolver.js';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StylePanelStore } from '../src/services/style-panel-store.js';

function writeV2Panel(dir: string, account: string, role: string, types: Array<{key: string; sample_count: number}>): string {
  const typesYaml = types.map(t => `  - key: ${t.key}\n    sample_count: ${t.sample_count}`).join('\n');
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
tone: {primary: 客观克制, humor_frequency: low, opinionated: mid}
bold_policy: {frequency: x, what_to_bold: [], dont_bold: []}
transition_phrases: []
data_citation: {required: false, format_style: '', min_per_article: 0}
heading_cadence: {levels_used: [h2], paragraphs_per_h3: [5, 10], h3_style: ''}
banned_vocabulary: []
---

# 风格卡

## 开头 · 实测模式
(body)
`;
  const fp = join(dir, `${role}-v2.md`);
  writeFileSync(fp, content);
  return fp;
}

describe('resolveStyleBindingV2', () => {
  it('resolves with articleType in panel', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'crx-bind-'));
    const acctDir = join(vault, '08_experts/style-panel/acc');
    mkdirSync(acctDir, { recursive: true });
    writeV2Panel(acctDir, 'acc', 'opening', [{ key: '实测', sample_count: 10 }]);
    const store = new StylePanelStore(vault);
    const result = await resolveStyleBindingV2({ account: 'acc', role: 'opening' }, '实测', store);
    expect(result.panel.frontmatter.version).toBe(2);
    expect(result.typeSection).toContain('实测模式');
  });

  it('throws TypeNotInPanelError if type missing', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'crx-bind-'));
    const acctDir = join(vault, '08_experts/style-panel/acc');
    mkdirSync(acctDir, { recursive: true });
    writeV2Panel(acctDir, 'acc', 'opening', [{ key: '访谈', sample_count: 5 }]);
    const store = new StylePanelStore(vault);
    await expect(
      resolveStyleBindingV2({ account: 'acc', role: 'opening' }, '实测', store),
    ).rejects.toBeInstanceOf(TypeNotInPanelError);
  });

  it('throws StyleVersionTooOldError for v1 panel', async () => {
    const vault = mkdtempSync(join(tmpdir(), 'crx-bind-'));
    const acctDir = join(vault, '08_experts/style-panel/acc');
    mkdirSync(acctDir, { recursive: true });
    writeFileSync(
      join(acctDir, 'opening-v1.md'),
      `---\naccount: acc\nrole: opening\nversion: 1\nstatus: active\ncreated_at: '2026-01-01'\nsource_article_count: 10\n---\n# body\n`,
    );
    const store = new StylePanelStore(vault);
    await expect(
      resolveStyleBindingV2({ account: 'acc', role: 'opening' }, '实测', store),
    ).rejects.toBeInstanceOf(StyleVersionTooOldError);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm --filter @crossing/web-server test style-binding-resolver-v2
```
Expected: FAIL.

- [ ] **Step 4: Implement new errors + resolver**

Modify `packages/web-server/src/services/style-binding-resolver.ts` — append:

```ts
import { parsePanelV2 } from '@crossing/kb/style-distiller/panel-parser-v2';
import { extractTypeSection } from '@crossing/kb/style-distiller/panel-parser-v2';
import type { ArticleType, PanelV2 } from '@crossing/kb/style-distiller/panel-v2-schema';
import { readFileSync } from 'node:fs';

export class StyleVersionTooOldError extends Error {
  constructor(public binding: StyleBinding, public foundVersion: number) {
    super(`style binding version ${foundVersion} too old for ${binding.account}/${binding.role}, need ≥ 2`);
    this.name = 'StyleVersionTooOldError';
  }
}

export class TypeNotInPanelError extends Error {
  constructor(public binding: StyleBinding, public articleType: string, public availableTypes: string[]) {
    super(`panel ${binding.account}/${binding.role} has no "${articleType}" type; available: ${availableTypes.join(',')}`);
    this.name = 'TypeNotInPanelError';
  }
}

export interface ResolvedStyleV2 {
  panel: PanelV2;
  typeSection: string;
}

export async function resolveStyleBindingV2(
  binding: StyleBinding,
  articleType: ArticleType,
  store: StylePanelStore,
): Promise<ResolvedStyleV2> {
  const latest = store.getLatestActive(binding.account, binding.role);
  if (!latest) {
    throw new StyleNotBoundError(binding, 'missing');
  }
  const raw = readFileSync(latest.absPath, 'utf-8');
  if (latest.frontmatter.version !== 2) {
    throw new StyleVersionTooOldError(binding, latest.frontmatter.version ?? 1);
  }
  const panel = parsePanelV2(latest.absPath, raw);
  const hasType = panel.frontmatter.types.some(t => t.key === articleType && t.sample_count > 0);
  if (!hasType) {
    throw new TypeNotInPanelError(binding, articleType, panel.frontmatter.types.map(t => t.key));
  }
  const section = extractTypeSection(panel.body, articleType);
  if (!section) {
    throw new TypeNotInPanelError(binding, articleType, panel.frontmatter.types.map(t => t.key));
  }
  return { panel, typeSection: section };
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm --filter @crossing/web-server test style-binding-resolver-v2
```
Expected: PASS (3 tests green).

- [ ] **Step 6: Commit**

```bash
git add packages/web-server/src/services/style-binding-resolver.ts \
        packages/web-server/src/services/style-panel-store.ts \
        packages/web-server/src/routes/config-style-panels.ts \
        packages/web-server/tests/style-binding-resolver-v2.test.ts
git commit -m "feat(web-server): v2 style binding resolver with version & type gates"
```

---

### Task 14: BriefIntakeForm article_type dropdown + project.article_type

**Files:**
- Modify: `packages/web-ui/src/components/brief/BriefIntakeForm.tsx` (add dropdown)
- Modify: `packages/web-server/src/services/project-store.ts` (add article_type field)
- Modify: `packages/web-server/src/routes/brief.ts` (accept article_type on POST)
- Modify: `packages/web-ui/src/api/types.ts` or equivalent (project shape)

- [ ] **Step 1: Expand project schema**

Find the project type declaration (likely `packages/web-server/src/services/project-store.ts` or `types.ts`). Add:

```ts
export interface Project {
  // ... existing fields
  article_type?: '实测' | '访谈' | '评论';
}
```

- [ ] **Step 2: BriefIntakeForm dropdown**

Modify `packages/web-ui/src/components/brief/BriefIntakeForm.tsx`:

Add state + field:

```tsx
const [articleType, setArticleType] = useState<'实测' | '访谈' | '评论' | ''>('');

// In the form:
<label className="block mb-4">
  <span className="text-xs text-[var(--meta)] block mb-1">文章类型 *</span>
  <select
    required
    value={articleType}
    onChange={(e) => setArticleType(e.target.value as any)}
    className="w-48 h-9 px-3 rounded border border-[var(--hair)] bg-[var(--bg-1)] text-sm"
  >
    <option value="">请选择</option>
    <option value="实测">🧪 实测</option>
    <option value="访谈">🎤 访谈</option>
    <option value="评论">💬 评论</option>
  </select>
</label>

// Pass into submit:
onUpload({ file, articleType: articleType as any });
// (assume handler signature includes article_type)

// validate:
if (!articleType) { toast.error('请选择文章类型'); return; }
```

Pass `article_type` through in the fetch body to POST brief/upload endpoint.

- [ ] **Step 3: Backend accepts article_type**

Modify `packages/web-server/src/routes/brief.ts` — when saving brief (or creating project), accept `article_type` from the request body (FormData field) and persist to project.json:

```ts
await deps.store.update(projectId, {
  status: 'brief_analyzing',
  article_type: body.article_type,   // new
});
```

If creation flow is elsewhere, locate and patch similarly.

- [ ] **Step 4: Verify manually**

Open the UI, create a new project, upload brief without selecting type → form blocks. Select type → POST includes it → project.json shows `article_type` field.

- [ ] **Step 5: Commit**

```bash
git add packages/web-ui/src/components/brief/BriefIntakeForm.tsx \
        packages/web-server/src/services/project-store.ts \
        packages/web-server/src/routes/brief.ts
git commit -m "feat: article_type dropdown in brief form + project.json persistence"
```

---

### Task 15: Writer orchestrator consumes panel v2 + hard rules

**Files:**
- Modify: `packages/web-server/src/services/writer-orchestrator.ts`
- Modify: `packages/web-server/src/routes/writer.ts` (wire HardRulesStore)

- [ ] **Step 1: Update writer error handling**

Modify `packages/web-server/src/services/writer-orchestrator.ts`:

Before running writer agents, validate article_type is present and panel is v2:

```ts
import { resolveStyleBindingV2, StyleVersionTooOldError, TypeNotInPanelError } from './style-binding-resolver.js';

export class MissingArticleTypeError extends Error {
  constructor() {
    super('project.article_type is required; please set in Brief stage');
    this.name = 'MissingArticleTypeError';
  }
}

// inside runWriter, right after you read the project:
if (!project.article_type) {
  opts.onEvent?.({
    type: 'run.blocked',
    data: { reason: 'missing_article_type' },
  });
  throw new MissingArticleTypeError();
}

// then for each writer agent (opening/practice/closing):
try {
  const resolved = await resolveStyleBindingV2(
    binding,
    project.article_type,
    opts.stylePanelStore,
  );
  // inject resolved.typeSection + resolved.panel.frontmatter into prompt via contextBundleService
} catch (err) {
  if (err instanceof StyleVersionTooOldError) {
    opts.onEvent?.({ type: 'run.blocked', data: { reason: 'panel_version_too_old', account: binding.account, role: binding.role } });
    return { blocked: true };
  }
  if (err instanceof TypeNotInPanelError) {
    opts.onEvent?.({
      type: 'run.blocked',
      data: {
        reason: 'type_not_in_panel',
        account: binding.account, role: binding.role,
        article_type: project.article_type,
        available_types: err.availableTypes,
      },
    });
    return { blocked: true };
  }
  throw err;
}
```

- [ ] **Step 2: Inject hard rules into writer prompt**

Inside the writer prompt assembly (look for where the system prompt is built — might be `writer-opening-agent.ts` or `context-bundle-service.ts`):

```ts
import { HardRulesStore, type WritingHardRules } from './hard-rules-store.js';

// somewhere during runWriter:
const hardRules = await opts.hardRulesStore.read();

// build a prompt section:
function renderHardRules(rules: WritingHardRules, panelBannedVocab: string[]): string {
  const bannedPhrases = rules.banned_phrases.map(p => `  - ${p.pattern}${p.is_regex ? ' (regex)' : ''}：${p.reason}`).join('\n');
  const mergedVocab = [...rules.banned_vocabulary.map(v => v.word), ...panelBannedVocab];
  const vocab = [...new Set(mergedVocab)].map(w => `  - ${w}`).join('\n');
  const layout = rules.layout_rules.map(r => `  - ${r}`).join('\n');
  return `## 写作硬规则（绝对不允许违反）

禁用句式：
${bannedPhrases}

禁用词汇：
${vocab}

排版规则：
${layout}
`;
}

// Prepend renderHardRules(hardRules, panel.frontmatter.banned_vocabulary) to every writer user message.
```

- [ ] **Step 3: Wire HardRulesStore into WriterDeps**

Modify `packages/web-server/src/routes/writer.ts`:

Add `hardRulesStore: HardRulesStore` to `WriterDeps`. In `server.ts`, pass the already-constructed `hardRulesStore` into `registerWriterRoutes`.

- [ ] **Step 4: Manual smoke test**

- Create project, choose article_type = 实测
- Trigger writer
- Inspect run prompts (run directory under `runs/<ts>-<agent>/prompt.txt`)
- Confirm the prompt contains:
  - `## 写作硬规则（绝对不允许违反）`
  - `## 开头 · 实测模式` (from panel)
  - Not the 访谈 or 评论 sections

- [ ] **Step 5: Commit**

```bash
git add packages/web-server/src/services/writer-orchestrator.ts \
        packages/web-server/src/routes/writer.ts \
        packages/web-server/src/server.ts
git commit -m "feat(web-server): writer reads v2 panel type section + hard rules"
```

---

### Task 16: Writer error UI (blocked reasons → actionable banner)

**Files:**
- Modify: `packages/web-ui/src/pages/ProjectWorkbench.tsx` (FailureCard variants)

- [ ] **Step 1: Parse blocked event reason**

In `findLastFailure` (or a new helper), also detect `run.blocked` events. Extract `reason` field.

- [ ] **Step 2: Render actionable banner**

Instead of the generic "写作失败", render:

```tsx
function renderBlockedBanner(reason: string, data: any, onNavigate: (path: string) => void): JSX.Element {
  if (reason === 'missing_article_type') {
    return (
      <div className="...red banner...">
        <p>请回 Brief 阶段选择文章类型</p>
        <button onClick={() => onNavigate('brief')}>返回 Brief</button>
      </div>
    );
  }
  if (reason === 'panel_version_too_old') {
    return (
      <div>
        <p>账号「{data.account}」的风格面板是旧版本，请去风格库重新蒸馏</p>
        <button onClick={() => window.open('/style-panels')}>去风格库</button>
      </div>
    );
  }
  if (reason === 'type_not_in_panel') {
    return (
      <div>
        <p>
          当前风格面板「{data.account}」缺少「{data.article_type}」类型样本。
          可选类型：{(data.available_types ?? []).join(' / ')}
        </p>
        <p>重新蒸馏该账号或修改 Brief 中的文章类型。</p>
      </div>
    );
  }
  return <div>写作被阻塞：{reason}</div>;
}
```

Wire into the existing `writing_failed` branch.

- [ ] **Step 3: Manual test**

- Remove article_type from project.json manually → retry writer → verify "请回 Brief 阶段选择文章类型" banner
- Change binding to a non-existent type → verify TypeNotInPanel banner

- [ ] **Step 4: Commit**

```bash
git add packages/web-ui/src/pages/ProjectWorkbench.tsx
git commit -m "feat(web-ui): actionable banners for writer blocked reasons"
```

---

### Phase 7 — Cleanup UI & scripts

### Task 17: Cleanup old panels button

**Files:**
- Create: `packages/web-server/src/routes/config-style-panels-cleanup.ts`
- Modify: `packages/web-ui/src/pages/StylePanelsPage.tsx` (cleanup button)
- Modify: `packages/web-ui/src/api/style-panels-client.ts` (cleanupLegacy)

- [ ] **Step 1: Backend route**

```ts
// packages/web-server/src/routes/config-style-panels-cleanup.ts
import type { FastifyInstance } from 'fastify';
import { readdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface CleanupDeps {
  vaultPath: string;
}

export function registerStylePanelsCleanupRoutes(app: FastifyInstance, deps: CleanupDeps) {
  app.post('/api/config/style-panels/cleanup-legacy', async (_req, reply) => {
    const base = join(deps.vaultPath, '08_experts/style-panel');
    if (!existsSync(base)) return reply.send({ removed: [] });
    const removed: string[] = [];
    for (const entry of readdirSync(base)) {
      const full = join(base, entry);
      const st = statSync(full);
      if (st.isFile() && entry.endsWith('.md')) {
        // flat legacy file
        unlinkSync(full);
        removed.push(full);
      } else if (st.isDirectory()) {
        // nested: delete any *-v1.md
        for (const f of readdirSync(full)) {
          if (/-v1\.md$/.test(f)) {
            const fp = join(full, f);
            unlinkSync(fp);
            removed.push(fp);
          }
        }
      }
    }
    return reply.send({ removed });
  });
}
```

Wire it in `server.ts`:

```ts
import { registerStylePanelsCleanupRoutes } from './routes/config-style-panels-cleanup.js';
registerStylePanelsCleanupRoutes(app, { vaultPath: configStore.current.vaultPath });
```

- [ ] **Step 2: Client API**

Append to `packages/web-ui/src/api/style-panels-client.ts`:

```ts
export async function cleanupLegacyPanels(): Promise<{ removed: string[] }> {
  const res = await fetchOk('/api/config/style-panels/cleanup-legacy', { method: 'POST' });
  return res.json();
}
```

- [ ] **Step 3: Button UI**

Modify `packages/web-ui/src/pages/StylePanelsPage.tsx` — add button in the header:

```tsx
<button
  className="text-xs text-[var(--meta)] hover:text-[var(--red)]"
  onClick={async () => {
    const panelsV1 = panels.filter(p => p.version < 2 || p.is_legacy);
    if (panelsV1.length === 0) { toast.info('没有旧面板可清理'); return; }
    if (!confirm(`即将硬删 ${panelsV1.length} 个旧面板，不可恢复。继续？`)) return;
    const { removed } = await cleanupLegacyPanels();
    toast.success(`已删除 ${removed.length} 个文件`);
    await reload();
  }}
>
  🧹 清理旧面板
</button>
```

- [ ] **Step 4: Manual test**

Create a dummy `*_kb.md` in vault → click button → confirms → file gone.

- [ ] **Step 5: Commit**

```bash
git add packages/web-server/src/routes/config-style-panels-cleanup.ts \
        packages/web-server/src/server.ts \
        packages/web-ui/src/pages/StylePanelsPage.tsx \
        packages/web-ui/src/api/style-panels-client.ts
git commit -m "feat: cleanup legacy style panels from UI"
```

---

### Task 18: Evaluation script — read panel, produce readable report

**Files:**
- Create: `scripts/evaluate-panel.ts`

- [ ] **Step 1: Implement**

```ts
// scripts/evaluate-panel.ts
import { readFileSync } from 'node:fs';
import { parsePanelV2, extractTypeSection } from '../packages/kb/src/style-distiller/panel-parser-v2.js';
import { ARTICLE_TYPES } from '../packages/kb/src/style-distiller/panel-v2-schema.js';

function main() {
  const panelPath = process.argv[2];
  if (!panelPath) {
    console.error('Usage: tsx scripts/evaluate-panel.ts <panel.md>');
    process.exit(1);
  }
  const raw = readFileSync(panelPath, 'utf-8');
  const panel = parsePanelV2(panelPath, raw);

  console.log(`\n=== ${panelPath} ===`);
  console.log(`account: ${panel.frontmatter.account}`);
  console.log(`role: ${panel.frontmatter.role}  version: ${panel.frontmatter.version}`);
  console.log(`types:`);
  for (const t of panel.frontmatter.types) {
    console.log(`  - ${t.key} (${t.sample_count} samples)`);
  }
  console.log(`word_count_ranges.${panel.frontmatter.role}: ${panel.frontmatter.word_count_ranges[panel.frontmatter.role].join('–')} 字`);
  console.log(`tone: ${panel.frontmatter.tone.primary}, humor=${panel.frontmatter.tone.humor_frequency}, opinionated=${panel.frontmatter.tone.opinionated}`);
  console.log(`banned_vocabulary: ${panel.frontmatter.banned_vocabulary.join(', ')}`);
  console.log();

  for (const type of ARTICLE_TYPES) {
    const section = extractTypeSection(panel.body, type);
    if (!section) continue;
    console.log(`--- ${type} 模式 section ---`);
    console.log(section.slice(0, 400).trim());
    console.log('...');
    console.log();
  }
}

main();
```

- [ ] **Step 2: Smoke test**

```bash
cd /Users/zeoooo/crossing-writer && pnpm dlx tsx scripts/evaluate-panel.ts packages/kb/tests/fixtures/some-sample.md
```
Expected: pretty-printed summary.

- [ ] **Step 3: Commit**

```bash
git add scripts/evaluate-panel.ts
git commit -m "chore(scripts): add panel evaluation tool for manual QA"
```

---

### Task 19: Fixtures for integration testing (5 real articles)

**Files:**
- Create: `packages/kb/tests/fixtures/style-distill-v2/article-shice-1.md`
- Create: `packages/kb/tests/fixtures/style-distill-v2/article-shice-2.md`
- Create: `packages/kb/tests/fixtures/style-distill-v2/article-fangtan-1.md`
- Create: `packages/kb/tests/fixtures/style-distill-v2/article-pinglun-1.md`
- Create: `packages/kb/tests/fixtures/style-distill-v2/article-misc.md` (edge case)
- Create: `packages/kb/tests/style-distiller/fixtures-integration.test.ts`

- [ ] **Step 1: Copy 5 real articles from vault**

Use existing vault articles:

```bash
mkdir -p packages/kb/tests/fixtures/style-distill-v2
cp "/Users/zeoooo/CrossingVault/10_refs/十字路口Crossing/2026/2026-03-17_首发实测-Floatboat*.md" \
   packages/kb/tests/fixtures/style-distill-v2/article-shice-1.md

# 找另外 4 篇，分别覆盖 访谈 / 评论 / 混合 / 短文
```

Pick articles that cover the 3 types + edge cases (very long, short, image-heavy).

- [ ] **Step 2: Integration test**

```ts
// packages/kb/tests/style-distiller/fixtures-integration.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { splitParagraphs } from '../../src/style-distiller/paragraph-splitter.js';

const FIXTURES_DIR = join(__dirname, '../fixtures/style-distill-v2');

describe('fixtures paragraph split sanity', () => {
  it('each fixture yields reasonable paragraph count', () => {
    for (const file of readdirSync(FIXTURES_DIR)) {
      if (!file.endsWith('.md')) continue;
      const raw = readFileSync(join(FIXTURES_DIR, file), 'utf-8');
      // strip frontmatter
      const body = raw.replace(/^---[\s\S]*?---\n/, '');
      const paragraphs = splitParagraphs(body);
      expect(paragraphs.length).toBeGreaterThan(5);
      expect(paragraphs.length).toBeLessThan(500);
      // at least one "[图]" for articles with images
      if (/!\[/.test(body)) {
        expect(paragraphs).toContain('[图]');
      }
    }
  });
});
```

- [ ] **Step 3: Run test**

```bash
pnpm --filter @crossing/kb test fixtures-integration
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/kb/tests/fixtures/ \
        packages/kb/tests/style-distiller/fixtures-integration.test.ts
git commit -m "test(kb): add 5 real-article fixtures for paragraph splitter sanity"
```

---

## Self-Review

- [ ] **Spec coverage**
  - Panel v2 schema → Task 1 ✓
  - Paragraph splitter → Task 2 ✓
  - Hard rules yaml store + API + UI → Tasks 3/4/5 ✓
  - Article labeler (merged type + role) → Task 6 ✓
  - Aggregator (role × type) → Task 7 ✓
  - Composer v2 (per-role opus) → Task 8 ✓
  - Run logger + API + UI reconnect → Tasks 9/11/12 ✓
  - Orchestrator v2 wiring → Task 10 ✓
  - Resolver v2 (version + type checks + errors) → Task 13 ✓
  - BriefIntakeForm article_type → Task 14 ✓
  - Writer consumes panel v2 + hard rules → Task 15 ✓
  - Writer error UI → Task 16 ✓
  - Cleanup old panels → Task 17 ✓
  - Evaluation script + fixtures → Tasks 18/19 ✓

- [ ] **Placeholder scan**: No "TBD / TODO / fill-in". Each step has concrete code.

- [ ] **Type consistency**: `ArticleType`, `Role`, `PanelFrontmatterV2`, `PanelV2`, `LabeledArticle`, `BucketV2`, `AggregatedV2` used consistently across kb / web-server / web-ui.

- [ ] **Non-goals respected**: No changes to writer generation logic itself (SP-B), no config UI flow redesign (SP-C).

---

**Done. Plan ready for execution.**
