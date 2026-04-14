# SP-06 Style Distiller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 refs.sqlite 里按账号读大量文章，跑 4 步 pipeline（纯代码量化 + 3 个 LLM agent 提炼结构/片段/合成）→ 产出 v2 风格卡 `08_experts/style-panel/<account>_kb.md`，供 SP-05 Writer 做 few-shot。
**Architecture:** 3 个纯代码模块（quant-analyzer / sample-picker / snippet-aggregator）+ 3 个 LLM agent + orchestrator + CLI 子命令 + 后端 SSE 路由 + 前端列表+表单。中间产物落 `~/CrossingVault/.distill/<account>/`，最终 kb.md 覆盖写。
**Tech Stack:** TypeScript / Node `child_process` (spawnSync claude/codex) / better-sqlite3 / Fastify SSE / React / Vitest

**Spec:** `docs/superpowers/specs/2026-04-14-sp06-style-distiller-design.md`

**Branch:** `sp06` (branched fresh from main after SP-05 merged)

---

## Pre-flight

```bash
cd /Users/zeoooo/crossing-writer
git checkout main
git pull --ff-only
git checkout -b sp06
```

确认依赖：

```bash
cd /Users/zeoooo/crossing-writer && pnpm -F @crossing/kb ls better-sqlite3 commander
cd /Users/zeoooo/crossing-writer && pnpm -F @crossing/agents ls
cd /Users/zeoooo/crossing-writer && pnpm -F @crossing/web-server ls fastify
cd /Users/zeoooo/crossing-writer && pnpm -F @crossing/web-ui ls react
```

---

## File Structure

**New files (kb):**

```
packages/kb/src/style-distiller/
├── types.ts
├── quant-analyzer.ts
├── sample-picker.ts
├── snippet-aggregator.ts
└── orchestrator.ts

packages/kb/tests/style-distiller/
├── quant-analyzer.test.ts
├── sample-picker.test.ts
├── snippet-aggregator.test.ts
├── orchestrator.test.ts
└── orchestrator-errors.test.ts

packages/kb/tests/cli/
├── list-accounts.test.ts
└── distill-style.test.ts
```

**New files (agents):**

```
packages/agents/src/roles/
├── style-distiller-structure-agent.ts
├── style-distiller-snippets-agent.ts
└── style-distiller-composer-agent.ts

packages/agents/src/prompts/
├── style-distiller-structure.md
├── style-distiller-snippets.md
└── style-distiller-composer.md

packages/agents/tests/
├── style-distiller-structure-agent.test.ts
├── style-distiller-snippets-agent.test.ts
└── style-distiller-composer-agent.test.ts
```

**New files (web-server):**

```
packages/web-server/src/routes/kb-accounts.ts
packages/web-server/tests/routes-kb-accounts.test.ts
packages/web-server/tests/routes-kb-style-panels-distill.test.ts
packages/web-server/tests/integration-sp06-e2e.test.ts
```

**New files (web-ui):**

```
packages/web-ui/src/pages/StylePanelsPage.tsx
packages/web-ui/src/api/style-panels-client.ts
packages/web-ui/src/components/style-panels/
├── StylePanelList.tsx
├── AccountCandidateList.tsx
├── DistillForm.tsx
└── ProgressView.tsx

packages/web-ui/tests/components/style-panels/
├── StylePanelList.test.tsx
├── AccountCandidateList.test.tsx
├── DistillForm.test.tsx
└── ProgressView.test.tsx

packages/web-ui/tests/api/style-panels-client.test.ts
```

**Modified:**

```
packages/kb/src/cli.ts                              — 新增 list-accounts / distill-style 子命令
packages/kb/src/index.ts                            — 导出 orchestrator + types
packages/agents/src/index.ts                        — 导出 3 个新 agent
packages/web-server/src/routes/kb-style-panels.ts   — 加 POST /:account/distill SSE
packages/web-server/src/server.ts                   — mount kb-accounts route
packages/web-server/src/services/config-store.ts    — 不改；只在 server.ts 初始化时把 3 个新 agent key 默认值写入
packages/web-ui/src/App.tsx                         — 加 /style-panels 路由
packages/web-ui/src/pages/ProjectList.tsx           — header 加"风格面板"入口
```

---

## 关键类型（贯穿全 plan，T1 定义）

```ts
// packages/kb/src/style-distiller/types.ts
export interface QuantResult {
  account: string;
  article_count: number;
  date_range: { start: string; end: string };
  word_count: { median: number; p10: number; p90: number };
  opening_words: { median: number; p10: number; p90: number };
  closing_words: { median: number; p10: number; p90: number };
  case_section_words: { median: number; p10: number; p90: number };
  paragraph_length_sentences: { median: number; p10: number; p90: number };
  bold_per_section: { median: number; p10: number; p90: number };
  emoji_density: Record<string, number>;
  image_to_text_ratio: number;
  pronoun_ratio: { we: number; you: number; none: number };
  top_transition_words: Array<{ word: string; count: number }>;
}

export interface ArticleSample {
  id: string;
  account: string;
  title: string;
  published_at: string;
  word_count: number;
  body_plain: string;
}

export interface SnippetCandidate {
  tag: string;
  from: string;
  excerpt: string;
  position_ratio: number;
  length: number;
}

export interface DistillStepEvent {
  step: "quant" | "structure" | "snippets" | "composer";
  phase: "started" | "completed" | "failed" | "batch_progress";
  account: string;
  duration_ms?: number;
  error?: string;
  stats?: Record<string, unknown>;
}

export type DistillStep = "quant" | "structure" | "snippets" | "composer";

export interface DistillOptions {
  account: string;
  sampleSize: number;
  since?: string;
  until?: string;
  onlyStep?: DistillStep;
  dryRun?: boolean;
  cliModelPerStep?: Partial<Record<"structure" | "snippets" | "composer", { cli: "claude" | "codex"; model?: string }>>;
  onEvent?: (ev: DistillStepEvent) => void;
}

export interface DistillResult {
  account: string;
  kb_path: string;
  sample_size_actual: number;
  steps_run: DistillStep[];
}
```

---

## Task Index

**M1 代码基础**
- Task 1: types.ts + quant-analyzer
- Task 2: sample-picker（分层采样 + 精读挑选）
- Task 3: snippet-aggregator（去重 + 排序）

**M2 3 个 Agent + prompts**
- Task 4: style-distiller-structure agent + prompt
- Task 5: style-distiller-snippets agent + prompt
- Task 6: style-distiller-composer agent + prompt

**M3 Orchestrator**
- Task 7: orchestrator 主流程（4 步串联 + SSE 回调 + dry-run + only-step）
- Task 8: orchestrator error path + step failure 保留中间产物

**M4 CLI**
- Task 9: list-accounts 子命令
- Task 10: distill-style 子命令 + flag 解析 + stdout 进度

**M5 后端路由**
- Task 11: GET /api/kb/accounts
- Task 12: POST /api/kb/style-panels/:account/distill (SSE)

**M6 前端**
- Task 13: style-panels-client（getAccounts / startDistill SSE）
- Task 14: StylePanelsPage + StylePanelList + AccountCandidateList
- Task 15: DistillForm + ProgressView（SSE 订阅）

**M7 集成**
- Task 16: integration e2e — mock 3 agent → 真跑 orchestrator → 验 kb.md + .distill/

---

### Task 1: types.ts + quant-analyzer

**Files:**
- Create: `packages/kb/src/style-distiller/types.ts`
- Create: `packages/kb/src/style-distiller/quant-analyzer.ts`
- Create: `packages/kb/tests/style-distiller/quant-analyzer.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/kb/tests/style-distiller/quant-analyzer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { analyzeQuant } from "../../src/style-distiller/quant-analyzer.js";
import type { ArticleSample } from "../../src/style-distiller/types.js";

function mk(id: string, body: string, published = "2025-06-01", wc?: number): ArticleSample {
  return {
    id,
    account: "test",
    title: id,
    published_at: published,
    word_count: wc ?? body.length,
    body_plain: body,
  };
}

describe("quant-analyzer", () => {
  it("computes basic word_count percentiles", () => {
    const samples = [
      mk("a", "x".repeat(1000), "2025-01-01", 1000),
      mk("b", "y".repeat(2000), "2025-02-01", 2000),
      mk("c", "z".repeat(3000), "2025-03-01", 3000),
      mk("d", "w".repeat(4000), "2025-04-01", 4000),
      mk("e", "v".repeat(5000), "2025-05-01", 5000),
    ];
    const q = analyzeQuant("test", samples);
    expect(q.article_count).toBe(5);
    expect(q.word_count.median).toBe(3000);
    expect(q.word_count.p10).toBeLessThanOrEqual(1500);
    expect(q.word_count.p90).toBeGreaterThanOrEqual(4500);
  });

  it("detects emojis and counts density per emoji", () => {
    const samples = [
      mk("a", "开头🚥数据\n正文🚥总结"),
      mk("b", "纯文"),
    ];
    const q = analyzeQuant("test", samples);
    expect(q.emoji_density["🚥"]).toBeCloseTo(1, 1);
  });

  it("computes pronoun ratio (we / you / none)", () => {
    const samples = [
      mk("a", "我们看到这个产品"),
      mk("b", "你会发现这个功能很棒"),
      mk("c", "这款产品值得关注"),
    ];
    const q = analyzeQuant("test", samples);
    expect(q.pronoun_ratio.we + q.pronoun_ratio.you + q.pronoun_ratio.none).toBeCloseTo(1, 2);
    expect(q.pronoun_ratio.we).toBeGreaterThan(0);
    expect(q.pronoun_ratio.you).toBeGreaterThan(0);
    expect(q.pronoun_ratio.none).toBeGreaterThan(0);
  });

  it("counts bold frequency per section (## headers)", () => {
    const body = [
      "## 第一节", "**加粗一**", "正文", "**加粗二**",
      "## 第二节", "正文无加粗",
    ].join("\n");
    const q = analyzeQuant("test", [mk("a", body)]);
    expect(q.bold_per_section.median).toBeGreaterThan(0);
    expect(q.bold_per_section.median).toBeLessThanOrEqual(2);
  });

  it("computes image_to_text_ratio (chars per image)", () => {
    const body = "正文".repeat(100) + "\n![](img1.png)\n" + "尾巴".repeat(50);
    const q = analyzeQuant("test", [mk("a", body)]);
    expect(q.image_to_text_ratio).toBeGreaterThan(100);
  });

  it("extracts top transition words", () => {
    const body = "首先这样。其次那样。然而这样。但是那样。其次又一次。";
    const q = analyzeQuant("test", [mk("a", body)]);
    const words = q.top_transition_words.map((t) => t.word);
    expect(words).toContain("其次");
  });

  it("returns date_range across samples", () => {
    const samples = [
      mk("a", "x", "2025-01-15"),
      mk("b", "y", "2026-02-20"),
    ];
    const q = analyzeQuant("test", samples);
    expect(q.date_range.start).toBe("2025-01-15");
    expect(q.date_range.end).toBe("2026-02-20");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/style-distiller/quant-analyzer.test.ts
```

- [ ] **Step 3: Implement**

Create `packages/kb/src/style-distiller/types.ts`:

```ts
export interface QuantResult {
  account: string;
  article_count: number;
  date_range: { start: string; end: string };
  word_count: { median: number; p10: number; p90: number };
  opening_words: { median: number; p10: number; p90: number };
  closing_words: { median: number; p10: number; p90: number };
  case_section_words: { median: number; p10: number; p90: number };
  paragraph_length_sentences: { median: number; p10: number; p90: number };
  bold_per_section: { median: number; p10: number; p90: number };
  emoji_density: Record<string, number>;
  image_to_text_ratio: number;
  pronoun_ratio: { we: number; you: number; none: number };
  top_transition_words: Array<{ word: string; count: number }>;
}

export interface ArticleSample {
  id: string;
  account: string;
  title: string;
  published_at: string;
  word_count: number;
  body_plain: string;
}

export interface SnippetCandidate {
  tag: string;
  from: string;
  excerpt: string;
  position_ratio: number;
  length: number;
}

export type DistillStep = "quant" | "structure" | "snippets" | "composer";

export interface DistillStepEvent {
  step: DistillStep;
  phase: "started" | "completed" | "failed" | "batch_progress";
  account: string;
  duration_ms?: number;
  error?: string;
  stats?: Record<string, unknown>;
}

export interface DistillOptions {
  account: string;
  sampleSize: number;
  since?: string;
  until?: string;
  onlyStep?: DistillStep;
  dryRun?: boolean;
  cliModelPerStep?: Partial<Record<"structure" | "snippets" | "composer", { cli: "claude" | "codex"; model?: string }>>;
  onEvent?: (ev: DistillStepEvent) => void;
}

export interface DistillResult {
  account: string;
  kb_path: string;
  sample_size_actual: number;
  steps_run: DistillStep[];
}
```

Create `packages/kb/src/style-distiller/quant-analyzer.ts`:

```ts
import type { ArticleSample, QuantResult } from "./types.js";

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
const TRANSITION_WORDS = ["首先", "其次", "然后", "最后", "但是", "然而", "不过", "所以", "因此", "另外", "此外", "值得一提的是", "有意思的是", "说回来", "不止如此", "同时", "与此同时", "回到"];
const WE_RE = /我们/g;
const YOU_RE = /你(?!好)/g;

function dist(values: number[]): { median: number; p10: number; p90: number } {
  if (values.length === 0) return { median: 0, p10: 0, p90: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))]!;
  return { median: pick(0.5), p10: pick(0.1), p90: pick(0.9) };
}

function splitSections(body: string): string[] {
  const parts = body.split(/^##\s+.+$/m);
  return parts.filter((p) => p.trim().length > 0);
}

function splitParagraphs(body: string): string[] {
  return body.split(/\n\n+/).filter((p) => p.trim().length > 0);
}

function countSentences(paragraph: string): number {
  const m = paragraph.match(/[。！？!?]/g);
  return Math.max(1, m ? m.length : 1);
}

export function analyzeQuant(account: string, samples: ArticleSample[]): QuantResult {
  if (samples.length === 0) {
    throw new Error("analyzeQuant: empty samples");
  }
  const wordCounts: number[] = [];
  const openingWords: number[] = [];
  const closingWords: number[] = [];
  const caseSectionWords: number[] = [];
  const paragraphLens: number[] = [];
  const boldPerSection: number[] = [];
  const emojiCounts: Record<string, number> = {};
  let totalChars = 0;
  let totalImages = 0;
  let weHits = 0;
  let youHits = 0;
  let articlesWithPronoun = 0;
  let articlesTotal = 0;
  const transitionCounts: Record<string, number> = {};
  let dateMin = samples[0]!.published_at;
  let dateMax = samples[0]!.published_at;

  for (const s of samples) {
    articlesTotal += 1;
    wordCounts.push(s.word_count);
    if (s.published_at < dateMin) dateMin = s.published_at;
    if (s.published_at > dateMax) dateMax = s.published_at;

    const paragraphs = splitParagraphs(s.body_plain);
    if (paragraphs.length > 0) {
      openingWords.push(paragraphs[0]!.length);
      closingWords.push(paragraphs[paragraphs.length - 1]!.length);
    }
    for (const p of paragraphs) paragraphLens.push(countSentences(p));

    const sections = splitSections(s.body_plain);
    for (const sec of sections) {
      caseSectionWords.push(sec.length);
      const bolds = sec.match(/\*\*[^*]+\*\*/g);
      boldPerSection.push(bolds ? bolds.length : 0);
    }

    const emojiMatches = s.body_plain.match(EMOJI_RE) ?? [];
    for (const e of emojiMatches) emojiCounts[e] = (emojiCounts[e] ?? 0) + 1;

    totalChars += s.body_plain.length;
    const imgs = s.body_plain.match(/!\[[^\]]*\]\([^)]*\)/g);
    totalImages += imgs ? imgs.length : 0;

    const we = (s.body_plain.match(WE_RE) ?? []).length;
    const you = (s.body_plain.match(YOU_RE) ?? []).length;
    weHits += we;
    youHits += you;
    if (we > 0 || you > 0) articlesWithPronoun += 1;

    for (const w of TRANSITION_WORDS) {
      const re = new RegExp(w, "g");
      const m = s.body_plain.match(re);
      if (m) transitionCounts[w] = (transitionCounts[w] ?? 0) + m.length;
    }
  }

  const emoji_density: Record<string, number> = {};
  for (const [k, v] of Object.entries(emojiCounts)) emoji_density[k] = v / samples.length;

  const totalPronounHits = weHits + youHits;
  const weRatio = totalPronounHits > 0 ? weHits / (totalPronounHits + (articlesTotal - articlesWithPronoun)) : 0;
  const youRatio = totalPronounHits > 0 ? youHits / (totalPronounHits + (articlesTotal - articlesWithPronoun)) : 0;
  const noneRatio = Math.max(0, 1 - weRatio - youRatio);

  const top_transition_words = Object.entries(transitionCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([word, count]) => ({ word, count }));

  return {
    account,
    article_count: samples.length,
    date_range: { start: dateMin, end: dateMax },
    word_count: dist(wordCounts),
    opening_words: dist(openingWords),
    closing_words: dist(closingWords),
    case_section_words: dist(caseSectionWords),
    paragraph_length_sentences: dist(paragraphLens),
    bold_per_section: dist(boldPerSection),
    emoji_density,
    image_to_text_ratio: totalImages > 0 ? totalChars / totalImages : 0,
    pronoun_ratio: { we: weRatio, you: youRatio, none: noneRatio },
    top_transition_words,
  };
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/style-distiller/quant-analyzer.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/kb/src/style-distiller/types.ts packages/kb/src/style-distiller/quant-analyzer.ts packages/kb/tests/style-distiller/quant-analyzer.test.ts && git -c commit.gpgsign=false commit -m "feat(kb): SP-06 style-distiller types + quant-analyzer"
```

