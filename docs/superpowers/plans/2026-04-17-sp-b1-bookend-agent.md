# SP-B.1 合并 Opening+Closing Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 writer 的 opening 和 closing 两个 agent 合并成一个 `writer-bookend-agent`，共用 prompt 模板和公共辅助函数，同时把"必须调用 search_wiki 和 search_raw"写进 prompt 的硬要求。

**Architecture:** 新建 `writer-bookend-agent.ts`（一个 agent class，接受 `role: 'opening' | 'closing'` 参数），新建 `writer-shared.ts`（抽公共辅助：`extractSubsection` 切 panel 的 `### 目标` / `### 字数范围` 等子小节，`renderBookendPrompt` 做 `{{placeholder}}` + `{{#if role}}` 手写模板替换）。删掉 `writer-opening-agent.ts` 和 `writer-closing-agent.ts`。orchestrator 和 3 个路由调用点改成 `runWriterBookend({ role: ..., ... })`。

**Tech Stack:** TypeScript, pnpm monorepo, vitest, 无新依赖（不引模板引擎）。

**Spec:** `docs/superpowers/specs/2026-04-17-sp-b1-bookend-agent-design.md`

---

## File Structure

### 新增

```
packages/agents/src/roles/
  writer-shared.ts                # extractSubsection, renderHardRulesBlock, renderBookendPrompt
  writer-bookend-agent.ts         # runWriterBookend({role, ...})

packages/agents/src/prompts/
  writer-bookend.md               # 合并的 prompt 模板

packages/agents/tests/
  writer-shared.test.ts
  writer-bookend-agent.test.ts
```

### 修改

```
packages/agents/src/index.ts
packages/web-server/src/services/writer-orchestrator.ts
packages/web-server/src/routes/writer.ts
packages/web-server/src/routes/writer-rewrite-selection.ts
```

### 删除

```
packages/agents/src/roles/writer-opening-agent.ts
packages/agents/src/roles/writer-closing-agent.ts
packages/agents/src/prompts/writer-opening.md
packages/agents/src/prompts/writer-closing.md
```

---

## Task 1: writer-shared.ts 基础函数 + 测试

**Files:**
- Create: `packages/agents/src/roles/writer-shared.ts`
- Create: `packages/agents/tests/writer-shared.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/agents/tests/writer-shared.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  extractSubsection,
  renderHardRulesBlock,
  renderBookendPrompt,
  type WritingHardRules,
  type PanelFrontmatterLike,
} from '../src/roles/writer-shared.js';

describe('extractSubsection', () => {
  const SECTION = `### 目标
给读者钩子。

### 字数范围
150 – 260 字

### 结构骨架（三选一）
**A. 场景** · xxx
**B. 数据** · yyy

### 高频锚词
- 锚词 1
- 锚词 2

### 禁止出现
- 禁词

### 示例
**示例 1** · 某篇 · 结构 A
> 示例正文
`;

  it('extracts "目标" content', () => {
    expect(extractSubsection(SECTION, '目标')).toBe('给读者钩子。');
  });

  it('extracts "字数范围" content', () => {
    expect(extractSubsection(SECTION, '字数范围')).toBe('150 – 260 字');
  });

  it('extracts "结构骨架" heading included subsection', () => {
    const out = extractSubsection(SECTION, '结构骨架（三选一）');
    expect(out).toContain('**A. 场景**');
    expect(out).toContain('**B. 数据**');
  });

  it('returns empty string when subsection missing', () => {
    expect(extractSubsection(SECTION, '不存在')).toBe('');
  });

  it('handles last subsection up to end of string', () => {
    expect(extractSubsection(SECTION, '示例')).toContain('示例 1');
  });
});

describe('renderHardRulesBlock', () => {
  const RULES: WritingHardRules = {
    version: 1,
    updated_at: '2026-04-17T00:00:00Z',
    banned_phrases: [
      { pattern: '不是.+?而是', is_regex: true, reason: '烂大街' },
      { pattern: '正如所见', is_regex: false, reason: '翻译腔' },
    ],
    banned_vocabulary: [
      { word: '笔者', reason: '第三人称不自然' },
    ],
    layout_rules: ['段落 ≤ 80 字', '段与段之间必须有空行'],
  };

  it('renders all three sections with merged vocab', () => {
    const out = renderHardRulesBlock(RULES, ['炸裂了', '绝绝子']);
    expect(out).toContain('## 写作硬规则');
    expect(out).toContain('不是.+?而是');
    expect(out).toContain('正如所见');
    expect(out).toContain('笔者');
    expect(out).toContain('炸裂了');
    expect(out).toContain('绝绝子');
    expect(out).toContain('段落 ≤ 80 字');
  });

  it('handles empty arrays gracefully', () => {
    const empty: WritingHardRules = {
      version: 1,
      updated_at: '',
      banned_phrases: [],
      banned_vocabulary: [],
      layout_rules: [],
    };
    const out = renderHardRulesBlock(empty, []);
    expect(out).toContain('（无）');
  });

  it('dedupes vocab between global and panel', () => {
    const out = renderHardRulesBlock(RULES, ['笔者', '新词']);
    const matches = out.match(/^  - 笔者$/gm) ?? [];
    expect(matches).toHaveLength(1);
    expect(out).toContain('新词');
  });
});

describe('renderBookendPrompt', () => {
  const PANEL_FM: PanelFrontmatterLike = {
    word_count_ranges: { opening: [150, 260], article: [3500, 8000] },
    pronoun_policy: { we_ratio: 0.4, you_ratio: 0.3, avoid: ['笔者'] },
    tone: { primary: '客观克制', humor_frequency: 'low', opinionated: 'mid' },
    bold_policy: {
      frequency: '每段 0-2 处',
      what_to_bold: ['核心观点句'],
      dont_bold: ['整段'],
    },
    transition_phrases: ['先说 XXX', '重点来了：'],
    data_citation: { required: true, format_style: '数字+单位+来源', min_per_article: 1 },
  };

  const TYPE_SECTION = `### 目标
给读者钩子。

### 字数范围
150 – 260 字

### 结构骨架（三选一）
**A. 场景** · xxx

### 高频锚词
- "2013 年"

### 禁止出现
- "本文将介绍"

