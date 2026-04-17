# SP-B.3 Post-Write Validator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After writer produces opening / closing, validate (word count 20% tolerance, banned phrases zero-tolerance, banned vocabulary zero-tolerance) and retry once with violations fed back to the agent.

**Architecture:** A pure validator module (`bookend-validator.ts`) returns `{ ok, violations, chars }`. `renderBookendPrompt` gains a `retryFeedback` parameter that, when set, prepends a "上一次产出 - 不合规" block to the prompt. Orchestrator wraps each bookend call with `runBookendWithValidation` which runs validator, emits events, optionally retries once, and returns the final result.

**Tech Stack:** TypeScript, Node fs, vitest, existing `runWriterBookend` / `renderBookendPrompt` from `@crossing/agents`.

---

## File Structure

**Create:**
- `packages/agents/src/roles/bookend-validator.ts` — pure validator functions, no I/O
- `packages/agents/tests/bookend-validator.test.ts` — unit tests
- `packages/web-server/tests/writer-orchestrator-validation.test.ts` — integration test with mocked invoker

**Modify:**
- `packages/agents/src/roles/writer-shared.ts` — `RenderBookendPromptOpts` gains `retryFeedback?`; render inserts a block
- `packages/agents/src/prompts/writer-bookend.md` — add `{{retryFeedbackBlock}}` placeholder
- `packages/agents/tests/writer-shared.test.ts` — assert retry block rendering
- `packages/agents/src/roles/writer-bookend-agent.ts` — `RunWriterBookendOpts.retryFeedback?` + pass-through
- `packages/agents/src/index.ts` — export validator + types
- `packages/web-server/src/services/writer-orchestrator.ts` — new `runBookendWithValidation` wrapper; opening / closing call sites use it
- `docs/superpowers/specs/2026-04-17-sp-b3-post-write-validator-design.md` — append validation log after real run

---

## Task 1: Validator — countChars + checkWordCount (20% tolerance)

**Files:**
- Create: `packages/agents/src/roles/bookend-validator.ts`
- Create: `packages/agents/tests/bookend-validator.test.ts`

- [ ] **Step 1: Write failing tests**

Write to `packages/agents/tests/bookend-validator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { countChars, checkWordCount } from '../src/roles/bookend-validator.js';

describe('countChars', () => {
  it('counts Chinese + English chars, ignoring whitespace', () => {
    expect(countChars('你好 hello')).toBe(7);
  });

  it('strips markdown bold markers', () => {
    expect(countChars('**核心**观点')).toBe(4);
  });

  it('strips markdown headings', () => {
    expect(countChars('# 标题\n正文')).toBe(4);
  });

  it('strips code fences and inline backticks', () => {
    expect(countChars('`code` 正文')).toBe(6);
  });

  it('strips list bullets', () => {
    expect(countChars('- 项目一\n- 项目二')).toBe(6);
  });

  it('counts empty string as 0', () => {
    expect(countChars('')).toBe(0);
  });
});

describe('checkWordCount', () => {
  it('returns null when override missing', () => {
    expect(checkWordCount('正文', undefined)).toBeNull();
  });

  it('returns null when chars within tolerance band', () => {
    // range [200, 350], tolerance band [160, 420]
    const text = '字'.repeat(300);
    expect(checkWordCount(text, [200, 350])).toBeNull();
  });

  it('returns null when chars equal upper tolerance bound (420)', () => {
    const text = '字'.repeat(420);
    expect(checkWordCount(text, [200, 350])).toBeNull();
  });

  it('returns violation when chars > ceil(max * 1.2)', () => {
    // range [200, 350], tolerance max = ceil(350*1.2) = 420
    const text = '字'.repeat(421);
    const v = checkWordCount(text, [200, 350]);
    expect(v).toEqual({
      kind: 'word_count',
      chars: 421,
      min: 200,
      max: 350,
      tolerance: 0.2,
    });
  });

  it('returns violation when chars < floor(min * 0.8)', () => {
    // range [200, 350], tolerance min = floor(200*0.8) = 160
    const text = '字'.repeat(159);
    const v = checkWordCount(text, [200, 350]);
    expect(v).toEqual({
      kind: 'word_count',
      chars: 159,
      min: 200,
      max: 350,
      tolerance: 0.2,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @crossing/agents test bookend-validator`
Expected: FAIL with "Cannot find module '../src/roles/bookend-validator.js'".

- [ ] **Step 3: Create validator file**

Write to `packages/agents/src/roles/bookend-validator.ts`:

```ts
export type Violation =
  | { kind: 'word_count'; chars: number; min: number; max: number; tolerance: 0.2 }
  | { kind: 'banned_phrase'; pattern: string; reason: string; excerpt: string }
  | { kind: 'banned_vocabulary'; word: string; reason: string };

export interface ValidationResult {
  ok: boolean;
  violations: Violation[];
  chars: number;
}

/**
 * Count body chars: strip markdown markers (**, #, backticks, list bullets)
 * + strip whitespace; count what's left.
 */
export function countChars(text: string): number {
  let s = text;
  // Strip code fences (``` blocks) entirely
  s = s.replace(/```[\s\S]*?```/g, '');
  // Strip inline backticks but keep their content
  s = s.replace(/`([^`]*)`/g, '$1');
  // Strip bold / italic markers
  s = s.replace(/\*+/g, '');
  s = s.replace(/_+/g, '');
  // Strip heading hashes at line start
  s = s.replace(/^#+\s*/gm, '');
  // Strip list bullets at line start
  s = s.replace(/^[\s]*[-*+]\s+/gm, '');
  s = s.replace(/^[\s]*\d+\.\s+/gm, '');
  // Strip blockquote markers
  s = s.replace(/^>\s*/gm, '');
  // Strip all whitespace (incl. newlines, full-width spaces)
  s = s.replace(/[\s\u3000]+/g, '');
  return s.length;
}

/**
 * Check total word count against override. Returns null if override missing
 * OR chars within tolerance band [floor(min*0.8), ceil(max*1.2)].
 */
export function checkWordCount(
  text: string,
  override: [number, number] | undefined,
): Extract<Violation, { kind: 'word_count' }> | null {
  if (!override) return null;
  const [min, max] = override;
  const lowerBound = Math.floor(min * 0.8);
  const upperBound = Math.ceil(max * 1.2);
  const chars = countChars(text);
  if (chars >= lowerBound && chars <= upperBound) return null;
  return {
    kind: 'word_count',
    chars,
    min,
    max,
    tolerance: 0.2,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @crossing/agents test bookend-validator`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/roles/bookend-validator.ts packages/agents/tests/bookend-validator.test.ts
git commit -m "$(cat <<'EOF'
feat(agents): bookend-validator countChars + checkWordCount with 20% tolerance

SP-B.3 Task 1. Pure functions, no I/O. Tolerance band is
[floor(min*0.8), ceil(max*1.2)] — closing [200, 350] → accept
(160, 420). Matches the "超出 20% 都可接受" decision in the spec.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Validator — findBannedPhrases + findBannedVocabulary

**Files:**
- Modify: `packages/agents/src/roles/bookend-validator.ts`
- Modify: `packages/agents/tests/bookend-validator.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/agents/tests/bookend-validator.test.ts`:

```ts
import { findBannedPhrases, findBannedVocabulary } from '../src/roles/bookend-validator.js';

describe('findBannedPhrases', () => {
  it('matches literal phrase', () => {
    const hits = findBannedPhrases('这句有正如所见的翻译腔', [
      { pattern: '正如所见', is_regex: false, reason: '翻译腔' },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      kind: 'banned_phrase',
      pattern: '正如所见',
      reason: '翻译腔',
    });
    expect(hits[0]!.excerpt).toContain('正如所见');
  });

  it('matches regex phrase', () => {
    const hits = findBannedPhrases('这不是工具而是伙伴', [
      { pattern: '不是.+?而是', is_regex: true, reason: '烂大街' },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.pattern).toBe('不是.+?而是');
  });

  it('returns empty when no hit', () => {
    expect(findBannedPhrases('一段干净的文字', [
      { pattern: '不是.+?而是', is_regex: true, reason: 'x' },
    ])).toHaveLength(0);
  });

  it('skips regex that fails to compile (no throw)', () => {
    const hits = findBannedPhrases('任意文字', [
      { pattern: '[unclosed', is_regex: true, reason: 'x' },
      { pattern: '文字', is_regex: false, reason: 'y' },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.pattern).toBe('文字');
  });

  it('returns multiple hits for multiple phrases', () => {
    const hits = findBannedPhrases('不是A而是B。另外还有正如所见。', [
      { pattern: '不是.+?而是', is_regex: true, reason: '1' },
      { pattern: '正如所见', is_regex: false, reason: '2' },
    ]);
    expect(hits).toHaveLength(2);
  });
});

describe('findBannedVocabulary', () => {
  it('matches word via includes', () => {
    const hits = findBannedVocabulary('笔者认为值得一试', [
      { word: '笔者', reason: '第三人称自称不自然' },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual({
      kind: 'banned_vocabulary',
      word: '笔者',
      reason: '第三人称自称不自然',
    });
  });

  it('returns empty when no hit', () => {
    expect(findBannedVocabulary('我认为', [
      { word: '笔者', reason: 'x' },
    ])).toHaveLength(0);
  });

  it('returns multiple hits for multiple words', () => {
    const hits = findBannedVocabulary('笔者和本人都这么想', [
      { word: '笔者', reason: '1' },
      { word: '本人', reason: '2' },
    ]);
    expect(hits).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @crossing/agents test bookend-validator`
Expected: FAIL with "findBannedPhrases is not a function".

- [ ] **Step 3: Implement**

Append to `packages/agents/src/roles/bookend-validator.ts`:

```ts
/** Snippet of surrounding text for a phrase hit — makes violation feedback useful */
function extractExcerpt(text: string, matchIndex: number, matchLen: number, ctx = 15): string {
  const start = Math.max(0, matchIndex - ctx);
  const end = Math.min(text.length, matchIndex + matchLen + ctx);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

export interface BannedPhraseRule {
  pattern: string;
  is_regex: boolean;
  reason: string;
}
export interface BannedVocabRule {
  word: string;
  reason: string;
}

export function findBannedPhrases(
  text: string,
  phrases: BannedPhraseRule[],
): Array<Extract<Violation, { kind: 'banned_phrase' }>> {
  const hits: Array<Extract<Violation, { kind: 'banned_phrase' }>> = [];
  for (const p of phrases) {
    if (p.is_regex) {
      let re: RegExp;
      try {
        re = new RegExp(p.pattern, 'u');
      } catch {
        continue;
      }
      const m = text.match(re);
      if (m && m.index !== undefined) {
        hits.push({
          kind: 'banned_phrase',
          pattern: p.pattern,
          reason: p.reason,
          excerpt: extractExcerpt(text, m.index, m[0].length),
        });
      }
    } else {
      const idx = text.indexOf(p.pattern);
      if (idx !== -1) {
        hits.push({
          kind: 'banned_phrase',
          pattern: p.pattern,
          reason: p.reason,
          excerpt: extractExcerpt(text, idx, p.pattern.length),
        });
      }
    }
  }
  return hits;
}

export function findBannedVocabulary(
  text: string,
  vocab: BannedVocabRule[],
): Array<Extract<Violation, { kind: 'banned_vocabulary' }>> {
  const hits: Array<Extract<Violation, { kind: 'banned_vocabulary' }>> = [];
  for (const v of vocab) {
    if (text.includes(v.word)) {
      hits.push({
        kind: 'banned_vocabulary',
        word: v.word,
        reason: v.reason,
      });
    }
  }
  return hits;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @crossing/agents test bookend-validator`
Expected: PASS — all tests (Task 1 + Task 2).

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/roles/bookend-validator.ts packages/agents/tests/bookend-validator.test.ts
git commit -m "$(cat <<'EOF'
feat(agents): bookend-validator findBannedPhrases + findBannedVocabulary