---

### Task 2: sample-picker

**Files:**
- Create: `packages/kb/src/style-distiller/sample-picker.ts`
- Create: `packages/kb/tests/style-distiller/sample-picker.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/kb/tests/style-distiller/sample-picker.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { stratifiedSample, pickDeepRead } from "../../src/style-distiller/sample-picker.js";
import type { ArticleSample } from "../../src/style-distiller/types.js";

function mk(id: string, wc: number, published: string): ArticleSample {
  return { id, account: "x", title: id, published_at: published, word_count: wc, body_plain: "" };
}

describe("sample-picker stratifiedSample", () => {
  it("returns all when pool <= sampleSize", () => {
    const pool = [mk("a", 100, "2025-01-01"), mk("b", 200, "2025-02-01")];
    const out = stratifiedSample(pool, 10);
    expect(out).toHaveLength(2);
  });

  it("spreads across word_count quartiles x time buckets", () => {
    const pool: ArticleSample[] = [];
    for (let i = 0; i < 40; i += 1) {
      const q = Math.floor(i / 10); // 0..3 word-count quartile
      const m = (i % 12) + 1; // jitter months across quartiles
      const mm = String(m).padStart(2, "0");
      pool.push(mk(`a${i}`, (q + 1) * 1000, `2025-${mm}-01`));
    }
    const sampled = stratifiedSample(pool, 16);
    expect(sampled.length).toBe(16);
    const ids = new Set(sampled.map((s) => s.id));
    expect(ids.size).toBe(16);
    const buckets = new Set(sampled.map((s) => Math.floor((s.word_count - 1) / 1000)));
    expect(buckets.size).toBeGreaterThanOrEqual(3);
  });

  it("fills from next bucket when a bucket is short", () => {
    const pool: ArticleSample[] = [];
    for (let i = 0; i < 5; i += 1) pool.push(mk(`a${i}`, 1000, "2025-01-01"));
    for (let i = 0; i < 20; i += 1) pool.push(mk(`b${i}`, 5000, `2025-0${(i % 8) + 1}-01`));
    const sampled = stratifiedSample(pool, 15);
    expect(sampled.length).toBe(15);
    const ids = new Set(sampled.map((s) => s.id));
    expect(ids.size).toBe(15);
  });
});

describe("sample-picker pickDeepRead", () => {
  it("picks 5-8 articles with word_count + time diversity", () => {
    const pool: ArticleSample[] = [];
    for (let i = 0; i < 30; i += 1) {
      const m = String((i % 12) + 1).padStart(2, "0");
      pool.push(mk(`a${i}`, 500 + i * 200, `2025-${m}-01`));
    }
    const picked = pickDeepRead(pool, 7);
    expect(picked.length).toBe(7);
    const ids = new Set(picked.map((p) => p.id));
    expect(ids.size).toBe(7);
    const wcs = picked.map((p) => p.word_count).sort((a, b) => a - b);
    expect(wcs[wcs.length - 1]! - wcs[0]!).toBeGreaterThan(1000);
  });

  it("clamps requested count to pool size", () => {
    const pool = [mk("a", 100, "2025-01-01"), mk("b", 200, "2025-02-01")];
    const picked = pickDeepRead(pool, 7);
    expect(picked.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/style-distiller/sample-picker.test.ts
```

- [ ] **Step 3: Implement**

Create `packages/kb/src/style-distiller/sample-picker.ts`:

```ts
import type { ArticleSample } from "./types.js";

function quartileIndex(values: number[], v: number): 0 | 1 | 2 | 3 {
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)]!;
  const q2 = sorted[Math.floor(sorted.length * 0.5)]!;
  const q3 = sorted[Math.floor(sorted.length * 0.75)]!;
  if (v <= q1) return 0;
  if (v <= q2) return 1;
  if (v <= q3) return 2;
  return 3;
}

function quarterOf(date: string): number {
  const m = Number(date.slice(5, 7));
  return Math.min(3, Math.floor((m - 1) / 3));
}

function timeBucketOf(date: string): string {
  const y = date.slice(0, 4);
  return `${y}-Q${quarterOf(date)}`;
}

export function stratifiedSample(pool: ArticleSample[], sampleSize: number): ArticleSample[] {
  if (pool.length <= sampleSize) return [...pool];

  const wcs = pool.map((p) => p.word_count);
  const buckets = new Map<string, ArticleSample[]>();
  for (const a of pool) {
    const key = `${quartileIndex(wcs, a.word_count)}|${timeBucketOf(a.published_at)}`;
    const arr = buckets.get(key) ?? [];
    arr.push(a);
    buckets.set(key, arr);
  }

  const bucketKeys = [...buckets.keys()].sort();
  const perBucket = Math.max(1, Math.floor(sampleSize / Math.max(1, bucketKeys.length)));
  const out: ArticleSample[] = [];
  const seen = new Set<string>();

  for (const key of bucketKeys) {
    const items = buckets.get(key)!;
    const step = Math.max(1, Math.floor(items.length / Math.max(1, perBucket)));
    for (let i = 0; i < items.length && out.length < sampleSize; i += step) {
      const it = items[i]!;
      if (!seen.has(it.id)) {
        out.push(it);
        seen.add(it.id);
        if (out.filter((o) => buckets.get(key)!.includes(o)).length >= perBucket) break;
      }
    }
  }

  if (out.length < sampleSize) {
    for (const a of pool) {
      if (out.length >= sampleSize) break;
      if (!seen.has(a.id)) {
        out.push(a);
        seen.add(a.id);
      }
    }
  }

  return out.slice(0, sampleSize);
}

export function pickDeepRead(pool: ArticleSample[], count: number): ArticleSample[] {
  const n = Math.min(count, pool.length);
  if (n === 0) return [];
  const byWc = [...pool].sort((a, b) => a.word_count - b.word_count);
  const step = Math.max(1, Math.floor(byWc.length / n));
  const picked: ArticleSample[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < byWc.length && picked.length < n; i += step) {
    const a = byWc[i]!;
    if (!seen.has(a.id)) {
      picked.push(a);
      seen.add(a.id);
    }
  }
  for (const a of pool) {
    if (picked.length >= n) break;
    if (!seen.has(a.id)) {
      picked.push(a);
      seen.add(a.id);
    }
  }
  return picked.slice(0, n);
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/style-distiller/sample-picker.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/kb/src/style-distiller/sample-picker.ts packages/kb/tests/style-distiller/sample-picker.test.ts && git -c commit.gpgsign=false commit -m "feat(kb): SP-06 sample-picker stratified + deep-read selection"
```

---

### Task 3: snippet-aggregator

**Files:**
- Create: `packages/kb/src/style-distiller/snippet-aggregator.ts`
- Create: `packages/kb/tests/style-distiller/snippet-aggregator.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/kb/tests/style-distiller/snippet-aggregator.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { aggregateSnippets } from "../../src/style-distiller/snippet-aggregator.js";
import type { SnippetCandidate } from "../../src/style-distiller/types.js";

function mk(tag: string, from: string, excerpt: string, pos = 0.1, length?: number): SnippetCandidate {
  return { tag, from, excerpt, position_ratio: pos, length: length ?? excerpt.length };
}

describe("snippet-aggregator", () => {
  it("dedupes by normalized excerpt hash (whitespace + case)", () => {
    const input = [
      mk("opening.data", "a1", "  据 Monnfox 统计，25 亿次。  "),
      mk("opening.data", "a2", "据 Monnfox 统计，25 亿次。"),
      mk("opening.data", "a3", "据 MONNFOX 统计，25 亿次。"),
    ];
    const out = aggregateSnippets(input);
    expect(out["opening.data"]!.length).toBe(1);
  });

  it("groups by tag and caps each tag at 10", () => {
    const input: SnippetCandidate[] = [];
    for (let i = 0; i < 15; i += 1) input.push(mk("bold.judgment", `a${i}`, `不是 X${i}，而是 Y${i}`));
    for (let i = 0; i < 5; i += 1) input.push(mk("closing.blank", `b${i}`, `这场竞赛刚刚开始${i}`));
    const out = aggregateSnippets(input);
    expect(out["bold.judgment"]!.length).toBe(10);
    expect(out["closing.blank"]!.length).toBe(5);
  });

  it("ranks by score: prefer typical position + longer length", () => {
    const input: SnippetCandidate[] = [
      mk("opening.data", "a1", "短的开头", 0.05, 10),
      mk("opening.data", "a2", "稍长一点的开头句式示例", 0.05, 20),
      mk("opening.data", "a3", "位置不太像开头的句子", 0.6, 20),
    ];
    const out = aggregateSnippets(input);
    expect(out["opening.data"]![0]!.from).toBe("a2");
    expect(out["opening.data"]![out["opening.data"]!.length - 1]!.from).toBe("a3");
  });

  it("produces at least 3 per tag if input has >= 3 unique", () => {
    const input: SnippetCandidate[] = [
      mk("transition.case", "a1", "回到现场"),
      mk("transition.case", "a2", "说回正题"),
      mk("transition.case", "a3", "另一个线索"),
      mk("transition.case", "a4", "同时值得一提"),
    ];
    const out = aggregateSnippets(input);
    expect(out["transition.case"]!.length).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/style-distiller/snippet-aggregator.test.ts
```

- [ ] **Step 3: Implement**

Create `packages/kb/src/style-distiller/snippet-aggregator.ts`:

```ts
import type { SnippetCandidate } from "./types.js";

function normalize(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

function typicalPosition(tag: string): number {
  if (tag.startsWith("opening")) return 0.05;
  if (tag.startsWith("closing")) return 0.95;
  if (tag.startsWith("bold")) return 0.5;
  if (tag.startsWith("quote")) return 0.4;
  if (tag.startsWith("transition")) return 0.5;
  return 0.5;
}

function score(c: SnippetCandidate): number {
  const target = typicalPosition(c.tag);
  const positionPenalty = Math.abs(c.position_ratio - target);
  const lengthBonus = Math.min(1, c.length / 80);
  return lengthBonus - positionPenalty;
}

export function aggregateSnippets(
  candidates: SnippetCandidate[],
  perTagLimit = 10,
): Record<string, SnippetCandidate[]> {
  const byTag = new Map<string, SnippetCandidate[]>();
  for (const c of candidates) {
    const arr = byTag.get(c.tag) ?? [];
    arr.push(c);
    byTag.set(c.tag, arr);
  }

  const out: Record<string, SnippetCandidate[]> = {};
  for (const [tag, arr] of byTag.entries()) {
    const seen = new Set<string>();
    const deduped: SnippetCandidate[] = [];
    for (const c of arr) {
      const h = normalize(c.excerpt);
      if (seen.has(h)) continue;
      seen.add(h);
      deduped.push(c);
    }
    deduped.sort((a, b) => score(b) - score(a));
    out[tag] = deduped.slice(0, perTagLimit);
  }
  return out;
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/style-distiller/snippet-aggregator.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/kb/src/style-distiller/snippet-aggregator.ts packages/kb/tests/style-distiller/snippet-aggregator.test.ts && git -c commit.gpgsign=false commit -m "feat(kb): SP-06 snippet-aggregator dedupe + rank"
```

---

### Task 4: style-distiller-structure agent + prompt

**Files:**
- Create: `packages/agents/src/prompts/style-distiller-structure.md`
- Create: `packages/agents/src/roles/style-distiller-structure-agent.ts`
- Create: `packages/agents/tests/style-distiller-structure-agent.test.ts`
- Modify: `packages/agents/src/index.ts`

- [ ] **Step 1: Write failing test**

Create `packages/agents/tests/style-distiller-structure-agent.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/model-adapter.js", () => ({
  invokeAgent: vi.fn(),
}));

import { invokeAgent } from "../src/model-adapter.js";
import { StyleDistillerStructureAgent } from "../src/roles/style-distiller-structure-agent.js";

describe("StyleDistillerStructureAgent", () => {
  beforeEach(() => {
    (invokeAgent as any).mockReset();
  });

  it("embeds sample articles + quant summary in user message, returns text", async () => {
    (invokeAgent as any).mockReturnValue({
      text: "# 结构提炼\n一、核心定位\n...",
      meta: { cli: "claude", model: "opus", durationMs: 1000 },
    });
    const agent = new StyleDistillerStructureAgent({ cli: "claude", model: "opus" });
    const out = await agent.distill({
      account: "赛博禅心",
      samples: [
        { id: "2025-06-01_a", title: "T1", published_at: "2025-06-01", word_count: 2000, body_plain: "正文 A" },
        { id: "2025-09-10_b", title: "T2", published_at: "2025-09-10", word_count: 3500, body_plain: "正文 B" },
      ],
      quantSummary: "中位数字数 3200",
    });
    expect(out.text).toContain("结构提炼");
    const call = (invokeAgent as any).mock.calls[0][0];
    expect(call.agentKey).toBe("style_distiller.structure");
    expect(call.cli).toBe("claude");
    expect(call.systemPrompt.length).toBeGreaterThan(200);
    expect(call.userMessage).toContain("赛博禅心");
    expect(call.userMessage).toContain("2025-06-01_a");
    expect(call.userMessage).toContain("正文 A");
    expect(call.userMessage).toContain("中位数字数 3200");
  });

  it("throws if samples empty", async () => {
    const agent = new StyleDistillerStructureAgent({ cli: "claude" });
    await expect(agent.distill({ account: "x", samples: [], quantSummary: "" })).rejects.toThrow(/at least one sample/);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm test tests/style-distiller-structure-agent.test.ts
```

- [ ] **Step 3: Implement**

Create `packages/agents/src/prompts/style-distiller-structure.md`:

```markdown
你是"风格结构蒸馏师"。你收到以下输入：

1. 一个公众号账号名
2. 5-8 篇该账号的代表文章（含标题、发布日期、字数、正文）
3. 一份该账号的量化指标摘要（字数/段长/加粗频次/emoji 等）

你的任务：输出一份 markdown，覆盖这 10 节（**按顺序、节标题一字不差**）：

- 一、核心定位
- 二、开头写法
- 三、结构骨架
- 四、实测段落写法
- 五、语气 tone
- 六、行业观察段 / 收束段
- 七、视觉/排版元素
- 八、禁区
- 九、给 Writer Agent 的一句话 system prompt 提炼
- 十、待补（留空，待人工确认）

## 输出要求

- 每节 150-400 字，必须引用 1-3 条原文例（从你读的样本里直接挑，不编造）
- 禁用空洞形容（"风格鲜明"/"文笔优秀"），必须落到"用什么句式""几段几字""标点习惯"
- 量化节（如开头段字数）直接引用输入里的数字，不要另算
- 禁止 YAML frontmatter；第一行就是 `一、核心定位`
- 禁止前言/总结/作者签名
```