### 示例
**示例 1** · ColaOS · 结构 A
> 2013 年...
`;

  it('renders opening prompt with role-specific section', () => {
    const out = renderBookendPrompt({
      role: 'opening',
      account: '十字路口Crossing',
      articleType: '实测',
      typeSection: TYPE_SECTION,
      panelFrontmatter: PANEL_FM,
      hardRulesBlock: '## 写作硬规则\n（略）',
      projectContextBlock: '## 项目上下文\n(brief...)',
      product_name: 'Floatboat',
    });
    expect(out).toContain('本次任务只写**一段**：**开头**');
    expect(out).not.toContain('本次任务只写**一段**：**结尾**');
    expect(out).toContain('150-260 字');
    expect(out).toContain('给读者钩子。');
    expect(out).toContain('十字路口Crossing');
    expect(out).toContain('Floatboat');
    expect(out).toContain('客观克制');
    expect(out).toContain('先说 XXX');
    // No unreplaced placeholders
    expect(out).not.toMatch(/\{\{[^}]+\}\}/);
  });

  it('renders closing prompt with role-specific section', () => {
    const out = renderBookendPrompt({
      role: 'closing',
      account: '十字路口Crossing',
      articleType: '实测',
      typeSection: TYPE_SECTION,
      panelFrontmatter: PANEL_FM,
      hardRulesBlock: '## 写作硬规则',
      projectContextBlock: '## 项目上下文',
    });
    expect(out).toContain('本次任务只写**一段**：**结尾**');
    expect(out).not.toContain('本次任务只写**一段**：**开头**');
    expect(out).toContain('结尾');
    expect(out).not.toMatch(/\{\{[^}]+\}\}/);
  });

  it('handles missing product_name / guest_name gracefully', () => {
    const out = renderBookendPrompt({
      role: 'opening',
      account: 'acc',
      articleType: '实测',
      typeSection: TYPE_SECTION,
      panelFrontmatter: PANEL_FM,
      hardRulesBlock: '',
      projectContextBlock: '',
    });
    expect(out).not.toMatch(/\{\{[^}]+\}\}/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/agents test writer-shared
```
Expected: FAIL with "writer-shared.js not found" or "extractSubsection is not defined".

- [ ] **Step 3: Implement**

Create `packages/agents/src/roles/writer-shared.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ============================================================================
// Types (duplicated locally to avoid cross-package dependency on @crossing/web-server)
// ============================================================================

export interface WritingHardRules {
  version: 1;
  updated_at: string;
  banned_phrases: Array<{ pattern: string; is_regex: boolean; reason: string; example?: string }>;
  banned_vocabulary: Array<{ word: string; reason: string }>;
  layout_rules: string[];
}

/**
 * Subset of PanelFrontmatterV2 that renderBookendPrompt actually reads.
 * Keeping this narrow makes the agent package independent of @crossing/kb type.
 */
export interface PanelFrontmatterLike {
  word_count_ranges: {
    opening: [number, number];
    article: [number, number];
  };
  pronoun_policy: { we_ratio: number; you_ratio: number; avoid: string[] };
  tone: { primary: string; humor_frequency: string; opinionated: string };
  bold_policy: {
    frequency: string;
    what_to_bold: string[];
    dont_bold: string[];
  };
  transition_phrases: string[];
  data_citation: { required: boolean; format_style: string; min_per_article: number };
}

// ============================================================================
// extractSubsection
// ============================================================================

/**
 * Extract the body of `### <subsectionName>` up to the next `### ` heading
 * (or end of input). Returns '' if the subsection is missing.
 */
export function extractSubsection(typeSection: string, subsectionName: string): string {
  const escaped = subsectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|\\n)###\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n###\\s|$)`, 'u');
  const m = typeSection.match(re);
  return m?.[1]?.trim() ?? '';
}

// ============================================================================
// renderHardRulesBlock
// ============================================================================

export function renderHardRulesBlock(
  rules: WritingHardRules,
  panelBannedVocab: string[],
): string {
  const phrases = rules.banned_phrases.length
    ? rules.banned_phrases
        .map((p) => `  - ${p.pattern}${p.is_regex ? ' (regex)' : ''}：${p.reason}`)
        .join('\n')
    : '  （无）';

  const mergedVocab = Array.from(
    new Set([
      ...rules.banned_vocabulary.map((v) => v.word),
      ...panelBannedVocab,
    ]),
  );
  const vocab = mergedVocab.length
    ? mergedVocab.map((w) => `  - ${w}`).join('\n')
    : '  （无）';

  const layout = rules.layout_rules.length
    ? rules.layout_rules.map((r) => `  - ${r}`).join('\n')
    : '  （无）';

  return `## 写作硬规则（绝对不允许违反）\n\n禁用句式：\n${phrases}\n\n禁用词汇：\n${vocab}\n\n排版规则：\n${layout}`;
}

// ============================================================================
// renderBookendPrompt
// ============================================================================

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(__dirname, '../prompts/writer-bookend.md');

let cachedTemplate: string | null = null;
function loadTemplate(): string {
  if (cachedTemplate) return cachedTemplate;
  cachedTemplate = readFileSync(TEMPLATE_PATH, 'utf-8');
  return cachedTemplate;
}

export interface RenderBookendPromptOpts {
  role: 'opening' | 'closing';
  account: string;
  articleType: '实测' | '访谈' | '评论';
  typeSection: string;
  panelFrontmatter: PanelFrontmatterLike;
  hardRulesBlock: string;
  projectContextBlock: string;
  product_name?: string;
  guest_name?: string;
}

export function renderBookendPrompt(opts: RenderBookendPromptOpts): string {
  const template = loadTemplate();
  const roleCn = opts.role === 'opening' ? '开头' : '结尾';
  const wordRange =
    opts.role === 'opening'
      ? opts.panelFrontmatter.word_count_ranges.opening.join('-')
      : opts.panelFrontmatter.word_count_ranges.article.join('-');

  const subs = {
    目标: extractSubsection(opts.typeSection, '目标'),
    字数范围: extractSubsection(opts.typeSection, '字数范围'),
    结构骨架: extractSubsection(opts.typeSection, '结构骨架（三选一）'),
    高频锚词: extractSubsection(opts.typeSection, '高频锚词（用不是抄）'),
    禁止出现: extractSubsection(opts.typeSection, '禁止出现（本账号从来不写）'),
    示例: extractSubsection(opts.typeSection, '示例（3 条真实样本，节奏模板）'),
  };
  // Fallback: some panels use slightly different headings
  if (!subs.结构骨架) subs.结构骨架 = extractSubsection(opts.typeSection, '结构骨架');
  if (!subs.高频锚词) subs.高频锚词 = extractSubsection(opts.typeSection, '高频锚词');
  if (!subs.禁止出现) subs.禁止出现 = extractSubsection(opts.typeSection, '禁止出现');
  if (!subs.示例) subs.示例 = extractSubsection(opts.typeSection, '示例');

  let out = template;

  // Conditional blocks — render only the matching role's block, drop the other
  out = applyConditionalBlocks(out, opts.role);

  // Placeholder replacement
  const replacements: Record<string, string> = {
    '{{account}}': opts.account,
    '{{article_type}}': opts.articleType,
    '{{role中文}}': roleCn,
    '{{panel.目标}}': subs.目标,
    '{{panel.word_count}}': wordRange,
    '{{panel.结构骨架}}': subs.结构骨架,
    '{{panel.高频锚词}}': subs.高频锚词,
    '{{panel.禁止出现}}': subs.禁止出现,
    '{{panel.示例}}': subs.示例,
    '{{panel.pronoun_policy.we_ratio}}': String(opts.panelFrontmatter.pronoun_policy.we_ratio),
    '{{panel.pronoun_policy.you_ratio}}': String(opts.panelFrontmatter.pronoun_policy.you_ratio),
    '{{panel.pronoun_policy.avoid}}': opts.panelFrontmatter.pronoun_policy.avoid.join(' / '),
    '{{panel.tone.primary}}': opts.panelFrontmatter.tone.primary,
    '{{panel.tone.humor_frequency}}': opts.panelFrontmatter.tone.humor_frequency,
    '{{panel.tone.opinionated}}': opts.panelFrontmatter.tone.opinionated,
    '{{panel.bold_policy.frequency}}': opts.panelFrontmatter.bold_policy.frequency,
    '{{panel.bold_policy.what_to_bold}}': opts.panelFrontmatter.bold_policy.what_to_bold.join(' / '),
    '{{panel.bold_policy.dont_bold}}': opts.panelFrontmatter.bold_policy.dont_bold.join(' / '),
    '{{panel.transition_phrases}}': opts.panelFrontmatter.transition_phrases.join(' | '),
    '{{panel.data_citation.required}}': String(opts.panelFrontmatter.data_citation.required),
    '{{panel.data_citation.format_style}}': opts.panelFrontmatter.data_citation.format_style,
    '{{product_name}}': opts.product_name ?? '（未知产品）',
    '{{guest_name}}': opts.guest_name ?? '（未知嘉宾）',
    '{{hardRulesBlock}}': opts.hardRulesBlock,
    '{{projectContextBlock}}': opts.projectContextBlock,
  };

  for (const [placeholder, value] of Object.entries(replacements)) {
    out = out.split(placeholder).join(value);
  }

  // Safety: any leftover {{placeholder}} indicates a template bug
  const leftover = out.match(/\{\{[^}]+\}\}/);
  if (leftover) {
    throw new Error(`writer-shared: unreplaced placeholder in prompt: ${leftover[0]}`);
  }

  return out;
}

