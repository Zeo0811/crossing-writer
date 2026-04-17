# SP-B.2 硬约束强化 + 字数 override + Writer 归档 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 bookend writer 的 prompt 层注入"字数 override + 单段/总体双约束 + 交付前自查清单"，同时给 writer 加 runLogDir 归档。

**Architecture:** `writing-hard-rules.yaml` 新增可选 `word_count_overrides` 字段（per-role，优先级高于 panel）。`writer-shared.ts` 新增 `parseWordCountRange` + `resolveWordConstraint` 两个纯函数：把 panel `### 字数范围` 里 "10 – 110 字(单段)" 解析为 min/max/perPara，再和 override 合流成"单段 + 总体"双约束。Prompt 模板拆成 `{{panel.word_count_per_para}}` + `{{panel.word_count_total}}`，尾部加 6 条自查清单。UI 硬规则页加第 4 个 block 支持 2 个 number input 编辑 override。Writer orchestrator 调用 bookend 时传入 hardRules.word_count_overrides + runLogDir（每次调用产出 prompt/response/meta/trace 4 个归档文件）。

**Tech Stack:** TypeScript + pnpm workspace，vitest，js-yaml。

**Spec:** `docs/superpowers/specs/2026-04-17-sp-b2-hard-constraint-injection-design.md`

---

## File Structure

### 修改

```
packages/agents/src/roles/writer-shared.ts        # 扩类型 + 2 个新函数 + renderBookendPrompt 改
packages/agents/src/roles/writer-bookend-agent.ts # RunWriterBookendOpts 新增 2 字段，透传
packages/agents/src/prompts/writer-bookend.md     # 双字数占位 + 自查清单
packages/agents/tests/writer-shared.test.ts       # 扩 12 个新 case

packages/web-server/src/services/hard-rules-store.ts              # 扩类型 + seed default
packages/web-server/src/services/writer-orchestrator.ts           # 传 override + runLogDir
packages/web-server/tests/hard-rules-store.test.ts                # 新 case：round-trip + seed
packages/web-server/tests/config-writing-hard-rules-routes.test.ts  # 新 case：PUT 含 word_count_overrides

packages/web-ui/src/api/writing-hard-rules-client.ts              # 类型扩
packages/web-ui/src/pages/WritingHardRulesPage.tsx                # 加第 4 个 RulesSection
packages/web-ui/src/components/writing-hard-rules/RuleEditModal.tsx  # 加 word_count kind 分支
```

### 删除

无。

---

## Task 1: writer-shared 类型扩充 + parseWordCountRange

**Files:**
- Modify: `packages/agents/src/roles/writer-shared.ts`
- Modify: `packages/agents/tests/writer-shared.test.ts`

Working dir: `/Users/zeoooo/crossing-writer`, branch `feat/sp-a-style-distill-v2`.

- [ ] **Step 1: Add word_count_overrides to WritingHardRules type**

Open `packages/agents/src/roles/writer-shared.ts`. Find the `WritingHardRules` interface (top of types section, around line 16). Add a new optional field at the end:

```ts
export interface WritingHardRules {
  version: 1;
  updated_at: string;
  banned_phrases: Array<{ pattern: string; is_regex: boolean; reason: string; example?: string }>;
  banned_vocabulary: Array<{ word: string; reason: string }>;
  layout_rules: string[];
  /** Optional per-role total word-count override. When set, takes precedence
   *  over panel's `### 字数范围` subsection text. Tuple is [min, max]. */
  word_count_overrides?: {
    opening?: [number, number];
    closing?: [number, number];
    article?: [number, number];
  };
}
```

- [ ] **Step 2: Write failing test for parseWordCountRange**

Append to `packages/agents/tests/writer-shared.test.ts`:

```ts
import { parseWordCountRange } from '../src/roles/writer-shared.js';