Create `packages/agents/src/roles/style-distiller-structure-agent.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { invokeAgent } from "../model-adapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(
  join(__dirname, "../prompts/style-distiller-structure.md"),
  "utf-8",
);

export interface StructureSample {
  id: string;
  title: string;
  published_at: string;
  word_count: number;
  body_plain: string;
}

export interface StructureDistillInput {
  account: string;
  samples: StructureSample[];
  quantSummary: string;
}

export interface StructureDistillOutput {
  text: string;
  meta: { cli: string; model?: string | null; durationMs: number };
}

export class StyleDistillerStructureAgent {
  constructor(private opts: { cli: "claude" | "codex"; model?: string }) {}

  async distill(input: StructureDistillInput): Promise<StructureDistillOutput> {
    if (input.samples.length === 0) {
      throw new Error("at least one sample required");
    }
    const samplesBlock = input.samples.map((s, i) => [
      `## Sample ${i + 1}: ${s.id}`,
      `- 标题：${s.title}`,
      `- 发布日期：${s.published_at}`,
      `- 字数：${s.word_count}`,
      ``,
      s.body_plain,
    ].join("\n")).join("\n\n---\n\n");

    const userMessage = [
      `# 账号：${input.account}`,
      ``,
      `# 量化摘要`,
      input.quantSummary,
      ``,
      `# 代表文章（${input.samples.length} 篇）`,
      samplesBlock,
      ``,
      `按 system prompt 输出 10 节结构提炼 markdown。`,
    ].join("\n");

    const result = invokeAgent({
      agentKey: "style_distiller.structure",
      cli: this.opts.cli,
      model: this.opts.model,
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
    });
    return {
      text: result.text,
      meta: { cli: result.meta.cli, model: result.meta.model ?? null, durationMs: result.meta.durationMs },
    };
  }
}
```

Modify `packages/agents/src/index.ts` — append:

```ts
export { StyleDistillerStructureAgent } from "./roles/style-distiller-structure-agent.js";
export type { StructureSample, StructureDistillInput, StructureDistillOutput } from "./roles/style-distiller-structure-agent.js";
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm test tests/style-distiller-structure-agent.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/agents/src/prompts/style-distiller-structure.md packages/agents/src/roles/style-distiller-structure-agent.ts packages/agents/src/index.ts packages/agents/tests/style-distiller-structure-agent.test.ts && git -c commit.gpgsign=false commit -m "feat(agents): SP-06 style-distiller structure agent"
```

---

### Task 5: style-distiller-snippets agent + prompt

**Files:**
- Create: `packages/agents/src/prompts/style-distiller-snippets.md`
- Create: `packages/agents/src/roles/style-distiller-snippets-agent.ts`
- Create: `packages/agents/tests/style-distiller-snippets-agent.test.ts`
- Modify: `packages/agents/src/index.ts`

- [ ] **Step 1: Write failing test**

Create `packages/agents/tests/style-distiller-snippets-agent.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/model-adapter.js", () => ({
  invokeAgent: vi.fn(),
}));

import { invokeAgent } from "../src/model-adapter.js";
import { StyleDistillerSnippetsAgent } from "../src/roles/style-distiller-snippets-agent.js";

describe("StyleDistillerSnippetsAgent", () => {
  beforeEach(() => {
    (invokeAgent as any).mockReset();
  });

  it("parses JSON list of candidates from agent output", async () => {
    (invokeAgent as any).mockReturnValue({
      text: JSON.stringify([
        { tag: "opening.data", from: "2025-06-01_a", excerpt: "据 X 统计", position_ratio: 0.03, length: 8 },
        { tag: "closing.blank", from: "2025-06-01_a", excerpt: "刚刚开始", position_ratio: 0.97, length: 4 },
      ]),
      meta: { cli: "claude", model: "opus", durationMs: 1000 },
    });
    const agent = new StyleDistillerSnippetsAgent({ cli: "claude", model: "opus" });
    const out = await agent.harvest({
      account: "X",
      batchIndex: 0,
      totalBatches: 2,
      articles: [{ id: "2025-06-01_a", title: "T", published_at: "2025-06-01", word_count: 1000, body_plain: "据 X 统计..." }],
    });
    expect(out.candidates).toHaveLength(2);
    expect(out.candidates[0]!.tag).toBe("opening.data");
    expect(out.candidates[0]!.from).toBe("2025-06-01_a");
  });

  it("strips markdown code fence around JSON", async () => {
    (invokeAgent as any).mockReturnValue({
      text: "```json\n[{\"tag\":\"bold.judgment\",\"from\":\"a\",\"excerpt\":\"不是 X\",\"position_ratio\":0.5,\"length\":5}]\n```",
      meta: { cli: "claude", model: "opus", durationMs: 1 },
    });
    const agent = new StyleDistillerSnippetsAgent({ cli: "claude" });
    const out = await agent.harvest({ account: "X", batchIndex: 0, totalBatches: 1, articles: [{ id: "a", title: "T", published_at: "2025-01-01", word_count: 100, body_plain: "x" }] });
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0]!.tag).toBe("bold.judgment");
  });

  it("throws on invalid JSON output", async () => {
    (invokeAgent as any).mockReturnValue({ text: "not json", meta: { cli: "claude", model: null, durationMs: 1 } });
    const agent = new StyleDistillerSnippetsAgent({ cli: "claude" });
    await expect(agent.harvest({ account: "X", batchIndex: 0, totalBatches: 1, articles: [{ id: "a", title: "T", published_at: "2025-01-01", word_count: 100, body_plain: "x" }] })).rejects.toThrow(/parse/i);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm test tests/style-distiller-snippets-agent.test.ts
```

- [ ] **Step 3: Implement**

Create `packages/agents/src/prompts/style-distiller-snippets.md`:

```markdown
你是"风格片段采集器"。输入：20-30 篇某账号的文章（id + 标题 + 正文）。

你的任务：从每篇文章里摘出"可被 Writer 复用的句式样本"，按 tag 分类。

## Tag 枚举（只能用这些）

- `opening.data` —— 开头段落里用数据/统计开场的句子
- `opening.scene` —— 开头段落里以场景/画面开场的句子
- `opening.question` —— 开头段落里以问句开场
- `bold.judgment` —— 文中加粗的判断句（"不是 X，而是 Y"/"这次关键是 Z"）
- `closing.blank` —— 结尾段里留白式句子（不给结论，留余韵）
- `closing.call` —— 结尾段里召唤/点题式
- `quote.peer` —— 引用同行/产品人的话
- `quote.org` —— 引用机构/报告的数据
- `transition.case` —— case 之间的过渡短句

## 输出格式（严格 JSON 数组，禁止 markdown 说明）

```json
[
  {
    "tag": "opening.data",
    "from": "<article id>",
    "excerpt": "<原文片段，15-120 字>",
    "position_ratio": 0.03,
    "length": 58
  },
  ...
]
```

- `position_ratio` 是该句在文章正文中的字符起始位置 / 文章总字符长度
- `excerpt` 必须是原文**原句**，不改一个字
- 每篇文章摘 3-6 条（不够就少；质量优先）
- 整批至少输出 60 条候选（如果原料够）
- 直接输出 JSON 数组，第一个字符是 `[`，最后一个字符是 `]`，不要前言/解释/代码围栏
```

Create `packages/agents/src/roles/style-distiller-snippets-agent.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { invokeAgent } from "../model-adapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(
  join(__dirname, "../prompts/style-distiller-snippets.md"),
  "utf-8",
);

export interface SnippetBatchArticle {
  id: string;
  title: string;
  published_at: string;
  word_count: number;
  body_plain: string;
}

export interface SnippetHarvestInput {
  account: string;
  batchIndex: number;
  totalBatches: number;
  articles: SnippetBatchArticle[];
}

export interface HarvestedSnippet {
  tag: string;
  from: string;
  excerpt: string;
  position_ratio: number;
  length: number;
}

export interface SnippetHarvestOutput {
  candidates: HarvestedSnippet[];
  meta: { cli: string; model?: string | null; durationMs: number };
}

function stripFence(text: string): string {
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(text.trim());
  return m ? m[1]!.trim() : text.trim();
}

export class StyleDistillerSnippetsAgent {
  constructor(private opts: { cli: "claude" | "codex"; model?: string }) {}

  async harvest(input: SnippetHarvestInput): Promise<SnippetHarvestOutput> {
    const articlesBlock = input.articles.map((a) => [
      `## ${a.id}`,
      `标题：${a.title}  日期：${a.published_at}  字数：${a.word_count}`,
      ``,
      a.body_plain,
    ].join("\n")).join("\n\n---\n\n");

    const userMessage = [
      `# 账号：${input.account}`,
      `# 批次：${input.batchIndex + 1} / ${input.totalBatches}`,
      ``,
      `# 文章（${input.articles.length} 篇）`,
      articlesBlock,
      ``,
      `输出 JSON 数组。`,
    ].join("\n");

    const result = invokeAgent({
      agentKey: "style_distiller.snippets",
      cli: this.opts.cli,
      model: this.opts.model,
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
    });
    let parsed: HarvestedSnippet[];
    try {
      parsed = JSON.parse(stripFence(result.text));
    } catch (e) {
      throw new Error(`snippets agent: failed to parse JSON output: ${(e as Error).message}`);
    }
    if (!Array.isArray(parsed)) throw new Error("snippets agent: output is not an array");
    return {
      candidates: parsed,
      meta: { cli: result.meta.cli, model: result.meta.model ?? null, durationMs: result.meta.durationMs },
    };
  }
}
```

Modify `packages/agents/src/index.ts` — append:

```ts
export { StyleDistillerSnippetsAgent } from "./roles/style-distiller-snippets-agent.js";
export type { SnippetBatchArticle, SnippetHarvestInput, HarvestedSnippet, SnippetHarvestOutput } from "./roles/style-distiller-snippets-agent.js";
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm test tests/style-distiller-snippets-agent.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/agents/src/prompts/style-distiller-snippets.md packages/agents/src/roles/style-distiller-snippets-agent.ts packages/agents/src/index.ts packages/agents/tests/style-distiller-snippets-agent.test.ts && git -c commit.gpgsign=false commit -m "feat(agents): SP-06 style-distiller snippets agent"
```

---

### Task 6: style-distiller-composer agent + prompt

**Files:**
- Create: `packages/agents/src/prompts/style-distiller-composer.md`
- Create: `packages/agents/src/roles/style-distiller-composer-agent.ts`
- Create: `packages/agents/tests/style-distiller-composer-agent.test.ts`
- Modify: `packages/agents/src/index.ts`

- [ ] **Step 1: Write failing test**

Create `packages/agents/tests/style-distiller-composer-agent.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/model-adapter.js", () => ({
  invokeAgent: vi.fn(),
}));

import { invokeAgent } from "../src/model-adapter.js";
import { StyleDistillerComposerAgent } from "../src/roles/style-distiller-composer-agent.js";