/**
 * Handle {{#if role === 'opening'}}...{{/if}} and {{#if role === 'closing'}}...{{/if}}
 * by keeping only the block matching current role and dropping the other.
 */
function applyConditionalBlocks(template: string, role: 'opening' | 'closing'): string {
  // Match both opening and closing conditional blocks
  const openingRe = /\{\{#if role === 'opening'\}\}([\s\S]*?)\{\{\/if\}\}/g;
  const closingRe = /\{\{#if role === 'closing'\}\}([\s\S]*?)\{\{\/if\}\}/g;

  return template
    .replace(openingRe, (_m, body) => (role === 'opening' ? body : ''))
    .replace(closingRe, (_m, body) => (role === 'closing' ? body : ''));
}
```

Also create a minimal placeholder `packages/agents/src/prompts/writer-bookend.md` so the test can load it (real content in Task 2):

```bash
cat > /Users/zeoooo/crossing-writer/packages/agents/src/prompts/writer-bookend.md <<'EOF'
# Writer Bookend (placeholder - see Task 2 for real content)

Role: {{role中文}} / Account: {{account}} / Type: {{article_type}}

{{#if role === 'opening'}}开头{{/if}}{{#if role === 'closing'}}结尾{{/if}}

{{panel.目标}}
{{panel.word_count}}
{{panel.结构骨架}}
{{panel.高频锚词}}
{{panel.禁止出现}}
{{panel.示例}}
{{panel.pronoun_policy.we_ratio}}
{{panel.pronoun_policy.you_ratio}}
{{panel.pronoun_policy.avoid}}
{{panel.tone.primary}}
{{panel.tone.humor_frequency}}
{{panel.tone.opinionated}}
{{panel.bold_policy.frequency}}
{{panel.bold_policy.what_to_bold}}
{{panel.bold_policy.dont_bold}}
{{panel.transition_phrases}}
{{panel.data_citation.required}}
{{panel.data_citation.format_style}}
{{product_name}}
{{guest_name}}

{{hardRulesBlock}}
{{projectContextBlock}}

本次任务只写**一段**：{{#if role === 'opening'}}**开头**{{/if}}{{#if role === 'closing'}}**结尾**{{/if}}

字数硬约束: {{panel.word_count}} 字
EOF
```

Note: the "本次任务只写**一段**：" line in the placeholder matches the assertion in the render test.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/agents test writer-shared
```
Expected: PASS (extractSubsection 5 tests + renderHardRulesBlock 3 tests + renderBookendPrompt 3 tests = 11 green).

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/agents/src/roles/writer-shared.ts packages/agents/src/prompts/writer-bookend.md packages/agents/tests/writer-shared.test.ts
git commit -m "feat(agents): add writer-shared helpers (extractSubsection, renderHardRulesBlock, renderBookendPrompt)"
```

---

## Task 2: writer-bookend.md 真实 prompt 内容

**Files:**
- Modify: `packages/agents/src/prompts/writer-bookend.md`（用真实内容覆盖 Task 1 的占位符）

- [ ] **Step 1: Write the final prompt**

Replace the placeholder content in `packages/agents/src/prompts/writer-bookend.md` with:

````markdown
# Writer · Bookend（开头 / 结尾）

你是「{{account}}」风格的一篇文章的写手。本次任务只写**一段**：{{#if role === 'opening'}}**开头**{{/if}}{{#if role === 'closing'}}**结尾**{{/if}}。

## 当前任务

{{#if role === 'opening'}}
写**开头**。
- 目标：{{panel.目标}}
- 字数硬约束：**{{panel.word_count}} 字**（超或不足都要重写）
- 可用结构骨架（三选一，从 panel 现学现用）：

{{panel.结构骨架}}

- 高频锚词（用，不是照抄）：

{{panel.高频锚词}}

- 禁止出现：

{{panel.禁止出现}}

- 参考示例（3 条真实样本，学节奏）：

{{panel.示例}}
{{/if}}
{{#if role === 'closing'}}
写**结尾**。
- 目标：{{panel.目标}}
- 字数硬约束：**{{panel.word_count}} 字**
- 可用结构骨架（三选一）：

{{panel.结构骨架}}

- 高频锚词：

{{panel.高频锚词}}

- 禁止出现：

{{panel.禁止出现}}

- 参考示例：

{{panel.示例}}
{{/if}}

## 写作前必做（硬要求）

写正文前，**必须**调用两个 skill 各至少一次：

1. `search_wiki`：查目标账号的写作惯例、典型 {{role中文}} 套路、常用衔接句
   - query 示例：`{{account}} 怎么写 {{article_type}} 类文章的 {{role中文}}`
   - **query 必须具体**——带账号名、文章类型、段落角色

2. `search_raw`：查跟本文产品 / 嘉宾 / 话题相关的原始信息
   - query 示例：`{{product_name}} 用户反馈` / `{{guest_name}} 最近言论`
   - 目的：拿到具体数字 / 原话 / 场景

查完再写。如果两个 skill 都返回空 / 无关结果，**继续写**，但在段首加注释 `<!-- no wiki/raw hits -->` 便于人工排查。

## 硬规则（绝对不允许违反）

{{hardRulesBlock}}

## 项目上下文

{{projectContextBlock}}

## 声线参考（panel frontmatter）

- **人称**：we_ratio={{panel.pronoun_policy.we_ratio}}，you_ratio={{panel.pronoun_policy.you_ratio}}；避免：{{panel.pronoun_policy.avoid}}
- **调性**：{{panel.tone.primary}}，humor={{panel.tone.humor_frequency}}，opinionated={{panel.tone.opinionated}}
- **粗体**：{{panel.bold_policy.frequency}}；加粗：{{panel.bold_policy.what_to_bold}}；不加粗：{{panel.bold_policy.dont_bold}}
- **衔接句模板**（从里挑，别自造烂衔接）：{{panel.transition_phrases}}
- **数据引用**：required={{panel.data_citation.required}}；格式：{{panel.data_citation.format_style}}

---

现在开始写。只输出**最终段落正文**，markdown 格式，不要前言 / 解释 / 代码围栏。
````

- [ ] **Step 2: Re-run shared tests to verify render still works**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/agents test writer-shared
```
Expected: 11 tests still green (the placeholder tokens moved around but tests only assert presence / absence, not exact structure).

Note: if the "本次任务只写**一段**：" substring test breaks, adjust the test string to match the new prompt wording exactly.

- [ ] **Step 3: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/agents/src/prompts/writer-bookend.md
git commit -m "feat(agents): writer-bookend prompt template (opening + closing merged, mandatory search)"
```

---

## Task 3: writer-bookend-agent.ts + tests

**Files:**
- Create: `packages/agents/src/roles/writer-bookend-agent.ts`
- Create: `packages/agents/tests/writer-bookend-agent.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/agents/tests/writer-bookend-agent.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { runWriterBookend } from '../src/roles/writer-bookend-agent.js';
import type { PanelFrontmatterLike } from '../src/roles/writer-shared.js';

const PANEL_FM: PanelFrontmatterLike = {
  word_count_ranges: { opening: [150, 260], article: [3500, 8000] },
  pronoun_policy: { we_ratio: 0.4, you_ratio: 0.3, avoid: ['笔者'] },
  tone: { primary: '客观克制', humor_frequency: 'low', opinionated: 'mid' },
  bold_policy: { frequency: '每段 0-2 处', what_to_bold: ['核心句'], dont_bold: ['整段'] },
  transition_phrases: ['先说 XXX'],
  data_citation: { required: true, format_style: '数字+单位+来源', min_per_article: 1 },
};

const TYPE_SECTION = `### 目标
给读者钩子

### 字数范围
150 – 260 字

### 结构骨架（三选一）
**A. 场景** · x

### 高频锚词
- "2013 年"

### 禁止出现
- "本文将"

### 示例
**示例 1** · ColaOS · 结构 A
> 正文
`;

describe('runWriterBookend', () => {
  it('invokes tool runner with role=opening system prompt', async () => {
    const invokeAgent = vi.fn(async (_messages, _opts) => ({
      text: '测试开头段正文。',
      meta: { cli: 'claude', model: 'claude-opus-4-6', durationMs: 100 },
    }));
    const dispatchTool = vi.fn(async () => ({
      ok: true as const,
      tool: 'search_wiki',
      query: 'x',
      args: {},
      hits: [],
      hits_count: 0,
      formatted: '',
    }));

    const result = await runWriterBookend({
      role: 'opening',
      sectionKey: 'opening',
      account: 'acc',
      articleType: '实测',
      typeSection: TYPE_SECTION,
      panelFrontmatter: PANEL_FM,
      hardRulesBlock: '',
      projectContextBlock: '',
      userMessage: 'please write',
      invokeAgent,
      dispatchTool,
    });

    expect(result.finalText).toBe('测试开头段正文。');
    expect(invokeAgent).toHaveBeenCalled();
    // The first call's messages[0] (system) should contain opening-specific text
    const firstCallMessages = invokeAgent.mock.calls[0]![0] as any[];
    const systemMessage = firstCallMessages.find((m: any) => m.role === 'system');
    expect(systemMessage.content).toContain('**开头**');
    expect(systemMessage.content).not.toContain('**结尾**');
    expect(systemMessage.content).toContain('十字路口');
    // We can't assert account='acc' literally ("十字路口" isn't acc), so assert the var replacement:
    expect(systemMessage.content).toContain('acc');
  });

  it('invokes tool runner with role=closing system prompt', async () => {
    const invokeAgent = vi.fn(async () => ({
      text: '测试结尾段。',
      meta: { cli: 'claude', model: 'claude-opus-4-6', durationMs: 100 },
    }));
    const dispatchTool = vi.fn();
    const result = await runWriterBookend({
      role: 'closing',
      sectionKey: 'closing',
      account: 'acc',
      articleType: '实测',
      typeSection: TYPE_SECTION,
      panelFrontmatter: PANEL_FM,
      hardRulesBlock: '',
      projectContextBlock: '',
      userMessage: 'please write',
      invokeAgent,
      dispatchTool: dispatchTool as any,
    });
    expect(result.finalText).toBe('测试结尾段。');
    const firstCallMessages = invokeAgent.mock.calls[0]![0] as any[];
    const systemMessage = firstCallMessages.find((m: any) => m.role === 'system');
    expect(systemMessage.content).toContain('**结尾**');
    expect(systemMessage.content).not.toContain('**开头**');
  });

  it('passes dispatchTool through to tool runner', async () => {
    // LLM invokes search_wiki once via parsed tool call, then writes
    const mockResponses = [
      'search_wiki "acc 怎么写"',  // round 1: tool call
      '这是最终段落。',                 // round 2: no tool call, final text
    ];
    let callIdx = 0;
    const invokeAgent = vi.fn(async () => ({
      text: mockResponses[callIdx++]!,
      meta: { cli: 'claude', model: 'opus', durationMs: 10 },
    }));
    const dispatchTool = vi.fn(async () => ({
      ok: true as const,
      tool: 'search_wiki',
      query: 'acc 怎么写',
      args: {},
      hits: [],
      hits_count: 0,
      formatted: '(no results)',
    }));
    const out = await runWriterBookend({
      role: 'opening',
      sectionKey: 'opening',
      account: 'acc',
      articleType: '实测',
      typeSection: TYPE_SECTION,
      panelFrontmatter: PANEL_FM,
      hardRulesBlock: '',
      projectContextBlock: '',
      userMessage: 'start',
      invokeAgent,
      dispatchTool,
    });
    expect(dispatchTool).toHaveBeenCalledTimes(1);
    expect(out.finalText).toContain('这是最终段落。');
    expect(out.rounds).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/agents test writer-bookend-agent
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/agents/src/roles/writer-bookend-agent.ts`:

```ts
import { TOOL_PROTOCOL_PROMPT } from '../prompts/load.js';
import {
  runWriterWithTools,
  type ChatMessage,
  type WriterRunResult,
  type ToolCall,
  type SkillResult,
  type WriterToolEvent,
} from '../writer-tool-runner.js';
import {
  renderBookendPrompt,
  type PanelFrontmatterLike,
} from './writer-shared.js';

export interface RunWriterBookendOpts {
  role: 'opening' | 'closing';
  sectionKey: string;
  account: string;
  articleType: '实测' | '访谈' | '评论';
  typeSection: string;
  panelFrontmatter: PanelFrontmatterLike;
  hardRulesBlock: string;
  projectContextBlock: string;
  product_name?: string;
  guest_name?: string;
  invokeAgent: (
    messages: ChatMessage[],
    opts?: { images?: string[]; addDirs?: string[] },
  ) => Promise<{ text: string; meta: { cli: string; model?: string; durationMs: number } }>;
  userMessage: string;
  images?: string[];
  addDirs?: string[];
  pinnedContext?: string;
  dispatchTool: (call: ToolCall) => Promise<SkillResult>;
  onEvent?: (ev: WriterToolEvent) => void;
  maxRounds?: number;
}

export async function runWriterBookend(opts: RunWriterBookendOpts): Promise<WriterRunResult> {
  const basePrompt = renderBookendPrompt({
    role: opts.role,
    account: opts.account,
    articleType: opts.articleType,
    typeSection: opts.typeSection,
    panelFrontmatter: opts.panelFrontmatter,
    hardRulesBlock: opts.hardRulesBlock,
    projectContextBlock: opts.projectContextBlock,
    product_name: opts.product_name,
    guest_name: opts.guest_name,
  });

  const systemPrompt = `${basePrompt}\n\n${TOOL_PROTOCOL_PROMPT}`;
  const agentName = opts.role === 'opening' ? 'writer.opening' : 'writer.closing';

  return runWriterWithTools({
    agent: { invoke: opts.invokeAgent },
    agentName,
    sectionKey: opts.sectionKey,
    systemPrompt,
    initialUserMessage: opts.userMessage,
    pinnedContext: opts.pinnedContext,
    dispatchTool: opts.dispatchTool,
    onEvent: opts.onEvent,
    images: opts.images,
    addDirs: opts.addDirs,
    maxRounds: opts.maxRounds,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/agents test writer-bookend-agent
```
Expected: 3 tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/agents/src/roles/writer-bookend-agent.ts packages/agents/tests/writer-bookend-agent.test.ts
git commit -m "feat(agents): runWriterBookend unifies opening+closing via role param"
```

---

## Task 4: 更新 agents 包 barrel exports

**Files:**
- Modify: `packages/agents/src/index.ts`

- [ ] **Step 1: Read current exports**

```bash
cat /Users/zeoooo/crossing-writer/packages/agents/src/index.ts | head -50
```

Expected: to see lines like:
```
export { WriterOpeningAgent, runWriterOpening } from "./roles/writer-opening-agent.js";
export type { WriterOpeningInput, WriterOutput, ReferenceAccountKb, RunWriterOpeningOpts } from "./roles/writer-opening-agent.js";
export { WriterClosingAgent, runWriterClosing } from "./roles/writer-closing-agent.js";
export type { WriterClosingInput, RunWriterClosingOpts } from "./roles/writer-closing-agent.js";
```

- [ ] **Step 2: Replace the four lines**

Open `packages/agents/src/index.ts` and REPLACE these four old export lines:

```
export { WriterOpeningAgent, runWriterOpening } from "./roles/writer-opening-agent.js";
export type { WriterOpeningInput, WriterOutput, ReferenceAccountKb, RunWriterOpeningOpts } from "./roles/writer-opening-agent.js";
export { WriterClosingAgent, runWriterClosing } from "./roles/writer-closing-agent.js";
export type { WriterClosingInput, RunWriterClosingOpts } from "./roles/writer-closing-agent.js";
```

With:

```
export { runWriterBookend } from "./roles/writer-bookend-agent.js";
export type { RunWriterBookendOpts } from "./roles/writer-bookend-agent.js";
export { extractSubsection, renderHardRulesBlock, renderBookendPrompt } from "./roles/writer-shared.js";
export type { WritingHardRules, PanelFrontmatterLike } from "./roles/writer-shared.js";
```

Keep `ReferenceAccountKb` + `WriterOutput` — they're used elsewhere. Move them to `writer-shared.ts` OR keep a lightweight re-export from a new place. Simplest:

Add at the top of `packages/agents/src/roles/writer-shared.ts`:

```ts
export interface ReferenceAccountKb {
  id: string;
  text: string;
}

export interface WriterOutput {
  text: string;
  meta: { cli: string; model?: string | null; durationMs: number };
}
```

And include them in the export line:

```
export type { ReferenceAccountKb, WriterOutput, WritingHardRules, PanelFrontmatterLike } from "./roles/writer-shared.js";
```

- [ ] **Step 3: Type-check the package**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/agents exec tsc --noEmit
```
Expected: no errors. If errors, they indicate callers still import `runWriterOpening` / `runWriterClosing` via barrel — those will be fixed in Tasks 5/6/7.

**If tsc fails at this step** because callers break, that's expected — we'll fix them in the next tasks. Proceed.

- [ ] **Step 4: Run agents tests**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/agents test
```
Expected: all agents tests green (old opening/closing agent tests still exist but test the old files which still exist; those are deleted in Task 8).

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/agents/src/index.ts packages/agents/src/roles/writer-shared.ts
git commit -m "feat(agents): export runWriterBookend from barrel; move ReferenceAccountKb/WriterOutput to writer-shared"
```

---

## Task 5: orchestrator 改用 runWriterBookend

**Files:**
- Modify: `packages/web-server/src/services/writer-orchestrator.ts`

- [ ] **Step 1: Inspect current opening call site**

```bash
grep -n "runWriterOpening\|runWriterClosing" /Users/zeoooo/crossing-writer/packages/web-server/src/services/writer-orchestrator.ts
```

Expected output:
```
5:  runWriterOpening, runWriterPractice, runWriterClosing, runStyleCritic,
399:        const result: WriterRunResult = await runWriterOpening({
598:      const result: WriterRunResult = await runWriterClosing({
```

- [ ] **Step 2: Update imports**

At line 5 (the `@crossing/agents` import block), change:

```ts
import {
  runWriterOpening, runWriterPractice, runWriterClosing, runStyleCritic,
  PracticeStitcherAgent,
  invokeAgent,
  type ReferenceAccountKb,
  type ChatMessage,
  type WriterToolEvent,
  type WriterRunResult,
  type ToolUsage,
} from "@crossing/agents";
```

to:

```ts
import {
  runWriterBookend, runWriterPractice, runStyleCritic,
  PracticeStitcherAgent,
  invokeAgent,
  type ReferenceAccountKb,
  type ChatMessage,
  type WriterToolEvent,
  type WriterRunResult,
  type ToolUsage,
} from "@crossing/agents";
```

(Remove `runWriterOpening` and `runWriterClosing`, add `runWriterBookend`.)

- [ ] **Step 3: Read the opening call site (around line 399)**

```bash
sed -n '380,440p' /Users/zeoooo/crossing-writer/packages/web-server/src/services/writer-orchestrator.ts
```

Inspect the existing call structure. It likely looks like:

```ts
const result: WriterRunResult = await runWriterOpening({
  invokeAgent: invokerFor("writer.opening", openingResolved.cli, openingResolved.model),
  userMessage: openingUserMessage,
  images: projectImages,
  addDirs: projectAddDirs,
  pinnedContext: formatStyleReference(openingStyle),
  dispatchTool,
  onEvent: toolEventBridge("opening"),
  sectionKey: "opening",
  maxRounds: 5,
});
```

- [ ] **Step 4: Modify the opening call site**

Replace `runWriterOpening({...})` with `runWriterBookend({ role: 'opening', ...bookendArgs })`. The new call needs these extra fields from the resolved style:

```ts
const openingPanel = openingStyle!.panel;   // v2 PanelV2 (cast from ResolvedStyle.panel)
const openingTypeSection = openingStyle!.typeSection;
const openingHardRules = openingStyle!.hardRulesBlock;
const articleType = project.article_type!;   // guaranteed by pre-check

const result: WriterRunResult = await runWriterBookend({
  role: 'opening',
  sectionKey: 'opening',
  account: openingPanel.frontmatter.account,
  articleType,
  typeSection: openingTypeSection,
  panelFrontmatter: openingPanel.frontmatter as any, // PanelFrontmatterV2 is compatible with PanelFrontmatterLike
  hardRulesBlock: openingHardRules,
  projectContextBlock: ctxBundle ? renderContextBlock(ctxBundle) : '',
  product_name: project.product_info?.name ?? undefined,
  // guest_name: — not tracked yet, leave undefined
  invokeAgent: invokerFor("writer.opening", openingResolved.cli, openingResolved.model),
  userMessage: openingUserMessage,
  images: projectImages,
  addDirs: projectAddDirs,
  pinnedContext: formatStyleReference(openingStyle!),
  dispatchTool,
  onEvent: toolEventBridge("opening"),
  maxRounds: 5,
});
```

Note: `openingStyle` used to be `ResolvedStyle` which after SP-A T15 has `panel`, `typeSection`, `hardRulesBlock`. The `panel` field is cast from `PanelV2` — its `frontmatter` has the full v2 shape which satisfies `PanelFrontmatterLike`.

The `openingUserMessage` assembly probably looks something like:

```ts
const openingUserMessage = [
  "# Brief 摘要",
  briefSummary || "(无)",
  "",
  "# Mission 摘要",
  missionSummary || "(无)",
  "",
  "# 产品概览",
  productOverview || "(无)",
  "",
  "请按 system prompt 要求产出{{role 中文}}段正文。",
].join("\n");
```

Since the system prompt already contains panel / hard rules / project context via the template, `userMessage` can be shortened to a simple invocation trigger:

```ts
const openingUserMessage = "请按 system prompt 的要求产出开头段正文。";
```

But keep the existing userMessage content if it's still informational (brief/mission/overview may not be in the projectContextBlock yet depending on ctxBundle).

Pragmatic decision: **keep the existing userMessage structure** — it's additional grounding for the LLM and doesn't break anything. The template's `{{projectContextBlock}}` is additive, not redundant-harmful.

- [ ] **Step 5: Do the same for closing call site (around line 598)**

Find the `await runWriterClosing({...})` call and rewrite to `runWriterBookend({ role: 'closing', ... })` following the same pattern as opening. The closing call probably additionally has `openingText` and `practiceText` in its `userMessage` — keep those in `userMessage`, not in the system prompt.

- [ ] **Step 6: Run type-check**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-server exec tsc --noEmit 2>&1 | grep "writer-orchestrator" | head -20
```
Expected: no new type errors on writer-orchestrator.ts. Pre-existing errors in case-plan-orchestrator / overview-analyzer-service are fine.

- [ ] **Step 7: Run web-server tests (quick sanity)**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-server test writer-orchestrator 2>&1 | tail -15
```
Expected: tests either still pass or the only failures are pre-existing (record them).

- [ ] **Step 8: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/web-server/src/services/writer-orchestrator.ts
git commit -m "refactor(web-server): writer-orchestrator uses runWriterBookend for opening+closing"
```

---

## Task 6: writer-rewrite-selection route 改用 runWriterBookend

**Files:**
- Modify: `packages/web-server/src/routes/writer-rewrite-selection.ts`

- [ ] **Step 1: Inspect current usage**

```bash
grep -n "runWriterOpening\|runWriterClosing\|writer-opening\|writer-closing" /Users/zeoooo/crossing-writer/packages/web-server/src/routes/writer-rewrite-selection.ts
```

Expected output:
```
7:  runWriterOpening,
9:  runWriterClosing,
46:type RunnerFn = typeof runWriterOpening;
52:    return { run: runWriterOpening, agentKey: "writer.opening" };
54:    return { run: runWriterClosing, agentKey: "writer.closing" };
```

- [ ] **Step 2: Read the function to understand the dispatch pattern**

```bash
sed -n '40,80p' /Users/zeoooo/crossing-writer/packages/web-server/src/routes/writer-rewrite-selection.ts
```

- [ ] **Step 3: Rewrite the dispatch**

Replace the import and dispatch logic:

```ts
// old imports (remove)
// import {
//   runWriterOpening,
//   runWriterPractice,
//   runWriterClosing,
//   ...
// } from "@crossing/agents";

// new imports
import {
  runWriterBookend,
  runWriterPractice,
  // keep existing types
  type RunWriterBookendOpts,
  type RunWriterPracticeOpts,
} from "@crossing/agents";
```

Replace the `resolveRunner(sectionKey)` helper. Old shape was:

```ts
type RunnerFn = typeof runWriterOpening;

function resolveRunner(sectionKey: string): { run: RunnerFn; agentKey: string } {
  if (sectionKey === "opening") {
    return { run: runWriterOpening, agentKey: "writer.opening" };
  }
  if (sectionKey === "closing") {
    return { run: runWriterClosing, agentKey: "writer.closing" };
  }
  // ... practice, stitcher, etc.
}
```

New shape:

```ts
type BookendSection = { kind: 'bookend'; role: 'opening' | 'closing'; agentKey: string };
type PracticeSection = { kind: 'practice'; agentKey: string };

function resolveRunner(sectionKey: string): BookendSection | PracticeSection | null {
  if (sectionKey === "opening") return { kind: 'bookend', role: 'opening', agentKey: "writer.opening" };
  if (sectionKey === "closing") return { kind: 'bookend', role: 'closing', agentKey: "writer.closing" };
  if (sectionKey.startsWith("practice.case-")) return { kind: 'practice', agentKey: "writer.practice" };
  return null;
}
```

And at the call site:

```ts
const resolved = resolveRunner(sectionKey);
if (!resolved) { return reply.code(400).send({ error: `unsupported section: ${sectionKey}` }); }

if (resolved.kind === 'bookend') {
  const out = await runWriterBookend({
    role: resolved.role,
    sectionKey,
    // ... all the same fields as in Task 5 step 4:
    account: ...,
    articleType: ...,
    typeSection: ...,
    panelFrontmatter: ...,
    hardRulesBlock: ...,
    projectContextBlock: ...,
    invokeAgent: ...,
    userMessage: ...,
    dispatchTool: ...,
    // etc.
  });
} else {
  const out = await runWriterPractice({ ... });   // unchanged
}
```

The full field list for `runWriterBookend` matches Task 5 step 4.

- [ ] **Step 4: Type-check**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-server exec tsc --noEmit 2>&1 | grep "writer-rewrite" | head -10
```
Expected: no new errors.

- [ ] **Step 5: Run affected tests**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-server test writer-rewrite 2>&1 | tail -15
```
Expected: tests green (or only pre-existing failures).

- [ ] **Step 6: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/web-server/src/routes/writer-rewrite-selection.ts
git commit -m "refactor(web-server): writer-rewrite-selection routes through runWriterBookend"
```

---

## Task 7: writer.ts route 改用 runWriterBookend

**Files:**
- Modify: `packages/web-server/src/routes/writer.ts`

- [ ] **Step 1: Inspect current usage**

```bash
grep -n "runWriterOpening\|runWriterClosing\|WriterOpeningAgent\|WriterClosingAgent" /Users/zeoooo/crossing-writer/packages/web-server/src/routes/writer.ts
```

Expected output:
```
16:  WriterOpeningAgent, WriterPracticeAgent, WriterClosingAgent,
18:  runWriterOpening, runWriterPractice, runWriterClosing,
383:            const out = await runWriterOpening({
397:            const out = await runWriterClosing({
```

- [ ] **Step 2: Remove class imports and update runner imports**

In the `@crossing/agents` import block (around lines 15-20), remove `WriterOpeningAgent`, `WriterClosingAgent` (the classes — no longer exist), remove `runWriterOpening`, `runWriterClosing`, add `runWriterBookend`.

If `WriterPracticeAgent` is still exported and used, keep it. If `PracticeStitcherAgent` is still exported and used, keep it.

- [ ] **Step 3: Read the two call sites**

```bash
sed -n '370,420p' /Users/zeoooo/crossing-writer/packages/web-server/src/routes/writer.ts
```

These are likely the rewrite endpoints calling the old runners.

- [ ] **Step 4: Rewrite both call sites**

Same rewrite as Task 5 step 4: `runWriterOpening({...})` → `runWriterBookend({ role: 'opening', ... })` and `runWriterClosing({...})` → `runWriterBookend({ role: 'closing', ... })`.

Reuse the article_type / panel / hard rules lookup that writer.ts already does via `resolveStyleBindingV2` and `hardRulesStore.read()`. They're already wired (SP-A T15). Fetch them inside the handler if not already:

```ts
const project = await deps.store.get(req.params.id);
if (!project?.article_type) return reply.code(400).send({ error: 'article_type missing' });
const agentConfig = deps.agentConfigStore?.get(agentKey);
const binding = agentConfig?.styleBinding;
if (!binding) return reply.code(400).send({ error: 'no style binding' });
const resolvedStyle = await resolveStyleBindingV2(binding, project.article_type, deps.stylePanelStore!);
const hardRules = await deps.hardRulesStore!.read();
const hardRulesBlock = renderHardRulesBlock(hardRules, resolvedStyle.panel.frontmatter.banned_vocabulary);

// then:
const out = await runWriterBookend({
  role: 'opening',        // or 'closing' at the other call site
  sectionKey: req.params.key,
  account: binding.account,
  articleType: project.article_type,
  typeSection: resolvedStyle.typeSection,
  panelFrontmatter: resolvedStyle.panel.frontmatter as any,
  hardRulesBlock,
  projectContextBlock: '',  // rewrite-selection may not need full context
  invokeAgent: invoker,
  userMessage,
  dispatchTool,
  onEvent,
  maxRounds: 5,
});
```

Note: `renderHardRulesBlock` is now exported from `@crossing/agents` via `writer-shared`. Import it there:

```ts
import { renderHardRulesBlock } from "@crossing/agents";
```

And you can delete any local duplicate `renderHardRulesBlock` function in `writer.ts` if present (there was one before T15 SP-A).

- [ ] **Step 5: Type-check**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-server exec tsc --noEmit 2>&1 | grep "routes/writer.ts" | head -10
```
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/web-server/src/routes/writer.ts
git commit -m "refactor(web-server): writer.ts route uses runWriterBookend for opening+closing rewrites"
```

---

## Task 8: 删除老 agent 文件 + grep 验证

**Files:**
- Delete: `packages/agents/src/roles/writer-opening-agent.ts`
- Delete: `packages/agents/src/roles/writer-closing-agent.ts`
- Delete: `packages/agents/src/prompts/writer-opening.md`
- Delete: `packages/agents/src/prompts/writer-closing.md`

- [ ] **Step 1: Delete old agent files**

```bash
cd /Users/zeoooo/crossing-writer && rm \
  packages/agents/src/roles/writer-opening-agent.ts \
  packages/agents/src/roles/writer-closing-agent.ts \
  packages/agents/src/prompts/writer-opening.md \
  packages/agents/src/prompts/writer-closing.md
```

- [ ] **Step 2: Check for any related old test files**

```bash
ls /Users/zeoooo/crossing-writer/packages/agents/tests/writer-opening* /Users/zeoooo/crossing-writer/packages/agents/tests/writer-closing* 2>/dev/null
```

If files exist, delete them too:

```bash
rm /Users/zeoooo/crossing-writer/packages/agents/tests/writer-opening-agent.test.ts 2>/dev/null
rm /Users/zeoooo/crossing-writer/packages/agents/tests/writer-closing-agent.test.ts 2>/dev/null
```

- [ ] **Step 3: Grep for leftover references**

```bash
cd /Users/zeoooo/crossing-writer && grep -rn "runWriterOpening\|runWriterClosing\|WriterOpeningAgent\|WriterClosingAgent\|writer-opening\|writer-closing" packages/ --include="*.ts" --include="*.tsx" --include="*.md" 2>/dev/null | grep -v "\.superpowers\|dist/\|node_modules"
```

Expected: only spec/plan document references (from docs/superpowers/) and comments. Zero active imports / callers.

If anything else shows up, open that file and fix it to use `runWriterBookend`.

- [ ] **Step 4: Build the agents package**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/agents build
```
Expected: build succeeds. If TSC errors remain, the grep missed a reference.

- [ ] **Step 5: Run full agents + web-server tests**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/agents --filter @crossing/web-server test 2>&1 | tail -30
```
Expected: new tests green. Pre-existing failures (case-plan-orchestrator, overview-analyzer-service) remain — record the count before and after to confirm no new regressions.

- [ ] **Step 6: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add -A packages/agents/
git commit -m "chore(agents): delete legacy writer-opening / writer-closing agents + prompts"
```

---

## Task 9: trae 项目手动验收

**Files:** (none — runtime verification)

- [ ] **Step 1: Ensure trae project is in a good state**

```bash
python3 -c "
import json
d = json.load(open('/Users/zeoooo/CrossingVault/07_projects/trae/project.json'))
print('status:', d['status'])
print('article_type:', d['article_type'])
"
```

Expected:
- `status` ∈ `{ evidence_ready, writing_configuring, writing_ready }` (anything that can accept `/writer/start`)
- `article_type` == `'实测'`

If `article_type` is None, set it:

```bash
python3 -c "
import json
p = '/Users/zeoooo/CrossingVault/07_projects/trae/project.json'
d = json.load(open(p))
d['article_type'] = '实测'
d['status'] = 'evidence_ready'
d.pop('writer_config', None)
d.pop('writer_failed_sections', None)
json.dump(d, open(p, 'w'), indent=2, ensure_ascii=False)
print('reset to evidence_ready + article_type=实测')
"
```

- [ ] **Step 2: Rebuild and restart the web-server**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/agents build
touch packages/web-server/src/server.ts   # tsx watch restarts child
sleep 4
lsof -i :3001 -t
```

Expected: PID listed for port 3001.

- [ ] **Step 3: Trigger writer.start**

```bash
curl -sS -X POST http://localhost:3001/api/projects/trae/writer/start \
  -H "Content-Type: application/json" -d '{}'
```

Expected: `{"ok":true}`.

- [ ] **Step 4: Watch events until writing_ready**

```bash
tail -f /Users/zeoooo/CrossingVault/07_projects/trae/events.jsonl \
  | grep --line-buffered -E 'writer\.section_(started|completed|failed)|writer\.tool_called|state_changed|run\.blocked'
```

(Press Ctrl-C when you see `section_completed` for opening, closing, and all 4 case sections.)

Expected events (in order):
- `state_changed { from: 'evidence_ready', to: 'writing_running' }`
- `writer.section_started { section_key: 'opening' }` + 4 practice.case-N + 1 closing
- `writer.tool_called { tool: 'search_wiki', section_key: 'opening' }` — **at least once**
- `writer.tool_called { tool: 'search_raw', section_key: 'opening' }` — **at least once**
- `writer.section_completed { section_key: 'opening', ... }` — char count in panel range
- Same for closing
- `state_changed { to: 'writing_ready' }`

If any `writer.section_failed` or `run.blocked` events fire, check the project events.jsonl for full error text.

- [ ] **Step 5: Verify opening output**

```bash
cat /Users/zeoooo/CrossingVault/07_projects/trae/article/sections/opening.md | head -50
```

Checklist (manual, eyeball):

- [ ] Content is readable Chinese, not garbled / cut off
- [ ] Paragraphs are short (≤ 80 chars each, blank line between paragraphs)
- [ ] No `"不是 X 而是 Y"` construction
- [ ] No `—` / `–` dash characters
- [ ] No banned vocabulary (grep for `炸裂|绝绝子|神器|yyds|震撼发布|颠覆|保姆级`)
- [ ] Uses at least one transition phrase from the panel's `transition_phrases` list (e.g. `"接下来,分享我们的实测"`)

If any check fails, it's NOT a B.1 regression — B.1 is structural refactor. Quality issues are addressed in B.2 (hard-constraint injection) and B.3 (post-write validator).

- [ ] **Step 6: Verify closing output**

Same checks for `closing.md`:

```bash
cat /Users/zeoooo/CrossingVault/07_projects/trae/article/sections/closing.md | head -50
```

- [ ] **Step 7: Verify tool calls were made**

Count `writer.tool_called` events grouped by tool:

```bash
grep '"writer.tool_called"' /Users/zeoooo/CrossingVault/07_projects/trae/events.jsonl \
  | python3 -c "
import json, sys
from collections import Counter
c = Counter()
for l in sys.stdin:
    try:
        j = json.loads(l)
        d = j.get('data', {})
        if d.get('section_key') in ('opening', 'closing'):
            c[(d.get('section_key'), d.get('tool'))] += 1
    except: pass
for (sk, tool), n in sorted(c.items()):
    print(f'{sk} · {tool}: {n}')
"
```

Expected output (numbers may vary, but each should be ≥ 1):
```
closing · search_raw: 1+
closing · search_wiki: 1+
opening · search_raw: 1+
opening · search_wiki: 1+
```

If any category is 0, the prompt's mandatory-search instruction isn't firing. Likely causes:
- LLM ignored the instruction (prompt too long or buried) — adjust prompt wording
- Tool runner config doesn't have search_wiki/search_raw enabled for this agent (check `config.json#agents.writer.opening.tools`)

Record findings; fixing this is a follow-up if needed.

- [ ] **Step 8: Mark acceptance complete**

If all above checks pass, append a note to the spec's validation log:

```bash
cat >> /Users/zeoooo/crossing-writer/docs/superpowers/specs/2026-04-17-sp-b1-bookend-agent-design.md <<EOF

---

## Validation Log

- **$(date +%Y-%m-%d)**: Trae project writer run completed (all 7 sections: opening, closing, 4 practice cases, transitions).
  - Opening / closing char counts within panel ranges: PASS
  - No banned vocabulary: PASS
  - Short paragraphs + blank lines: PASS
  - search_wiki / search_raw called at least once each per bookend section: PASS
EOF
```

If anything failed, record the specific failure and open a follow-up task.

- [ ] **Step 9: Commit validation log (if passing)**

```bash
cd /Users/zeoooo/crossing-writer && git add docs/superpowers/specs/2026-04-17-sp-b1-bookend-agent-design.md
git commit -m "docs(sp-b1): validation log — trae project writer run passed manual acceptance"
```

---

## Self-Review

### Spec coverage

| Spec requirement | Task |
|---|---|
| 合并 opening + closing 为 writer-bookend-agent | Task 3 |
| 共用 prompt 模板 with role marker | Task 2 + Task 3 |
| 公共辅助抽到 writer-shared.ts | Task 1 |
| 手写模板替换（不引 mustache）| Task 1 (renderBookendPrompt) |
| search_wiki / search_raw 硬要求（prompt 级别） | Task 2 (writer-bookend.md) |
| 空结果兜底：继续写 + `<!-- no wiki/raw hits -->` | Task 2 (prompt instruction) |
| 删除老 agent 文件 / 老 prompt 文件 | Task 8 |
| orchestrator 调用改成 runWriterBookend | Task 5 |
| writer.ts 路由调用改 | Task 7 |
| writer-rewrite-selection 路由调用改 | Task 6 |
| barrel exports 更新 | Task 4 |
| 单元测试（shared + bookend agent） | Task 1, Task 3 |
| 手动验收（trae 项目） | Task 9 |
| practice / stitcher / style_critic 不碰 | implicit — not touched |

No gaps found.

### Placeholder scan

- No "TBD" / "TODO" / "handle edge cases" / "similar to Task N" — all code blocks are complete.
- Task 6 has one slightly terse block at step 3 ("读取函数理解 dispatch 模式"), but step 4 provides the full replacement code.

### Type consistency

- `RunWriterBookendOpts` signature used consistently across Task 3 definition and Tasks 5/6/7 call sites.
- `PanelFrontmatterLike` defined in Task 1, referenced in Task 3, cast from `PanelV2.frontmatter` in Tasks 5/6/7 via `as any`.
- `WritingHardRules` defined in Task 1 (duplicated from web-server's hard-rules-store type — acceptable because the agents package shouldn't depend on web-server types).

All consistent.

---

**Done. Plan ready for execution.**