describe('parseWordCountRange', () => {
  it('parses half-width dash, per-paragraph suffix', () => {
    expect(parseWordCountRange('10 - 110 字(单段)')).toEqual({ min: 10, max: 110, perPara: true });
  });

  it('parses full-width em dash, per-paragraph suffix', () => {
    expect(parseWordCountRange('10 – 110 字(单段)')).toEqual({ min: 10, max: 110, perPara: true });
  });

  it('parses hyphen-minus, no suffix', () => {
    expect(parseWordCountRange('150-260 字')).toEqual({ min: 150, max: 260, perPara: false });
  });

  it('parses "X 字以内" as [0, X]', () => {
    expect(parseWordCountRange('200 字以内')).toEqual({ min: 0, max: 200, perPara: false });
  });

  it('returns null on garbage', () => {
    expect(parseWordCountRange('纯粹的文字')).toBeNull();
  });

  it('returns null on empty string', () => {
    expect(parseWordCountRange('')).toBeNull();
  });

  it('handles full-width spaces around dash', () => {
    expect(parseWordCountRange('150 – 260 字')).toEqual({ min: 150, max: 260, perPara: false });
  });

  it('detects full-width parens 单段', () => {
    expect(parseWordCountRange('10 – 110 字（单段）')).toEqual({ min: 10, max: 110, perPara: true });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/agents test writer-shared
```

Expected: FAIL — `parseWordCountRange is not exported`.

- [ ] **Step 4: Implement parseWordCountRange**

In `packages/agents/src/roles/writer-shared.ts`, add the function after `extractSubsection` (around line 66):

```ts
/**
 * Parse a 字数范围 text like "10 – 110 字(单段)" or "150-260 字".
 * Supports: hyphen-minus / em dash / en dash as range separator,
 *          full- or half-width parens on "单段" suffix,
 *          "X 字以内" form (min defaults to 0).
 * Returns null for unparseable inputs.
 */
export function parseWordCountRange(
  text: string,
): { min: number; max: number; perPara: boolean } | null {
  if (!text) return null;
  const perPara = /[（(]单段[）)]/.test(text);
  // Range form: "min <dash> max 字"
  const rangeRe = /(\d+)\s*[-–—]\s*(\d+)\s*字/u;
  const m = text.match(rangeRe);
  if (m) {
    const min = Number.parseInt(m[1]!, 10);
    const max = Number.parseInt(m[2]!, 10);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return { min, max, perPara };
    }
  }
  // "X 字以内" form
  const capRe = /(\d+)\s*字\s*以内/u;
  const m2 = text.match(capRe);
  if (m2) {
    const max = Number.parseInt(m2[1]!, 10);
    if (Number.isFinite(max)) {
      return { min: 0, max, perPara };
    }
  }
  return null;
}
```

- [ ] **Step 5: Run test, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/agents test writer-shared
```

Expected: all tests green (previous 13 + 8 new = 21 tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add \
  packages/agents/src/roles/writer-shared.ts \
  packages/agents/tests/writer-shared.test.ts
git commit -m "feat(agents): parseWordCountRange + WritingHardRules.word_count_overrides type"
```

---

## Task 2: resolveWordConstraint

**Files:**
- Modify: `packages/agents/src/roles/writer-shared.ts`
- Modify: `packages/agents/tests/writer-shared.test.ts`

- [ ] **Step 1: Write failing test**

Append to `packages/agents/tests/writer-shared.test.ts`:

```ts
import { resolveWordConstraint } from '../src/roles/writer-shared.js';

describe('resolveWordConstraint', () => {
  it('override takes precedence over panel per-para', () => {
    const out = resolveWordConstraint(
      'opening',
      '10 – 110 字(单段)',
      [200, 400],
    );
    expect(out.totalText).toContain('200');
    expect(out.totalText).toContain('400');
    expect(out.totalMax).toBe(400);
    // perParaText still shows panel guidance so the writer knows the unit
    expect(out.perParaText).toContain('10');
    expect(out.perParaText).toContain('110');
  });

  it('panel per-para without override: computes total via default paragraph count', () => {
    const out = resolveWordConstraint(
      'opening',
      '10 – 110 字(单段)',
      undefined,
    );
    // opening default paragraph count = 5
    expect(out.totalMax).toBe(550);
    expect(out.totalText).toContain('50');
    expect(out.totalText).toContain('550');
    expect(out.perParaText).toContain('10');
    expect(out.perParaText).toContain('110');
  });

  it('closing default paragraph count = 7', () => {
    const out = resolveWordConstraint(
      'closing',
      '10 – 110 字(单段)',
      undefined,
    );
    expect(out.totalMax).toBe(770);
  });

  it('panel total-range (no 单段) without override passes through as total', () => {
    const out = resolveWordConstraint(
      'opening',
      '150-260 字',
      undefined,
    );
    expect(out.totalMax).toBe(260);
    expect(out.totalText).toContain('150');
    expect(out.perParaText).toBe('—');
  });

  it('empty panel + override: uses override only', () => {
    const out = resolveWordConstraint('closing', '', [200, 350]);
    expect(out.totalMax).toBe(350);
    expect(out.totalText).toContain('200');
    expect(out.totalText).toContain('350');
    expect(out.perParaText).toBe('—');
  });

  it('empty panel + no override: returns safe defaults', () => {
    const out = resolveWordConstraint('closing', '', undefined);
    expect(out.totalMax).toBeGreaterThan(0);
    expect(out.totalText.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test (expect FAIL)**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/agents test writer-shared
```

Expected: FAIL — `resolveWordConstraint is not exported`.

- [ ] **Step 3: Implement resolveWordConstraint**

In `packages/agents/src/roles/writer-shared.ts`, add after `parseWordCountRange`:

```ts
export interface WordConstraint {
  perParaText: string;  // e.g. "每段 10 – 110 字" or "—"
  totalText: string;    // e.g. "200 – 400 字" or "50 – 550 字（单段×默认段数推算）"
  totalMax: number;
}

/** Default paragraph count per role — used to extrapolate total bound when
 *  panel only gives per-paragraph range and no override is provided. */
const DEFAULT_PARA_COUNT = { opening: 5, closing: 7 } as const;

/** Absolute safe default when neither panel nor override is set. */
const ABSOLUTE_DEFAULT_TOTAL: Record<'opening' | 'closing', [number, number]> = {
  opening: [150, 400],
  closing: [150, 350],
};

export function resolveWordConstraint(
  role: 'opening' | 'closing',
  panelSubsText: string,
  override?: [number, number],
): WordConstraint {
  const parsed = parseWordCountRange(panelSubsText);
  const perParaText = parsed?.perPara
    ? `每段 ${parsed.min} – ${parsed.max} 字`
    : '—';

  if (override) {
    const [min, max] = override;
    return {
      perParaText,
      totalText: `${min} – ${max} 字（硬规则指定）`,
      totalMax: max,
    };
  }

  if (parsed && parsed.perPara) {
    const n = DEFAULT_PARA_COUNT[role];
    return {
      perParaText,
      totalText: `${parsed.min * n} – ${parsed.max * n} 字（单段 × ${n} 段推算）`,
      totalMax: parsed.max * n,
    };
  }

  if (parsed && !parsed.perPara) {
    return {
      perParaText: '—',
      totalText: `${parsed.min} – ${parsed.max} 字`,
      totalMax: parsed.max,
    };
  }

  const [min, max] = ABSOLUTE_DEFAULT_TOTAL[role];
  return {
    perParaText: '—',
    totalText: `${min} – ${max} 字（默认兜底，建议在硬规则里覆盖）`,
    totalMax: max,
  };
}
```

- [ ] **Step 4: Run test, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/agents test writer-shared
```

Expected: all green (previous 21 + 6 new = 27 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add \
  packages/agents/src/roles/writer-shared.ts \
  packages/agents/tests/writer-shared.test.ts
git commit -m "feat(agents): resolveWordConstraint merges panel 字数范围 + override + fallback"
```

---

## Task 3: renderBookendPrompt uses double word-count placeholders + self-review checklist

**Files:**
- Modify: `packages/agents/src/roles/writer-shared.ts`
- Modify: `packages/agents/src/prompts/writer-bookend.md`
- Modify: `packages/agents/tests/writer-shared.test.ts`

- [ ] **Step 1: Update writer-bookend.md template**

Open `packages/agents/src/prompts/writer-bookend.md`. Find both `- 字数硬约束：**{{panel.word_count}}**` occurrences (line ~10 for opening, line ~30 for closing). Replace each with:

```markdown
- 字数硬约束:
  - 单段: **{{panel.word_count_per_para}}**
  - 总体: **{{panel.word_count_total}}**
  超或不足都要重写。
```

Then find the line `现在开始写。只输出**最终段落正文**...` near the end of the file. BEFORE that line, insert:

```markdown
## 交付前自查清单（违反任一项立即重写，不要输出违规版）

1. **总字数** ≤ {{panel.word_count_total_max}} 字；单段字数满足 {{panel.word_count_per_para}}
2. **禁用句式**：扫描全文，不得命中"硬规则"block 里列出的任何一条句式
3. **禁用词汇**：扫描全文，不得命中"硬规则"block 里列出的任何一条词汇
4. **段落节奏**：每段 ≤ 80 字，段与段之间必须空行
5. **粗体**：产品名 / 人名首次出现必须加粗；整段不加粗；遵循 panel.bold_policy
6. **衔接句**：若使用衔接句，优先从 panel.transition_phrases 里挑，不自造

若任一项不通过，**在内部修订后再自查**，直到全部通过才输出。**不要输出自查过程**，只输出最终段落正文。

---

```

The trailing `---` + blank line sit above the existing `现在开始写` so there's a visual break.

- [ ] **Step 2: Write failing test for new placeholder wiring**

Append to `packages/agents/tests/writer-shared.test.ts` inside the existing `describe('renderBookendPrompt', ...)` block:

```ts
  it('applies wordOverride: prompt shows override total and hides panel extrapolation', () => {
    const out = renderBookendPrompt({
      role: 'opening',
      account: 'acc',
      articleType: '实测',
      typeSection: `### 字数范围\n10 – 110 字(单段)\n\n### 目标\nfoo\n`,
      panelFrontmatter: PANEL_FM,
      hardRulesBlock: '',
      projectContextBlock: '',
      wordOverride: [200, 400],
    });
    expect(out).toContain('200');
    expect(out).toContain('400');
    expect(out).toContain('硬规则指定');
    expect(out).toContain('每段 10 – 110 字');
    expect(out).not.toMatch(/\{\{[^}]+\}\}/);
  });

  it('falls back to panel extrapolation when no override', () => {
    const out = renderBookendPrompt({
      role: 'opening',
      account: 'acc',
      articleType: '实测',
      typeSection: `### 字数范围\n10 – 110 字(单段)\n\n### 目标\nfoo\n`,
      panelFrontmatter: PANEL_FM,
      hardRulesBlock: '',
      projectContextBlock: '',
    });
    // 5 paragraphs × 110 max = 550
    expect(out).toContain('550');
    expect(out).toContain('单段 × 5 段推算');
  });

  it('includes self-review checklist with 6 items', () => {
    const out = renderBookendPrompt({
      role: 'opening',
      account: 'acc',
      articleType: '实测',
      typeSection: `### 字数范围\n150-260 字\n\n### 目标\nfoo\n`,
      panelFrontmatter: PANEL_FM,
      hardRulesBlock: '',
      projectContextBlock: '',
    });
    expect(out).toContain('交付前自查清单');
    expect(out).toContain('1. **总字数**');
    expect(out).toContain('6. **衔接句**');
    expect(out).toContain('不要输出自查过程');
  });
```

Also remove or update the existing test `'renders opening prompt with role-specific section'` that expects `toContain('150 – 260 字')` to also expect the total-range phrasing. Simplest: change that one assertion to:

```ts
expect(out).toContain('150');  // The original '150 – 260 字' value still appears in the resolved totalText
expect(out).toContain('260');
```

(Keep the rest of that test unchanged.)

- [ ] **Step 3: Run test, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/agents test writer-shared
```

Expected: FAIL because renderBookendPrompt doesn't handle wordOverride / word_count_per_para / word_count_total_max yet.

- [ ] **Step 4: Update RenderBookendPromptOpts interface**

In `packages/agents/src/roles/writer-shared.ts`, find `RenderBookendPromptOpts`. Add field:

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
  /** Override [min, max] total word count. If provided, takes precedence
   *  over panel 字数范围 text; see resolveWordConstraint. */
  wordOverride?: [number, number];
}
```

- [ ] **Step 5: Update renderBookendPrompt body**

In `renderBookendPrompt`, REPLACE the old `wordRange` computation:

```ts
// OLD (delete):
const wordRange = subs.字数范围 ? subs.字数范围 : ...;
```

With a call to `resolveWordConstraint`:

```ts
const wordConstraint = resolveWordConstraint(
  opts.role,
  subs.字数范围,
  opts.wordOverride,
);
```

Then in the `replacements` object, REMOVE the old `{{panel.word_count}}` entry (if still present) and ADD three new entries:

```ts
const replacements: Record<string, string> = {
  // ... existing entries (keep all others) ...
  '{{panel.word_count_per_para}}': wordConstraint.perParaText,
  '{{panel.word_count_total}}': wordConstraint.totalText,
  '{{panel.word_count_total_max}}': String(wordConstraint.totalMax),
  // ... rest of existing entries ...
};
```

- [ ] **Step 6: Run test, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/agents test writer-shared
```

Expected: all green (previous 27 + 3 new = 30 tests).

- [ ] **Step 7: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add \
  packages/agents/src/roles/writer-shared.ts \
  packages/agents/src/prompts/writer-bookend.md \
  packages/agents/tests/writer-shared.test.ts
git commit -m "feat(agents): bookend prompt uses per-para + total word constraints + self-review checklist"
```

---

## Task 4: writer-bookend-agent accepts wordOverride and runLogDir

**Files:**
- Modify: `packages/agents/src/roles/writer-bookend-agent.ts`
- Modify: `packages/agents/tests/writer-bookend-agent.test.ts`

- [ ] **Step 1: Extend RunWriterBookendOpts**

In `packages/agents/src/roles/writer-bookend-agent.ts`, find `RunWriterBookendOpts`. Add:

```ts
export interface RunWriterBookendOpts {
  // ... existing fields ...
  wordOverride?: [number, number];
  /** When set, writes prompt/response/meta/trace artifacts to
   *  <runLogDir>/<ts>-writer.<role>/ for offline inspection. */
  runLogDir?: string;
}
```

- [ ] **Step 2: Pass wordOverride to renderBookendPrompt**

In `runWriterBookend`, find the `renderBookendPrompt({ ... })` call. Add `wordOverride: opts.wordOverride` as the last field:

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
});
```

- [ ] **Step 3: Thread runLogDir into the invoke call**

Find the block that calls `runWriterWithTools`. Note that the tool runner's `opts.agent.invoke` is used per-round. The `runLogDir` is a concern of `invokeAgent` (the raw model-adapter call), not the tool runner.

The tool runner calls `opts.agent.invoke(messages, { images, addDirs })`. But we need runLogDir to land in the underlying `invokeAgent`.

Look at how `opts.invokeAgent` is constructed in the orchestrator (we don't modify that yet — Task 6). For now, the agent has no clean hook for runLogDir because `opts.invokeAgent` is already bound by the caller.

Given this constraint, **scope the agent-side change to type-only**: expose `runLogDir?: string` on the opts so the caller (Task 6) knows it's the canonical name, but don't try to plumb it through the tool runner. Document this in the interface comment.

Actually wait — the proper wiring is: the CALLER of runWriterBookend (writer-orchestrator) builds its `invokeAgent` closure with `runLogDir` baked in. The agent doesn't need to see `runLogDir` at all. So we remove `runLogDir` from `RunWriterBookendOpts` and document that the orchestrator should bake it into its `invokeAgent` closure.

Drop the `runLogDir?: string` field from `RunWriterBookendOpts`. The agent opts change is only `wordOverride?: [number, number]`.

Update the JSDoc on RunWriterBookendOpts to mention: "Callers wanting artifact archival should bake runLogDir into the invokeAgent closure (see writer-orchestrator)."

- [ ] **Step 4: Write failing test for wordOverride pass-through**

Append to `packages/agents/tests/writer-bookend-agent.test.ts`:

```ts
  it('passes wordOverride through to renderBookendPrompt', async () => {
    const invokeAgent = vi.fn(async () => ({
      text: '段落正文。',
      meta: { cli: 'claude', model: 'opus', durationMs: 10 },
    }));
    const dispatchTool = vi.fn();
    await runWriterBookend({
      role: 'opening',
      sectionKey: 'opening',
      account: 'acc',
      articleType: '实测',
      typeSection: `### 字数范围\n10 – 110 字(单段)\n\n### 目标\nx\n`,
      panelFrontmatter: PANEL_FM,
      hardRulesBlock: '',
      projectContextBlock: '',
      userMessage: 'x',
      wordOverride: [200, 400],
      invokeAgent,
      dispatchTool: dispatchTool as any,
    });
    const systemMsg = (invokeAgent.mock.calls[0]![0] as any[]).find((m: any) => m.role === 'system');
    expect(systemMsg.content).toContain('200');
    expect(systemMsg.content).toContain('400');
    expect(systemMsg.content).toContain('硬规则指定');
  });
```

- [ ] **Step 5: Run test, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/agents test writer-bookend-agent
```

Expected: all green (previous 3 + 1 new = 4 tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add \
  packages/agents/src/roles/writer-bookend-agent.ts \
  packages/agents/tests/writer-bookend-agent.test.ts
git commit -m "feat(agents): RunWriterBookendOpts.wordOverride — threads into renderBookendPrompt"
```

---

## Task 5: hard-rules-store WritingHardRules type + default seed + PUT validation

**Files:**
- Modify: `packages/web-server/src/services/hard-rules-store.ts`
- Modify: `packages/web-server/tests/hard-rules-store.test.ts`
- Modify: `packages/web-server/src/routes/config-writing-hard-rules.ts` (PUT validator allow new field)
- Modify: `packages/web-server/tests/config-writing-hard-rules-routes.test.ts`

- [ ] **Step 1: Extend WritingHardRules + DEFAULT_RULES in hard-rules-store**

In `packages/web-server/src/services/hard-rules-store.ts`, extend the interface:

```ts
export interface WritingHardRules {
  version: 1;
  updated_at: string;
  banned_phrases: HardRulePhrase[];
  banned_vocabulary: HardRuleVocabulary[];
  layout_rules: string[];
  word_count_overrides?: {
    opening?: [number, number];
    closing?: [number, number];
    article?: [number, number];
  };
}
```

Find `DEFAULT_RULES` and add the seed:

```ts
const DEFAULT_RULES: WritingHardRules = {
  version: 1,
  updated_at: new Date('2026-04-16').toISOString(),
  banned_phrases: [ /* existing */ ],
  banned_vocabulary: [ /* existing */ ],
  layout_rules: [ /* existing */ ],
  word_count_overrides: {
    opening: [200, 400],
    closing: [200, 350],
    article: [3500, 8000],
  },
};
```

- [ ] **Step 2: Write failing test for seed + round-trip**

Append to `packages/web-server/tests/hard-rules-store.test.ts`:

```ts
  it('seed includes default word_count_overrides', async () => {
    const rules = await store.read();
    expect(rules.word_count_overrides).toBeDefined();
    expect(rules.word_count_overrides?.opening).toEqual([200, 400]);
    expect(rules.word_count_overrides?.closing).toEqual([200, 350]);
    expect(rules.word_count_overrides?.article).toEqual([3500, 8000]);
  });

  it('round-trips a custom word_count_overrides', async () => {
    await store.write({
      version: 1,
      updated_at: '2026-04-17T00:00:00Z',
      banned_phrases: [],
      banned_vocabulary: [],
      layout_rules: [],
      word_count_overrides: {
        opening: [180, 380],
      },
    });
    const rules = await store.read();
    expect(rules.word_count_overrides?.opening).toEqual([180, 380]);
    expect(rules.word_count_overrides?.closing).toBeUndefined();
  });
```

- [ ] **Step 3: Run test, expect PASS (both types and store support new field)**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-server test hard-rules-store
```

Expected: all green (previous 4 + 2 new = 6 tests).

- [ ] **Step 4: Allow word_count_overrides in PUT validation**

In `packages/web-server/src/routes/config-writing-hard-rules.ts`, find the PUT handler's validation block. The existing validation is:

```ts
if (!body || body.version !== 1) { ... }
if (!Array.isArray(body.banned_phrases) || !Array.isArray(body.banned_vocabulary) || !Array.isArray(body.layout_rules)) { ... }
```

Add after that (no further validation required — word_count_overrides is optional and its inner fields are also optional):

```ts
if (body.word_count_overrides !== undefined) {
  const o = body.word_count_overrides;
  if (typeof o !== 'object' || o === null || Array.isArray(o)) {
    return reply.code(400).send({ error: 'word_count_overrides must be an object' });
  }
  for (const key of ['opening', 'closing', 'article'] as const) {
    const v = o[key];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      return reply.code(400).send({ error: `word_count_overrides.${key} must be [min, max] numbers` });
    }
  }
}
```

- [ ] **Step 5: Write test for PUT validation**

Append to `packages/web-server/tests/config-writing-hard-rules-routes.test.ts`:

```ts
  it('PUT accepts word_count_overrides', async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/writing-hard-rules',
      payload: {
        version: 1,
        banned_phrases: [],
        banned_vocabulary: [],
        layout_rules: [],
        word_count_overrides: {
          opening: [180, 380],
          closing: [160, 300],
        },
      },
    });
    expect(res.statusCode).toBe(200);
    const get = await app.inject({ method: 'GET', url: '/api/config/writing-hard-rules' });
    expect(get.json().word_count_overrides.opening).toEqual([180, 380]);
  });

  it('PUT 400 on malformed word_count_overrides', async () => {
    const { app } = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/config/writing-hard-rules',
      payload: {
        version: 1,
        banned_phrases: [],
        banned_vocabulary: [],
        layout_rules: [],
        word_count_overrides: { opening: [180, 'bad'] },
      },
    });
    expect(res.statusCode).toBe(400);
  });
```

- [ ] **Step 6: Run route tests, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-server test config-writing-hard-rules-routes
```

Expected: previous 4 + 2 new = 6 green.

- [ ] **Step 7: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add \
  packages/web-server/src/services/hard-rules-store.ts \
  packages/web-server/tests/hard-rules-store.test.ts \
  packages/web-server/src/routes/config-writing-hard-rules.ts \
  packages/web-server/tests/config-writing-hard-rules-routes.test.ts
git commit -m "feat(web-server): word_count_overrides in HardRulesStore + PUT validator"
```

---

## Task 6: writer-orchestrator threads override + runLogDir to bookend

**Files:**
- Modify: `packages/web-server/src/services/writer-orchestrator.ts`

- [ ] **Step 1: Inspect current bookend call sites**

```bash
grep -n "runWriterBookend" /Users/zeoooo/crossing-writer/packages/web-server/src/services/writer-orchestrator.ts
```

Expected: 2 call sites — one for opening, one for closing.

- [ ] **Step 2: Import hard-rules access + update each call**

If `hardRulesStore` is available via `opts.hardRulesStore` or similar (check RunWriterOpts interface), make it accessible. If not, the style-resolver already reads it (SP-A T15). Since writer-orchestrator doesn't hold the store directly, the simplest path is:

- Load hardRules once per run via `opts.hardRulesStore.read()` near the top of `runWriter`, alongside where `resolvedStyles` is computed.
- Store the override in a local variable per role, and pass into bookend call.

Top of runWriter, after project check:

```ts
const hardRules = opts.hardRulesStore ? await opts.hardRulesStore.read() : null;
const openingOverride = hardRules?.word_count_overrides?.opening;
const closingOverride = hardRules?.word_count_overrides?.closing;
```

If `opts.hardRulesStore` doesn't exist on `RunWriterOpts`, add it:

```ts
export interface RunWriterOpts {
  // ... existing
  hardRulesStore?: HardRulesStore;
}
```

And update the server.ts `registerWriterRoutes` call to pass it (if not already — check existing wiring).

For `runLogDir`, build a path per-section:

```ts
const runLogDir = join(opts.projectsDir, opts.projectId, 'runs');
```

Each `invokeAgent` call inside the bookend's `invokerFor` factory already accepts `runLogDir` — pass it through.

- [ ] **Step 3: Update the invokerFor factory (if needed)**

Check `invokerFor` signature. It returns a function that wraps `invokeAgent`. Ensure the returned function passes `runLogDir` through:

```ts
function invokerFor(agentKey: WriterAgentKey, cli: 'claude' | 'codex', model?: string, runLogDir?: string) {
  return async (messages: ChatMessage[], opts?: { images?: string[]; addDirs?: string[] }) => {
    // existing message assembly
    const result = await invokeAgent({
      agentKey,
      cli,
      model,
      systemPrompt,
      userMessage,
      images: opts?.images,
      addDirs: opts?.addDirs,
      runLogDir,   // new: propagate
    });
    return { text: result.text, meta: { cli: result.meta.cli, model: result.meta.model, durationMs: result.meta.durationMs } };
  };
}
```

Update both bookend call sites to construct an invoker with runLogDir:

Opening:

```ts
const runLogDir = join(opts.projectsDir, opts.projectId, 'runs');
const result: WriterRunResult = await runWriterBookend({
  role: 'opening',
  sectionKey: 'opening',
  // ... existing fields ...
  wordOverride: openingOverride,
  invokeAgent: invokerFor('writer.opening', openingResolved.cli, openingResolved.model, runLogDir),
  // ... rest ...
});
```

Closing: same pattern with `role: 'closing'` and `wordOverride: closingOverride`.

- [ ] **Step 4: Type-check**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-server exec tsc --noEmit 2>&1 | grep -E "writer-orchestrator\.ts" | head -10
```

Expected: 0 errors on writer-orchestrator.ts.

- [ ] **Step 5: Run existing writer-orchestrator tests**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-server test writer-orchestrator 2>&1 | tail -15
```

Expected: existing tests still pass. Some tests mock `runWriterBookend` — verify they don't break because of the new `wordOverride` parameter being undefined (should be fine since optional).

- [ ] **Step 6: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/web-server/src/services/writer-orchestrator.ts
git commit -m "feat(web-server): writer-orchestrator passes word_count_overrides + runLogDir to bookend"
```

---

## Task 7: UI — WritingHardRules page adds word_count_overrides block

**Files:**
- Modify: `packages/web-ui/src/api/writing-hard-rules-client.ts`
- Modify: `packages/web-ui/src/pages/WritingHardRulesPage.tsx`
- Modify: `packages/web-ui/src/components/writing-hard-rules/RuleEditModal.tsx`

- [ ] **Step 1: Extend client types**

In `packages/web-ui/src/api/writing-hard-rules-client.ts`, extend `WritingHardRules`:

```ts
export interface WritingHardRules {
  version: 1;
  updated_at: string;
  banned_phrases: HardRulePhrase[];
  banned_vocabulary: HardRuleVocabulary[];
  layout_rules: string[];
  word_count_overrides?: {
    opening?: [number, number];
    closing?: [number, number];
    article?: [number, number];
  };
}
```

- [ ] **Step 2: RuleEditModal adds 'word_count' kind**

In `packages/web-ui/src/components/writing-hard-rules/RuleEditModal.tsx`, extend `RuleKind`:

```ts
export type RuleKind = 'phrase' | 'vocabulary' | 'layout' | 'word_count';
```

Add to `FIELDS`:

```ts
word_count: [
  { key: 'role', label: '段落角色（opening/closing/article）', required: true },
  { key: 'min', label: '最小字数', required: true, type: 'number' },
  { key: 'max', label: '最大字数', required: true, type: 'number' },
],
```

Extend the input rendering switch to handle `type === 'number'`:

```tsx
{f.type === 'bool' ? (
  <input type="checkbox" ... />
) : f.type === 'number' ? (
  <input
    type="number"
    value={state[f.key] ?? ''}
    onChange={(e) => setState({ ...state, [f.key]: e.target.value === '' ? '' : Number(e.target.value) })}
    className="w-full h-9 px-2 rounded border border-[var(--hair)] bg-[var(--bg-0)] text-sm"
  />
) : (
  <input type="text" ... />
)}
```

Update `defaultFor(kind)`:

```ts
if (kind === 'word_count') return { role: '', min: 0, max: 0 };
```

Update the `save()` logic so required validation works for number type (empty string should fail required check):

```ts
for (const f of fields) {
  const v = state[f.key];
  if (f.required && (v === '' || v === undefined || v === null)) {
    setError(`${f.label} 是必填`);
    return;
  }
}
```

- [ ] **Step 3: WritingHardRulesPage adds 4th RulesSection**

In `packages/web-ui/src/pages/WritingHardRulesPage.tsx`, after the existing 3 sections, add:

```tsx
<RulesSection
  title="字数范围（覆盖面板）"
  kind="word_count"
  rows={
    rules.word_count_overrides
      ? Object.entries(rules.word_count_overrides).map(([role, range]) => ({
          role,
          min: range?.[0] ?? 0,
          max: range?.[1] ?? 0,
        }))
      : []
  }
  columns={[
    { key: 'role', label: 'role' },
    { key: 'min', label: 'min' },
    { key: 'max', label: 'max' },
  ]}
  onAdd={(v) => {
    const current = rules.word_count_overrides ?? {};
    update({
      word_count_overrides: { ...current, [v.role]: [v.min, v.max] },
    });
  }}
  onEdit={(i, v) => {
    const current = rules.word_count_overrides ?? {};
    const oldKey = Object.keys(current)[i];
    if (!oldKey) return;
    const next = { ...current };
    delete next[oldKey as keyof typeof next];
    next[v.role as keyof typeof next] = [v.min, v.max];
    update({ word_count_overrides: next });
  }}
  onDelete={(i) => {
    const current = rules.word_count_overrides ?? {};
    const keys = Object.keys(current);
    const target = keys[i];
    if (!target) return;
    const next = { ...current };
    delete next[target as keyof typeof next];
    update({ word_count_overrides: Object.keys(next).length ? next : undefined });
  }}
/>
```

- [ ] **Step 4: Build to verify TS**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-ui build 2>&1 | tail -10
```

Expected: build succeeds (tsc passes, vite bundles without errors).

- [ ] **Step 5: Smoke test manually**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-ui dev
```

Open `http://localhost:5173/writing-hard-rules`. Verify:
- 4 sections now (banned phrases / banned vocabulary / layout rules / word count overrides)
- Seeded defaults show 3 rows in word_count_overrides
- Clicking "新增" on word count section opens modal with role/min/max inputs
- Edit / delete work
- Saving persists to yaml (re-open and see persisted values)

- [ ] **Step 6: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add \
  packages/web-ui/src/api/writing-hard-rules-client.ts \
  packages/web-ui/src/pages/WritingHardRulesPage.tsx \
  packages/web-ui/src/components/writing-hard-rules/RuleEditModal.tsx
git commit -m "feat(web-ui): word_count_overrides block on writing-hard-rules page"
```

---

## Task 8: End-to-end verification on trae

**Files:** runtime only, no code changes.

- [ ] **Step 1: Reset trae to evidence_ready**

```bash
python3 -c "
import json
p = '/Users/zeoooo/CrossingVault/07_projects/trae/project.json'
d = json.load(open(p))
d['status'] = 'evidence_ready'
d.pop('writer_config', None)
d.pop('writer_failed_sections', None)
json.dump(d, open(p,'w'), indent=2, ensure_ascii=False)
print('status=evidence_ready, article_type=', d.get('article_type'))
"
```

Expected: article_type is still '实测' (from SP-A T14).

- [ ] **Step 2: Rebuild and restart web-server**

```bash
cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/agents build
touch packages/web-server/src/server.ts
sleep 4
lsof -i :3001 -t
```

- [ ] **Step 3: Trigger writer**

```bash
curl -sS -X POST http://localhost:3001/api/projects/trae/writer/start \
  -H "Content-Type: application/json" -d '{}'
```

Expected: `{"ok":true}`.

- [ ] **Step 4: Monitor section events**

```bash
tail -f /Users/zeoooo/CrossingVault/07_projects/trae/events.jsonl \
  | grep --line-buffered -E "section_(started|completed|failed)|state_changed"
```

Let it run until state_changed to writing_ready. Ctrl-C when done.

- [ ] **Step 5: Verify opening / closing word counts inside override range**

```bash
wc -m /Users/zeoooo/CrossingVault/07_projects/trae/article/sections/opening.md
wc -m /Users/zeoooo/CrossingVault/07_projects/trae/article/sections/closing.md
```

Expected (approx — wc -m counts chars including frontmatter):
- opening char count ≈ 400 ± 200
- closing char count ≈ 350 ± 200

Subtract frontmatter (maybe 200 chars) for the actual body. Acceptance: opening body ∈ [200, 400], closing body ∈ [200, 350]. Hand-eyeball OK.

- [ ] **Step 6: Verify run artifacts exist**

```bash
ls /Users/zeoooo/CrossingVault/07_projects/trae/runs/ | head -20
```

Expected: directories like `2026-04-17T03-XX-XX-000Z-writer.opening` / `writer.closing`. Each directory has `prompt.txt`, `response.txt`, `meta.json`, `trace.ndjson`.

- [ ] **Step 7: Verify prompt contains self-review checklist**

```bash
OPENING_RUN=$(ls -t /Users/zeoooo/CrossingVault/07_projects/trae/runs/ | grep writer.opening | head -1)
grep -c "交付前自查清单" /Users/zeoooo/CrossingVault/07_projects/trae/runs/"$OPENING_RUN"/prompt.txt
```

Expected: at least 1 (the checklist appears in the prompt).

Also verify:

```bash
grep -c "总字数" /Users/zeoooo/CrossingVault/07_projects/trae/runs/"$OPENING_RUN"/prompt.txt
grep -c "禁用句式" /Users/zeoooo/CrossingVault/07_projects/trae/runs/"$OPENING_RUN"/prompt.txt
```

Both should return ≥ 1.

- [ ] **Step 8: Verify no banned phrase / vocab in output**

```bash
for f in /Users/zeoooo/CrossingVault/07_projects/trae/article/sections/opening.md /Users/zeoooo/CrossingVault/07_projects/trae/article/sections/closing.md; do
  echo "=== $f ==="
  # Check for dash
  grep -c '—\|–' "$f" || echo "0 dash hits"
  # Check for "不是X而是Y" style
  grep -cE "不是.{1,12}而是" "$f" || echo "0 不是...而是 hits"
  # Check for banned vocab
  grep -cE "炸裂|绝绝子|家人们|神器|yyds|震撼发布" "$f" || echo "0 banned vocab hits"
done
```

Expected: all counts are 0.

- [ ] **Step 9: Append validation log to spec doc and commit**

```bash
cat >> /Users/zeoooo/crossing-writer/docs/superpowers/specs/2026-04-17-sp-b2-hard-constraint-injection-design.md <<EOF

---

## Validation Log

- **$(date +%Y-%m-%d)**: Trae project writer run passed B.2 acceptance.
  - Opening body length within override [200, 400] ✓
  - Closing body length within override [200, 350] ✓
  - Run artifacts (prompt/response/meta/trace) persisted under runs/*-writer.{opening,closing} ✓
  - Prompt contains self-review checklist ('交付前自查清单') ✓
  - No banned phrases (无破折号 / 无"不是X而是Y") ✓
  - No banned vocabulary ✓
EOF

cd /Users/zeoooo/crossing-writer && git add docs/superpowers/specs/2026-04-17-sp-b2-hard-constraint-injection-design.md
git commit -m "docs(sp-b2): validation log — trae project writer run passed B.2 acceptance"
```

---

## Self-Review

### Spec coverage

| Spec requirement | Task |
|---|---|
| Add `word_count_overrides` to yaml schema + seed default | Task 5 |
| `parseWordCountRange` 函数 | Task 1 |
| `resolveWordConstraint` 函数 | Task 2 |
| Prompt 双字数占位（单段 + 总体） | Task 3 |
| 交付前自查清单 | Task 3 |
| Bookend agent transfers wordOverride | Task 4 |
| Writer orchestrator reads hardRules + passes to bookend | Task 6 |
| Writer runLogDir archival | Task 6 |
| UI hard-rules page adds 4th block | Task 7 |
| Round-trip tests on hard-rules-store | Task 5 |
| PUT validation for new field | Task 5 |
| Trae end-to-end verification | Task 8 |

### Placeholder scan

- No "TBD" / "TODO" / "similar to Task N" remains.
- All code blocks are complete snippets.

### Type consistency

- `WordConstraint` interface defined in Task 2, consumed by renderBookendPrompt in Task 3 — ✓
- `wordOverride?: [number, number]` on `RenderBookendPromptOpts` (Task 3), `RunWriterBookendOpts` (Task 4), and orchestrator call sites (Task 6) all use same shape — ✓
- `WritingHardRules.word_count_overrides?` optional nested with optional inner fields — same shape in agents/web-server/web-ui (Tasks 1/5/7) — ✓
- `runLogDir: string` only appears in invokerFor factory (Task 6) and is path-scalar — not in bookend opts — ✓

No gaps.

---

**Done. Plan ready for execution.**