describe("StyleDistillerComposerAgent", () => {
  beforeEach(() => {
    (invokeAgent as any).mockReset();
  });

  it("builds kb.md with frontmatter containing all metadata", async () => {
    (invokeAgent as any).mockReturnValue({
      text: "# 正文内容\n一、核心定位\n...",
      meta: { cli: "claude", model: "opus", durationMs: 2000 },
    });
    const agent = new StyleDistillerComposerAgent({ cli: "claude", model: "opus" });
    const out = await agent.compose({
      account: "赛博禅心",
      sampleSizeRequested: 100,
      sampleSizeActual: 87,
      sourcePoolSize: 314,
      articleDateRange: { start: "2025-01-01", end: "2026-04-01" },
      distilledAt: "2026-04-14T15:30:00Z",
      stepClis: { structure: { cli: "claude", model: "opus" }, snippets: { cli: "claude", model: "opus" }, composer: { cli: "claude", model: "opus" } },
      deepReadIds: ["2025-08-15_X", "2025-11-20_Y"],
      quantJson: '{"article_count":87}',
      structureMd: "一、核心定位\n...",
      snippetsYaml: "opening.data:\n  - from: a\n    excerpt: 据 X",
    });
    expect(out.kbMd.startsWith("---\n")).toBe(true);
    expect(out.kbMd).toContain("type: style_expert");
    expect(out.kbMd).toContain("account: 赛博禅心");
    expect(out.kbMd).toContain("version: v2");
    expect(out.kbMd).toContain("sample_size_requested: 100");
    expect(out.kbMd).toContain("sample_size_actual: 87");
    expect(out.kbMd).toContain("2025-08-15_X");
    expect(out.kbMd).toContain("# 正文内容");
    const call = (invokeAgent as any).mock.calls[0][0];
    expect(call.userMessage).toContain("一、核心定位");
    expect(call.userMessage).toContain("opening.data");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm test tests/style-distiller-composer-agent.test.ts
```

- [ ] **Step 3: Implement**

Create `packages/agents/src/prompts/style-distiller-composer.md`:

```markdown
你是"风格卡合成师"。输入：
1. 账号元数据（名字、样本量、日期范围）
2. 量化 JSON（字数/段长/emoji 等指标）
3. 结构 md（已做好 10 节骨架）
4. 片段 YAML（按 tag 分组的原文候选）

你的任务：合成一份完整的 v2 风格卡 markdown 正文（**不写 frontmatter——调用方会自己拼**）。

## 输出结构（严格）

1. `# <账号> 风格卡 v2`
2. 结构节（1-10 节；把"结构 md"几乎原样插入这里，可微调措辞）
3. `# 句式模板库`
   - `## 开头钩子变体`（5-8 种，每种：模式一句话 + 1-2 条原文例，原文例来自片段 YAML）
   - `## 结尾模板变体`（4-5 种）
   - `## 转折/过渡词库`（列量化 JSON 的 top_transition_words）
   - `## 加粗金句模式`（从 bold.judgment 片段里归纳 2-3 种模式）
   - `## 引用模板`（quote.peer / quote.org 分两类）
   - `## 标题模板`（如果样本里有规律就列，没有就"未识别明显模板"一句）
4. `# 量化指标表`
   - 一个 markdown 表格：指标 / 中位数 / 区间(P10-P90) / 说明
   - 必须覆盖：整篇字数、开头段字数、case 小节字数、结尾段字数、段平均句数、加粗句频次、emoji 密度、图文比、人称比例
   - 数值全部取自量化 JSON，不许改
   - 表格下方一句说明："Writer agent 可据此自检偏离度"
5. `# 片段库`
   - 按 tag 分组输出 YAML code block（把输入的片段 YAML 原样放入 code block）

## 严禁

- 不要 frontmatter（调用方处理）
- 不要编造数字（所有数字必须在量化 JSON 里有出处）
- 不要编造片段（所有原文引用必须在片段 YAML 里）
- 不要加作者署名/祝福/前言
```

Create `packages/agents/src/roles/style-distiller-composer-agent.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { invokeAgent } from "../model-adapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(
  join(__dirname, "../prompts/style-distiller-composer.md"),
  "utf-8",
);

export interface ComposerInput {
  account: string;
  sampleSizeRequested: number;
  sampleSizeActual: number;
  sourcePoolSize: number;
  articleDateRange: { start: string; end: string };
  distilledAt: string;
  stepClis: {
    structure: { cli: string; model?: string };
    snippets: { cli: string; model?: string };
    composer: { cli: string; model?: string };
  };
  deepReadIds: string[];
  quantJson: string;
  structureMd: string;
  snippetsYaml: string;
}

export interface ComposerOutput {
  kbMd: string;
  meta: { cli: string; model?: string | null; durationMs: number };
}

function yamlFrontmatter(input: ComposerInput): string {
  const lines = [
    "---",
    "type: style_expert",
    `account: ${input.account}`,
    "version: v2",
    `distilled_from: ${input.sampleSizeActual} 篇样本（从 ${input.articleDateRange.start}~${input.articleDateRange.end} 范围的 ${input.sourcePoolSize} 篇中采样）`,
    `sample_size_requested: ${input.sampleSizeRequested}`,
    `sample_size_actual: ${input.sampleSizeActual}`,
    `article_date_range: ${input.articleDateRange.start} ~ ${input.articleDateRange.end}`,
    `distilled_at: ${input.distilledAt}`,
    "distilled_by:",
    `  structure: ${input.stepClis.structure.cli}/${input.stepClis.structure.model ?? "default"}`,
    `  snippets: ${input.stepClis.snippets.cli}/${input.stepClis.snippets.model ?? "default"}`,
    `  composer: ${input.stepClis.composer.cli}/${input.stepClis.composer.model ?? "default"}`,
    "sample_articles_read_in_full:",
    ...input.deepReadIds.map((id) => `  - ${id}`),
    "---",
  ];
  return lines.join("\n");
}

export class StyleDistillerComposerAgent {
  constructor(private opts: { cli: "claude" | "codex"; model?: string }) {}

  async compose(input: ComposerInput): Promise<ComposerOutput> {
    const userMessage = [
      `# 账号：${input.account}`,
      ``,
      `# 量化 JSON`,
      "```json",
      input.quantJson,
      "```",
      ``,
      `# 结构 md`,
      input.structureMd,
      ``,
      `# 片段 YAML`,
      "```yaml",
      input.snippetsYaml,
      "```",
      ``,
      `按 system prompt 合成正文（不写 frontmatter）。`,
    ].join("\n");

    const result = invokeAgent({
      agentKey: "style_distiller.composer",
      cli: this.opts.cli,
      model: this.opts.model,
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
    });

    const kbMd = `${yamlFrontmatter(input)}\n${result.text.trim()}\n`;
    return {
      kbMd,
      meta: { cli: result.meta.cli, model: result.meta.model ?? null, durationMs: result.meta.durationMs },
    };
  }
}
```

Modify `packages/agents/src/index.ts` — append:

```ts
export { StyleDistillerComposerAgent } from "./roles/style-distiller-composer-agent.js";
export type { ComposerInput, ComposerOutput } from "./roles/style-distiller-composer-agent.js";
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm test tests/style-distiller-composer-agent.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/agents/src/prompts/style-distiller-composer.md packages/agents/src/roles/style-distiller-composer-agent.ts packages/agents/src/index.ts packages/agents/tests/style-distiller-composer-agent.test.ts && git -c commit.gpgsign=false commit -m "feat(agents): SP-06 style-distiller composer agent"
```

---

### Task 7: orchestrator 主流程

**Files:**
- Create: `packages/kb/src/style-distiller/orchestrator.ts`
- Create: `packages/kb/tests/style-distiller/orchestrator.test.ts`
- Modify: `packages/kb/src/index.ts`

- [ ] **Step 1: Write failing test**

Create `packages/kb/tests/style-distiller/orchestrator.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

vi.mock("@crossing/agents", async () => ({
  StyleDistillerStructureAgent: vi.fn().mockImplementation(() => ({
    distill: vi.fn().mockResolvedValue({ text: "一、核心定位\nMOCK\n", meta: { cli: "claude", model: "opus", durationMs: 100 } }),
  })),
  StyleDistillerSnippetsAgent: vi.fn().mockImplementation(() => ({
    harvest: vi.fn().mockResolvedValue({
      candidates: [
        { tag: "opening.data", from: "a1", excerpt: "据 X 统计", position_ratio: 0.03, length: 8 },
        { tag: "bold.judgment", from: "a2", excerpt: "不是 X 而是 Y", position_ratio: 0.5, length: 10 },
      ],
      meta: { cli: "claude", model: "opus", durationMs: 100 },
    }),
  })),
  StyleDistillerComposerAgent: vi.fn().mockImplementation(() => ({
    compose: vi.fn().mockResolvedValue({ kbMd: "---\ntype: style_expert\n---\n# 正文 MOCK", meta: { cli: "claude", model: "opus", durationMs: 100 } }),
  })),
}));

import { runDistill } from "../../src/style-distiller/orchestrator.js";

function makeDb(dir: string, account: string, articleCount: number): string {
  const p = join(dir, "refs.sqlite");
  const db = new Database(p);
  db.exec(`CREATE TABLE ref_articles (id TEXT PRIMARY KEY, account TEXT, title TEXT, author TEXT, published_at TEXT, url TEXT, summary TEXT, md_path TEXT, topics_core_json TEXT, topics_fine_json TEXT, body_plain TEXT, word_count INT, is_original INT)`);
  const ins = db.prepare(`INSERT INTO ref_articles VALUES (@id,@account,@title,'',@pub,'','','','[]','[]',@body,@wc,1)`);
  for (let i = 0; i < articleCount; i += 1) {
    const m = String((i % 12) + 1).padStart(2, "0");
    ins.run({ id: `${account}_${i}`, account, title: `T${i}`, pub: `2025-${m}-01`, body: `正文${i} `.repeat(100), wc: 500 + i * 10 });
  }
  db.close();
  return p;
}

describe("orchestrator runDistill", () => {
  let vault: string;
  let sqlitePath: string;
  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), "sp06-vault-"));
    mkdirSync(join(vault, "08_experts", "style-panel"), { recursive: true });
    mkdirSync(join(vault, ".distill"), { recursive: true });
    mkdirSync(join(vault, ".index"), { recursive: true });
    sqlitePath = makeDb(join(vault, ".index"), "赛博禅心", 50);
  });

  it("runs 4 steps, writes intermediates + kb.md, emits events", async () => {
    const events: any[] = [];
    const res = await runDistill({
      account: "赛博禅心",
      sampleSize: 25,
      onEvent: (ev) => events.push(ev),
    }, { vaultPath: vault, sqlitePath });

    expect(res.account).toBe("赛博禅心");
    expect(res.steps_run).toEqual(["quant", "structure", "snippets", "composer"]);
    expect(existsSync(join(vault, ".distill", "赛博禅心", "quant.json"))).toBe(true);
    expect(existsSync(join(vault, ".distill", "赛博禅心", "structure.md"))).toBe(true);
    expect(existsSync(join(vault, ".distill", "赛博禅心", "snippets.yaml"))).toBe(true);
    expect(existsSync(join(vault, ".distill", "赛博禅心", "distilled_at.txt"))).toBe(true);
    expect(existsSync(join(vault, "08_experts", "style-panel", "赛博禅心_kb.md"))).toBe(true);

    const quant = JSON.parse(readFileSync(join(vault, ".distill", "赛博禅心", "quant.json"), "utf-8"));
    expect(quant.account).toBe("赛博禅心");
    expect(quant.article_count).toBe(25);

    const kb = readFileSync(join(vault, "08_experts", "style-panel", "赛博禅心_kb.md"), "utf-8");
    expect(kb).toContain("# 正文 MOCK");

    expect(events.find((e) => e.step === "quant" && e.phase === "completed")).toBeTruthy();
    expect(events.find((e) => e.step === "structure" && e.phase === "completed")).toBeTruthy();
    expect(events.find((e) => e.step === "snippets" && e.phase === "completed")).toBeTruthy();
    expect(events.find((e) => e.step === "composer" && e.phase === "completed")).toBeTruthy();
    expect(events.find((e) => e.step === "snippets" && e.phase === "batch_progress")).toBeTruthy();
  });

  it("dry-run: only runs quant, no kb.md", async () => {
    const res = await runDistill({ account: "赛博禅心", sampleSize: 25, dryRun: true }, { vaultPath: vault, sqlitePath });
    expect(res.steps_run).toEqual(["quant"]);
    expect(existsSync(join(vault, ".distill", "赛博禅心", "quant.json"))).toBe(true);
    expect(existsSync(join(vault, "08_experts", "style-panel", "赛博禅心_kb.md"))).toBe(false);
  });

  it("only-step=composer reuses intermediates", async () => {
    // seed intermediates
    const dd = join(vault, ".distill", "赛博禅心");
    mkdirSync(dd, { recursive: true });
    writeFileSync(join(dd, "quant.json"), JSON.stringify({ account: "赛博禅心", article_count: 10, date_range: { start: "2025-01-01", end: "2025-12-01" } }));
    writeFileSync(join(dd, "structure.md"), "一、核心定位\nSEED\n");
    writeFileSync(join(dd, "snippets.yaml"), "opening.data:\n  - from: x\n    excerpt: y\n");
    writeFileSync(join(dd, "deep_read_ids.json"), JSON.stringify(["seed_id"]));
    writeFileSync(join(dd, "sample_stats.json"), JSON.stringify({ sampleSizeRequested: 10, sampleSizeActual: 10, sourcePoolSize: 50, articleDateRange: { start: "2025-01-01", end: "2025-12-01" } }));

    const res = await runDistill({ account: "赛博禅心", sampleSize: 10, onlyStep: "composer" }, { vaultPath: vault, sqlitePath });
    expect(res.steps_run).toEqual(["composer"]);
    expect(existsSync(join(vault, "08_experts", "style-panel", "赛博禅心_kb.md"))).toBe(true);
  });

  it("only-step=snippets throws if quant missing", async () => {
    await expect(runDistill({ account: "赛博禅心", sampleSize: 10, onlyStep: "snippets" }, { vaultPath: vault, sqlitePath })).rejects.toThrow(/missing intermediate/);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/style-distiller/orchestrator.test.ts
```

- [ ] **Step 3: Implement**

Create `packages/kb/src/style-distiller/orchestrator.ts`:

```ts
import Database from "better-sqlite3";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  StyleDistillerStructureAgent,
  StyleDistillerSnippetsAgent,
  StyleDistillerComposerAgent,
} from "@crossing/agents";
import { analyzeQuant } from "./quant-analyzer.js";
import { stratifiedSample, pickDeepRead } from "./sample-picker.js";
import { aggregateSnippets } from "./snippet-aggregator.js";
import type {
  ArticleSample, DistillOptions, DistillResult, DistillStep, DistillStepEvent, QuantResult, SnippetCandidate,
} from "./types.js";

export interface DistillContext {
  vaultPath: string;
  sqlitePath: string;
}

const BATCH_SIZE = 25;

function loadPool(sqlitePath: string, account: string, since?: string, until?: string): { pool: ArticleSample[]; totalInRange: number } {
  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  try {
    const where: string[] = ["account = @account"];
    const params: Record<string, unknown> = { account };
    if (since) { where.push("published_at >= @since"); params.since = since; }
    if (until) { where.push("published_at <= @until"); params.until = until; }
    const sql = `SELECT id, account, title, published_at, word_count, body_plain FROM ref_articles WHERE ${where.join(" AND ")} ORDER BY published_at DESC`;
    const rows = db.prepare(sql).all(params) as Array<{ id: string; account: string; title: string; published_at: string; word_count: number | null; body_plain: string | null }>;
    const pool: ArticleSample[] = rows.map((r) => ({
      id: r.id,
      account: r.account,
      title: r.title,
      published_at: r.published_at,
      word_count: r.word_count ?? (r.body_plain ?? "").length,
      body_plain: r.body_plain ?? "",
    }));
    return { pool, totalInRange: pool.length };
  } finally {
    db.close();
  }
}

function emit(onEvent: DistillOptions["onEvent"], ev: DistillStepEvent) {
  if (onEvent) {
    try { onEvent(ev); } catch { /* swallow user-handler errors */ }
  }
}

function quantSummary(q: QuantResult): string {
  return [
    `article_count=${q.article_count}`,
    `date_range=${q.date_range.start}~${q.date_range.end}`,
    `word_count median=${q.word_count.median} (P10=${q.word_count.p10} P90=${q.word_count.p90})`,
    `opening_words median=${q.opening_words.median}`,
    `closing_words median=${q.closing_words.median}`,
    `case_section_words median=${q.case_section_words.median}`,
    `paragraph_length_sentences median=${q.paragraph_length_sentences.median}`,
    `bold_per_section median=${q.bold_per_section.median}`,
    `image_to_text_ratio=${Math.round(q.image_to_text_ratio)}`,
    `pronoun we=${q.pronoun_ratio.we.toFixed(2)} you=${q.pronoun_ratio.you.toFixed(2)} none=${q.pronoun_ratio.none.toFixed(2)}`,
  ].join("\n");
}

function snippetsToYaml(grouped: Record<string, SnippetCandidate[]>): string {
  const lines: string[] = [];
  for (const tag of Object.keys(grouped).sort()) {
    lines.push(`${tag}:`);
    for (const s of grouped[tag]!) {
      const escaped = s.excerpt.replace(/"/g, '\\"');
      lines.push(`  - from: ${s.from}`);
      lines.push(`    excerpt: "${escaped}"`);
    }
  }
  return lines.join("\n");
}

export async function runDistill(options: DistillOptions, ctx: DistillContext): Promise<DistillResult> {
  const { account, sampleSize, since, until, onlyStep, dryRun, cliModelPerStep, onEvent } = options;
  const distillDir = join(ctx.vaultPath, ".distill", account);
  mkdirSync(distillDir, { recursive: true });
  const stepsRun: DistillStep[] = [];

  const runQuant = !onlyStep || onlyStep === "quant";
  const runStructure = !onlyStep || onlyStep === "structure";
  const runSnippets = !onlyStep || onlyStep === "snippets";
  const runComposer = !onlyStep || onlyStep === "composer";

  let quant: QuantResult | null = null;
  let sampleStats: { sampleSizeRequested: number; sampleSizeActual: number; sourcePoolSize: number; articleDateRange: { start: string; end: string } } | null = null;
  let deepReadIds: string[] = [];
  let samplePool: ArticleSample[] = [];
  let deepReadSamples: ArticleSample[] = [];

  if (runQuant) {
    const started = Date.now();
    emit(onEvent, { step: "quant", phase: "started", account });
    const { pool, totalInRange } = loadPool(ctx.sqlitePath, account, since, until);
    if (pool.length === 0) throw new Error(`no articles for account=${account} in date range`);
    samplePool = stratifiedSample(pool, sampleSize);
    deepReadSamples = pickDeepRead(samplePool, 7);
    deepReadIds = deepReadSamples.map((s) => s.id);
    quant = analyzeQuant(account, samplePool);
    sampleStats = {
      sampleSizeRequested: sampleSize,
      sampleSizeActual: samplePool.length,
      sourcePoolSize: totalInRange,
      articleDateRange: quant.date_range,
    };
    writeFileSync(join(distillDir, "quant.json"), JSON.stringify(quant, null, 2), "utf-8");
    writeFileSync(join(distillDir, "sample_stats.json"), JSON.stringify(sampleStats, null, 2), "utf-8");
    writeFileSync(join(distillDir, "deep_read_ids.json"), JSON.stringify(deepReadIds), "utf-8");
    writeFileSync(join(distillDir, "sample_pool_ids.json"), JSON.stringify(samplePool.map((s) => s.id)), "utf-8");
    stepsRun.push("quant");
    emit(onEvent, { step: "quant", phase: "completed", account, duration_ms: Date.now() - started, stats: { article_count: samplePool.length, source_pool: totalInRange } });
  }

  if (dryRun) {
    writeFileSync(join(distillDir, "distilled_at.txt"), `${new Date().toISOString()} dry-run sample_size=${sampleSize}\n`, "utf-8");
    return { account, kb_path: "", sample_size_actual: samplePool.length, steps_run: stepsRun };
  }

  // If subsequent steps run, we may need intermediate state:
  const needsIntermediates = runStructure || runSnippets || runComposer;
  if (needsIntermediates && !quant) {
    const qp = join(distillDir, "quant.json");
    const sp = join(distillDir, "sample_stats.json");
    const dp = join(distillDir, "deep_read_ids.json");
    const pp = join(distillDir, "sample_pool_ids.json");
    if (!existsSync(qp) || !existsSync(sp)) {
      throw new Error(`missing intermediate: quant.json / sample_stats.json (run without --only-step or rerun earlier step first)`);
    }
    quant = JSON.parse(readFileSync(qp, "utf-8")) as QuantResult;
    sampleStats = JSON.parse(readFileSync(sp, "utf-8"));
    deepReadIds = existsSync(dp) ? JSON.parse(readFileSync(dp, "utf-8")) : [];
    // Reload pool if structure/snippets need body_plain
    if (runStructure || runSnippets) {
      const { pool } = loadPool(ctx.sqlitePath, account, since, until);
      const ids = existsSync(pp) ? new Set<string>(JSON.parse(readFileSync(pp, "utf-8"))) : null;
      samplePool = ids ? pool.filter((a) => ids.has(a.id)) : pool.slice(0, sampleStats!.sampleSizeActual);
      deepReadSamples = deepReadIds.length
        ? samplePool.filter((s) => deepReadIds.includes(s.id))
        : pickDeepRead(samplePool, 7);
      if (deepReadSamples.length === 0 && samplePool.length > 0) deepReadSamples = pickDeepRead(samplePool, 7);
    }
  }

  if (runStructure) {
    const started = Date.now();
    emit(onEvent, { step: "structure", phase: "started", account });
    const cliModel = cliModelPerStep?.structure ?? { cli: "claude" as const, model: "opus" };
    const agent = new StyleDistillerStructureAgent(cliModel);
    const out = await agent.distill({
      account,
      samples: deepReadSamples.map((s) => ({ id: s.id, title: s.title, published_at: s.published_at, word_count: s.word_count, body_plain: s.body_plain })),
      quantSummary: quantSummary(quant!),
    });
    writeFileSync(join(distillDir, "structure.md"), out.text, "utf-8");
    stepsRun.push("structure");
    emit(onEvent, { step: "structure", phase: "completed", account, duration_ms: Date.now() - started, stats: { bytes: out.text.length } });
  }

  if (runSnippets) {
    const started = Date.now();
    emit(onEvent, { step: "snippets", phase: "started", account });
    const cliModel = cliModelPerStep?.snippets ?? { cli: "claude" as const, model: "opus" };
    const agent = new StyleDistillerSnippetsAgent(cliModel);
    const batches: ArticleSample[][] = [];
    for (let i = 0; i < samplePool.length; i += BATCH_SIZE) batches.push(samplePool.slice(i, i + BATCH_SIZE));
    const all: SnippetCandidate[] = [];
    for (let i = 0; i < batches.length; i += 1) {
      const out = await agent.harvest({
        account,
        batchIndex: i,
        totalBatches: batches.length,
        articles: batches[i]!.map((a) => ({ id: a.id, title: a.title, published_at: a.published_at, word_count: a.word_count, body_plain: a.body_plain })),
      });
      all.push(...out.candidates);
      emit(onEvent, { step: "snippets", phase: "batch_progress", account, stats: { batch: i + 1, total_batches: batches.length, candidates_so_far: all.length } });
    }
    const grouped = aggregateSnippets(all);
    const yaml = snippetsToYaml(grouped);
    writeFileSync(join(distillDir, "snippets.yaml"), yaml, "utf-8");
    stepsRun.push("snippets");
    emit(onEvent, { step: "snippets", phase: "completed", account, duration_ms: Date.now() - started, stats: { raw: all.length, tags: Object.keys(grouped).length } });
  }

  let kbPath = "";
  if (runComposer) {
    const started = Date.now();
    emit(onEvent, { step: "composer", phase: "started", account });
    const cliModel = cliModelPerStep?.composer ?? { cli: "claude" as const, model: "opus" };
    const agent = new StyleDistillerComposerAgent(cliModel);
    const quantJson = readFileSync(join(distillDir, "quant.json"), "utf-8");
    const structureMd = readFileSync(join(distillDir, "structure.md"), "utf-8");
    const snippetsYaml = readFileSync(join(distillDir, "snippets.yaml"), "utf-8");
    const stats = sampleStats ?? JSON.parse(readFileSync(join(distillDir, "sample_stats.json"), "utf-8"));
    const ids = deepReadIds.length ? deepReadIds : JSON.parse(readFileSync(join(distillDir, "deep_read_ids.json"), "utf-8"));
    const structureCli = cliModelPerStep?.structure ?? { cli: "claude" as const, model: "opus" };
    const snippetsCli = cliModelPerStep?.snippets ?? { cli: "claude" as const, model: "opus" };
    const out = await agent.compose({
      account,
      sampleSizeRequested: stats.sampleSizeRequested,
      sampleSizeActual: stats.sampleSizeActual,
      sourcePoolSize: stats.sourcePoolSize,
      articleDateRange: stats.articleDateRange,
      distilledAt: new Date().toISOString(),
      stepClis: { structure: structureCli, snippets: snippetsCli, composer: cliModel },
      deepReadIds: ids,
      quantJson,
      structureMd,
      snippetsYaml,
    });
    const panelDir = join(ctx.vaultPath, "08_experts", "style-panel");
    mkdirSync(panelDir, { recursive: true });
    kbPath = join(panelDir, `${account}_kb.md`);
    writeFileSync(kbPath, out.kbMd, "utf-8");
    stepsRun.push("composer");
    emit(onEvent, { step: "composer", phase: "completed", account, duration_ms: Date.now() - started, stats: { bytes: out.kbMd.length, path: kbPath } });
  }

  writeFileSync(join(distillDir, "distilled_at.txt"), `${new Date().toISOString()} steps=${stepsRun.join(",")} sample_size=${sampleSize}\n`, "utf-8");

  return {
    account,
    kb_path: kbPath,
    sample_size_actual: sampleStats?.sampleSizeActual ?? samplePool.length,
    steps_run: stepsRun,
  };
}
```

Modify `packages/kb/src/index.ts` — append (or create if empty):

```ts
export { runDistill } from "./style-distiller/orchestrator.js";
export type { DistillContext } from "./style-distiller/orchestrator.js";
export type { DistillOptions, DistillResult, DistillStep, DistillStepEvent, QuantResult, ArticleSample, SnippetCandidate } from "./style-distiller/types.js";
export { analyzeQuant } from "./style-distiller/quant-analyzer.js";
export { stratifiedSample, pickDeepRead } from "./style-distiller/sample-picker.js";
export { aggregateSnippets } from "./style-distiller/snippet-aggregator.js";
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/style-distiller/orchestrator.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/kb/src/style-distiller/orchestrator.ts packages/kb/src/index.ts packages/kb/tests/style-distiller/orchestrator.test.ts && git -c commit.gpgsign=false commit -m "feat(kb): SP-06 orchestrator 4-step pipeline + dry-run + only-step"
```

---

### Task 8: orchestrator error path

**Files:**
- Create: `packages/kb/tests/style-distiller/orchestrator-errors.test.ts`
- Modify: `packages/kb/src/style-distiller/orchestrator.ts` (wrap each step with try/catch)

- [ ] **Step 1: Write failing test**

Create `packages/kb/tests/style-distiller/orchestrator-errors.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

vi.mock("@crossing/agents", async () => ({
  StyleDistillerStructureAgent: vi.fn().mockImplementation(() => ({
    distill: vi.fn().mockRejectedValue(new Error("boom-structure")),
  })),
  StyleDistillerSnippetsAgent: vi.fn().mockImplementation(() => ({
    harvest: vi.fn().mockResolvedValue({ candidates: [], meta: { cli: "c", model: "o", durationMs: 1 } }),
  })),
  StyleDistillerComposerAgent: vi.fn().mockImplementation(() => ({
    compose: vi.fn().mockResolvedValue({ kbMd: "---\n---\n#x", meta: { cli: "c", model: "o", durationMs: 1 } }),
  })),
}));

import { runDistill } from "../../src/style-distiller/orchestrator.js";

function makeDb(dir: string, account: string): string {
  const p = join(dir, "refs.sqlite");
  const db = new Database(p);
  db.exec(`CREATE TABLE ref_articles (id TEXT PRIMARY KEY, account TEXT, title TEXT, author TEXT, published_at TEXT, url TEXT, summary TEXT, md_path TEXT, topics_core_json TEXT, topics_fine_json TEXT, body_plain TEXT, word_count INT, is_original INT)`);
  const ins = db.prepare(`INSERT INTO ref_articles VALUES (@id,@account,@title,'',@pub,'','','','[]','[]',@body,@wc,1)`);
  for (let i = 0; i < 30; i += 1) {
    const m = String((i % 12) + 1).padStart(2, "0");
    ins.run({ id: `${account}_${i}`, account, title: `T${i}`, pub: `2025-${m}-01`, body: `正文${i}`, wc: 500 + i });
  }
  db.close();
  return p;
}

describe("orchestrator error path", () => {
  let vault: string;
  let sqlitePath: string;
  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), "sp06-err-"));
    mkdirSync(join(vault, "08_experts", "style-panel"), { recursive: true });
    mkdirSync(join(vault, ".index"), { recursive: true });
    sqlitePath = makeDb(join(vault, ".index"), "X");
  });

  it("emits step_failed and throws; quant.json is preserved", async () => {
    const events: any[] = [];
    await expect(
      runDistill({ account: "X", sampleSize: 20, onEvent: (ev) => events.push(ev) }, { vaultPath: vault, sqlitePath }),
    ).rejects.toThrow(/boom-structure/);
    expect(existsSync(join(vault, ".distill", "X", "quant.json"))).toBe(true);
    expect(existsSync(join(vault, "08_experts", "style-panel", "X_kb.md"))).toBe(false);
    const failEv = events.find((e) => e.phase === "failed");
    expect(failEv).toBeTruthy();
    expect(failEv.step).toBe("structure");
    expect(failEv.error).toContain("boom-structure");
  });

  it("throws when no articles in date range", async () => {
    await expect(
      runDistill({ account: "NONE", sampleSize: 20 }, { vaultPath: vault, sqlitePath }),
    ).rejects.toThrow(/no articles/);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/style-distiller/orchestrator-errors.test.ts
```

- [ ] **Step 3: Implement**

Modify `packages/kb/src/style-distiller/orchestrator.ts` — wrap each step in try/catch and emit `failed` event before rethrow. Replace the four step blocks with this pattern (example for structure; apply same shape to quant/snippets/composer):

```ts
if (runStructure) {
  const started = Date.now();
  emit(onEvent, { step: "structure", phase: "started", account });
  try {
    const cliModel = cliModelPerStep?.structure ?? { cli: "claude" as const, model: "opus" };
    const agent = new StyleDistillerStructureAgent(cliModel);
    const out = await agent.distill({
      account,
      samples: deepReadSamples.map((s) => ({ id: s.id, title: s.title, published_at: s.published_at, word_count: s.word_count, body_plain: s.body_plain })),
      quantSummary: quantSummary(quant!),
    });
    writeFileSync(join(distillDir, "structure.md"), out.text, "utf-8");
    stepsRun.push("structure");
    emit(onEvent, { step: "structure", phase: "completed", account, duration_ms: Date.now() - started, stats: { bytes: out.text.length } });
  } catch (err) {
    emit(onEvent, { step: "structure", phase: "failed", account, duration_ms: Date.now() - started, error: (err as Error).message });
    throw err;
  }
}
```

Apply the same wrapping to `runQuant`, `runSnippets`, `runComposer` blocks: `try { ... existing body ...; stepsRun.push(...); emit completed } catch (err) { emit failed with step=X; throw err }`.

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/style-distiller/
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/kb/src/style-distiller/orchestrator.ts packages/kb/tests/style-distiller/orchestrator-errors.test.ts && git -c commit.gpgsign=false commit -m "feat(kb): SP-06 orchestrator per-step try/catch with failed event"
```

---

### Task 9: CLI list-accounts

**Files:**
- Modify: `packages/kb/src/cli.ts`
- Create: `packages/kb/tests/cli/list-accounts.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/kb/tests/cli/list-accounts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { buildCli } from "../../src/cli.js";

function makeConfig(tmp: string): string {
  const sqlitePath = join(tmp, "refs.sqlite");
  const vaultPath = join(tmp, "vault");
  mkdirSync(vaultPath, { recursive: true });
  const db = new Database(sqlitePath);
  db.exec(`CREATE TABLE ref_articles (id TEXT PRIMARY KEY, account TEXT, title TEXT, author TEXT, published_at TEXT, url TEXT, summary TEXT, md_path TEXT, topics_core_json TEXT, topics_fine_json TEXT, body_plain TEXT, word_count INT, is_original INT)`);
  const ins = db.prepare(`INSERT INTO ref_articles VALUES (@id,@account,@t,'',@p,'','','','[]','[]','',100,1)`);
  ins.run({ id: "a1", account: "A", t: "t", p: "2025-01-01" });
  ins.run({ id: "a2", account: "A", t: "t", p: "2025-06-01" });
  ins.run({ id: "b1", account: "B", t: "t", p: "2025-02-01" });
  db.close();
  const cfg = join(tmp, "config.json");
  writeFileSync(cfg, JSON.stringify({ sqlitePath, vaultPath }), "utf-8");
  return cfg;
}

describe("CLI list-accounts", () => {
  it("prints account count + date range as JSON with --json", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "sp06-cli-"));
    const cfg = makeConfig(tmp);
    const program = buildCli();
    program.exitOverride();
    let out = "";
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout as any).write = (s: string) => { out += s; return true; };
    try {
      await program.parseAsync(["node", "crossing-kb", "list-accounts", "-c", cfg, "--json"]);
    } finally {
      (process.stdout as any).write = origWrite;
    }
    const parsed = JSON.parse(out);
    expect(parsed).toHaveLength(2);
    const a = parsed.find((r: any) => r.account === "A");
    expect(a.count).toBe(2);
    expect(a.earliest_published_at).toBe("2025-01-01");
    expect(a.latest_published_at).toBe("2025-06-01");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/cli/list-accounts.test.ts
```

- [ ] **Step 3: Implement**

Modify `packages/kb/src/cli.ts` — add `list-accounts` subcommand before the `return program` line:

```ts
import Database from "better-sqlite3";

  program.command("list-accounts")
    .description("list accounts present in refs.sqlite with counts and date ranges")
    .option("-c, --config <path>", "config.json path", "config.json")
    .option("--json", "output JSON array")
    .action((opts) => {
      const cfg = loadConfig(opts.config);
      const db = new Database(cfg.sqlitePath, { readonly: true, fileMustExist: true });
      try {
        const rows = db.prepare(
          `SELECT account, COUNT(*) AS count, MIN(published_at) AS earliest_published_at, MAX(published_at) AS latest_published_at
           FROM ref_articles GROUP BY account ORDER BY count DESC`,
        ).all() as Array<{ account: string; count: number; earliest_published_at: string; latest_published_at: string }>;
        if (opts.json) {
          process.stdout.write(JSON.stringify(rows, null, 2));
          return;
        }
        for (const r of rows) {
          process.stdout.write(
            `${r.account}\t${r.count}\t${r.earliest_published_at} ~ ${r.latest_published_at}\n`,
          );
        }
      } finally {
        db.close();
      }
    });
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/cli/list-accounts.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/kb/src/cli.ts packages/kb/tests/cli/list-accounts.test.ts && git -c commit.gpgsign=false commit -m "feat(kb): CLI list-accounts subcommand"
```

---

### Task 10: CLI distill-style

**Files:**
- Modify: `packages/kb/src/cli.ts`
- Create: `packages/kb/tests/cli/distill-style.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/kb/tests/cli/distill-style.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const runDistillMock = vi.fn();
vi.mock("../../src/style-distiller/orchestrator.js", () => ({
  runDistill: (opts: any, ctx: any) => runDistillMock(opts, ctx),
}));

import { buildCli } from "../../src/cli.js";

function makeConfig(tmp: string): string {
  const sqlitePath = join(tmp, "refs.sqlite");
  const vaultPath = join(tmp, "vault");
  mkdirSync(vaultPath, { recursive: true });
  const db = new Database(sqlitePath);
  db.exec(`CREATE TABLE ref_articles (id TEXT PRIMARY KEY, account TEXT, title TEXT, author TEXT, published_at TEXT, url TEXT, summary TEXT, md_path TEXT, topics_core_json TEXT, topics_fine_json TEXT, body_plain TEXT, word_count INT, is_original INT)`);
  db.close();
  const cfg = join(tmp, "config.json");
  writeFileSync(cfg, JSON.stringify({ sqlitePath, vaultPath }), "utf-8");
  return cfg;
}

describe("CLI distill-style", () => {
  beforeEach(() => { runDistillMock.mockReset(); });

  it("passes flags (sample-size / since / until / only-step / dry-run / model overrides) to orchestrator", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "sp06-cli2-"));
    const cfg = makeConfig(tmp);
    runDistillMock.mockImplementation(async (opts: any) => {
      (opts.onEvent ?? (() => {}))({ step: "quant", phase: "started", account: opts.account });
      (opts.onEvent ?? (() => {}))({ step: "quant", phase: "completed", account: opts.account, stats: { article_count: 10, source_pool: 50 } });
      return { account: opts.account, kb_path: "/tmp/x_kb.md", sample_size_actual: 10, steps_run: ["quant"] };
    });
    const program = buildCli();
    program.exitOverride();
    let out = "";
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout as any).write = (s: string) => { out += s; return true; };
    try {
      await program.parseAsync([
        "node", "crossing-kb", "distill-style", "赛博禅心",
        "-c", cfg,
        "--sample-size", "50",
        "--since", "2025-01-01",
        "--until", "2026-04-01",
        "--only-step", "quant",
        "--structure-cli", "codex",
        "--snippets-model", "haiku",
        "--composer-cli", "claude",
        "--composer-model", "opus",
      ]);
    } finally {
      (process.stdout as any).write = origWrite;
    }
    expect(runDistillMock).toHaveBeenCalled();
    const call = runDistillMock.mock.calls[0];
    expect(call[0].account).toBe("赛博禅心");
    expect(call[0].sampleSize).toBe(50);
    expect(call[0].since).toBe("2025-01-01");
    expect(call[0].until).toBe("2026-04-01");
    expect(call[0].onlyStep).toBe("quant");
    expect(call[0].cliModelPerStep.structure.cli).toBe("codex");
    expect(call[0].cliModelPerStep.snippets.model).toBe("haiku");
    expect(call[0].cliModelPerStep.composer.cli).toBe("claude");
    expect(call[0].cliModelPerStep.composer.model).toBe("opus");
    expect(out).toContain("[1/4] quant-analyzer");
    expect(out).toContain("/tmp/x_kb.md");
  });

  it("--dry-run sets dryRun=true", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "sp06-cli3-"));
    const cfg = makeConfig(tmp);
    runDistillMock.mockResolvedValue({ account: "x", kb_path: "", sample_size_actual: 5, steps_run: ["quant"] });
    const program = buildCli();
    program.exitOverride();
    await program.parseAsync(["node", "crossing-kb", "distill-style", "x", "-c", cfg, "--dry-run"]);
    expect(runDistillMock.mock.calls[0]![0].dryRun).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/cli/distill-style.test.ts
```

- [ ] **Step 3: Implement**

Modify `packages/kb/src/cli.ts` — import orchestrator at top, then add subcommand:

```ts
import { runDistill } from "./style-distiller/orchestrator.js";
import type { DistillStep, DistillStepEvent } from "./style-distiller/types.js";

  program.command("distill-style <account>")
    .description("distill style panel for an account via 4-step pipeline")
    .option("-c, --config <path>", "config.json path", "config.json")
    .option("--sample-size <n>", "sample size", "200")
    .option("--since <date>", "published_at >= YYYY-MM-DD")
    .option("--until <date>", "published_at <= YYYY-MM-DD")
    .option("--only-step <step>", "quant|structure|snippets|composer")
    .option("--dry-run", "only run quant step, do not write kb.md")
    .option("--structure-cli <cli>", "claude|codex for structure step")
    .option("--structure-model <m>", "model for structure step")
    .option("--snippets-cli <cli>", "claude|codex for snippets step")
    .option("--snippets-model <m>", "model for snippets step")
    .option("--composer-cli <cli>", "claude|codex for composer step")
    .option("--composer-model <m>", "model for composer step")
    .action(async (account: string, opts) => {
      const cfg = loadConfig(opts.config);
      const onlyStep = opts.onlyStep as DistillStep | undefined;
      if (onlyStep && !["quant","structure","snippets","composer"].includes(onlyStep)) {
        process.stderr.write(`invalid --only-step: ${onlyStep}\n`); process.exit(1);
      }
      const cliModelPerStep: Record<string, { cli: "claude" | "codex"; model?: string }> = {};
      if (opts.structureCli || opts.structureModel) cliModelPerStep.structure = { cli: (opts.structureCli as "claude" | "codex") ?? "claude", model: opts.structureModel };
      if (opts.snippetsCli || opts.snippetsModel) cliModelPerStep.snippets = { cli: (opts.snippetsCli as "claude" | "codex") ?? "claude", model: opts.snippetsModel };
      if (opts.composerCli || opts.composerModel) cliModelPerStep.composer = { cli: (opts.composerCli as "claude" | "codex") ?? "claude", model: opts.composerModel };

      const stepNames: Record<DistillStep, string> = {
        quant: "[1/4] quant-analyzer",
        structure: "[2/4] structure-distiller",
        snippets: "[3/4] snippet-harvester",
        composer: "[4/4] composer",
      };
      const t0 = Date.now();
      const onEvent = (ev: DistillStepEvent) => {
        if (ev.phase === "started") {
          process.stdout.write(`${stepNames[ev.step]}\n  → running...\n`);
        } else if (ev.phase === "batch_progress" && ev.stats) {
          process.stdout.write(`  → batch ${ev.stats.batch}/${ev.stats.total_batches}: ${ev.stats.candidates_so_far} candidates\n`);
        } else if (ev.phase === "completed") {
          const stats = ev.stats ?? {};
          const parts = Object.entries(stats).map(([k, v]) => `${k}=${v}`).join(" ");
          process.stdout.write(`  → done (${Math.round((ev.duration_ms ?? 0) / 1000)}s) ${parts}\n`);
        } else if (ev.phase === "failed") {
          process.stdout.write(`  → FAILED: ${ev.error}\n`);
        }
      };
      try {
        const result = await runDistill({
          account,
          sampleSize: parseInt(opts.sampleSize, 10),
          since: opts.since,
          until: opts.until,
          onlyStep,
          dryRun: !!opts.dryRun,
          cliModelPerStep: Object.keys(cliModelPerStep).length ? cliModelPerStep : undefined,
          onEvent,
        }, { vaultPath: cfg.vaultPath, sqlitePath: cfg.sqlitePath });
        process.stdout.write(`Total: ${Math.round((Date.now() - t0) / 1000)}s\n`);
        if (result.kb_path) process.stdout.write(`${result.kb_path}\n`);
      } catch (err) {
        process.stderr.write(`distill failed: ${(err as Error).message}\n`);
        process.exit(1);
      }
    });
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/cli/distill-style.test.ts && pnpm test
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/kb/src/cli.ts packages/kb/tests/cli/distill-style.test.ts && git -c commit.gpgsign=false commit -m "feat(kb): CLI distill-style subcommand with flag passthrough"
```

---

### Task 11: GET /api/kb/accounts

**Files:**
- Create: `packages/web-server/src/routes/kb-accounts.ts`
- Create: `packages/web-server/tests/routes-kb-accounts.test.ts`
- Modify: `packages/web-server/src/server.ts`

- [ ] **Step 1: Write failing test**

Create `packages/web-server/tests/routes-kb-accounts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import Database from "better-sqlite3";
import { registerKbAccountsRoutes } from "../src/routes/kb-accounts.js";

function makeDb(dir: string): string {
  const p = join(dir, "refs.sqlite");
  const db = new Database(p);
  db.exec(`CREATE TABLE ref_articles (id TEXT PRIMARY KEY, account TEXT, title TEXT, author TEXT, published_at TEXT, url TEXT, summary TEXT, md_path TEXT, topics_core_json TEXT, topics_fine_json TEXT, body_plain TEXT, word_count INT, is_original INT)`);
  const ins = db.prepare(`INSERT INTO ref_articles VALUES (@id,@account,'t','',@p,'','','','[]','[]','',100,1)`);
  ins.run({ id: "a1", account: "A", p: "2025-01-01" });
  ins.run({ id: "a2", account: "A", p: "2025-06-01" });
  ins.run({ id: "b1", account: "B", p: "2025-03-15" });
  db.close();
  return p;
}

describe("GET /api/kb/accounts", () => {
  it("returns accounts with count + date range, sorted by count desc", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "sp06-acc-"));
    const sqlitePath = makeDb(tmp);
    const app = Fastify();
    registerKbAccountsRoutes(app, { sqlitePath });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/kb/accounts" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ account: string; count: number; earliest_published_at: string; latest_published_at: string }>;
    expect(body[0]!.account).toBe("A");
    expect(body[0]!.count).toBe(2);
    expect(body[0]!.earliest_published_at).toBe("2025-01-01");
    expect(body[0]!.latest_published_at).toBe("2025-06-01");
    expect(body[1]!.account).toBe("B");
  });

  it("returns empty array when sqlite missing", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "sp06-acc-empty-"));
    const app = Fastify();
    registerKbAccountsRoutes(app, { sqlitePath: join(tmp, "does-not-exist.sqlite") });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/kb/accounts" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/routes-kb-accounts.test.ts
```

- [ ] **Step 3: Implement**

Create `packages/web-server/src/routes/kb-accounts.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";

export interface KbAccountsDeps {
  sqlitePath: string;
}

export interface AccountRow {
  account: string;
  count: number;
  earliest_published_at: string;
  latest_published_at: string;
}

export function registerKbAccountsRoutes(app: FastifyInstance, deps: KbAccountsDeps) {
  app.get("/api/kb/accounts", async (_req, reply) => {
    if (!existsSync(deps.sqlitePath)) return reply.send([]);
    const db = new Database(deps.sqlitePath, { readonly: true, fileMustExist: true });
    try {
      const rows = db.prepare(
        `SELECT account, COUNT(*) AS count, MIN(published_at) AS earliest_published_at, MAX(published_at) AS latest_published_at
         FROM ref_articles GROUP BY account ORDER BY count DESC`,
      ).all() as AccountRow[];
      return reply.send(rows);
    } finally {
      db.close();
    }
  });
}
```

Modify `packages/web-server/src/server.ts` — import and mount near other route registrations:

```ts
import { registerKbAccountsRoutes } from "./routes/kb-accounts.js";
// inside buildServer(), after other registers:
registerKbAccountsRoutes(app, { sqlitePath });
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/routes-kb-accounts.test.ts && pnpm test
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/web-server/src/routes/kb-accounts.ts packages/web-server/src/server.ts packages/web-server/tests/routes-kb-accounts.test.ts && git -c commit.gpgsign=false commit -m "feat(web-server): GET /api/kb/accounts"
```

---

### Task 12: POST /api/kb/style-panels/:account/distill (SSE)

**Files:**
- Modify: `packages/web-server/src/routes/kb-style-panels.ts`
- Create: `packages/web-server/tests/routes-kb-style-panels-distill.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/web-server/tests/routes-kb-style-panels-distill.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import Database from "better-sqlite3";

const runDistillMock = vi.fn();
vi.mock("@crossing/kb", () => ({
  runDistill: (opts: any, ctx: any) => runDistillMock(opts, ctx),
}));

import { registerKbStylePanelsRoutes } from "../src/routes/kb-style-panels.js";

function seed() {
  const vault = mkdtempSync(join(tmpdir(), "sp06-distill-"));
  mkdirSync(join(vault, "08_experts", "style-panel"), { recursive: true });
  mkdirSync(join(vault, ".index"), { recursive: true });
  const sqlitePath = join(vault, ".index", "refs.sqlite");
  const db = new Database(sqlitePath);
  db.exec(`CREATE TABLE ref_articles (id TEXT PRIMARY KEY, account TEXT, title TEXT, author TEXT, published_at TEXT, url TEXT, summary TEXT, md_path TEXT, topics_core_json TEXT, topics_fine_json TEXT, body_plain TEXT, word_count INT, is_original INT)`);
  const ins = db.prepare(`INSERT INTO ref_articles VALUES (@id,'赛博禅心','t','',@p,'','','','[]','[]','',100,1)`);
  for (let i = 0; i < 30; i += 1) ins.run({ id: `a${i}`, p: `2025-0${(i % 9) + 1}-01` });
  db.close();
  return { vault, sqlitePath };
}

describe("POST /api/kb/style-panels/:account/distill", () => {
  beforeEach(() => { runDistillMock.mockReset(); });

  it("404 when account not in refs.sqlite", async () => {
    const { vault, sqlitePath } = seed();
    const app = Fastify();
    registerKbStylePanelsRoutes(app, { vaultPath: vault, sqlitePath });
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/kb/style-panels/UNKNOWN/distill", payload: { sample_size: 20 } });
    expect(res.statusCode).toBe(404);
  });

  it("400 when since > until", async () => {
    const { vault, sqlitePath } = seed();
    const app = Fastify();
    registerKbStylePanelsRoutes(app, { vaultPath: vault, sqlitePath });
    await app.ready();
    const res = await app.inject({
      method: "POST", url: "/api/kb/style-panels/赛博禅心/distill",
      payload: { sample_size: 20, since: "2026-01-01", until: "2025-01-01" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 when sample_size < 20", async () => {
    const { vault, sqlitePath } = seed();
    const app = Fastify();
    registerKbStylePanelsRoutes(app, { vaultPath: vault, sqlitePath });
    await app.ready();
    const res = await app.inject({
      method: "POST", url: "/api/kb/style-panels/赛博禅心/distill", payload: { sample_size: 5 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 when only_step invalid", async () => {
    const { vault, sqlitePath } = seed();
    const app = Fastify();
    registerKbStylePanelsRoutes(app, { vaultPath: vault, sqlitePath });
    await app.ready();
    const res = await app.inject({
      method: "POST", url: "/api/kb/style-panels/赛博禅心/distill", payload: { sample_size: 20, only_step: "bogus" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("streams SSE events ending with all_completed", async () => {
    const { vault, sqlitePath } = seed();
    runDistillMock.mockImplementation(async (opts: any) => {
      opts.onEvent({ step: "quant", phase: "started", account: opts.account });
      opts.onEvent({ step: "quant", phase: "completed", account: opts.account, duration_ms: 10, stats: { article_count: 20 } });
      return { account: opts.account, kb_path: "/tmp/x.md", sample_size_actual: 20, steps_run: ["quant", "structure", "snippets", "composer"] };
    });
    const app = Fastify();
    registerKbStylePanelsRoutes(app, { vaultPath: vault, sqlitePath });
    await app.ready();
    const res = await app.inject({
      method: "POST", url: "/api/kb/style-panels/赛博禅心/distill", payload: { sample_size: 20 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.body).toContain("event: distill.step_started");
    expect(res.body).toContain("event: distill.step_completed");
    expect(res.body).toContain("event: distill.all_completed");
    expect(res.body).toContain("/tmp/x.md");
  });

  it("emits step_failed when orchestrator throws", async () => {
    const { vault, sqlitePath } = seed();
    runDistillMock.mockImplementation(async (opts: any) => {
      opts.onEvent({ step: "structure", phase: "failed", account: opts.account, error: "boom" });
      throw new Error("boom");
    });
    const app = Fastify();
    registerKbStylePanelsRoutes(app, { vaultPath: vault, sqlitePath });
    await app.ready();
    const res = await app.inject({
      method: "POST", url: "/api/kb/style-panels/赛博禅心/distill", payload: { sample_size: 20 },
    });
    expect(res.body).toContain("event: distill.step_failed");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/routes-kb-style-panels-distill.test.ts
```

- [ ] **Step 3: Implement**

Modify `packages/web-server/src/routes/kb-style-panels.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { runDistill, type DistillStep, type DistillStepEvent } from "@crossing/kb";

export interface KbStylePanelsDeps {
  vaultPath: string;
  sqlitePath: string;
}

export interface StylePanelEntry {
  id: string;
  path: string;
  last_updated_at: string;
}

interface DistillBody {
  sample_size?: number;
  since?: string;
  until?: string;
  only_step?: string;
  cli_model_per_step?: Partial<Record<"structure" | "snippets" | "composer", { cli: "claude" | "codex"; model?: string }>>;
}

function countAccount(sqlitePath: string, account: string, since?: string, until?: string): number {
  if (!existsSync(sqlitePath)) return 0;
  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  try {
    const where: string[] = ["account = @a"];
    const params: Record<string, unknown> = { a: account };
    if (since) { where.push("published_at >= @s"); params.s = since; }
    if (until) { where.push("published_at <= @u"); params.u = until; }
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ref_articles WHERE ${where.join(" AND ")}`).get(params) as { c: number };
    return row.c;
  } finally {
    db.close();
  }
}