SP-B.3 Task 2. Regex failures silently skipped (don't throw).
Excerpt carries ±15 chars around the hit for feedback quality.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Validator — validateBookend integration

**Files:**
- Modify: `packages/agents/src/roles/bookend-validator.ts`
- Modify: `packages/agents/tests/bookend-validator.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/agents/tests/bookend-validator.test.ts`:

```ts
import { validateBookend } from '../src/roles/bookend-validator.js';
import type { WritingHardRules } from '../src/roles/writer-shared.js';

const CLEAN_RULES: WritingHardRules = {
  version: 1,
  updated_at: '2026-04-17T00:00:00Z',
  banned_phrases: [
    { pattern: '不是.+?而是', is_regex: true, reason: '烂大街' },
  ],
  banned_vocabulary: [{ word: '笔者', reason: 'x' }],
  layout_rules: [],
  word_count_overrides: { opening: [200, 400], closing: [200, 350] },
};

describe('validateBookend', () => {
  it('passes when all rules met', () => {
    const text = '字'.repeat(300);
    const r = validateBookend({
      finalText: text,
      role: 'closing',
      hardRules: CLEAN_RULES,
      wordOverride: [200, 350],
    });
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
    expect(r.chars).toBe(300);
  });

  it('collects multiple violations', () => {
    const text = `${'字'.repeat(500)}不是A而是B笔者`;
    const r = validateBookend({
      finalText: text,
      role: 'closing',
      hardRules: CLEAN_RULES,
      wordOverride: [200, 350],
    });
    expect(r.ok).toBe(false);
    const kinds = r.violations.map((v) => v.kind).sort();
    expect(kinds).toEqual([
      'banned_phrase',
      'banned_vocabulary',
      'word_count',
    ]);
  });

  it('word_count skipped when override missing — other checks still run', () => {
    const text = '字'.repeat(5) + '不是A而是B';
    const r = validateBookend({
      finalText: text,
      role: 'closing',
      hardRules: CLEAN_RULES,
      wordOverride: undefined,
    });
    expect(r.ok).toBe(false);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]!.kind).toBe('banned_phrase');
  });

  it('empty rules → all pass', () => {
    const emptyRules: WritingHardRules = {
      version: 1,
      updated_at: '',
      banned_phrases: [],
      banned_vocabulary: [],
      layout_rules: [],
    };
    const r = validateBookend({
      finalText: '任意文字',
      role: 'opening',
      hardRules: emptyRules,
      wordOverride: undefined,
    });
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it('undercount violation', () => {
    // range [200, 400], lowerBound = floor(200*0.8) = 160
    const text = '字'.repeat(100);
    const r = validateBookend({
      finalText: text,
      role: 'opening',
      hardRules: CLEAN_RULES,
      wordOverride: [200, 400],
    });
    expect(r.ok).toBe(false);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]!.kind).toBe('word_count');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @crossing/agents test bookend-validator`
Expected: FAIL with "validateBookend is not a function".

- [ ] **Step 3: Implement**

Append to `packages/agents/src/roles/bookend-validator.ts`:

```ts
import type { WritingHardRules } from './writer-shared.js';

export interface ValidateBookendOpts {
  finalText: string;
  role: 'opening' | 'closing';
  hardRules: WritingHardRules;
  wordOverride?: [number, number];
}

export function validateBookend(opts: ValidateBookendOpts): ValidationResult {
  const violations: Violation[] = [];
  const chars = countChars(opts.finalText);

  const wordViolation = checkWordCount(opts.finalText, opts.wordOverride);
  if (wordViolation) violations.push(wordViolation);

  for (const v of findBannedPhrases(opts.finalText, opts.hardRules.banned_phrases)) {
    violations.push(v);
  }
  for (const v of findBannedVocabulary(opts.finalText, opts.hardRules.banned_vocabulary)) {
    violations.push(v);
  }

  return {
    ok: violations.length === 0,
    violations,
    chars,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @crossing/agents test bookend-validator`
Expected: PASS — all tests.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/roles/bookend-validator.ts packages/agents/tests/bookend-validator.test.ts
git commit -m "$(cat <<'EOF'
feat(agents): bookend-validator validateBookend composition

SP-B.3 Task 3. Collects word / phrase / vocab violations. ok=false
iff any. Missing wordOverride → skip word-count check but still run
phrase + vocab scans.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Validator — formatViolations helper

**Files:**
- Modify: `packages/agents/src/roles/bookend-validator.ts`
- Modify: `packages/agents/tests/bookend-validator.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/agents/tests/bookend-validator.test.ts`:

```ts
import { formatViolations } from '../src/roles/bookend-validator.js';

describe('formatViolations', () => {
  it('formats word_count violation with bounds', () => {
    const out = formatViolations([
      { kind: 'word_count', chars: 500, min: 200, max: 350, tolerance: 0.2 },
    ]);
    expect(out).toContain('[word_count]');
    expect(out).toContain('500');
    expect(out).toContain('200');
    expect(out).toContain('350');
    expect(out).toContain('420'); // ceil(350 * 1.2)
  });

  it('formats banned_phrase with pattern + excerpt', () => {
    const out = formatViolations([
      {
        kind: 'banned_phrase',
        pattern: '不是.+?而是',
        reason: '烂大街',
        excerpt: '上下文 不是A而是B 上下文',
      },
    ]);
    expect(out).toContain('[banned_phrase]');
    expect(out).toContain('不是.+?而是');
    expect(out).toContain('不是A而是B');
  });

  it('formats banned_vocabulary with word', () => {
    const out = formatViolations([
      { kind: 'banned_vocabulary', word: '笔者', reason: '第三人称' },
    ]);
    expect(out).toContain('[banned_vocabulary]');
    expect(out).toContain('笔者');
  });

  it('numbers multiple violations starting at 1', () => {
    const out = formatViolations([
      { kind: 'word_count', chars: 500, min: 200, max: 350, tolerance: 0.2 },
      { kind: 'banned_vocabulary', word: '笔者', reason: 'x' },
    ]);
    expect(out).toMatch(/^1\. /m);
    expect(out).toMatch(/^2\. /m);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @crossing/agents test bookend-validator`
Expected: FAIL with "formatViolations is not a function".

- [ ] **Step 3: Implement**

Append to `packages/agents/src/roles/bookend-validator.ts`:

```ts
/** Format violations into a numbered markdown list for feedback to the agent */
export function formatViolations(violations: Violation[]): string {
  return violations
    .map((v, i) => `${i + 1}. ${formatOne(v)}`)
    .join('\n');
}

function formatOne(v: Violation): string {
  switch (v.kind) {
    case 'word_count': {
      const upper = Math.ceil(v.max * (1 + v.tolerance));
      const lower = Math.floor(v.min * (1 - v.tolerance));
      return `[word_count] 全文 ${v.chars} 字，超出允许区间 [${lower}, ${upper}] 字（基准 [${v.min}, ${v.max}] ± ${v.tolerance * 100}%）。调整到 [${v.min}, ${v.max}] 之内。`;
    }
    case 'banned_phrase':
      return `[banned_phrase] 命中模式「${v.pattern}」（${v.reason}）。片段：「${v.excerpt}」。换一种写法。`;
    case 'banned_vocabulary':
      return `[banned_vocabulary] 出现禁用词「${v.word}」（${v.reason}）。去掉或替换。`;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @crossing/agents test bookend-validator`
Expected: PASS — all tests.

- [ ] **Step 5: Commit**

```bash
git add packages/agents/src/roles/bookend-validator.ts packages/agents/tests/bookend-validator.test.ts
git commit -m "$(cat <<'EOF'
feat(agents): bookend-validator formatViolations — retry feedback text

SP-B.3 Task 4. Produces numbered markdown list ready to embed in
renderBookendPrompt's retryFeedback block.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: renderBookendPrompt — retryFeedback block

**Files:**
- Modify: `packages/agents/src/roles/writer-shared.ts`
- Modify: `packages/agents/src/prompts/writer-bookend.md`
- Modify: `packages/agents/tests/writer-shared.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/agents/tests/writer-shared.test.ts` inside the `describe('renderBookendPrompt', ...)` block:

```ts
  it('no retry block when retryFeedback undefined', () => {
    const out = renderBookendPrompt({
      role: 'opening',
      account: 'acc',
      articleType: '实测',
      typeSection: `### 字数范围\n150-260 字\n\n### 目标\nfoo\n`,
      panelFrontmatter: PANEL_FM,
      hardRulesBlock: '',
      projectContextBlock: '',
    });
    expect(out).not.toContain('上一次产出');
  });

  it('renders retry block with previous text + violation list', () => {
    const out = renderBookendPrompt({
      role: 'closing',
      account: 'acc',
      articleType: '实测',
      typeSection: `### 字数范围\n150-260 字\n\n### 目标\nfoo\n`,
      panelFrontmatter: PANEL_FM,
      hardRulesBlock: '',
      projectContextBlock: '',
      retryFeedback: {
        previousText: '这是上一次的正文',
        violationsText: '1. [word_count] 超了\n2. [banned_vocabulary] 笔者',
      },
    });
    expect(out).toContain('上一次产出 - 不合规，需要重写');
    expect(out).toContain('这是上一次的正文');
    expect(out).toContain('1. [word_count] 超了');
    expect(out).toContain('2. [banned_vocabulary] 笔者');
    expect(out).toContain('按这些修，其他不变');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @crossing/agents test writer-shared`
Expected: FAIL — `retryFeedback` not accepted by type; test assertions miss.

- [ ] **Step 3: Update prompt template**

In `packages/agents/src/prompts/writer-bookend.md`, find this line:

```
现在开始写。只输出**最终段落正文**，markdown 格式，不要前言 / 解释 / 代码围栏。
```

Replace with:

```
{{retryFeedbackBlock}}

现在开始写。只输出**最终段落正文**，markdown 格式，不要前言 / 解释 / 代码围栏。
```

- [ ] **Step 4: Update RenderBookendPromptOpts and render logic**

In `packages/agents/src/roles/writer-shared.ts`, modify `RenderBookendPromptOpts`:

```ts
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
  wordOverride?: [number, number];
  /** SP-B.3: when set, prepend a "上一次产出 - 不合规" block to the prompt.
   *  violationsText is produced by formatViolations(). */
  retryFeedback?: {
    previousText: string;
    violationsText: string;
  };
}
```

Inside `renderBookendPrompt`, before the `replacements` object declaration, add:

```ts
  const retryFeedbackBlock = opts.retryFeedback
    ? `## 上一次产出 - 不合规，需要重写\n\n上一次你产出的正文（供参考，不是让你微调）：\n\n\`\`\`\n${opts.retryFeedback.previousText}\n\`\`\`\n\n违规清单（按这些修，其他不变）：\n\n${opts.retryFeedback.violationsText}\n\n修完按交付前自查清单再扫一遍。`
    : '';
```

Then in the `replacements` object, add this key (put it next to `'{{projectContextBlock}}'`):

```ts
    '{{retryFeedbackBlock}}': retryFeedbackBlock,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @crossing/agents test writer-shared`
Expected: PASS — all tests.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/roles/writer-shared.ts packages/agents/src/prompts/writer-bookend.md packages/agents/tests/writer-shared.test.ts
git commit -m "$(cat <<'EOF'
feat(agents): renderBookendPrompt retryFeedback block

SP-B.3 Task 5. When opts.retryFeedback is set, prepend a block with
previous text + violation list to the bookend prompt. Template gains
{{retryFeedbackBlock}} placeholder.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: runWriterBookend passthrough + exports

**Files:**
- Modify: `packages/agents/src/roles/writer-bookend-agent.ts`
- Modify: `packages/agents/src/index.ts`

- [ ] **Step 1: Write failing test**

Append to `packages/agents/tests/writer-bookend-agent.test.ts` (create describe block if not present):

```ts
describe('runWriterBookend retryFeedback', () => {
  it('plumbs retryFeedback into the system prompt', async () => {
    let capturedSystem = '';
    const fakeInvoke = async (messages: ChatMessage[]) => {
      capturedSystem = messages.find((m) => m.role === 'system')?.content ?? '';
      return { text: '段落正文', meta: { cli: 'claude', durationMs: 1 } };
    };
    await runWriterBookend({
      role: 'opening',
      sectionKey: 'opening',
      account: 'acc',
      articleType: '实测',
      typeSection: `### 字数范围\n150-260 字\n\n### 目标\nfoo\n`,
      panelFrontmatter: {
        word_count_ranges: { opening: [150, 260], article: [3500, 8000] },
        pronoun_policy: { we_ratio: 0.4, you_ratio: 0.3, avoid: [] },
        tone: { primary: '客观克制', humor_frequency: 'low', opinionated: 'mid' },
        bold_policy: { frequency: '每段 0-2 处', what_to_bold: [], dont_bold: [] },
        transition_phrases: [],
        data_citation: { required: false, format_style: '', min_per_article: 0 },
      },
      hardRulesBlock: '',
      projectContextBlock: '',
      retryFeedback: {
        previousText: '上一次',
        violationsText: '1. [word_count] 超',
      },
      invokeAgent: fakeInvoke,
      userMessage: '',
      dispatchTool: async () => ({ status: 'ok', text: '' } as any),
    });
    expect(capturedSystem).toContain('上一次产出 - 不合规');
    expect(capturedSystem).toContain('上一次');
    expect(capturedSystem).toContain('1. [word_count] 超');
  });
});
```

(Add `ChatMessage` to the existing imports if missing.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @crossing/agents test writer-bookend-agent`
Expected: FAIL — `retryFeedback` is not in `RunWriterBookendOpts`.

- [ ] **Step 3: Add retryFeedback to RunWriterBookendOpts**

In `packages/agents/src/roles/writer-bookend-agent.ts`, modify `RunWriterBookendOpts` — add this next to `wordOverride`:

```ts
  /** SP-B.3: when set, this is a retry run. runWriterBookend passes the block
   *  through to renderBookendPrompt which injects "上一次产出 - 不合规". */
  retryFeedback?: {
    previousText: string;
    violationsText: string;
  };
```

Then in the body of `runWriterBookend`, extend the `renderBookendPrompt` call:

```ts
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
    wordOverride: opts.wordOverride,
    retryFeedback: opts.retryFeedback,
  });
```

- [ ] **Step 4: Export validator from @crossing/agents**

In `packages/agents/src/index.ts`, append after the existing `writer-shared` re-export block:

```ts
export {
  countChars,
  checkWordCount,
  findBannedPhrases,
  findBannedVocabulary,
  validateBookend,
  formatViolations,
} from "./roles/bookend-validator.js";
export type {
  Violation,
  ValidationResult,
  ValidateBookendOpts,
  BannedPhraseRule,
  BannedVocabRule,
} from "./roles/bookend-validator.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @crossing/agents test`
Expected: PASS — all tests in agents package (bookend-validator + writer-shared + writer-bookend-agent).

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/roles/writer-bookend-agent.ts packages/agents/src/index.ts packages/agents/tests/writer-bookend-agent.test.ts
git commit -m "$(cat <<'EOF'
feat(agents): runWriterBookend retryFeedback + export validator API

SP-B.3 Task 6. RunWriterBookendOpts gains retryFeedback; threaded into
renderBookendPrompt. @crossing/agents exports validator functions +
Violation/ValidationResult types.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Orchestrator — runBookendWithValidation wrapper

**Files:**
- Modify: `packages/web-server/src/services/writer-orchestrator.ts`
- Create: `packages/web-server/tests/writer-orchestrator-validation.test.ts`

- [ ] **Step 1: Write failing integration test**

Write to `packages/web-server/tests/writer-orchestrator-validation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runBookendWithValidation } from '../src/services/writer-orchestrator.js';
import type { WritingHardRules } from '@crossing/agents';

const RULES: WritingHardRules = {
  version: 1,
  updated_at: '',
  banned_phrases: [
    { pattern: '不是.+?而是', is_regex: true, reason: '烂大街' },
  ],
  banned_vocabulary: [{ word: '笔者', reason: 'x' }],
  layout_rules: [],
  word_count_overrides: { closing: [200, 350] },
};

function goodText(): string { return '字'.repeat(300); }
function badText(): string { return '字'.repeat(500) + '不是A而是B'; }

type Ev = { type: string; [k: string]: unknown };
type FakeRun = {
  finalText: string;
  toolsUsed: [];
  lastMeta: { cli: 'claude'; durationMs: number };
};
function fakeResult(text: string): FakeRun {
  return { finalText: text, toolsUsed: [], lastMeta: { cli: 'claude', durationMs: 1 } };
}

describe('runBookendWithValidation', () => {
  it('first pass valid → validation_passed attempt=1, single run call', async () => {
    const events: Ev[] = [];
    let runCalls = 0;
    const out = await runBookendWithValidation({
      role: 'closing',
      sectionKey: 'closing',
      publishEvent: async (type, data) => { events.push({ type, ...data }); },
      runBookend: async (_retry) => { runCalls++; return fakeResult(goodText()) as any; },
      hardRules: RULES,
      wordOverride: [200, 350],
    });
    expect(runCalls).toBe(1);
    expect(out.finalText).toBe(goodText());
    expect(events.map((e) => e.type)).toEqual(['writer.validation_passed']);
    expect(events[0]).toMatchObject({ attempt: 1, chars: 300 });
  });

  it('first bad → retry → second good: validation_retry then validation_passed attempt=2', async () => {
    const events: Ev[] = [];
    const textsSeenByRun: Array<unknown> = [];
    let runCalls = 0;
    const out = await runBookendWithValidation({
      role: 'closing',
      sectionKey: 'closing',
      publishEvent: async (type, data) => { events.push({ type, ...data }); },
      runBookend: async (retry) => {
        runCalls++;
        textsSeenByRun.push(retry);
        return fakeResult(runCalls === 1 ? badText() : goodText()) as any;
      },
      hardRules: RULES,
      wordOverride: [200, 350],
    });
    expect(runCalls).toBe(2);
    expect(out.finalText).toBe(goodText());
    expect(events.map((e) => e.type)).toEqual([
      'writer.validation_retry',
      'writer.validation_passed',
    ]);
    expect(events[1]).toMatchObject({ attempt: 2 });
    // retry arg passed to second runBookend call
    expect(textsSeenByRun[0]).toBeUndefined();
    expect(textsSeenByRun[1]).toMatchObject({
      previousText: badText(),
      violationsText: expect.stringContaining('[word_count]'),
    });
  });

  it('both bad → validation_failed, second result persists', async () => {
    const events: Ev[] = [];
    let runCalls = 0;
    const out = await runBookendWithValidation({
      role: 'closing',
      sectionKey: 'closing',
      publishEvent: async (type, data) => { events.push({ type, ...data }); },
      runBookend: async () => { runCalls++; return fakeResult(badText()) as any; },
      hardRules: RULES,
      wordOverride: [200, 350],
    });
    expect(runCalls).toBe(2);
    expect(out.finalText).toBe(badText());
    expect(events.map((e) => e.type)).toEqual([
      'writer.validation_retry',
      'writer.validation_failed',
    ]);
  });

  it('null hardRules → skip validation entirely', async () => {
    const events: Ev[] = [];
    let runCalls = 0;
    const out = await runBookendWithValidation({
      role: 'closing',
      sectionKey: 'closing',
      publishEvent: async (type, data) => { events.push({ type, ...data }); },
      runBookend: async () => { runCalls++; return fakeResult(badText()) as any; },
      hardRules: null,
      wordOverride: undefined,
    });
    expect(runCalls).toBe(1);
    expect(out.finalText).toBe(badText());
    expect(events).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @crossing/web-server test writer-orchestrator-validation`
Expected: FAIL — `runBookendWithValidation` not exported.

- [ ] **Step 3: Implement wrapper in writer-orchestrator.ts**

Open `packages/web-server/src/services/writer-orchestrator.ts`. Add import at the top — extend the existing `@crossing/agents` import:

```ts
import {
  runWriterBookend, runWriterPractice, runStyleCritic,
  PracticeStitcherAgent,
  invokeAgent,
  validateBookend,
  formatViolations,
  type ReferenceAccountKb,
  type ChatMessage,
  type WriterToolEvent,
  type WriterRunResult,
  type ToolUsage,
  type WritingHardRules,
} from "@crossing/agents";
```

(If `WritingHardRules` was already imported from `./hard-rules-store.js`, keep it from there — just add `validateBookend` and `formatViolations`.)

Then, above `export async function runWriter`, add:

```ts
/**
 * SP-B.3 wrapper around a single bookend call.
 * - Runs runBookend() once.
 * - If hardRules is null → skip validation, return first result unchanged.
 * - Else: validate. If ok → publish validation_passed, return.
 * - If not ok → publish validation_retry, runBookend(retry). Validate again.
 *   Publish validation_passed (if now ok) or validation_failed.
 * - In both paths, the last result is always returned (no throw).
 */
export async function runBookendWithValidation(params: {
  role: 'opening' | 'closing';
  sectionKey: string;
  publishEvent: (type: string, data: Record<string, unknown>) => Promise<void>;
  runBookend: (
    retry?: { previousText: string; violationsText: string },
  ) => Promise<WriterRunResult>;
  hardRules: WritingHardRules | null;
  wordOverride: [number, number] | undefined;
}): Promise<WriterRunResult> {
  const first = await params.runBookend(undefined);
  if (!params.hardRules) return first;

  const v1 = validateBookend({
    finalText: first.finalText,
    role: params.role,
    hardRules: params.hardRules,
    wordOverride: params.wordOverride,
  });

  if (v1.ok) {
    await params.publishEvent('writer.validation_passed', {
      section_key: params.sectionKey, attempt: 1, chars: v1.chars,
    });
    return first;
  }

  await params.publishEvent('writer.validation_retry', {
    section_key: params.sectionKey,
    violations: v1.violations,
  });

  const second = await params.runBookend({
    previousText: first.finalText,
    violationsText: formatViolations(v1.violations),
  });

  const v2 = validateBookend({
    finalText: second.finalText,
    role: params.role,
    hardRules: params.hardRules,
    wordOverride: params.wordOverride,
  });

  if (v2.ok) {
    await params.publishEvent('writer.validation_passed', {
      section_key: params.sectionKey, attempt: 2, chars: v2.chars,
    });
  } else {
    await params.publishEvent('writer.validation_failed', {
      section_key: params.sectionKey,
      violations: v2.violations,
    });
  }

  return second;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @crossing/web-server test writer-orchestrator-validation`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/web-server/src/services/writer-orchestrator.ts packages/web-server/tests/writer-orchestrator-validation.test.ts
git commit -m "$(cat <<'EOF'
feat(web-server): runBookendWithValidation wrapper

SP-B.3 Task 7. Runs bookend → validate → optional retry once → emit
validation_passed / validation_retry / validation_failed events. Always
returns the last attempt (no throw); retry feedback is the formatted
violations string.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Wire opening + closing to use wrapper

**Files:**
- Modify: `packages/web-server/src/services/writer-orchestrator.ts:408-461` (opening call site)
- Modify: `packages/web-server/src/services/writer-orchestrator.ts:613-666` (closing call site)

- [ ] **Step 1: Refactor opening call site**

In `runWriter`, locate the opening block (currently awaits `runWriterBookend(...)` directly and writes section). Replace the inner `const result = await runWriterBookend({...})` line + payload with:

```ts
        const result: WriterRunResult = await runBookendWithValidation({
          role: 'opening',
          sectionKey: 'opening',
          publishEvent: publish,
          hardRules: hardRules,
          wordOverride: openingWordOverride,
          runBookend: (retry) => runWriterBookend({
            role: 'opening',
            sectionKey: 'opening',
            account: openingStyle?.panel.frontmatter.account ?? '',
            articleType: project.article_type! as any,
            typeSection: openingStyle?.typeSection ?? '',
            panelFrontmatter: (openingStyle?.panel.frontmatter ?? {}) as any,
            hardRulesBlock: openingStyle?.hardRulesBlock ?? '',
            projectContextBlock: ctxBundle ? renderContextBlock(ctxBundle) : '',
            wordOverride: openingWordOverride,
            retryFeedback: retry,
            product_name: project.product_info?.name ?? undefined,
            invokeAgent: invokerFor("writer.opening", openingResolved.cli, openingResolved.model, writerRunLogDir),
            userMessage: buildOpeningUserMessage(briefSummary, missionSummary, productOverview, refs),
            images: projectImages,
            addDirs: projectAddDirs,
            ...(openingStyle ? { pinnedContext: formatStyleReference(openingStyle) } : {}),
            dispatchTool,
            onEvent: toolEventBridge("opening"),
            maxRounds: 5,
          }),
        });
```

- [ ] **Step 2: Refactor closing call site**

Apply the same shape to the closing block:

```ts
      const result: WriterRunResult = await runBookendWithValidation({
        role: 'closing',
        sectionKey: 'closing',
        publishEvent: publish,
        hardRules: hardRules,
        wordOverride: closingWordOverride,
        runBookend: (retry) => runWriterBookend({
          role: 'closing',
          sectionKey: 'closing',
          account: closingStyle?.panel.frontmatter.account ?? '',
          articleType: project.article_type! as any,
          typeSection: closingStyle?.typeSection ?? '',
          panelFrontmatter: (closingStyle?.panel.frontmatter ?? {}) as any,
          hardRulesBlock: closingStyle?.hardRulesBlock ?? '',
          projectContextBlock: ctxBundle ? renderContextBlock(ctxBundle) : '',
          wordOverride: closingWordOverride,
          retryFeedback: retry,
          product_name: project.product_info?.name ?? undefined,
          invokeAgent: invokerFor("writer.closing", closingResolved.cli, closingResolved.model, writerRunLogDir),
          userMessage: buildClosingUserMessage(openingBody, stitchedPractice, refs),
          images: projectImages,
          addDirs: projectAddDirs,
          ...(closingStyle ? { pinnedContext: formatStyleReference(closingStyle) } : {}),
          dispatchTool,
          onEvent: toolEventBridge("closing"),
          maxRounds: 5,
        }),
      });
```

- [ ] **Step 3: Run full test suite for web-server**

Run: `pnpm --filter @crossing/web-server test`
Expected: PASS — no regressions in existing writer tests.

- [ ] **Step 4: Typecheck the workspace**

Run: `pnpm -r typecheck` (or `pnpm -r tsc --noEmit`)
Expected: PASS — no new errors.

- [ ] **Step 5: Commit**

```bash
git add packages/web-server/src/services/writer-orchestrator.ts
git commit -m "$(cat <<'EOF'
feat(web-server): writer opening + closing call sites use runBookendWithValidation

SP-B.3 Task 8. Wraps each bookend call with the validation → retry
helper. runBookend is a closure capturing the rest of RunWriterBookendOpts
so the retry path re-runs with the same context + retryFeedback injected.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Trae project acceptance + validation log

**Files:**
- Run: `pnpm dev` (starts web-server + web-ui)
- Modify: `docs/superpowers/specs/2026-04-17-sp-b3-post-write-validator-design.md` (append validation log)

- [ ] **Step 1: Start services**

```bash
pnpm dev
```

Wait until `[web-server] Server listening on http://localhost:3001` and UI on port 5173.

- [ ] **Step 2: Run writer on trae project**

Open the trae project in the UI. Trigger **Writer** stage run (either fresh or rewrite opening / closing). Wait for completion.

- [ ] **Step 3: Verify event log contains validation events**

Locate the project's event log directory:

```bash
ls ~/.claude-writer-vault/07_projects/trae/events/ | tail -1
```

Grep for validation events in the latest event file:

```bash
grep -E 'validation_(passed|retry|failed)' \
  ~/.claude-writer-vault/07_projects/trae/events/*.jsonl | tail -20
```

Expected: at least one `validation_passed` (attempt=1) for opening and closing on a clean run. If either fails to pass on first try, expect `validation_retry` → `validation_passed` (attempt=2) or `validation_failed`.

- [ ] **Step 4: Verify run log directory has retry sub-dirs when retry happened**

```bash
ls ~/.claude-writer-vault/07_projects/trae/runs/ | tail -10
```

For a clean run: one `*-writer.opening` and one `*-writer.closing`. For a retry: two of the same name (timestamps differ).

- [ ] **Step 5: Verify final section content**

```bash
cat ~/.claude-writer-vault/07_projects/trae/article/opening.md | tail -20
cat ~/.claude-writer-vault/07_projects/trae/article/closing.md | tail -20
```

Confirm: no `不是X而是Y`, no `笔者`/`本人`, no em-dashes; total char count (stripped of markdown) within override tolerance band.

- [ ] **Step 6: Append validation log to spec**

Append to `docs/superpowers/specs/2026-04-17-sp-b3-post-write-validator-design.md`:

```markdown

---

## Validation log

- **2026-04-17**: Trae project writer run passed B.3 acceptance.
  - Opening: validation_passed on attempt=1 (chars=<N1> ∈ [160, 480]) ✓
  - Closing: validation_passed on attempt=<1 or 2> (chars=<N2> ∈ [160, 420]) ✓
  - runLogDir has expected number of writer.opening / writer.closing sub-dirs ✓
  - Final opening/closing texts zero banned phrases / vocabulary ✓

Replace `<N1>` and `<N2>` with the actual chars count observed.
If retry happened, replace `<1 or 2>` with `2` and keep the line.
```

Fill in the `<N1>` / `<N2>` / retry attempt number from observed values. Don't leave placeholders.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-04-17-sp-b3-post-write-validator-design.md
git commit -m "$(cat <<'EOF'
docs(sp-b3): validation log — trae project writer run passed B.3 acceptance

SP-B.3 Task 9. Real run produced expected event sequence and final
texts stayed within tolerance + zero banned hits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Summary

9 tasks, each ends with a commit. Roughly:

- Tasks 1-4: pure validator functions (`bookend-validator.ts`) — 4 small commits, all TDD
- Task 5: prompt template + render accept `retryFeedback`
- Task 6: `runWriterBookend` passthrough + `@crossing/agents` exports
- Task 7: orchestrator wrapper `runBookendWithValidation` + unit tests (mocked invoker)
- Task 8: wire opening + closing call sites
- Task 9: real run on trae + append validation log to spec