export function registerKbStylePanelsRoutes(app: FastifyInstance, deps: KbStylePanelsDeps) {
  app.get("/api/kb/style-panels", async (_req, reply) => {
    const dir = join(deps.vaultPath, "08_experts", "style-panel");
    if (!existsSync(dir)) return reply.send([]);
    const entries: StylePanelEntry[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".md")) continue;
      const abs = join(dir, name);
      const st = statSync(abs);
      entries.push({ id: name.slice(0, -3), path: abs, last_updated_at: st.mtime.toISOString() });
    }
    entries.sort((a, b) => a.id.localeCompare(b.id));
    return reply.send(entries);
  });

  app.post<{ Params: { account: string }; Body: DistillBody }>(
    "/api/kb/style-panels/:account/distill",
    async (req, reply) => {
      const account = decodeURIComponent(req.params.account);
      const body = req.body ?? {};
      const sampleSize = body.sample_size ?? 200;
      if (!Number.isInteger(sampleSize) || sampleSize < 20) {
        return reply.code(400).send({ error: "sample_size must be integer >= 20" });
      }
      if (body.since && body.until && body.since > body.until) {
        return reply.code(400).send({ error: "since must be <= until" });
      }
      if (body.only_step && !["quant", "structure", "snippets", "composer"].includes(body.only_step)) {
        return reply.code(400).send({ error: `invalid only_step: ${body.only_step}` });
      }
      const totalInRange = countAccount(deps.sqlitePath, account, body.since, body.until);
      if (totalInRange === 0) {
        return reply.code(404).send({ error: `account not found or empty in date range: ${account}` });
      }
      if (totalInRange < 20) {
        return reply.code(400).send({ error: `only ${totalInRange} articles in range (need >= 20)` });
      }

      reply.raw.setHeader("Content-Type", "text/event-stream");
      reply.raw.setHeader("Cache-Control", "no-cache");
      reply.raw.setHeader("Connection", "keep-alive");
      reply.hijack();

      const send = (type: string, data: Record<string, unknown>) => {
        reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      const onEvent = (ev: DistillStepEvent) => {
        if (ev.phase === "started") send("distill.step_started", { step: ev.step, account: ev.account });
        else if (ev.phase === "batch_progress") send("distill.batch_progress", { step: ev.step, ...ev.stats });
        else if (ev.phase === "completed") send("distill.step_completed", { step: ev.step, duration_ms: ev.duration_ms, stats: ev.stats });
        else if (ev.phase === "failed") send("distill.step_failed", { step: ev.step, error: ev.error });
      };

      try {
        const result = await runDistill({
          account,
          sampleSize,
          since: body.since,
          until: body.until,
          onlyStep: body.only_step as DistillStep | undefined,
          cliModelPerStep: body.cli_model_per_step,
          onEvent,
        }, { vaultPath: deps.vaultPath, sqlitePath: deps.sqlitePath });
        send("distill.all_completed", {
          account: result.account, kb_path: result.kb_path, sample_size_actual: result.sample_size_actual, steps_run: result.steps_run,
        });
      } catch (err) {
        send("distill.step_failed", { step: "unknown", error: (err as Error).message });
      } finally {
        reply.raw.end();
      }
    },
  );
}
```

Update `packages/web-server/src/server.ts` call site so `registerKbStylePanelsRoutes(app, { vaultPath, sqlitePath })` now passes `sqlitePath`.

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/routes-kb-style-panels-distill.test.ts && pnpm test
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/web-server/src/routes/kb-style-panels.ts packages/web-server/src/server.ts packages/web-server/tests/routes-kb-style-panels-distill.test.ts && git -c commit.gpgsign=false commit -m "feat(web-server): POST /api/kb/style-panels/:account/distill SSE"
```

---

### Task 13: style-panels-client

**Files:**
- Create: `packages/web-ui/src/api/style-panels-client.ts`
- Create: `packages/web-ui/tests/api/style-panels-client.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/web-ui/tests/api/style-panels-client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAccounts, listStylePanels, startDistillStream } from "../../src/api/style-panels-client.js";

function sseBody(events: Array<{ type: string; data: any }>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(ctrl) {
      for (const e of events) ctrl.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`));
      ctrl.close();
    },
  });
}

describe("style-panels-client", () => {
  beforeEach(() => { (globalThis as any).fetch = vi.fn(); });

  it("getAccounts GETs /api/kb/accounts and returns JSON", async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => [{ account: "A", count: 10, earliest_published_at: "2025-01-01", latest_published_at: "2025-12-01" }] });
    const rows = await getAccounts();
    expect(rows[0]!.account).toBe("A");
    expect((fetch as any).mock.calls[0]![0]).toBe("/api/kb/accounts");
  });

  it("listStylePanels GETs /api/kb/style-panels", async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => [{ id: "X", path: "/x.md", last_updated_at: "2026-01-01T00:00:00Z" }] });
    const rows = await listStylePanels();
    expect(rows[0]!.id).toBe("X");
  });

  it("startDistillStream POSTs and parses SSE events", async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      body: sseBody([
        { type: "distill.step_started", data: { step: "quant", account: "X" } },
        { type: "distill.step_completed", data: { step: "quant", duration_ms: 100 } },
        { type: "distill.all_completed", data: { account: "X", kb_path: "/x.md", sample_size_actual: 20, steps_run: ["quant"] } },
      ]),
    });
    const events: any[] = [];
    await startDistillStream("X", { sample_size: 20 }, (ev) => events.push(ev));
    expect(events.map((e) => e.type)).toEqual([
      "distill.step_started", "distill.step_completed", "distill.all_completed",
    ]);
    expect(events[2]!.data.kb_path).toBe("/x.md");
    const call = (fetch as any).mock.calls[0];
    expect(call[0]).toBe("/api/kb/style-panels/X/distill");
    expect(call[1].method).toBe("POST");
    expect(call[1].body).toContain("sample_size");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test tests/api/style-panels-client.test.ts
```

- [ ] **Step 3: Implement**

Create `packages/web-ui/src/api/style-panels-client.ts`:

```ts
export interface AccountRow {
  account: string;
  count: number;
  earliest_published_at: string;
  latest_published_at: string;
}

export interface StylePanelEntry {
  id: string;
  path: string;
  last_updated_at: string;
}

export interface DistillBody {
  sample_size?: number;
  since?: string;
  until?: string;
  only_step?: "quant" | "structure" | "snippets" | "composer";
  cli_model_per_step?: Partial<Record<"structure" | "snippets" | "composer", { cli: "claude" | "codex"; model?: string }>>;
}

async function fetchOk(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${init?.method ?? "GET"} ${input} → ${res.status}: ${text}`);
  }
  return res;
}

export async function getAccounts(): Promise<AccountRow[]> {
  const res = await fetchOk(`/api/kb/accounts`);
  return res.json();
}

export async function listStylePanels(): Promise<StylePanelEntry[]> {
  const res = await fetchOk(`/api/kb/style-panels`);
  return res.json();
}

export async function startDistillStream(
  account: string,
  body: DistillBody,
  onEvent: (ev: { type: string; data: any }) => void,
): Promise<void> {
  const res = await fetch(`/api/kb/style-panels/${encodeURIComponent(account)}/distill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`distill start failed: ${res.status}: ${text}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const eventMatch = /^event:\s*(.+)$/m.exec(raw);
      const dataMatch = /^data:\s*(.*)$/m.exec(raw);
      if (eventMatch && dataMatch) {
        try { onEvent({ type: eventMatch[1]!.trim(), data: JSON.parse(dataMatch[1]!) }); }
        catch { onEvent({ type: eventMatch[1]!.trim(), data: dataMatch[1]! }); }
      }
    }
  }
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test tests/api/style-panels-client.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/web-ui/src/api/style-panels-client.ts packages/web-ui/tests/api/style-panels-client.test.ts && git -c commit.gpgsign=false commit -m "feat(web-ui): style-panels-client (accounts + distill SSE)"
```

---

### Task 14: StylePanelsPage + list components

**Files:**
- Create: `packages/web-ui/src/components/style-panels/StylePanelList.tsx`
- Create: `packages/web-ui/src/components/style-panels/AccountCandidateList.tsx`
- Create: `packages/web-ui/src/pages/StylePanelsPage.tsx`
- Create: `packages/web-ui/tests/components/style-panels/StylePanelList.test.tsx`
- Create: `packages/web-ui/tests/components/style-panels/AccountCandidateList.test.tsx`
- Modify: `packages/web-ui/src/App.tsx`

- [ ] **Step 1: Write failing test**

Create `packages/web-ui/tests/components/style-panels/StylePanelList.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StylePanelList } from "../../../src/components/style-panels/StylePanelList.js";

describe("StylePanelList", () => {
  it("renders distilled panels with id + last_updated_at + redistill button", () => {
    render(
      <StylePanelList
        panels={[
          { id: "十字路口Crossing", path: "/x.md", last_updated_at: "2026-04-10T00:00:00Z" },
          { id: "赛博禅心", path: "/y.md", last_updated_at: "2026-04-13T00:00:00Z" },
        ]}
        onRedistill={() => {}}
      />,
    );
    expect(screen.getByText("十字路口Crossing")).toBeInTheDocument();
    expect(screen.getByText("赛博禅心")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /重新蒸馏/ })).toHaveLength(2);
  });

  it("shows empty state when no panels", () => {
    render(<StylePanelList panels={[]} onRedistill={() => {}} />);
    expect(screen.getByText(/尚未蒸馏/)).toBeInTheDocument();
  });
});
```

Create `packages/web-ui/tests/components/style-panels/AccountCandidateList.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AccountCandidateList } from "../../../src/components/style-panels/AccountCandidateList.js";

describe("AccountCandidateList", () => {
  it("filters out already-distilled accounts and shows candidates", () => {
    render(
      <AccountCandidateList
        accounts={[
          { account: "量子位", count: 1982, earliest_published_at: "2024-09-01", latest_published_at: "2026-04-01" },
          { account: "赛博禅心", count: 1229, earliest_published_at: "2023-11-01", latest_published_at: "2026-04-01" },
        ]}
        distilledIds={new Set(["赛博禅心"])}
        onDistill={() => {}}
      />,
    );
    expect(screen.getByText("量子位")).toBeInTheDocument();
    expect(screen.queryByText("赛博禅心")).not.toBeInTheDocument();
  });

  it("calls onDistill(account) when 蒸馏 button clicked", () => {
    const cb = vi.fn();
    render(
      <AccountCandidateList
        accounts={[{ account: "量子位", count: 10, earliest_published_at: "2024-09-01", latest_published_at: "2026-04-01" }]}
        distilledIds={new Set()}
        onDistill={cb}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /蒸馏/ }));
    expect(cb).toHaveBeenCalledWith("量子位");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test tests/components/style-panels/
```

- [ ] **Step 3: Implement**

Create `packages/web-ui/src/components/style-panels/StylePanelList.tsx`:

```tsx
import type { StylePanelEntry } from "../../api/style-panels-client.js";

export interface StylePanelListProps {
  panels: StylePanelEntry[];
  onRedistill: (id: string) => void;
}

export function StylePanelList({ panels, onRedistill }: StylePanelListProps) {
  if (panels.length === 0) {
    return <div className="empty">尚未蒸馏任何风格面板</div>;
  }
  return (
    <ul className="style-panel-list">
      {panels.map((p) => (
        <li key={p.id}>
          <span className="id">{p.id}</span>
          <span className="date">{p.last_updated_at.slice(0, 10)}</span>
          <button type="button" onClick={() => onRedistill(p.id)}>重新蒸馏</button>
        </li>
      ))}
    </ul>
  );
}
```

Create `packages/web-ui/src/components/style-panels/AccountCandidateList.tsx`:

```tsx
import type { AccountRow } from "../../api/style-panels-client.js";

export interface AccountCandidateListProps {
  accounts: AccountRow[];
  distilledIds: Set<string>;
  onDistill: (account: string) => void;
}

export function AccountCandidateList({ accounts, distilledIds, onDistill }: AccountCandidateListProps) {
  const candidates = accounts.filter((a) => !distilledIds.has(a.account));
  if (candidates.length === 0) return <div className="empty">所有账号都已蒸馏</div>;
  return (
    <ul className="account-candidate-list">
      {candidates.map((a) => (
        <li key={a.account}>
          <span className="account">{a.account}</span>
          <span className="count">{a.count} 篇</span>
          <span className="range">{a.earliest_published_at.slice(0, 7)} ~ {a.latest_published_at.slice(0, 7)}</span>
          <button type="button" onClick={() => onDistill(a.account)}>蒸馏</button>
        </li>
      ))}
    </ul>
  );
}
```

Create `packages/web-ui/src/pages/StylePanelsPage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { getAccounts, listStylePanels, type AccountRow, type StylePanelEntry } from "../api/style-panels-client.js";
import { StylePanelList } from "../components/style-panels/StylePanelList.js";
import { AccountCandidateList } from "../components/style-panels/AccountCandidateList.js";
import { DistillForm } from "../components/style-panels/DistillForm.js";
import { ProgressView } from "../components/style-panels/ProgressView.js";

type Mode = { kind: "list" } | { kind: "form"; account: string } | { kind: "progress"; account: string; body: import("../api/style-panels-client.js").DistillBody };

export function StylePanelsPage() {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [panels, setPanels] = useState<StylePanelEntry[]>([]);
  const [mode, setMode] = useState<Mode>({ kind: "list" });

  async function reload() {
    const [a, p] = await Promise.all([getAccounts(), listStylePanels()]);
    setAccounts(a);
    setPanels(p);
  }
  useEffect(() => { void reload(); }, []);

  const distilledIds = new Set(panels.map((p) => p.id));

  if (mode.kind === "form") {
    const row = accounts.find((a) => a.account === mode.account);
    return (
      <DistillForm
        account={mode.account}
        totalInRange={row?.count ?? 0}
        onCancel={() => setMode({ kind: "list" })}
        onSubmit={(body) => setMode({ kind: "progress", account: mode.account, body })}
      />
    );
  }
  if (mode.kind === "progress") {
    return (
      <ProgressView
        account={mode.account}
        body={mode.body}
        onDone={async () => { await reload(); setMode({ kind: "list" }); }}
      />
    );
  }
  return (
    <div className="style-panels-page">
      <h2>已蒸馏的面板</h2>
      <StylePanelList panels={panels} onRedistill={(id) => setMode({ kind: "form", account: id })} />
      <h2>待蒸馏</h2>
      <AccountCandidateList accounts={accounts} distilledIds={distilledIds} onDistill={(a) => setMode({ kind: "form", account: a })} />
    </div>
  );
}
```

Modify `packages/web-ui/src/App.tsx` to add a route (react-router). Add route path `/style-panels` rendering `<StylePanelsPage />` alongside existing routes. Example snippet to insert:

```tsx
import { StylePanelsPage } from "./pages/StylePanelsPage.js";
// inside <Routes>:
<Route path="/style-panels" element={<StylePanelsPage />} />
```

Also in `packages/web-ui/src/pages/ProjectList.tsx` header, add one `<a href="/style-panels">风格面板</a>` link.

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test tests/components/style-panels/
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/web-ui/src/components/style-panels/StylePanelList.tsx packages/web-ui/src/components/style-panels/AccountCandidateList.tsx packages/web-ui/src/pages/StylePanelsPage.tsx packages/web-ui/src/App.tsx packages/web-ui/src/pages/ProjectList.tsx packages/web-ui/tests/components/style-panels/StylePanelList.test.tsx packages/web-ui/tests/components/style-panels/AccountCandidateList.test.tsx && git -c commit.gpgsign=false commit -m "feat(web-ui): StylePanelsPage + StylePanelList + AccountCandidateList"
```

---

### Task 15: DistillForm + ProgressView

**Files:**
- Create: `packages/web-ui/src/components/style-panels/DistillForm.tsx`
- Create: `packages/web-ui/src/components/style-panels/ProgressView.tsx`
- Create: `packages/web-ui/tests/components/style-panels/DistillForm.test.tsx`
- Create: `packages/web-ui/tests/components/style-panels/ProgressView.test.tsx`

- [ ] **Step 1: Write failing test**

Create `packages/web-ui/tests/components/style-panels/DistillForm.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DistillForm } from "../../../src/components/style-panels/DistillForm.js";

describe("DistillForm", () => {
  it("submits with default sample_size=200 and chosen cli/model overrides", () => {
    const onSubmit = vi.fn();
    render(<DistillForm account="赛博禅心" totalInRange={1229} onCancel={() => {}} onSubmit={onSubmit} />);
    expect(screen.getByText(/赛博禅心/)).toBeInTheDocument();
    expect(screen.getByText(/1229/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/sample_size/i), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText(/since/i), { target: { value: "2025-01-01" } });
    fireEvent.change(screen.getByLabelText(/until/i), { target: { value: "2026-04-01" } });
    fireEvent.click(screen.getByRole("button", { name: /开始蒸馏/ }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ sample_size: 100, since: "2025-01-01", until: "2026-04-01" }));
  });

  it("rejects sample_size < 20", () => {
    const onSubmit = vi.fn();
    render(<DistillForm account="X" totalInRange={100} onCancel={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/sample_size/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /开始蒸馏/ }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/至少 20/)).toBeInTheDocument();
  });
});
```

Create `packages/web-ui/tests/components/style-panels/ProgressView.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ProgressView } from "../../../src/components/style-panels/ProgressView.js";

vi.mock("../../../src/api/style-panels-client.js", () => ({
  startDistillStream: vi.fn(),
}));
import { startDistillStream } from "../../../src/api/style-panels-client.js";

describe("ProgressView", () => {
  beforeEach(() => { (startDistillStream as any).mockReset(); });

  it("shows step-by-step log from SSE events and calls onDone on all_completed", async () => {
    (startDistillStream as any).mockImplementation(async (_account: string, _body: any, onEvent: any) => {
      onEvent({ type: "distill.step_started", data: { step: "quant" } });
      onEvent({ type: "distill.step_completed", data: { step: "quant", duration_ms: 100, stats: { article_count: 20 } } });
      onEvent({ type: "distill.all_completed", data: { account: "X", kb_path: "/x.md" } });
    });
    const onDone = vi.fn();
    render(<ProgressView account="X" body={{ sample_size: 20 }} onDone={onDone} />);
    await waitFor(() => expect(screen.getByText(/\[1\/4\] quant-analyzer/)).toBeInTheDocument());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("shows failed line when step_failed event arrives", async () => {
    (startDistillStream as any).mockImplementation(async (_a: string, _b: any, onEvent: any) => {
      onEvent({ type: "distill.step_started", data: { step: "structure" } });
      onEvent({ type: "distill.step_failed", data: { step: "structure", error: "boom" } });
    });
    render(<ProgressView account="X" body={{ sample_size: 20 }} onDone={() => {}} />);
    await waitFor(() => expect(screen.getByText(/FAILED: boom/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test tests/components/style-panels/DistillForm.test.tsx tests/components/style-panels/ProgressView.test.tsx
```

- [ ] **Step 3: Implement**

Create `packages/web-ui/src/components/style-panels/DistillForm.tsx`:

```tsx
import { useState } from "react";
import type { DistillBody } from "../../api/style-panels-client.js";

export interface DistillFormProps {
  account: string;
  totalInRange: number;
  onCancel: () => void;
  onSubmit: (body: DistillBody) => void;
}

type StepKey = "structure" | "snippets" | "composer";

export function DistillForm({ account, totalInRange, onCancel, onSubmit }: DistillFormProps) {
  const [sampleSize, setSampleSize] = useState<number>(Math.min(200, totalInRange));
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [clis, setClis] = useState<Record<StepKey, { cli: "claude" | "codex"; model: string }>>({
    structure: { cli: "claude", model: "opus" },
    snippets:  { cli: "claude", model: "opus" },
    composer:  { cli: "claude", model: "opus" },
  });
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (sampleSize < 20) { setError("sample_size 至少 20"); return; }
    if (sampleSize > totalInRange) { setError(`sample_size 超过总文章数 ${totalInRange}`); return; }
    if (since && until && since > until) { setError("时间范围反了"); return; }
    onSubmit({
      sample_size: sampleSize,
      since: since || undefined,
      until: until || undefined,
      cli_model_per_step: {
        structure: clis.structure,
        snippets: clis.snippets,
        composer: clis.composer,
      },
    });
  }

  return (
    <div className="distill-form">
      <h2>蒸馏 {account}</h2>
      <div>文章来源: refs.sqlite · {totalInRange} 篇</div>
      <label>sample_size: <input aria-label="sample_size" type="number" value={sampleSize} onChange={(e) => setSampleSize(Number(e.target.value))} min={20} max={totalInRange} /></label>
      <label>since: <input aria-label="since" type="date" value={since} onChange={(e) => setSince(e.target.value)} /></label>
      <label>until: <input aria-label="until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></label>
      <fieldset>
        <legend>agent 配置</legend>
        {(["structure", "snippets", "composer"] as StepKey[]).map((k) => (
          <div key={k}>
            {k}:{" "}
            <select value={clis[k].cli} onChange={(e) => setClis({ ...clis, [k]: { ...clis[k], cli: e.target.value as "claude" | "codex" } })}>
              <option value="claude">claude</option>
              <option value="codex">codex</option>
            </select>
            <input value={clis[k].model} onChange={(e) => setClis({ ...clis, [k]: { ...clis[k], model: e.target.value } })} />
          </div>
        ))}
      </fieldset>
      {error && <div className="error">{error}</div>}
      <button type="button" onClick={submit}>开始蒸馏</button>
      <button type="button" onClick={onCancel}>取消</button>
    </div>
  );
}
```

Create `packages/web-ui/src/components/style-panels/ProgressView.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { startDistillStream, type DistillBody } from "../../api/style-panels-client.js";

export interface ProgressViewProps {
  account: string;
  body: DistillBody;
  onDone: () => void;
}

const STEP_LABEL: Record<string, string> = {
  quant: "[1/4] quant-analyzer",
  structure: "[2/4] structure-distiller",
  snippets: "[3/4] snippet-harvester",
  composer: "[4/4] composer",
};

export function ProgressView({ account, body, onDone }: ProgressViewProps) {
  const [lines, setLines] = useState<string[]>([]);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        await startDistillStream(account, body, (ev) => {
          if (ev.type === "distill.step_started") {
            setLines((xs) => [...xs, STEP_LABEL[ev.data.step] ?? ev.data.step, "  → running..."]);
          } else if (ev.type === "distill.batch_progress") {
            setLines((xs) => [...xs, `  → batch ${ev.data.batch}/${ev.data.total_batches}: ${ev.data.candidates_so_far} candidates`]);
          } else if (ev.type === "distill.step_completed") {
            const stats = ev.data.stats ?? {};
            const parts = Object.entries(stats).map(([k, v]) => `${k}=${v}`).join(" ");
            setLines((xs) => [...xs, `  → done (${Math.round((ev.data.duration_ms ?? 0) / 1000)}s) ${parts}`]);
          } else if (ev.type === "distill.step_failed") {
            setLines((xs) => [...xs, `  → FAILED: ${ev.data.error}`]);
          } else if (ev.type === "distill.all_completed") {
            setLines((xs) => [...xs, `Done: ${ev.data.kb_path}`]);
            onDone();
          }
        });
      } catch (e) {
        setLines((xs) => [...xs, `ERROR: ${(e as Error).message}`]);
      }
    })();
  }, [account, body, onDone]);

  return (
    <div className="progress-view">
      <h2>蒸馏 {account}</h2>
      <pre className="log">{lines.join("\n")}</pre>
    </div>
  );
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test tests/components/style-panels/
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/web-ui/src/components/style-panels/DistillForm.tsx packages/web-ui/src/components/style-panels/ProgressView.tsx packages/web-ui/tests/components/style-panels/DistillForm.test.tsx packages/web-ui/tests/components/style-panels/ProgressView.test.tsx && git -c commit.gpgsign=false commit -m "feat(web-ui): DistillForm + ProgressView SSE"
```

---

### Task 16: integration e2e

**Files:**
- Create: `packages/web-server/tests/integration-sp06-e2e.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/web-server/tests/integration-sp06-e2e.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import Database from "better-sqlite3";

vi.mock("@crossing/agents", () => ({
  StyleDistillerStructureAgent: vi.fn().mockImplementation(() => ({
    distill: vi.fn().mockResolvedValue({
      text: "一、核心定位\n十字路口定位是AI产品观察。\n二、开头写法\n数据派开头。\n三、结构骨架\n开头-cases-结尾。\n四、实测段落写法\n每case 一个小节。\n五、语气 tone\n冷静克制。\n六、行业观察段 / 收束段\n偏留白。\n七、视觉/排版元素\n加粗判断句。\n八、禁区\n不用感叹号。\n九、给 Writer Agent 的一句话 system prompt 提炼\n写得像十字路口。\n十、待补\n",
      meta: { cli: "claude", model: "opus", durationMs: 100 },
    }),
  })),
  StyleDistillerSnippetsAgent: vi.fn().mockImplementation(() => ({
    harvest: vi.fn().mockResolvedValue({
      candidates: [
        { tag: "opening.data", from: "a0", excerpt: "据统计，25亿次。", position_ratio: 0.02, length: 10 },
        { tag: "bold.judgment", from: "a1", excerpt: "不是X，而是Y。", position_ratio: 0.5, length: 8 },
        { tag: "closing.blank", from: "a2", excerpt: "下半场开始了。", position_ratio: 0.97, length: 7 },
      ],
      meta: { cli: "claude", model: "opus", durationMs: 100 },
    }),
  })),
  StyleDistillerComposerAgent: vi.fn().mockImplementation(() => ({
    compose: vi.fn().mockImplementation(async (input: any) => ({
      kbMd: [
        "---",
        "type: style_expert",
        `account: ${input.account}`,
        "version: v2",
        `sample_size_requested: ${input.sampleSizeRequested}`,
        `sample_size_actual: ${input.sampleSizeActual}`,
        `distilled_at: ${input.distilledAt}`,
        "---",
        `# ${input.account} 风格卡 v2`,
        "## 量化指标表",
        "| 指标 | 中位数 |",
        "|---|---|",
        "| 整篇字数 | 3200 |",
        "## 片段库",
        "```yaml",
        input.snippetsYaml,
        "```",
      ].join("\n"),
      meta: { cli: "claude", model: "opus", durationMs: 100 },
    })),
  })),
}));

import { registerKbStylePanelsRoutes } from "../src/routes/kb-style-panels.js";

function seedVault() {
  const vault = mkdtempSync(join(tmpdir(), "sp06-e2e-"));
  mkdirSync(join(vault, "08_experts", "style-panel"), { recursive: true });
  mkdirSync(join(vault, ".index"), { recursive: true });
  const sqlitePath = join(vault, ".index", "refs.sqlite");
  const db = new Database(sqlitePath);
  db.exec(`CREATE TABLE ref_articles (id TEXT PRIMARY KEY, account TEXT, title TEXT, author TEXT, published_at TEXT, url TEXT, summary TEXT, md_path TEXT, topics_core_json TEXT, topics_fine_json TEXT, body_plain TEXT, word_count INT, is_original INT)`);
  const ins = db.prepare(`INSERT INTO ref_articles VALUES (@id,'赛博禅心','t','',@p,'','','','[]','[]',@b,@wc,1)`);
  for (let i = 0; i < 60; i += 1) {
    const m = String((i % 12) + 1).padStart(2, "0");
    ins.run({ id: `a${i}`, p: `2025-${m}-01`, b: `正文${i} `.repeat(200), wc: 1000 + i * 20 });
  }
  db.close();
  return { vault, sqlitePath };
}

describe("SP-06 e2e: POST /distill full pipeline", () => {
  it("writes .distill/<account>/* + kb.md with v2 frontmatter", async () => {
    const { vault, sqlitePath } = seedVault();
    const app = Fastify();
    registerKbStylePanelsRoutes(app, { vaultPath: vault, sqlitePath });
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/api/kb/style-panels/赛博禅心/distill",
      payload: { sample_size: 30 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("event: distill.all_completed");

    const distillDir = join(vault, ".distill", "赛博禅心");
    expect(existsSync(join(distillDir, "quant.json"))).toBe(true);
    expect(existsSync(join(distillDir, "structure.md"))).toBe(true);
    expect(existsSync(join(distillDir, "snippets.yaml"))).toBe(true);
    expect(existsSync(join(distillDir, "distilled_at.txt"))).toBe(true);

    const kbPath = join(vault, "08_experts", "style-panel", "赛博禅心_kb.md");
    expect(existsSync(kbPath)).toBe(true);
    const kb = readFileSync(kbPath, "utf-8");
    expect(kb.startsWith("---\n")).toBe(true);
    expect(kb).toContain("type: style_expert");
    expect(kb).toContain("account: 赛博禅心");
    expect(kb).toContain("version: v2");
    expect(kb).toContain("sample_size_actual: 30");
    expect(kb).toContain("# 赛博禅心 风格卡 v2");
    expect(kb).toContain("量化指标表");
    expect(kb).toContain("片段库");
    expect(kb).toContain("opening.data");

    const quant = JSON.parse(readFileSync(join(distillDir, "quant.json"), "utf-8"));
    expect(quant.account).toBe("赛博禅心");
    expect(quant.article_count).toBe(30);
    expect(quant.word_count.median).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/integration-sp06-e2e.test.ts
```

- [ ] **Step 3: Implement**

No additional production code expected — everything was implemented in T1-T12. If this test fails, fix forward in whichever module needs adjustment (most likely: composer frontmatter, or orchestrator filename/paths). Rerun the full SP-06 suite before committing.

Full suite:

```bash
cd /Users/zeoooo/crossing-writer && pnpm -r test
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/integration-sp06-e2e.test.ts && cd /Users/zeoooo/crossing-writer && pnpm -r test
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/web-server/tests/integration-sp06-e2e.test.ts && git -c commit.gpgsign=false commit -m "test(web-server): SP-06 e2e integration (mock 3 agents → full pipeline)"
```

---

## Self-Review

### 1. Spec 节覆盖清单

| Spec 节 | 对应 Task(s) |
|---|---|
| §2 架构 Pipeline（4 步） | T1 quant / T2 sample-picker / T3 snippet-agg / T4-T6 agents / T7 orchestrator |
| §3 文件布局（`.distill/<account>/`, `08_experts/style-panel/<account>_kb.md`） | T7 orchestrator |
| §4.1 frontmatter | T6 composer（`yamlFrontmatter`）+ T16 e2e 验证字段 |
| §4.2 正文结构（10 节 / 句式模板库 / 量化表 / 片段库） | T4 prompt / T6 prompt + composer / T16 e2e |
| §5 ConfigStore 扩展（3 个 agent key） | 非本期新增字段，只在 orchestrator CLI/UI 里通过 `cliModelPerStep` 覆盖；已在 T7/T10/T15 覆盖 |
| §6 CLI 命令（list-accounts / distill-style + flags） | T9 / T10 |
| §7.1 SSE events（step_started/completed/batch_progress/failed/all_completed） | T12 |
| §7.2 请求参数校验（400/404） | T12 |
| §8 代码布局 | 所有 task 按此布局建文件 |
| §9 前端 UI（StylePanelsPage / DistillForm / ProgressView） | T13 / T14 / T15 |
| §10 错误处理（step 失败保留中间产物 / 20 篇下限 / 404 账号不存在） | T8 / T12 |
| §11 测试策略（quant/sample/aggregator/agent/orchestrator/CLI/route/UI/e2e） | T1-T16 全覆盖 |
| §12 里程碑 M1-M7 | T1-T3 / T4-T6 / T7-T8 / T9-T10 / T11-T12 / T13-T15 / T16 |
| §13 Future Work | 明确不做，未出现在 task |

### 2. Placeholder 扫描

在全文搜索下列关键字，均未出现：`TBD`、`similar to`、`add error handling`、`<placeholder>`、`TODO:`、`...similar...`、`(same as above)`。每个 Step 3 都提供了具体代码或具体命令。

### 3. 类型一致性

- `QuantResult` —— T1 定义 / T7 orchestrator 读写 quant.json / T16 e2e 断言
- `ArticleSample` —— T1 定义 / T2 sample-picker 入参 / T7 orchestrator 池加载
- `SnippetCandidate` —— T1 定义 / T3 aggregator 入参 / T7 orchestrator snippets 步骤
- `DistillStep` —— T1 定义 / T7 orchestrator onlyStep / T10 CLI / T12 路由
- `DistillOptions` —— T1 定义 / T7 orchestrator 入参 / T10 CLI / T12 路由
- `DistillStepEvent` —— T1 定义 / T7 orchestrator emit / T10 CLI stdout / T12 SSE / T15 ProgressView

全 plan 无重复或冲突类型定义。

### 4. Task count

16 个 task（T1-T16），落在 spec 要求的 14-18 区间内：
- M1 代码基础: T1, T2, T3（3）
- M2 3 agents: T4, T5, T6（3）
- M3 orchestrator: T7, T8（2）
- M4 CLI: T9, T10（2）
- M5 后端路由: T11, T12（2）
- M6 前端: T13, T14, T15（3）
- M7 集成: T16（1）

合计 16。
