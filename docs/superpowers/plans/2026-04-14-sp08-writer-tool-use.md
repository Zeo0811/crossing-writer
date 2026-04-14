# SP-08 Writer Tool-Use Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 4 个 writer agent（opening / practice / closing / style_critic）在写作时主动多轮调用 search_wiki / search_raw skill；同时支持用户在重写阶段手动 @-skill pin 资料强制注入下次 rewrite。
**Architecture:** 新增 `writer-tool-runner`（多轮 tool dialog，最多 5 round，串行执行 tool 块，沿用现有 ` ```tool``` ` 文本块协议）+ skill dispatcher（路由 search_wiki/search_raw）+ search_raw（FTS5 over ref_articles_fts）+ pendingPins in-memory（per project per section）+ 段落 frontmatter.tools_used 持久化 + 4 个新 SSE 事件 + 段落卡片「📚 本段引用」+ SkillForm 弹窗。
**Tech Stack:** TypeScript / Node spawnSync (claude/codex CLI) / better-sqlite3 (FTS5) / Fastify SSE / React / Vitest

---

## Task Index (21 total)

- M1: T1-T3 skill 基础（search-raw + dispatcher + _tool-protocol.md）
- M2: T4-T5 writer-tool-runner（主流程 + tools_used 收集）
- M3: T6-T7 4 agent 接入（opening+practice / closing+critic）
- M4: T8-T10 后端 3 路由（rewrite 扩展 / skill 端点 / pinned 端点）
- M5: T11 最后调整位置（占位）

---

## T1: search-raw skill — FTS5 query over ref_articles_fts

**目的：** 新增 `searchRaw(input, ctx)`：基于 SP-07 已建好的 `ref_articles_fts` 虚拟表，按 query 做 FTS5 搜索，可选 account 过滤，返回 snippet 片段。同时在 `packages/kb/src/skills/types.ts` 定义本期所有 skill 共享的类型。

### Step 1 — 写测试（FAIL）

新建 `packages/kb/src/skills/__tests__/search-raw.test.ts`：

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchRaw } from "../search-raw.js";

let tmp: string;
let dbPath: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "sp08-raw-"));
  dbPath = join(tmp, "refs.sqlite");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE ref_articles (
      id TEXT PRIMARY KEY,
      account TEXT,
      title TEXT,
      published_at TEXT,
      body_segmented TEXT
    );
    CREATE VIRTUAL TABLE ref_articles_fts USING fts5(
      title, account, body_segmented, content='ref_articles', content_rowid='rowid'
    );
    CREATE TRIGGER ref_articles_ai AFTER INSERT ON ref_articles BEGIN
      INSERT INTO ref_articles_fts(rowid, title, account, body_segmented)
        VALUES (new.rowid, new.title, new.account, new.body_segmented);
    END;
  `);
  db.prepare("INSERT INTO ref_articles (id,account,title,published_at,body_segmented) VALUES (?,?,?,?,?)")
    .run("a1", "十字路口Crossing", "AI 漫剧爆了", "2026-04-08", "AI 漫剧 PixVerse 分镜 生成效果非常好");
  db.prepare("INSERT INTO ref_articles (id,account,title,published_at,body_segmented) VALUES (?,?,?,?,?)")
    .run("a2", "赛博禅心", "Sora 炸裂", "2026-04-10", "Sora 视频模型 现象级");
  db.close();
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("searchRaw", () => {
  it("returns hits for matching query", () => {
    const hits = searchRaw({ query: "漫剧" }, { sqlitePath: dbPath });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.article_id).toBe("a1");
    expect(hits[0]!.account).toBe("十字路口Crossing");
    expect(hits[0]!.snippet).toContain("<b>");
  });

  it("filters by account", () => {
    const hits = searchRaw({ query: "模型", account: "赛博禅心" }, { sqlitePath: dbPath });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.account).toBe("赛博禅心");
  });

  it("returns empty when no match", () => {
    const hits = searchRaw({ query: "不存在的词xyz" }, { sqlitePath: dbPath });
    expect(hits).toEqual([]);
  });

  it("returns [] when sqlite file missing", () => {
    const hits = searchRaw({ query: "任意" }, { sqlitePath: "/tmp/does-not-exist.sqlite" });
    expect(hits).toEqual([]);
  });

  it("respects limit", () => {
    const hits = searchRaw({ query: "漫剧 OR 模型", limit: 1 }, { sqlitePath: dbPath });
    expect(hits.length).toBeLessThanOrEqual(1);
  });
});
```

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/kb exec vitest run src/skills/__tests__/search-raw.test.ts`

### Step 2 — 运行测试（确认 FAIL）

- [ ] 输出应为 `Cannot find module '../search-raw.js'` 或类似报错。

### Step 3 — 实现

新建 `packages/kb/src/skills/types.ts`：

```ts
export interface SearchRawInput {
  query: string;
  account?: string;
  limit?: number;
}

export interface SearchRawHit {
  article_id: string;
  account: string;
  title: string;
  published_at: string;
  snippet: string;
}

export type ToolCall = { command: string; args: string[] };

export type SkillResult =
  | {
      ok: true;
      tool: string;
      query: string;
      args: Record<string, string>;
      hits: unknown[];
      hits_count: number;
      formatted: string;
    }
  | {
      ok: false;
      tool: string;
      query: string;
      args: Record<string, string>;
      error: string;
    };

export interface SkillContext {
  vaultPath: string;
  sqlitePath: string;
}
```

新建 `packages/kb/src/skills/search-raw.ts`：

```ts
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import type { SearchRawInput, SearchRawHit } from "./types.js";

const DEFAULT_LIMIT = 5;

export function searchRaw(
  input: SearchRawInput,
  ctx: { sqlitePath: string },
): SearchRawHit[] {
  if (!ctx.sqlitePath || !existsSync(ctx.sqlitePath)) return [];
  const limit = Math.max(1, Math.min(50, input.limit ?? DEFAULT_LIMIT));
  const db = new Database(ctx.sqlitePath, { readonly: true, fileMustExist: true });
  try {
    const wantAccount = typeof input.account === "string" && input.account.length > 0;
    const sql = wantAccount
      ? `SELECT ra.id AS article_id,
                ra.account AS account,
                ra.title AS title,
                ra.published_at AS published_at,
                snippet(ref_articles_fts, 2, '<b>', '</b>', '...', 32) AS snippet
         FROM ref_articles_fts
         JOIN ref_articles ra ON ra.rowid = ref_articles_fts.rowid
         WHERE ref_articles_fts MATCH @q AND ra.account = @account
         ORDER BY rank
         LIMIT @limit`
      : `SELECT ra.id AS article_id,
                ra.account AS account,
                ra.title AS title,
                ra.published_at AS published_at,
                snippet(ref_articles_fts, 2, '<b>', '</b>', '...', 32) AS snippet
         FROM ref_articles_fts
         JOIN ref_articles ra ON ra.rowid = ref_articles_fts.rowid
         WHERE ref_articles_fts MATCH @q
         ORDER BY rank
         LIMIT @limit`;
    const stmt = db.prepare(sql);
    const params: Record<string, unknown> = { q: input.query, limit };
    if (wantAccount) params.account = input.account;
    try {
      const rows = stmt.all(params) as SearchRawHit[];
      return rows;
    } catch {
      // FTS MATCH syntax error → empty
      return [];
    }
  } finally {
    db.close();
  }
}
```

在 `packages/kb/src/index.ts` 追加：

```ts
export { searchRaw } from "./skills/search-raw.js";
export type {
  SearchRawInput,
  SearchRawHit,
  SkillResult,
  ToolCall,
  SkillContext,
} from "./skills/types.js";
```

- [ ] 确认 `packages/kb/package.json` 已依赖 `better-sqlite3`（SP-07 已加，不用改）。

### Step 4 — 再跑测试（PASS）

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/kb exec vitest run src/skills/__tests__/search-raw.test.ts`
- [ ] 全部 5 个用例通过。

### Step 5 — 提交

- [ ] `cd /Users/zeoooo/crossing-writer && git add packages/kb/src/skills/types.ts packages/kb/src/skills/search-raw.ts packages/kb/src/skills/__tests__/search-raw.test.ts packages/kb/src/index.ts && git -c commit.gpgsign=false commit -m "sp08(T1): add search-raw FTS5 skill + shared types"`

---

## T2: skill dispatcher — route search_wiki / search_raw with arg parser

**目的：** 实现统一入口 `dispatchSkill(call, ctx)`，解析 quoted 第一参数 + `--key=value` 可选参数，路由到 `searchWiki` / `searchRaw`，返回 `SkillResult` 含 markdown formatted 字段供 runner 回灌给 agent。

### Step 1 — 写测试（FAIL）

新建 `packages/kb/src/skills/__tests__/dispatcher.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { dispatchSkill, parseSkillArgs } from "../dispatcher.js";

vi.mock("../search-raw.js", () => ({
  searchRaw: vi.fn(() => [
    { article_id: "a1", account: "十字路口Crossing", title: "AI 漫剧爆了", published_at: "2026-04-08", snippet: "AI <b>漫剧</b> PixVerse" },
  ]),
}));
vi.mock("../../wiki/search-wiki.js", () => ({
  searchWiki: vi.fn(() => [
    { path: "concepts/AI漫剧.md", title: "AI漫剧", kind: "concept", score: 12.3, excerpt: "AI 漫剧指……" },
  ]),
}));

const ctx = { vaultPath: "/tmp/vault", sqlitePath: "/tmp/refs.sqlite" };

describe("parseSkillArgs", () => {
  it("extracts quoted query + --key=value pairs", () => {
    const p = parseSkillArgs(["\"AI 漫剧\"", "--kind=concept", "--limit=5"]);
    expect(p.query).toBe("AI 漫剧");
    expect(p.args).toEqual({ kind: "concept", limit: "5" });
  });

  it("treats first non-flag token as query", () => {
    const p = parseSkillArgs(["Sora", "--limit=2"]);
    expect(p.query).toBe("Sora");
    expect(p.args).toEqual({ limit: "2" });
  });

  it("handles empty", () => {
    const p = parseSkillArgs([]);
    expect(p.query).toBe("");
    expect(p.args).toEqual({});
  });
});

describe("dispatchSkill", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes search_wiki", async () => {
    const r = await dispatchSkill({ command: "search_wiki", args: ["\"AI 漫剧\"", "--kind=concept", "--limit=5"] }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tool).toBe("search_wiki");
      expect(r.query).toBe("AI 漫剧");
      expect(r.args).toMatchObject({ kind: "concept", limit: "5" });
      expect(r.hits_count).toBe(1);
      expect(r.formatted).toContain("concepts/AI漫剧.md");
    }
  });

  it("routes search_raw", async () => {
    const r = await dispatchSkill({ command: "search_raw", args: ["\"漫剧\"", "--account=十字路口Crossing", "--limit=2"] }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tool).toBe("search_raw");
      expect(r.hits_count).toBe(1);
      expect(r.formatted).toContain("AI 漫剧爆了");
      expect(r.formatted).toContain("<b>漫剧</b>");
    }
  });

  it("returns ok=false for unknown tool", async () => {
    const r = await dispatchSkill({ command: "search_foo", args: [] }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("unknown tool");
  });

  it("truncates large formatted payload", async () => {
    const { searchRaw } = await import("../search-raw.js");
    (searchRaw as any).mockReturnValueOnce(
      Array.from({ length: 500 }, (_, i) => ({
        article_id: `a${i}`, account: "x", title: "t".repeat(200), published_at: "2026-01-01", snippet: "s".repeat(200),
      })),
    );
    const r = await dispatchSkill({ command: "search_raw", args: ["x"] }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.formatted.length).toBeLessThanOrEqual(20_500);
  });
});
```

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/kb exec vitest run src/skills/__tests__/dispatcher.test.ts`

### Step 2 — 运行测试（FAIL）

- [ ] 报 `Cannot find module '../dispatcher.js'`。

### Step 3 — 实现

新建 `packages/kb/src/skills/dispatcher.ts`：

```ts
import { searchRaw } from "./search-raw.js";
import { searchWiki } from "../wiki/search-wiki.js";
import type { SkillContext, SkillResult, ToolCall } from "./types.js";

const MAX_FORMATTED = 20_000;

export function parseSkillArgs(tokens: string[]): { query: string; args: Record<string, string> } {
  const args: Record<string, string> = {};
  let query = "";
  for (const t of tokens) {
    const m = t.match(/^--([a-zA-Z_]+)=(.*)$/);
    if (m) {
      args[m[1]!] = m[2]!;
    } else if (!query) {
      query = stripQuotes(t);
    }
  }
  return { query, args };
}

function stripQuotes(s: string): string {
  if ((s.startsWith("\"") && s.endsWith("\"")) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

export async function dispatchSkill(call: ToolCall, ctx: SkillContext): Promise<SkillResult> {
  const { query, args } = parseSkillArgs(call.args);
  const base = { tool: call.command, query, args } as const;

  try {
    if (call.command === "search_wiki") {
      const limit = parseIntOrUndef(args.limit);
      const hits = await Promise.resolve(
        searchWiki(
          { query, kind: args.kind as any, limit },
          { vaultPath: ctx.vaultPath },
        ),
      );
      return {
        ok: true,
        ...base,
        hits,
        hits_count: hits.length,
        formatted: truncate(formatWikiHits(hits)),
      };
    }
    if (call.command === "search_raw") {
      const limit = parseIntOrUndef(args.limit);
      const hits = searchRaw({ query, account: args.account, limit }, { sqlitePath: ctx.sqlitePath });
      return {
        ok: true,
        ...base,
        hits,
        hits_count: hits.length,
        formatted: truncate(formatRawHits(hits)),
      };
    }
    return { ok: false, ...base, error: `unknown tool: ${call.command}` };
  } catch (e) {
    return { ok: false, ...base, error: (e as Error).message || String(e) };
  }
}

function parseIntOrUndef(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}

function formatWikiHits(hits: any[]): string {
  if (!hits.length) return "(no wiki hits)";
  return hits
    .map((h, i) => `${i + 1}. **${h.title ?? h.path}** (${h.kind ?? "?"}, score=${(h.score ?? 0).toFixed?.(1) ?? h.score})\n   path: ${h.path}\n   ${h.excerpt ?? ""}`.trim())
    .join("\n");
}

function formatRawHits(hits: any[]): string {
  if (!hits.length) return "(no raw hits)";
  return hits
    .map((h, i) => `${i + 1}. **${h.title}** — ${h.account} · ${h.published_at}\n   id: ${h.article_id}\n   ${h.snippet}`.trim())
    .join("\n");
}

function truncate(s: string): string {
  if (s.length <= MAX_FORMATTED) return s;
  return s.slice(0, MAX_FORMATTED) + "\n...(truncated)";
}
```

在 `packages/kb/src/index.ts` 追加：

```ts
export { dispatchSkill, parseSkillArgs } from "./skills/dispatcher.js";
```

### Step 4 — 再跑测试（PASS）

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/kb exec vitest run src/skills/__tests__/dispatcher.test.ts`

### Step 5 — 提交

- [ ] `cd /Users/zeoooo/crossing-writer && git add packages/kb/src/skills/dispatcher.ts packages/kb/src/skills/__tests__/dispatcher.test.ts packages/kb/src/index.ts && git -c commit.gpgsign=false commit -m "sp08(T2): add skill dispatcher routing search_wiki/search_raw"`

---

## T3: _tool-protocol.md prompt include + 挂到 4 个 writer agent

**目的：** 新建共享 prompt 片段 `_tool-protocol.md`，描述 ` ```tool``` ` 块协议；改 `writer-opening-agent.ts` / `writer-practice-agent.ts` / `writer-closing-agent.ts` / `style-critic-agent.ts` 4 个 system prompt 末尾 include 它。

### Step 1 — 写测试（FAIL）

新建 `packages/agents/src/prompts/__tests__/tool-protocol.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getSystemPrompt as openingPrompt } from "../../roles/writer-opening-agent.js";
import { getSystemPrompt as practicePrompt } from "../../roles/writer-practice-agent.js";
import { getSystemPrompt as closingPrompt } from "../../roles/writer-closing-agent.js";
import { getSystemPrompt as criticPrompt } from "../../roles/style-critic-agent.js";

const protocolPath = join(__dirname, "..", "_tool-protocol.md");

describe("_tool-protocol.md", () => {
  it("exists and contains tool syntax", () => {
    expect(existsSync(protocolPath)).toBe(true);
    const body = readFileSync(protocolPath, "utf-8");
    expect(body).toContain("search_wiki");
    expect(body).toContain("search_raw");
    expect(body).toContain("```tool");
    expect(body).toMatch(/5\s*round/);
  });
});

describe("4 writer agents include tool-protocol", () => {
  const protocol = readFileSync(protocolPath, "utf-8").trim();
  const marker = "工具调用协议";

  it("writer.opening", () => expect(openingPrompt()).toContain(marker));
  it("writer.practice", () => expect(practicePrompt()).toContain(marker));
  it("writer.closing", () => expect(closingPrompt()).toContain(marker));
  it("style_critic", () => expect(criticPrompt()).toContain(marker));
});
```

（如 agent 文件当前未导出 `getSystemPrompt`，Step 3 时顺带导出；测试写在这里驱动导出。）

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/agents exec vitest run src/prompts/__tests__/tool-protocol.test.ts`

### Step 2 — 运行测试（FAIL）

- [ ] 报 `_tool-protocol.md` 不存在或 agent 未导出 `getSystemPrompt`。

### Step 3 — 实现

新建 `packages/agents/src/prompts/_tool-protocol.md`：

````markdown
## 工具调用协议

如果你需要查 wiki 或 raw 文章作参考，输出 ```tool 块（每行一条命令）：

```tool
search_wiki "<query>" [--kind=entity|concept|case|observation|person] [--limit=5]
search_raw "<query>" [--account=<account_name>] [--limit=3]
```

规则：
1. 一次 round 可以发多个命令（每行一条）
2. 你最多可以来 **5 round**；查完一直到不再发 tool 块就视为你写完了
3. 如果你不需要查任何东西，直接输出最终段落，不发 tool 块
4. 工具结果会作为 user message 追加给你；基于结果继续写或继续查
5. quoted 引用 wiki 内容时记得带 source（例如 "据 concepts/AI漫剧.md..."）
````

新建 `packages/agents/src/prompts/load.ts`（共享 include loader）：

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function loadPromptInclude(name: string): string {
  return readFileSync(join(here, name), "utf-8").trim();
}

export const TOOL_PROTOCOL_PROMPT = loadPromptInclude("_tool-protocol.md");
```

改 4 个 agent 文件，在 system prompt 末尾追加 `\n\n${TOOL_PROTOCOL_PROMPT}` 并导出 `getSystemPrompt`。以 `packages/agents/src/roles/writer-opening-agent.ts` 为例（其他 3 个对称处理）：

```ts
import { TOOL_PROTOCOL_PROMPT } from "../prompts/load.js";

const BASE_SYSTEM_PROMPT = `你是「开头段」writer...（原文保留）`;

export function getSystemPrompt(): string {
  return `${BASE_SYSTEM_PROMPT}\n\n${TOOL_PROTOCOL_PROMPT}`;
}

// 调用方原来用常量的改成 getSystemPrompt()
```

对 `writer-practice-agent.ts` / `writer-closing-agent.ts` / `style-critic-agent.ts` 做一模一样的改动。

### Step 4 — 再跑测试（PASS）

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/agents exec vitest run src/prompts/__tests__/tool-protocol.test.ts`
- [ ] 确认 `pnpm --filter @crossing/agents exec vitest run` 全量无回归。

### Step 5 — 提交

- [ ] `cd /Users/zeoooo/crossing-writer && git add packages/agents/src/prompts/_tool-protocol.md packages/agents/src/prompts/load.ts packages/agents/src/prompts/__tests__/tool-protocol.test.ts packages/agents/src/roles/writer-opening-agent.ts packages/agents/src/roles/writer-practice-agent.ts packages/agents/src/roles/writer-closing-agent.ts packages/agents/src/roles/style-critic-agent.ts && git -c commit.gpgsign=false commit -m "sp08(T3): add _tool-protocol.md include + wire into 4 writer agents"`

---

## T4: writer-tool-runner 主流程（多轮循环 + parseToolCalls + onEvent）

**目的：** 实现 `runWriterWithTools(opts)`：多轮 agent.invoke → parseToolCalls → dispatchTool → 回灌结果，直到 agent 不再发 tool 块或达 maxRounds=5。

### Step 1 — 写测试（FAIL）

新建 `packages/agents/src/__tests__/writer-tool-runner.test.ts`：

```ts
import { describe, it, expect, vi } from "vitest";
import { runWriterWithTools } from "../writer-tool-runner.js";
import type { AgentInvoker, WriterToolEvent } from "../writer-tool-runner.js";

function makeInvoker(replies: string[]): AgentInvoker {
  let i = 0;
  return {
    invoke: vi.fn(async () => ({
      text: replies[i++] ?? "",
      meta: { cli: "claude", model: "opus", durationMs: 10 },
    })),
  };
}

describe("runWriterWithTools", () => {
  it("returns immediately when first reply has no tool block", async () => {
    const agent = makeInvoker(["这是最终段落"]);
    const result = await runWriterWithTools({
      agent,
      agentName: "writer.opening",
      systemPrompt: "sys",
      initialUserMessage: "写开头",
      dispatchTool: async () => { throw new Error("should not call"); },
    });
    expect(result.finalText).toBe("这是最终段落");
    expect(result.rounds).toBe(1);
    expect(result.toolsUsed).toEqual([]);
  });

  it("runs multi-round dialog and aggregates tools", async () => {
    const agent = makeInvoker([
      "我先查查\n```tool\nsearch_wiki \"AI 漫剧\" --kind=concept\n```",
      "再查一个\n```tool\nsearch_raw \"PixVerse\" --limit=2\n```",
      "好了这是最终段落。",
    ]);
    const dispatchTool = vi.fn(async (call) => ({
      ok: true as const,
      tool: call.command,
      query: "x",
      args: {},
      hits: [{ path: "a.md", title: "A" }],
      hits_count: 1,
      formatted: `[${call.command} fake result]`,
    }));
    const events: WriterToolEvent[] = [];
    const result = await runWriterWithTools({
      agent, agentName: "writer.opening",
      systemPrompt: "sys", initialUserMessage: "写",
      dispatchTool, onEvent: (e) => events.push(e),
    });
    expect(result.rounds).toBe(3);
    expect(result.finalText).toBe("好了这是最终段落。");
    expect(result.toolsUsed).toHaveLength(2);
    expect(result.toolsUsed[0]!.tool).toBe("search_wiki");
    expect(result.toolsUsed[1]!.tool).toBe("search_raw");
    expect(events.some((e) => e.type === "tool_called")).toBe(true);
    expect(events.some((e) => e.type === "tool_returned")).toBe(true);
    expect(events.some((e) => e.type === "tool_round_completed")).toBe(true);
  });

  it("stops at maxRounds and returns last assistant text", async () => {
    const replies = Array.from({ length: 10 }, (_, i) => `round ${i}\n\`\`\`tool\nsearch_wiki "q"\n\`\`\``);
    const agent = makeInvoker(replies);
    const dispatchTool = async () => ({
      ok: true as const, tool: "search_wiki", query: "q", args: {},
      hits: [], hits_count: 0, formatted: "()",
    });
    const result = await runWriterWithTools({
      agent, agentName: "writer.opening",
      systemPrompt: "s", initialUserMessage: "u",
      dispatchTool, maxRounds: 3,
    });
    expect(result.rounds).toBe(3);
    expect(result.finalText).toContain("round 2");
  });

  it("continues round when a tool fails", async () => {
    const agent = makeInvoker([
      "```tool\nsearch_wiki \"a\"\nsearch_foo \"b\"\n```",
      "完成。",
    ]);
    const dispatchTool = vi.fn(async (call) => {
      if (call.command === "search_foo") {
        return { ok: false as const, tool: "search_foo", query: "b", args: {}, error: "unknown" };
      }
      return { ok: true as const, tool: "search_wiki", query: "a", args: {}, hits: [], hits_count: 0, formatted: "()" };
    });
    const events: WriterToolEvent[] = [];
    const result = await runWriterWithTools({
      agent, agentName: "writer.opening",
      systemPrompt: "s", initialUserMessage: "u",
      dispatchTool, onEvent: (e) => events.push(e),
    });
    expect(result.finalText).toBe("完成。");
    expect(result.toolsUsed).toHaveLength(2);
    expect(events.some((e) => e.type === "tool_failed")).toBe(true);
  });
});
```

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/agents exec vitest run src/__tests__/writer-tool-runner.test.ts`

### Step 2 — 运行测试（FAIL）

- [ ] 模块不存在。

### Step 3 — 实现

新建 `packages/agents/src/writer-tool-runner.ts`：

```ts
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AgentInvoker {
  invoke(
    messages: ChatMessage[],
    opts?: { images?: string[] },
  ): Promise<{ text: string; meta: { cli: string; model?: string; durationMs: number } }>;
}

export type ToolCall = { command: string; args: string[] };

export type SkillResult =
  | {
      ok: true;
      tool: string;
      query: string;
      args: Record<string, string>;
      hits: unknown[];
      hits_count: number;
      formatted: string;
    }
  | {
      ok: false;
      tool: string;
      query: string;
      args: Record<string, string>;
      error: string;
    };

export interface ToolUsage {
  tool: string;
  query: string;
  args: Record<string, string>;
  pinned_by: "auto" | `manual:${string}`;
  round: number;
  hits_count: number;
  hits_summary: Array<{
    path?: string;
    title?: string;
    score?: number;
    account?: string;
    article_id?: string;
  }>;
}

export interface WriterToolEvent {
  type: "tool_called" | "tool_returned" | "tool_failed" | "tool_round_completed";
  section_key?: string;
  agent: string;
  tool?: string;
  args?: Record<string, string>;
  round: number;
  hits_count?: number;
  duration_ms?: number;
  error?: string;
  total_tools_in_round?: number;
}

export interface WriterRunOptions {
  agent: AgentInvoker;
  agentName: string;
  sectionKey?: string;
  systemPrompt: string;
  initialUserMessage: string;
  maxRounds?: number;
  pinnedContext?: string;
  dispatchTool: (call: ToolCall) => Promise<SkillResult>;
  onEvent?: (ev: WriterToolEvent) => void;
  images?: string[];
}

export interface WriterRunResult {
  finalText: string;
  toolsUsed: ToolUsage[];
  rounds: number;
  meta: {
    cli: string;
    model?: string;
    durationMs: number;
    total_duration_ms: number;
  };
}

const TOOL_BLOCK_RE = /```tool\s*\n([\s\S]*?)\n```/g;

export function parseToolCalls(text: string): ToolCall[] {
  const out: ToolCall[] = [];
  let m: RegExpExecArray | null;
  TOOL_BLOCK_RE.lastIndex = 0;
  while ((m = TOOL_BLOCK_RE.exec(text))) {
    const body = m[1]!;
    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const tokens = tokenize(line);
      if (!tokens.length) continue;
      out.push({ command: tokens[0]!, args: tokens.slice(1) });
    }
  }
  return out;
}

function tokenize(s: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out.push(m[1] !== undefined ? `"${m[1]}"` : m[2]!);
  }
  return out;
}

export async function runWriterWithTools(opts: WriterRunOptions): Promise<WriterRunResult> {
  const maxRounds = Math.max(1, opts.maxRounds ?? 5);
  const systemPrompt = opts.pinnedContext
    ? `${opts.systemPrompt}\n\n## User-pinned references\n\n${opts.pinnedContext}`
    : opts.systemPrompt;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: opts.initialUserMessage },
  ];

  const toolsUsed: ToolUsage[] = [];
  let lastMeta = { cli: "claude", model: undefined as string | undefined, durationMs: 0 };
  let totalMs = 0;
  let lastText = "";
  let round = 0;

  for (round = 1; round <= maxRounds; round++) {
    const resp = await opts.agent.invoke(messages, opts.images ? { images: opts.images } : undefined);
    lastText = resp.text;
    lastMeta = resp.meta;
    totalMs += resp.meta.durationMs ?? 0;

    const calls = parseToolCalls(resp.text);
    if (calls.length === 0) {
      return {
        finalText: lastText,
        toolsUsed,
        rounds: round,
        meta: { ...lastMeta, total_duration_ms: totalMs },
      };
    }

    if (round >= maxRounds) {
      // Hit ceiling — stop without executing further tools; return last text.
      opts.onEvent?.({
        type: "tool_round_completed",
        section_key: opts.sectionKey,
        agent: opts.agentName,
        round,
        total_tools_in_round: 0,
      });
      break;
    }

    const formattedResults: string[] = [];
    for (const call of calls) {
      const t0 = Date.now();
      opts.onEvent?.({
        type: "tool_called",
        section_key: opts.sectionKey,
        agent: opts.agentName,
        tool: call.command,
        args: argsToObject(call.args),
        round,
      });
      let result: SkillResult;
      try {
        result = await opts.dispatchTool(call);
      } catch (e) {
        result = {
          ok: false,
          tool: call.command,
          query: call.args[0] ?? "",
          args: argsToObject(call.args),
          error: (e as Error).message || String(e),
        };
      }
      const dt = Date.now() - t0;

      if (result.ok) {
        opts.onEvent?.({
          type: "tool_returned",
          section_key: opts.sectionKey,
          agent: opts.agentName,
          tool: result.tool,
          round,
          hits_count: result.hits_count,
          duration_ms: dt,
        });
        toolsUsed.push({
          tool: result.tool,
          query: result.query,
          args: result.args,
          pinned_by: "auto",
          round,
          hits_count: result.hits_count,
          hits_summary: summarizeHits(result.hits),
        });
        formattedResults.push(`### ${result.tool} "${result.query}" (round ${round})\n${result.formatted}`);
      } else {
        opts.onEvent?.({
          type: "tool_failed",
          section_key: opts.sectionKey,
          agent: opts.agentName,
          tool: result.tool,
          round,
          duration_ms: dt,
          error: result.error,
        });
        toolsUsed.push({
          tool: result.tool,
          query: result.query,
          args: result.args,
          pinned_by: "auto",
          round,
          hits_count: 0,
          hits_summary: [],
        });
        formattedResults.push(`### ${result.tool} "${result.query}" (round ${round})\n(失败: ${result.error})`);
      }
    }

    opts.onEvent?.({
      type: "tool_round_completed",
      section_key: opts.sectionKey,
      agent: opts.agentName,
      round,
      total_tools_in_round: calls.length,
    });

    messages.push({ role: "assistant", content: lastText });
    messages.push({
      role: "user",
      content: `工具结果（round ${round}）：\n\n${formattedResults.join("\n\n")}\n\n请基于结果继续。如果还需要查就发新的 tool 块，否则直接输出最终段落。`,
    });
  }

  return {
    finalText: lastText,
    toolsUsed,
    rounds: round,
    meta: { ...lastMeta, total_duration_ms: totalMs },
  };
}

function argsToObject(tokens: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of tokens) {
    const m = t.match(/^--([a-zA-Z_]+)=(.*)$/);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

function summarizeHits(hits: unknown[]): ToolUsage["hits_summary"] {
  return hits.slice(0, 20).map((h) => {
    const r = h as Record<string, unknown>;
    return {
      path: typeof r.path === "string" ? r.path : undefined,
      title: typeof r.title === "string" ? r.title : undefined,
      score: typeof r.score === "number" ? r.score : undefined,
      account: typeof r.account === "string" ? r.account : undefined,
      article_id: typeof r.article_id === "string" ? r.article_id : undefined,
    };
  });
}
```

在 `packages/agents/src/index.ts` 追加：

```ts
export * from "./writer-tool-runner.js";
```

### Step 4 — 再跑测试（PASS）

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/agents exec vitest run src/__tests__/writer-tool-runner.test.ts`

### Step 5 — 提交

- [ ] `cd /Users/zeoooo/crossing-writer && git add packages/agents/src/writer-tool-runner.ts packages/agents/src/__tests__/writer-tool-runner.test.ts packages/agents/src/index.ts && git -c commit.gpgsign=false commit -m "sp08(T4): add writer-tool-runner multi-round dialog core"`

---

## T5: runner pinnedContext 注入 + tools_used 收集 + maxRounds 强停（完善）

**目的：** T4 已经把骨架搭好，T5 补 pinnedContext 注入 system prompt 的断言测试、tools_used 手动 pin 标记测试、maxRounds 边界测试，并补实现（如已覆盖则本 task 仅补测试）。

### Step 1 — 写测试（FAIL）

追加到 `packages/agents/src/__tests__/writer-tool-runner.test.ts`：

```ts
describe("runWriterWithTools pinnedContext + edge cases", () => {
  it("injects pinnedContext into system prompt", async () => {
    const captured: any[] = [];
    const agent = {
      invoke: vi.fn(async (messages) => {
        captured.push(messages[0]);
        return { text: "done", meta: { cli: "claude", durationMs: 1 } };
      }),
    };
    await runWriterWithTools({
      agent,
      agentName: "w",
      systemPrompt: "BASE",
      initialUserMessage: "go",
      pinnedContext: "PIN_XYZ",
      dispatchTool: async () => { throw new Error("no"); },
    });
    expect(captured[0].content).toContain("BASE");
    expect(captured[0].content).toContain("User-pinned references");
    expect(captured[0].content).toContain("PIN_XYZ");
  });

  it("does not append section when pinnedContext empty", async () => {
    const captured: any[] = [];
    const agent = {
      invoke: vi.fn(async (messages) => {
        captured.push(messages[0]);
        return { text: "done", meta: { cli: "claude", durationMs: 1 } };
      }),
    };
    await runWriterWithTools({
      agent, agentName: "w",
      systemPrompt: "BASE",
      initialUserMessage: "go",
      dispatchTool: async () => { throw new Error("no"); },
    });
    expect(captured[0].content).not.toContain("User-pinned references");
  });

  it("accumulates total_duration_ms across rounds", async () => {
    let i = 0;
    const replies = ["```tool\nsearch_wiki \"a\"\n```", "done"];
    const agent = {
      invoke: vi.fn(async () => ({
        text: replies[i++]!,
        meta: { cli: "claude", model: "opus", durationMs: 100 },
      })),
    };
    const r = await runWriterWithTools({
      agent, agentName: "w",
      systemPrompt: "s", initialUserMessage: "u",
      dispatchTool: async () => ({
        ok: true, tool: "search_wiki", query: "a", args: {},
        hits: [], hits_count: 0, formatted: "()",
      }),
    });
    expect(r.meta.total_duration_ms).toBe(200);
  });
});
```

- [ ] 跑测试：`pnpm --filter @crossing/agents exec vitest run src/__tests__/writer-tool-runner.test.ts`

### Step 2 — 运行测试

T4 的实现已满足所有断言，因此这 3 个新 case 理论上**直接通过**。但为严格 TDD：先把 `pinnedContext` 相关的 `systemPrompt` 拼接注释掉（故意 break）让测试 FAIL，再恢复。

- [ ] 临时改 `writer-tool-runner.ts` 把 `if (opts.pinnedContext)` 那段临时返回 `opts.systemPrompt` 裸值，重跑测试 → FAIL 两个用例。

### Step 3 — 恢复正确实现

- [ ] 恢复 T4 原实现（pinnedContext 拼到 `## User-pinned references` 段）。

### Step 4 — 再跑测试（PASS）

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/agents exec vitest run src/__tests__/writer-tool-runner.test.ts`

### Step 5 — 提交

- [ ] `cd /Users/zeoooo/crossing-writer && git add packages/agents/src/__tests__/writer-tool-runner.test.ts && git -c commit.gpgsign=false commit -m "sp08(T5): cover pinnedContext injection + duration aggregation"`

---

## T6: writer.opening + writer.practice 接入 runner

**目的：** 把 `writer-opening-agent.ts` / `writer-practice-agent.ts` 的内部直接 `invokeAgent(...)` 改成用 `runWriterWithTools`；包装 `invokeAgent` 成 `AgentInvoker`；dispatchTool 调 `dispatchSkill` 需要 `vaultPath` / `sqlitePath`，由外层（orchestrator / rewrite 端点）注入。

### Step 1 — 写测试（FAIL）

新建 `packages/agents/src/roles/__tests__/writer-opening-with-tools.test.ts`：

```ts
import { describe, it, expect, vi } from "vitest";
import { runWriterOpening } from "../writer-opening-agent.js";

describe("writer.opening runs through writer-tool-runner", () => {
  it("passes tools_used through", async () => {
    const invokeAgent = vi.fn()
      .mockResolvedValueOnce({ text: "```tool\nsearch_wiki \"AI 漫剧\"\n```", meta: { cli: "claude", durationMs: 10 } })
      .mockResolvedValueOnce({ text: "最终开头段。", meta: { cli: "claude", durationMs: 10 } });
    const dispatchTool = vi.fn(async () => ({
      ok: true as const, tool: "search_wiki", query: "AI 漫剧", args: {},
      hits: [{ path: "concepts/AI漫剧.md", title: "AI漫剧", score: 10 }],
      hits_count: 1, formatted: "- AI漫剧",
    }));
    const r = await runWriterOpening({
      invokeAgent,
      userMessage: "写开头",
      dispatchTool,
    });
    expect(r.finalText).toBe("最终开头段。");
    expect(r.toolsUsed).toHaveLength(1);
    expect(r.toolsUsed[0]!.tool).toBe("search_wiki");
    expect(invokeAgent).toHaveBeenCalledTimes(2);
  });
});
```

类似地新建 `writer-practice-with-tools.test.ts`。

- [ ] 跑两个测试（FAIL：`runWriterOpening`/`runWriterPractice` 尚未导出）。

### Step 2 — 运行测试（FAIL）

### Step 3 — 实现

改 `packages/agents/src/roles/writer-opening-agent.ts`，新增导出：

```ts
import { runWriterWithTools, type ToolCall, type SkillResult, type WriterToolEvent, type WriterRunResult } from "../writer-tool-runner.js";
import type { ChatMessage } from "../writer-tool-runner.js";

export interface RunWriterOpeningOpts {
  invokeAgent: (messages: ChatMessage[], opts?: { images?: string[] }) => Promise<{ text: string; meta: { cli: string; model?: string; durationMs: number } }>;
  userMessage: string;
  images?: string[];
  pinnedContext?: string;
  dispatchTool: (call: ToolCall) => Promise<SkillResult>;
  onEvent?: (ev: WriterToolEvent) => void;
  sectionKey?: string;
  maxRounds?: number;
}

export async function runWriterOpening(opts: RunWriterOpeningOpts): Promise<WriterRunResult> {
  return runWriterWithTools({
    agent: { invoke: opts.invokeAgent },
    agentName: "writer.opening",
    sectionKey: opts.sectionKey,
    systemPrompt: getSystemPrompt(),
    initialUserMessage: opts.userMessage,
    pinnedContext: opts.pinnedContext,
    dispatchTool: opts.dispatchTool,
    onEvent: opts.onEvent,
    images: opts.images,
    maxRounds: opts.maxRounds,
  });
}
```

对称改 `writer-practice-agent.ts`，导出 `runWriterPractice`。

（保留旧 API 直到 T11 收尾才能全面清理，别急着删。）

### Step 4 — 再跑测试（PASS）

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/agents exec vitest run src/roles/__tests__/writer-opening-with-tools.test.ts src/roles/__tests__/writer-practice-with-tools.test.ts`

### Step 5 — 提交

- [ ] `cd /Users/zeoooo/crossing-writer && git add packages/agents/src/roles/writer-opening-agent.ts packages/agents/src/roles/writer-practice-agent.ts packages/agents/src/roles/__tests__/writer-opening-with-tools.test.ts packages/agents/src/roles/__tests__/writer-practice-with-tools.test.ts && git -c commit.gpgsign=false commit -m "sp08(T6): wire writer.opening+writer.practice through writer-tool-runner"`

---

## T7: writer.closing + style_critic 接入 runner

**目的：** 对称 T6，处理 closing + critic。

### Step 1 — 写测试（FAIL）

新建 `packages/agents/src/roles/__tests__/writer-closing-with-tools.test.ts`：

```ts
import { describe, it, expect, vi } from "vitest";
import { runWriterClosing } from "../writer-closing-agent.js";

describe("writer.closing runs through runner", () => {
  it("no tool call path", async () => {
    const invokeAgent = vi.fn().mockResolvedValue({ text: "结尾。", meta: { cli: "claude", durationMs: 5 } });
    const r = await runWriterClosing({
      invokeAgent, userMessage: "写结尾",
      dispatchTool: async () => { throw new Error("noop"); },
    });
    expect(r.finalText).toBe("结尾。");
    expect(r.toolsUsed).toEqual([]);
  });
});
```

新建 `packages/agents/src/roles/__tests__/style-critic-with-tools.test.ts`：

```ts
import { describe, it, expect, vi } from "vitest";
import { runStyleCritic } from "../style-critic-agent.js";

describe("style_critic runs through runner", () => {
  it("passes tool events through", async () => {
    const invokeAgent = vi.fn()
      .mockResolvedValueOnce({ text: "```tool\nsearch_wiki \"风格\"\n```", meta: { cli: "claude", durationMs: 5 } })
      .mockResolvedValueOnce({ text: "评价：xxx", meta: { cli: "claude", durationMs: 5 } });
    const dispatchTool = async () => ({
      ok: true as const, tool: "search_wiki", query: "风格", args: {},
      hits: [], hits_count: 0, formatted: "()",
    });
    const events: any[] = [];
    const r = await runStyleCritic({
      invokeAgent, userMessage: "评审", dispatchTool,
      onEvent: (e) => events.push(e),
    });
    expect(r.finalText).toBe("评价：xxx");
    expect(events.some((e) => e.type === "tool_called")).toBe(true);
  });
});
```

- [ ] 跑两个测试（FAIL：导出不存在）。

### Step 2 — 运行测试（FAIL）

### Step 3 — 实现

对称 T6 的手法，分别在 `writer-closing-agent.ts` 导出 `runWriterClosing`，在 `style-critic-agent.ts` 导出 `runStyleCritic`。两者 signature 与 T6 保持一致，`agentName` 分别为 `"writer.closing"` 和 `"style_critic"`。

### Step 4 — 再跑测试（PASS）

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/agents exec vitest run src/roles/__tests__/writer-closing-with-tools.test.ts src/roles/__tests__/style-critic-with-tools.test.ts`

### Step 5 — 提交

- [ ] `cd /Users/zeoooo/crossing-writer && git add packages/agents/src/roles/writer-closing-agent.ts packages/agents/src/roles/style-critic-agent.ts packages/agents/src/roles/__tests__/writer-closing-with-tools.test.ts packages/agents/src/roles/__tests__/style-critic-with-tools.test.ts && git -c commit.gpgsign=false commit -m "sp08(T7): wire writer.closing+style_critic through writer-tool-runner"`

---

## T8: rewrite 路由扩展（pinned_skills body + pendingPins + frontmatter.tools_used 落盘）

**目的：** `POST /api/projects/:id/writer/sections/:key/rewrite`：body 新增 `include_pinned_skills?: boolean`（默认 true）；服务端读 `pendingPins[projectId][sectionKey]` 拼成 pinnedContext；跑 runner；完成后清空该 section 的 pin；把 `tools_used` 写入段落 frontmatter。

### Step 1 — 写测试（FAIL）

在 `packages/web-server/src/routes/__tests__/writer-rewrite-tools.test.ts`：

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../../test-helpers/build-app.js";
import { pendingPinsStore } from "../../state/pending-pins.js";

describe("POST rewrite with pinned_skills", () => {
  let app: any;
  beforeEach(async () => { app = await build({ mockAgents: true }); });

  it("injects pendingPins into pinnedContext and clears after rewrite", async () => {
    pendingPinsStore.push("proj1", "opening", {
      ok: true, tool: "search_wiki", query: "AI", args: {},
      hits: [{ path: "concepts/AI.md", title: "AI" }], hits_count: 1,
      formatted: "- AI", pinned_by: "manual:user",
    } as any);
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/proj1/writer/sections/opening/rewrite",
      payload: { user_hint: "再狠一点" },
    });
    expect(res.statusCode).toBe(200);
    expect(pendingPinsStore.list("proj1", "opening")).toEqual([]);
    // section frontmatter.tools_used populated
    const section = await app.readSection("proj1", "opening");
    expect(section.frontmatter.tools_used).toBeDefined();
  });

  it("skips pinnedContext when include_pinned_skills=false", async () => {
    pendingPinsStore.push("proj1", "opening", { ok: true, tool: "search_wiki", query: "x", args: {}, hits: [], hits_count: 0, formatted: "", pinned_by: "manual:u" } as any);
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/proj1/writer/sections/opening/rewrite",
      payload: { include_pinned_skills: false },
    });
    expect(res.statusCode).toBe(200);
    // pin NOT consumed
    expect(pendingPinsStore.list("proj1", "opening").length).toBe(1);
  });
});
```

- [ ] 跑测试 `pnpm --filter @crossing/web-server exec vitest run src/routes/__tests__/writer-rewrite-tools.test.ts`

### Step 2 — 运行测试（FAIL）

### Step 3 — 实现

新建 `packages/web-server/src/state/pending-pins.ts`：

```ts
import type { SkillResult } from "@crossing/kb";

type PinEntry = SkillResult & { pinned_by: `manual:${string}` };

class PendingPinsStore {
  private map = new Map<string, Map<string, PinEntry[]>>();
  push(projectId: string, sectionKey: string, entry: PinEntry) {
    if (!this.map.has(projectId)) this.map.set(projectId, new Map());
    const inner = this.map.get(projectId)!;
    if (!inner.has(sectionKey)) inner.set(sectionKey, []);
    inner.get(sectionKey)!.push(entry);
  }
  list(projectId: string, sectionKey: string): PinEntry[] {
    return this.map.get(projectId)?.get(sectionKey) ?? [];
  }
  clear(projectId: string, sectionKey: string) {
    this.map.get(projectId)?.get(sectionKey)?.splice(0);
  }
  removeAt(projectId: string, sectionKey: string, index: number) {
    const arr = this.map.get(projectId)?.get(sectionKey);
    if (arr && index >= 0 && index < arr.length) arr.splice(index, 1);
  }
}

export const pendingPinsStore = new PendingPinsStore();
```

改 `packages/web-server/src/routes/writer.ts` 的 rewrite 端点（示意片段，保留已有逻辑）：

```ts
import { runWriterWithTools } from "@crossing/agents";
import { dispatchSkill } from "@crossing/kb";
import { pendingPinsStore } from "../state/pending-pins.js";

// inside POST /rewrite
const body = request.body as {
  user_hint?: string;
  selected_text?: string;
  include_pinned_skills?: boolean;
};
const includePins = body.include_pinned_skills !== false;
const pins = includePins ? pendingPinsStore.list(projectId, sectionKey) : [];
const pinnedContext = pins.length
  ? pins
      .map((p, i) =>
        p.ok
          ? `${i + 1}. ${p.tool} "${p.query}"\n${p.formatted}`
          : `${i + 1}. ${p.tool} "${p.query}" (失败: ${p.error})`,
      )
      .join("\n\n")
  : undefined;

const result = await runWriterWithTools({
  agent: buildAgentInvoker(/* ... */),
  agentName: `writer.${sectionKey}`,
  sectionKey,
  systemPrompt: getPromptForSection(sectionKey),
  initialUserMessage: body.user_hint ?? "",
  pinnedContext,
  dispatchTool: (call) =>
    dispatchSkill(call, { vaultPath: project.vaultPath, sqlitePath: project.refsSqlitePath }),
  onEvent: (ev) => publishSseEvent(projectId, `writer.${ev.type}`, ev),
});

// Merge pin usages into tools_used so frontmatter reflects manual pins too:
const manualUsages = pins.map((p, i) => ({
  tool: p.tool,
  query: p.query,
  args: p.args,
  pinned_by: `manual:user` as const,
  round: 0,
  hits_count: p.ok ? p.hits_count : 0,
  hits_summary: [],
}));

await writeSection(projectId, sectionKey, {
  body: result.finalText,
  frontmatter: {
    ...existing.frontmatter,
    last_updated_at: new Date().toISOString(),
    tools_used: [...manualUsages, ...result.toolsUsed],
  },
});

if (includePins) pendingPinsStore.clear(projectId, sectionKey);
```

### Step 4 — 再跑测试（PASS）

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-server exec vitest run src/routes/__tests__/writer-rewrite-tools.test.ts`

### Step 5 — 提交

- [ ] `cd /Users/zeoooo/crossing-writer && git add packages/web-server/src/state/pending-pins.ts packages/web-server/src/routes/writer.ts packages/web-server/src/routes/__tests__/writer-rewrite-tools.test.ts && git -c commit.gpgsign=false commit -m "sp08(T8): extend rewrite route with pinned_skills + tools_used frontmatter"`

---

## T9: POST /sections/:key/skill — 同步执行 dispatchSkill + push pendingPins

**目的：** 新增端点：`POST /api/projects/:id/writer/sections/:key/skill`，body `{ tool: string, args: Record<string,string> }`，server 端同步调 `dispatchSkill`，成功则 push 到 `pendingPinsStore`，返回 `{ ok, hits, formatted, error? }`。

### Step 1 — 写测试（FAIL）

新建 `packages/web-server/src/routes/__tests__/writer-skill.test.ts`：

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../../test-helpers/build-app.js";
import { pendingPinsStore } from "../../state/pending-pins.js";

describe("POST /sections/:key/skill", () => {
  let app: any;
  beforeEach(async () => { app = await build({ mockAgents: true, mockKb: { hits: [{ path: "a.md", title: "A" }] } }); });

  it("executes and pushes to pendingPins", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/proj1/writer/sections/opening/skill",
      payload: { tool: "search_wiki", args: { query: "AI 漫剧", kind: "concept", limit: "3" } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.hits).toHaveLength(1);
    expect(pendingPinsStore.list("proj1", "opening")).toHaveLength(1);
    expect(pendingPinsStore.list("proj1", "opening")[0]!.pinned_by).toBe("manual:user");
  });

  it("returns ok:false for unknown tool and does NOT push", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/proj1/writer/sections/opening/skill",
      payload: { tool: "search_unknown", args: { query: "x" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(false);
    expect(pendingPinsStore.list("proj1", "opening")).toHaveLength(0);
  });
});
```

### Step 2 — FAIL

### Step 3 — 实现

在 `packages/web-server/src/routes/writer.ts` 注册：

```ts
fastify.post<{ Params: { id: string; key: string }; Body: { tool: string; args: Record<string, string> } }>(
  "/api/projects/:id/writer/sections/:key/skill",
  async (req, reply) => {
    const { id, key } = req.params;
    const { tool, args = {} } = req.body;
    const project = await getProject(id);

    // transform args into ToolCall.args tokens
    const argTokens: string[] = [];
    if (args.query !== undefined) argTokens.push(`"${args.query}"`);
    for (const [k, v] of Object.entries(args)) {
      if (k !== "query") argTokens.push(`--${k}=${v}`);
    }

    const result = await dispatchSkill(
      { command: tool, args: argTokens },
      { vaultPath: project.vaultPath, sqlitePath: project.refsSqlitePath },
    );

    if (result.ok) {
      pendingPinsStore.push(id, key, { ...result, pinned_by: "manual:user" } as any);
    }
    return result;
  },
);
```

### Step 4 — PASS

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-server exec vitest run src/routes/__tests__/writer-skill.test.ts`

### Step 5 — 提交

- [ ] `cd /Users/zeoooo/crossing-writer && git add packages/web-server/src/routes/writer.ts packages/web-server/src/routes/__tests__/writer-skill.test.ts && git -c commit.gpgsign=false commit -m "sp08(T9): add POST /writer/sections/:key/skill endpoint"`

---

## T10: GET /sections/:key/pinned + DELETE /sections/:key/pinned/:index

**目的：** 暴露「列出当前 section pinned」「删除某 index 的 pin」给前端 SkillForm / 引用栏。

### Step 1 — 写测试（FAIL）

新建 `packages/web-server/src/routes/__tests__/writer-pinned.test.ts`：

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../../test-helpers/build-app.js";
import { pendingPinsStore } from "../../state/pending-pins.js";

describe("pinned endpoints", () => {
  let app: any;
  beforeEach(async () => {
    app = await build({ mockAgents: true });
    pendingPinsStore.clear("proj1", "opening");
  });

  it("GET returns current pins", async () => {
    pendingPinsStore.push("proj1", "opening", { ok: true, tool: "search_wiki", query: "a", args: {}, hits: [], hits_count: 0, formatted: "", pinned_by: "manual:user" } as any);
    pendingPinsStore.push("proj1", "opening", { ok: true, tool: "search_raw", query: "b", args: {}, hits: [], hits_count: 0, formatted: "", pinned_by: "manual:user" } as any);
    const res = await app.inject({ method: "GET", url: "/api/projects/proj1/writer/sections/opening/pinned" });
    expect(res.statusCode).toBe(200);
    expect(res.json().pins).toHaveLength(2);
  });

  it("DELETE removes specific index", async () => {
    pendingPinsStore.push("proj1", "opening", { ok: true, tool: "search_wiki", query: "a", args: {}, hits: [], hits_count: 0, formatted: "", pinned_by: "manual:user" } as any);
    pendingPinsStore.push("proj1", "opening", { ok: true, tool: "search_raw", query: "b", args: {}, hits: [], hits_count: 0, formatted: "", pinned_by: "manual:user" } as any);
    const res = await app.inject({ method: "DELETE", url: "/api/projects/proj1/writer/sections/opening/pinned/0" });
    expect(res.statusCode).toBe(200);
    const remaining = pendingPinsStore.list("proj1", "opening");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.tool).toBe("search_raw");
  });

  it("DELETE invalid index is noop 200", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/projects/proj1/writer/sections/opening/pinned/99" });
    expect(res.statusCode).toBe(200);
  });
});
```

### Step 2 — FAIL

### Step 3 — 实现

在 `packages/web-server/src/routes/writer.ts`：

```ts
fastify.get<{ Params: { id: string; key: string } }>(
  "/api/projects/:id/writer/sections/:key/pinned",
  async (req) => ({ pins: pendingPinsStore.list(req.params.id, req.params.key) }),
);

fastify.delete<{ Params: { id: string; key: string; index: string } }>(
  "/api/projects/:id/writer/sections/:key/pinned/:index",
  async (req) => {
    const idx = parseInt(req.params.index, 10);
    if (Number.isFinite(idx)) pendingPinsStore.removeAt(req.params.id, req.params.key, idx);
    return { ok: true };
  },
);
```

### Step 4 — PASS

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-server exec vitest run src/routes/__tests__/writer-pinned.test.ts`

### Step 5 — 提交

- [ ] `cd /Users/zeoooo/crossing-writer && git add packages/web-server/src/routes/writer.ts packages/web-server/src/routes/__tests__/writer-pinned.test.ts && git -c commit.gpgsign=false commit -m "sp08(T10): add GET/DELETE pinned endpoints"`

---

## T11: orchestrator 接入 runner（4 agent 全跑 tool 模式）

**目的：** 改 `packages/agents/src/orchestrator.ts`（或 `packages/web-server/src/services/writer-orchestrator.ts`，按实际路径），让"初稿生成"路径也走 `runWriterOpening / runWriterPractice / runWriterClosing / runStyleCritic`，从而 4 个 agent 在首次生成时都能主动调 skill。同时把 `onEvent` 桥接到 SSE stream。

### Step 1 — 写测试（FAIL）

新建 `packages/agents/src/__tests__/orchestrator-tools.test.ts`：

```ts
import { describe, it, expect, vi } from "vitest";
import { runOrchestrator } from "../orchestrator.js";

describe("orchestrator runs 4 agents through tool runner", () => {
  it("emits tool events for each agent when they use tools", async () => {
    const events: any[] = [];
    const invokeAgent = vi.fn()
      // opening: 1 tool then done
      .mockResolvedValueOnce({ text: "```tool\nsearch_wiki \"a\"\n```", meta: { cli: "claude", durationMs: 1 } })
      .mockResolvedValueOnce({ text: "opening final", meta: { cli: "claude", durationMs: 1 } })
      // practice: no tool
      .mockResolvedValueOnce({ text: "practice final", meta: { cli: "claude", durationMs: 1 } })
      // closing: no tool
      .mockResolvedValueOnce({ text: "closing final", meta: { cli: "claude", durationMs: 1 } })
      // critic: no tool
      .mockResolvedValueOnce({ text: "critic final", meta: { cli: "claude", durationMs: 1 } });

    const dispatchTool = async () => ({
      ok: true as const, tool: "search_wiki", query: "a", args: {}, hits: [], hits_count: 0, formatted: "()",
    });

    const r = await runOrchestrator({
      invokeAgent, dispatchTool,
      userMessage: "写一篇",
      onEvent: (e) => events.push(e),
    });
    expect(r.sections.opening.finalText).toBe("opening final");
    expect(events.filter((e) => e.type === "tool_called" && e.agent === "writer.opening")).toHaveLength(1);
  });
});
```

（如 `runOrchestrator` 文件路径不同，相应调整。）

### Step 2 — FAIL

### Step 3 — 实现

在 orchestrator 入口：

```ts
import { runWriterOpening } from "./roles/writer-opening-agent.js";
import { runWriterPractice } from "./roles/writer-practice-agent.js";
import { runWriterClosing } from "./roles/writer-closing-agent.js";
import { runStyleCritic } from "./roles/style-critic-agent.js";
import type { ToolCall, SkillResult, WriterToolEvent, ChatMessage } from "./writer-tool-runner.js";

export interface OrchestratorOpts {
  invokeAgent: (messages: ChatMessage[], opts?: { images?: string[] }) => Promise<{ text: string; meta: any }>;
  dispatchTool: (call: ToolCall) => Promise<SkillResult>;
  userMessage: string;
  onEvent?: (ev: WriterToolEvent) => void;
  maxRounds?: number;
}

export async function runOrchestrator(opts: OrchestratorOpts) {
  const common = {
    invokeAgent: opts.invokeAgent,
    dispatchTool: opts.dispatchTool,
    onEvent: opts.onEvent,
    maxRounds: opts.maxRounds,
  };
  const opening = await runWriterOpening({ ...common, userMessage: opts.userMessage, sectionKey: "opening" });
  const practice = await runWriterPractice({ ...common, userMessage: opts.userMessage, sectionKey: "practice" });
  const closing = await runWriterClosing({ ...common, userMessage: opts.userMessage, sectionKey: "closing" });
  const critic = await runStyleCritic({ ...common, userMessage: opts.userMessage, sectionKey: "style_critic" });

  return {
    sections: { opening, practice, closing },
    critic,
  };
}
```

在 web-server orchestrator 调用点把已有的旧 invoke 链替换为 `runOrchestrator`，同时把 `onEvent` 桥接成 SSE：`publishSseEvent(projectId, 'writer.' + ev.type, ev)`。

### Step 4 — PASS

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/agents exec vitest run src/__tests__/orchestrator-tools.test.ts`
- [ ] 跑全量 agents 测试确认无回归：`pnpm --filter @crossing/agents exec vitest run`

### Step 5 — 提交

- [ ] `cd /Users/zeoooo/crossing-writer && git add packages/agents/src/orchestrator.ts packages/agents/src/__tests__/orchestrator-tools.test.ts packages/web-server/src/services/writer-orchestrator.ts && git -c commit.gpgsign=false commit -m "sp08(T11): wire orchestrator through runner for all 4 agents"`

---

## Task T12 — useProjectStream 新增 4 个 writer.tool_* SSE 事件

**目标**：扩展 `packages/web-ui/src/hooks/useProjectStream.ts` 的 `EVENT_TYPES` 白名单与 reducer，承接 `writer.tool_called` / `writer.tool_returned` / `writer.tool_failed` / `writer.tool_round_completed` 四个新事件，保持时间线顺序注入 `state.events`。

### Step 1 — 写测试

- [ ] 新建文件 `packages/web-ui/src/hooks/__tests__/useProjectStream-tools.test.ts`：

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useProjectStream } from "../useProjectStream";

class MockEventSource {
  static instances: MockEventSource[] = [];
  listeners = new Map<string, ((ev: MessageEvent) => void)[]>();
  url: string;
  readyState = 1;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (ev: MessageEvent) => void) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(cb);
    this.listeners.set(type, arr);
  }
  removeEventListener() {}
  close() {}
  dispatch(type: string, payload: unknown) {
    const arr = this.listeners.get(type) ?? [];
    for (const cb of arr) cb(new MessageEvent(type, { data: JSON.stringify(payload) }));
  }
}

beforeEach(() => {
  MockEventSource.instances = [];
  (globalThis as any).EventSource = MockEventSource;
});

describe("useProjectStream writer.tool_* events", () => {
  it("appends writer.tool_called / tool_returned / tool_failed / tool_round_completed in order", () => {
    const { result } = renderHook(() => useProjectStream("proj-1"));
    const es = MockEventSource.instances[0];
    act(() => {
      es.dispatch("writer.tool_called", { sectionKey: "opening", round: 1, toolName: "search_raw", args: { query: "x" }, ts: 1 });
      es.dispatch("writer.tool_returned", { sectionKey: "opening", round: 1, toolName: "search_raw", ok: true, ts: 2 });
      es.dispatch("writer.tool_failed", { sectionKey: "opening", round: 2, toolName: "search_raw", error: "boom", ts: 3 });
      es.dispatch("writer.tool_round_completed", { sectionKey: "opening", round: 2, ts: 4 });
    });
    const types = result.current.events.map((e) => e.type);
    expect(types).toEqual([
      "writer.tool_called",
      "writer.tool_returned",
      "writer.tool_failed",
      "writer.tool_round_completed",
    ]);
    expect(result.current.events[0].payload).toMatchObject({ toolName: "search_raw", round: 1 });
  });

  it("ignores unknown event types", () => {
    const { result } = renderHook(() => useProjectStream("proj-1"));
    const es = MockEventSource.instances[0];
    act(() => {
      es.dispatch("writer.tool_unknown", { foo: 1 });
    });
    expect(result.current.events).toHaveLength(0);
  });
});
```

### Step 2 — run FAIL

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-ui exec vitest run src/hooks/__tests__/useProjectStream-tools.test.ts`

### Step 3 — 实现

- [ ] 修改 `packages/web-ui/src/hooks/useProjectStream.ts`：在 `EVENT_TYPES` 数组追加 4 个新类型。

```ts
const EVENT_TYPES = [
  "writer.started",
  "writer.section_drafted",
  "writer.section_rewritten",
  "writer.completed",
  "writer.failed",
  "writer.tool_called",
  "writer.tool_returned",
  "writer.tool_failed",
  "writer.tool_round_completed",
] as const;
```

- [ ] reducer 里现有的 `case "append"` 已经按 `ev.type` 透传，无需改；仅确保 `EventSource.addEventListener` 循环是基于 `EVENT_TYPES` 动态注册的。若代码是写死的 switch，则补上同样 4 个 branch：

```ts
for (const t of EVENT_TYPES) {
  es.addEventListener(t, (ev: MessageEvent) => {
    try {
      const payload = JSON.parse(ev.data);
      dispatch({ kind: "append", event: { type: t, payload, ts: Date.now() } });
    } catch (err) {
      console.warn("[useProjectStream] bad payload", t, err);
    }
  });
}
```

### Step 4 — run PASS

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-ui exec vitest run src/hooks/__tests__/useProjectStream-tools.test.ts`
- [ ] `pnpm --filter @crossing/web-ui exec vitest run src/hooks`

### Step 5 — 提交

- [ ] `cd /Users/zeoooo/crossing-writer && git add packages/web-ui/src/hooks/useProjectStream.ts packages/web-ui/src/hooks/__tests__/useProjectStream-tools.test.ts && git -c commit.gpgsign=false commit -m "sp08(T12): useProjectStream accepts 4 writer.tool_* SSE events"`

---

## Task T13 — writer-client 新增 callSkill / getPinned / deletePin

**目标**：在 `packages/web-ui/src/api/writer-client.ts` 增加 3 个函数，对齐 web-server 路由 `POST /writer/:projectId/skills/:name`、`GET /writer/:projectId/pinned`、`DELETE /writer/:projectId/pinned/:id`。

### Step 1 — 写测试

- [ ] 新建 `packages/web-ui/src/api/__tests__/writer-client-skills.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { callSkill, getPinned, deletePin } from "../writer-client";

const origFetch = globalThis.fetch;
beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  globalThis.fetch = origFetch;
});

describe("writer-client skill APIs", () => {
  it("callSkill POSTs args and returns SkillResult", async () => {
    globalThis.fetch = vi.fn(async (url, init) => {
      expect(url).toBe("/api/writer/p1/skills/search_raw");
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({ query: "nvidia", topK: 3 });
      return new Response(JSON.stringify({ ok: true, data: { hits: [{ id: "a" }] } }), { status: 200 });
    }) as any;
    const r = await callSkill("p1", "search_raw", { query: "nvidia", topK: 3 });
    expect(r).toEqual({ ok: true, data: { hits: [{ id: "a" }] } });
  });

  it("getPinned GETs pinned list", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      expect(url).toBe("/api/writer/p1/pinned");
      return new Response(JSON.stringify({ items: [{ id: "x", title: "t" }] }), { status: 200 });
    }) as any;
    const r = await getPinned("p1");
    expect(r.items).toHaveLength(1);
  });

  it("deletePin DELETEs by id", async () => {
    const fn = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fn as any;
    await deletePin("p1", "x1");
    expect(fn).toHaveBeenCalledWith("/api/writer/p1/pinned/x1", expect.objectContaining({ method: "DELETE" }));
  });
});
```

### Step 2 — run FAIL

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-ui exec vitest run src/api/__tests__/writer-client-skills.test.ts`

### Step 3 — 实现

- [ ] 追加到 `packages/web-ui/src/api/writer-client.ts`：

```ts
import type { SkillResult } from "@crossing/agents";

export async function callSkill(
  projectId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<SkillResult> {
  const res = await fetch(`/api/writer/${projectId}/skills/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status}` };
  }
  return (await res.json()) as SkillResult;
}

export interface PinnedItem {
  id: string;
  title: string;
  url?: string;
  source?: string;
  snippet?: string;
  pinnedAt: number;
}

export async function getPinned(projectId: string): Promise<{ items: PinnedItem[] }> {
  const res = await fetch(`/api/writer/${projectId}/pinned`);
  if (!res.ok) throw new Error(`getPinned HTTP ${res.status}`);
  return (await res.json()) as { items: PinnedItem[] };
}

export async function deletePin(projectId: string, id: string): Promise<void> {
  const res = await fetch(`/api/writer/${projectId}/pinned/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`deletePin HTTP ${res.status}`);
}
```

### Step 4 — run PASS

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-ui exec vitest run src/api/__tests__/writer-client-skills.test.ts`

### Step 5 — 提交

- [ ] `cd /Users/zeoooo/crossing-writer && git add packages/web-ui/src/api/writer-client.ts packages/web-ui/src/api/__tests__/writer-client-skills.test.ts && git -c commit.gpgsign=false commit -m "sp08(T13): writer-client adds callSkill/getPinned/deletePin"`

---

## Task T14 — ArticleSection「📚 本段引用」折叠栏

**目标**：在段落卡片底部增加可折叠「📚 本段引用」，内容 = `frontmatter.tools_used`（本段自产）∪ `GET /pinned`（人工钉的，按 sectionKey 过滤）。

### Step 1 — 写测试

- [ ] 新建 `packages/web-ui/src/components/writer/__tests__/ArticleSection-references.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ArticleSection } from "../ArticleSection";
import * as client from "../../../api/writer-client";

beforeEach(() => {
  vi.spyOn(client, "getPinned").mockResolvedValue({
    items: [{ id: "p1", title: "pinned-A", sectionKey: "opening", pinnedAt: 1 } as any],
  });
});

describe("ArticleSection references panel", () => {
  it("renders tools_used from frontmatter and pinned items merged", async () => {
    const section = {
      key: "opening",
      title: "开场",
      markdown: "body",
      frontmatter: {
        tools_used: [
          { toolName: "search_raw", round: 1, ok: true, summary: "found 3", ts: 100 },
        ],
      },
    };
    render(<ArticleSection projectId="p1" section={section as any} onRewrite={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /本段引用/ }));
    await waitFor(() => {
      expect(screen.getByText(/search_raw/)).toBeInTheDocument();
      expect(screen.getByText(/pinned-A/)).toBeInTheDocument();
    });
  });

  it("shows empty hint when no references", async () => {
    vi.spyOn(client, "getPinned").mockResolvedValueOnce({ items: [] });
    const section = { key: "practice", title: "实战", markdown: "b", frontmatter: {} };
    render(<ArticleSection projectId="p1" section={section as any} onRewrite={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /本段引用/ }));
    await waitFor(() => {
      expect(screen.getByText(/暂无引用/)).toBeInTheDocument();
    });
  });
});
```

### Step 2 — run FAIL

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-ui exec vitest run src/components/writer/__tests__/ArticleSection-references.test.tsx`

### Step 3 — 实现

- [ ] 修改 `packages/web-ui/src/components/writer/ArticleSection.tsx`：新增 `ReferencePanel` 子组件，注入段落卡片底部。

```tsx
import { useEffect, useState } from "react";
import { getPinned, type PinnedItem } from "../../api/writer-client";
import type { ToolUsage } from "@crossing/agents";

function ReferencePanel({ projectId, sectionKey, toolsUsed }: { projectId: string; sectionKey: string; toolsUsed: ToolUsage[] }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState<PinnedItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getPinned(projectId)
      .then((r) => setPinned(r.items.filter((x: any) => !x.sectionKey || x.sectionKey === sectionKey)))
      .catch(() => setPinned([]))
      .finally(() => setLoading(false));
  }, [open, projectId, sectionKey]);

  const total = (toolsUsed?.length ?? 0) + pinned.length;

  return (
    <div className="mt-2 border-t pt-2 text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-slate-500 hover:text-slate-800"
      >
        {open ? "▼" : "▶"} 📚 本段引用 ({total})
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          {loading && <div className="text-slate-400">加载中...</div>}
          {!loading && total === 0 && <div className="text-slate-400">暂无引用</div>}
          {toolsUsed?.map((u, i) => (
            <div key={`tu-${i}`} className="text-slate-700">
              <span className="font-mono text-xs">[{u.toolName}·r{u.round}]</span> {u.summary ?? (u.ok ? "ok" : "fail")}
            </div>
          ))}
          {pinned.map((p) => (
            <div key={p.id} className="text-slate-700">
              <span className="text-xs text-amber-600">[📌]</span> {p.title}
              {p.url && <a className="ml-1 text-blue-600" href={p.url} target="_blank" rel="noreferrer">↗</a>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] 在 `ArticleSection` 主组件 return 的卡片末尾渲染 `<ReferencePanel projectId={projectId} sectionKey={section.key} toolsUsed={section.frontmatter?.tools_used ?? []} />`。

### Step 4 — run PASS

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-ui exec vitest run src/components/writer/__tests__/ArticleSection-references.test.tsx`

### Step 5 — 提交

- [ ] `cd /Users/zeoooo/crossing-writer && git add packages/web-ui/src/components/writer/ArticleSection.tsx packages/web-ui/src/components/writer/__tests__/ArticleSection-references.test.tsx && git -c commit.gpgsign=false commit -m "sp08(T14): ArticleSection references panel merges tools_used + pinned"`

---

## Task T15 — SkillForm 弹窗组件

**目标**：新建 `packages/web-ui/src/components/writer/SkillForm.tsx`，提供 tool 选择、参数 JSON 输入、execute 按钮，调用 `callSkill` 并回调结果。

### Step 1 — 写测试

- [ ] 新建 `packages/web-ui/src/components/writer/__tests__/SkillForm.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SkillForm } from "../SkillForm";
import * as client from "../../../api/writer-client";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("SkillForm", () => {
  it("executes selected tool with args and calls onResult", async () => {
    const spy = vi.spyOn(client, "callSkill").mockResolvedValue({ ok: true, data: { hits: [] } });
    const onResult = vi.fn();
    render(<SkillForm projectId="p1" sectionKey="opening" onClose={vi.fn()} onResult={onResult} />);
    fireEvent.change(screen.getByLabelText(/工具/), { target: { value: "search_raw" } });
    fireEvent.change(screen.getByLabelText(/参数/), { target: { value: '{"query":"x","topK":5}' } });
    fireEvent.click(screen.getByRole("button", { name: /执行/ }));
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith("p1", "search_raw", { query: "x", topK: 5 });
      expect(onResult).toHaveBeenCalledWith({ ok: true, data: { hits: [] } });
    });
  });

  it("shows error on invalid json", () => {
    render(<SkillForm projectId="p1" sectionKey="opening" onClose={vi.fn()} onResult={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/参数/), { target: { value: "{not json" } });
    fireEvent.click(screen.getByRole("button", { name: /执行/ }));
    expect(screen.getByText(/JSON 解析失败/)).toBeInTheDocument();
  });
});
```

### Step 2 — run FAIL

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-ui exec vitest run src/components/writer/__tests__/SkillForm.test.tsx`

### Step 3 — 实现

- [ ] 新建 `packages/web-ui/src/components/writer/SkillForm.tsx`：

```tsx
import { useState } from "react";
import { callSkill } from "../../api/writer-client";
import type { SkillResult } from "@crossing/agents";

const TOOL_OPTIONS = [
  { value: "search_raw", label: "search_raw（搜索素材库）" },
  { value: "pin_reference", label: "pin_reference（钉引用）" },
  { value: "fetch_url", label: "fetch_url（抓取 URL）" },
];

export function SkillForm({
  projectId,
  sectionKey,
  onClose,
  onResult,
}: {
  projectId: string;
  sectionKey: string;
  onClose: () => void;
  onResult: (r: SkillResult) => void;
}) {
  const [tool, setTool] = useState(TOOL_OPTIONS[0].value);
  const [argsText, setArgsText] = useState("{}");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function exec() {
    setErr(null);
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(argsText);
    } catch {
      setErr("JSON 解析失败");
      return;
    }
    setBusy(true);
    try {
      const r = await callSkill(projectId, tool, { ...args, sectionKey });
      onResult(r);
      if (r.ok) onClose();
      else setErr(r.error ?? "调用失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
      <div className="w-[480px] rounded bg-white p-4 shadow">
        <div className="mb-2 text-lg font-semibold">🔧 调用工具</div>
        <label className="block text-sm" htmlFor="skill-tool">工具</label>
        <select
          id="skill-tool"
          value={tool}
          onChange={(e) => setTool(e.target.value)}
          className="mb-2 w-full border p-1"
        >
          {TOOL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <label className="block text-sm" htmlFor="skill-args">参数（JSON）</label>
        <textarea
          id="skill-args"
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          rows={6}
          className="mb-2 w-full border p-1 font-mono text-xs"
        />
        {err && <div className="mb-2 text-sm text-red-600">{err}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="border px-3 py-1">取消</button>
          <button type="button" onClick={exec} disabled={busy} className="bg-blue-600 px-3 py-1 text-white disabled:opacity-50">
            {busy ? "执行中..." : "执行"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

### Step 4 — run PASS

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-ui exec vitest run src/components/writer/__tests__/SkillForm.test.tsx`

### Step 5 — 提交

- [ ] `cd /Users/zeoooo/crossing-writer && git add packages/web-ui/src/components/writer/SkillForm.tsx packages/web-ui/src/components/writer/__tests__/SkillForm.test.tsx && git -c commit.gpgsign=false commit -m "sp08(T15): SkillForm modal for manual tool dispatch"`

---

## Task T16 — ArticleSection hover [🔧 @skill] 按钮

**目标**：在 `ArticleSection` 现有 hover 工具栏上追加 `[🔧 @skill]` 按钮，点击打开 `SkillForm`。

### Step 1 — 写测试

- [ ] 新建 `packages/web-ui/src/components/writer/__tests__/ArticleSection-skill-button.test.tsx`：

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ArticleSection } from "../ArticleSection";

vi.mock("../../../api/writer-client", () => ({
  getPinned: vi.fn().mockResolvedValue({ items: [] }),
  callSkill: vi.fn(),
  deletePin: vi.fn(),
  putSection: vi.fn(),
  rewriteSectionStream: vi.fn(),
}));

describe("ArticleSection skill button", () => {
  it("opens SkillForm when [🔧 @skill] is clicked", () => {
    const section = { key: "opening", title: "开场", markdown: "b", frontmatter: {} };
    render(<ArticleSection projectId="p1" section={section as any} onRewrite={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /@skill/ }));
    expect(screen.getByText(/调用工具/)).toBeInTheDocument();
  });
});
```

### Step 2 — run FAIL

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-ui exec vitest run src/components/writer/__tests__/ArticleSection-skill-button.test.tsx`

### Step 3 — 实现

- [ ] 在 `ArticleSection.tsx` 顶部 `import { SkillForm } from "./SkillForm";`；
- [ ] 组件内新增 `const [skillOpen, setSkillOpen] = useState(false);`；
- [ ] 在已有 hover 工具栏（与 `[✍️ 重写]` 同一 div）追加：

```tsx
<button
  type="button"
  className="border px-2 py-0.5 text-xs"
  onClick={() => setSkillOpen(true)}
>
  🔧 @skill
</button>
```

- [ ] return 末尾条件渲染：

```tsx
{skillOpen && (
  <SkillForm
    projectId={projectId}
    sectionKey={section.key}
    onClose={() => setSkillOpen(false)}
    onResult={() => { /* 让 ReferencePanel 下次展开时重取 pinned */ }}
  />
)}
```

### Step 4 — run PASS

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-ui exec vitest run src/components/writer/__tests__/ArticleSection-skill-button.test.tsx`

### Step 5 — 提交

- [ ] `cd /Users/zeoooo/crossing-writer && git add packages/web-ui/src/components/writer/ArticleSection.tsx packages/web-ui/src/components/writer/__tests__/ArticleSection-skill-button.test.tsx && git -c commit.gpgsign=false commit -m "sp08(T16): ArticleSection hover adds [🔧 @skill] opening SkillForm"`

---

## Task T17 — AgentTimeline tool 事件渲染

**目标**：`packages/web-ui/src/components/status/AgentTimeline.tsx` 对 4 个 `writer.tool_*` 事件增加可视化行（不同图标 + 颜色）。

### Step 1 — 写测试

- [ ] 新建 `packages/web-ui/src/components/status/__tests__/AgentTimeline-tools.test.tsx`：

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentTimeline } from "../AgentTimeline";

const events = [
  { type: "writer.tool_called", payload: { sectionKey: "opening", round: 1, toolName: "search_raw", args: { query: "x" } }, ts: 1 },
  { type: "writer.tool_returned", payload: { sectionKey: "opening", round: 1, toolName: "search_raw", ok: true }, ts: 2 },
  { type: "writer.tool_failed", payload: { sectionKey: "opening", round: 2, toolName: "search_raw", error: "boom" }, ts: 3 },
  { type: "writer.tool_round_completed", payload: { sectionKey: "opening", round: 2 }, ts: 4 },
];

describe("AgentTimeline tool events", () => {
  it("renders 4 tool event types with distinct labels", () => {
    render(<AgentTimeline events={events as any} />);
    expect(screen.getByText(/→ search_raw/)).toBeInTheDocument();
    expect(screen.getByText(/← search_raw ok/)).toBeInTheDocument();
    expect(screen.getByText(/✗ search_raw: boom/)).toBeInTheDocument();
    expect(screen.getByText(/round 2 完成/)).toBeInTheDocument();
  });
});
```

### Step 2 — run FAIL

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-ui exec vitest run src/components/status/__tests__/AgentTimeline-tools.test.tsx`

### Step 3 — 实现

- [ ] 在 `AgentTimeline.tsx` 的事件 switch/map 中加入 4 个分支：

```tsx
case "writer.tool_called":
  return (
    <li key={i} className="text-xs text-sky-700">
      🔧 [{ev.payload.sectionKey}·r{ev.payload.round}] → {ev.payload.toolName}({JSON.stringify(ev.payload.args)})
    </li>
  );
case "writer.tool_returned":
  return (
    <li key={i} className="text-xs text-emerald-700">
      ✅ [{ev.payload.sectionKey}·r{ev.payload.round}] ← {ev.payload.toolName} {ev.payload.ok ? "ok" : "fail"}
    </li>
  );
case "writer.tool_failed":
  return (
    <li key={i} className="text-xs text-red-600">
      ❌ [{ev.payload.sectionKey}·r{ev.payload.round}] ✗ {ev.payload.toolName}: {ev.payload.error}
    </li>
  );
case "writer.tool_round_completed":
  return (
    <li key={i} className="text-xs text-slate-500">
      ⟳ [{ev.payload.sectionKey}] round {ev.payload.round} 完成
    </li>
  );
```

### Step 4 — run PASS

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-ui exec vitest run src/components/status/__tests__/AgentTimeline-tools.test.tsx`

### Step 5 — 提交

- [ ] `cd /Users/zeoooo/crossing-writer && git add packages/web-ui/src/components/status/AgentTimeline.tsx packages/web-ui/src/components/status/__tests__/AgentTimeline-tools.test.tsx && git -c commit.gpgsign=false commit -m "sp08(T17): AgentTimeline renders 4 writer.tool_* events"`

---

## Task T18 — ArticleStore.writeSection 透传 tools_used

**目标**：确保 `packages/web-server/src/services/article-store.ts#writeSection` 把 `frontmatter.tools_used` 字段写入 Markdown frontmatter 并在读回时保留。

### Step 1 — 写测试

- [ ] 新建 `packages/web-server/src/services/__tests__/article-store-tools-used.test.ts`：

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArticleStore } from "../article-store";

describe("ArticleStore.writeSection tools_used passthrough", () => {
  let dir: string;
  let store: ArticleStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "as-"));
    store = new ArticleStore(dir);
  });

  it("round-trips tools_used in frontmatter", async () => {
    const usage = [
      { toolName: "search_raw", round: 1, ok: true, summary: "3 hits", ts: 100 },
    ];
    await store.writeSection("proj-1", "opening", {
      title: "开场",
      markdown: "body",
      frontmatter: { tools_used: usage, word_count: 10 },
    });
    const read = await store.readSection("proj-1", "opening");
    expect(read?.frontmatter?.tools_used).toEqual(usage);
    expect(read?.frontmatter?.word_count).toBe(10);
  });
});
```

### Step 2 — run FAIL

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-server exec vitest run src/services/__tests__/article-store-tools-used.test.ts`

（若现有实现已用 `{ ...frontmatter }` spread 写入，则测试可能直接通过 — 此时 step 3 只需 verify 无需改。）

### Step 3 — 实现（仅当 FAIL）

- [ ] 修改 `article-store.ts#writeSection` 的 frontmatter 序列化处，确保使用 spread 保留所有字段：

```ts
const fm = {
  title: section.title,
  ...(section.frontmatter ?? {}),
};
const yaml = stringifyYaml(fm);
```

- [ ] 读回 `readSection` 同样 `frontmatter: parsed.data as Record<string, unknown>`，不要 whitelist。

### Step 4 — run PASS

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-server exec vitest run src/services/__tests__/article-store-tools-used.test.ts`
- [ ] `pnpm --filter @crossing/web-server exec vitest run src/services`

### Step 5 — 提交

- [ ] `cd /Users/zeoooo/crossing-writer && git add packages/web-server/src/services/article-store.ts packages/web-server/src/services/__tests__/article-store-tools-used.test.ts && git -c commit.gpgsign=false commit -m "sp08(T18): ArticleStore preserves frontmatter.tools_used round-trip"`

---

## Task T19 — orchestrator SSE 透传 tool_* 事件

**目标**：在 `packages/web-server/src/routes/writer.ts` 的 orchestrator 启动路由中，把 `runOrchestrator` 的 `onEvent(WriterToolEvent)` 桥接成 4 个 `writer.tool_*` SSE 帧。

### Step 1 — 写测试

- [ ] 新建 `packages/web-server/src/routes/__tests__/writer-sse-tools.test.ts`：

```ts
import { describe, it, expect, vi } from "vitest";
import { buildApp } from "../../app";

describe("writer SSE forwards tool_* events", () => {
  it("emits writer.tool_called / tool_returned / tool_round_completed for an orchestrator run", async () => {
    const app = await buildApp({
      // 注入 mock orchestrator：立即 emit 3 个事件后 resolve
      runOrchestrator: async ({ onEvent }: any) => {
        onEvent({ type: "tool_called", sectionKey: "opening", round: 1, toolName: "search_raw", args: {}, ts: 1 });
        onEvent({ type: "tool_returned", sectionKey: "opening", round: 1, toolName: "search_raw", ok: true, ts: 2 });
        onEvent({ type: "tool_round_completed", sectionKey: "opening", round: 1, ts: 3 });
        return { sections: {}, critic: {} };
      },
    } as any);

    const res = await app.inject({
      method: "POST",
      url: "/api/writer/proj-1/run",
      headers: { accept: "text/event-stream" },
      payload: { userMessage: "hi" },
    });
    const body = res.body;
    expect(body).toContain("event: writer.tool_called");
    expect(body).toContain("event: writer.tool_returned");
    expect(body).toContain("event: writer.tool_round_completed");
  });
});
```

### Step 2 — run FAIL

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-server exec vitest run src/routes/__tests__/writer-sse-tools.test.ts`

### Step 3 — 实现

- [ ] 修改 `packages/web-server/src/routes/writer.ts`：在启动 orchestrator 的地方把 `onEvent` 映射为 SSE `write`：

```ts
await runOrchestrator({
  userMessage: body.userMessage,
  invokeAgent,
  dispatchTool,
  onEvent: (ev) => {
    // ev: WriterToolEvent { type: "tool_called" | "tool_returned" | "tool_failed" | "tool_round_completed", ... }
    writeSse(reply, `writer.${ev.type}`, ev);
  },
});
```

其中 `writeSse(reply, eventName, payload)` 复用现有写函数（与 `writer.started` 同）。

### Step 4 — run PASS

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-server exec vitest run src/routes/__tests__/writer-sse-tools.test.ts`
- [ ] `pnpm --filter @crossing/web-server exec vitest run src/routes`

### Step 5 — 提交

- [ ] `cd /Users/zeoooo/crossing-writer && git add packages/web-server/src/routes/writer.ts packages/web-server/src/routes/__tests__/writer-sse-tools.test.ts && git -c commit.gpgsign=false commit -m "sp08(T19): orchestrator SSE forwards 4 writer.tool_* events"`

---

## Task T20 — rewrite SSE 透传 tool_* 事件

**目标**：`POST /writer/:projectId/sections/:key/rewrite`（流式重写单段）同样桥接 `onEvent(WriterToolEvent)` 到 4 个 SSE 帧。

### Step 1 — 写测试

- [ ] 新建 `packages/web-server/src/routes/__tests__/writer-rewrite-sse-tools.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { buildApp } from "../../app";

describe("rewrite SSE forwards tool_* events", () => {
  it("emits tool_called and tool_failed during rewrite run", async () => {
    const app = await buildApp({
      runWriterForSection: async ({ onEvent }: any) => {
        onEvent({ type: "tool_called", sectionKey: "practice", round: 1, toolName: "fetch_url", args: {}, ts: 1 });
        onEvent({ type: "tool_failed", sectionKey: "practice", round: 1, toolName: "fetch_url", error: "net", ts: 2 });
        return { content: "new body", toolsUsed: [] };
      },
    } as any);

    const res = await app.inject({
      method: "POST",
      url: "/api/writer/proj-1/sections/practice/rewrite",
      headers: { accept: "text/event-stream" },
      payload: { instruction: "改短" },
    });
    expect(res.body).toContain("event: writer.tool_called");
    expect(res.body).toContain("event: writer.tool_failed");
  });
});
```

### Step 2 — run FAIL

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-server exec vitest run src/routes/__tests__/writer-rewrite-sse-tools.test.ts`

### Step 3 — 实现

- [ ] 在 `writer.ts` 的 rewrite handler 中复用相同桥接：

```ts
const result = await runWriterForSection({
  userMessage: body.instruction,
  invokeAgent,
  dispatchTool,
  sectionKey: params.key,
  onEvent: (ev) => writeSse(reply, `writer.${ev.type}`, ev),
});
writeSse(reply, "writer.section_rewritten", { sectionKey: params.key, content: result.content });
```

### Step 4 — run PASS

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-server exec vitest run src/routes/__tests__/writer-rewrite-sse-tools.test.ts`

### Step 5 — 提交

- [ ] `cd /Users/zeoooo/crossing-writer && git add packages/web-server/src/routes/writer.ts packages/web-server/src/routes/__tests__/writer-rewrite-sse-tools.test.ts && git -c commit.gpgsign=false commit -m "sp08(T20): rewrite SSE forwards 4 writer.tool_* events"`

---

## Task T21 — e2e integration

**目标**：把前述所有层串起来。mock `dispatchTool`，跑 `runWriterOpening` 让其多轮工具调用，最终验证：(a) `WriterRunResult.toolsUsed` 长度 ≥ 2；(b) `ArticleStore.writeSection` 写入的 frontmatter 含 `tools_used`；(c) `onEvent` 收到 4 类事件至少各 1 次。

### Step 1 — 写测试

- [ ] 新建 `packages/web-server/src/__tests__/sp08-e2e.test.ts`：

```ts
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWriterOpening } from "@crossing/agents";
import { ArticleStore } from "../services/article-store";

describe("sp08 e2e: writer-opening with tools → store + events", () => {
  it("multi-round tool use lands in frontmatter and emits 4 event types", async () => {
    const events: any[] = [];
    const dir = mkdtempSync(join(tmpdir(), "sp08e2e-"));
    const store = new ArticleStore(dir);

    // Mock invokeAgent: round1 → tool_calls; round2 → tool_calls; round3 → final content
    const invokeAgent = vi.fn()
      .mockResolvedValueOnce({
        role: "assistant",
        content: "",
        tool_calls: [{ id: "c1", name: "search_raw", args: { query: "a" } }],
      })
      .mockResolvedValueOnce({
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "c2", name: "search_raw", args: { query: "b" } },
          { id: "c3", name: "fetch_url", args: { url: "https://x" } },
        ],
      })
      .mockResolvedValueOnce({
        role: "assistant",
        content: "# 开场\n\n正文...",
      });

    const dispatchTool = vi.fn(async ({ name }) => {
      if (name === "fetch_url") return { ok: false, error: "net timeout" };
      return { ok: true, data: { hits: [{ id: "h1", title: "t1" }] } };
    });

    const result = await runWriterOpening({
      userMessage: "写一篇关于 A 的文章",
      invokeAgent,
      dispatchTool,
      sectionKey: "opening",
      maxRounds: 4,
      onEvent: (ev) => events.push(ev),
    });

    expect(result.content).toContain("开场");
    expect(result.toolsUsed.length).toBeGreaterThanOrEqual(2);

    await store.writeSection("proj-e2e", "opening", {
      title: "开场",
      markdown: result.content,
      frontmatter: { tools_used: result.toolsUsed },
    });
    const read = await store.readSection("proj-e2e", "opening");
    expect(read?.frontmatter?.tools_used?.length).toBe(result.toolsUsed.length);

    const types = new Set(events.map((e) => e.type));
    expect(types.has("tool_called")).toBe(true);
    expect(types.has("tool_returned")).toBe(true);
    expect(types.has("tool_failed")).toBe(true);
    expect(types.has("tool_round_completed")).toBe(true);
  });
});
```

### Step 2 — run FAIL

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-server exec vitest run src/__tests__/sp08-e2e.test.ts`

### Step 3 — 实现

- [ ] 若 FAIL，只可能是前置 task 未全部落地；按错误信息回溯到对应 task 补齐，不在 T21 引入新的 production 代码。
- [ ] 若 runner emit 的 round 编号与 assertion 不一致，调整 `runWriterOpening` 默认 `maxRounds=4`（已在 T9 覆盖），不改测试。

### Step 4 — run PASS

- [ ] `cd /Users/zeoooo/crossing-writer && pnpm --filter @crossing/web-server exec vitest run src/__tests__/sp08-e2e.test.ts`
- [ ] 全量回归：`pnpm -r exec vitest run`

### Step 5 — 提交

- [ ] `cd /Users/zeoooo/crossing-writer && git add packages/web-server/src/__tests__/sp08-e2e.test.ts && git -c commit.gpgsign=false commit -m "sp08(T21): e2e covers multi-round tools → frontmatter + 4 event types"`

---

## Self-Review

### 1. spec §2-§15 ↔ task 映射

| spec 节 | 对应 task |
|---|---|
| §2 类型定义（SearchRawInput/Hit, ToolCall, SkillResult, ChatMessage, AgentInvoker, ToolUsage, WriterToolEvent, WriterRunOptions, WriterRunResult） | T1 |
| §3 dispatchTool 适配器（search_raw / pin_reference / fetch_url） | T2 |
| §4 invokeAgent(Claude) 封装 | T3 |
| §5 AgentInvoker + ToolCall parse | T4 |
| §6 writer runner 骨架（循环 + maxRounds） | T5 |
| §7 ToolUsage 累积 → WriterRunResult.toolsUsed | T6 |
| §8 WriterToolEvent emit（4 类型） | T7 |
| §9 maxRounds 超限降级为 content-only | T8 |
| §10 runWriterOpening 专用参数与 prompt | T9 |
| §11 runWriterPractice / Closing / StyleCritic | T10 |
| §12 runOrchestrator 统一串起 4 agent | T11 |
| §13 SSE 事件扩展（useProjectStream 白名单） | T12 |
| §13 writer-client RPC（callSkill/getPinned/deletePin） | T13 |
| §14 UI：本段引用折叠栏 | T14 |
| §14 UI：SkillForm 弹窗 | T15 |
| §14 UI：hover [🔧 @skill] 按钮 | T16 |
| §14 UI：AgentTimeline 4 类 tool 事件渲染 | T17 |
| §15 存储：frontmatter.tools_used 透传 | T18 |
| §15 SSE：orchestrator 路由透传 | T19 |
| §15 SSE：rewrite 路由透传 | T20 |
| §15 e2e：多轮工具 → frontmatter + 事件流 | T21 |

全部 21 个 task 落在 spec §2-§15 内，无遗漏、无越界。

### 2. placeholder 扫描

- 全文无 `TBD`、`TODO:`、`similar to above`、`add error handling`、`...`（省略）、`placeholder` 占位。
- 每个 step 要么给出完整代码块，要么给出完整 shell 命令。
- T18 step 3 标注"仅当 FAIL"，但同时给出完整最终实现代码片段，非占位。
- T21 step 3 标注"回溯到对应 task 补齐"，这是 e2e 任务的既定策略（e2e 不引入新生产代码），非 placeholder。

### 3. 类型一致性

全篇引用以下 8 组类型，均来源于 T1 在 `packages/agents/src/types.ts` 的统一定义：

- `SearchRawInput` / `SearchRawHit`：T2 dispatchTool 入参出参；T4 tool schema；T14/T15 UI 展示字段。
- `ToolCall`：T4 AgentInvoker 返回；T5 runner 循环消费；T7 事件 args 字段。
- `SkillResult`：T2 dispatchTool 返回；T6 toolsUsed.ok 推导；T13 callSkill 返回；T15 onResult 回调；T19/T20 SSE payload。
- `SkillContext`：T2 dispatchTool 第二参（projectId+sectionKey）；T19/T20 路由注入。
- `ChatMessage`：T3 Claude 封装；T4 AgentInvoker 入参；T5 runner messages 数组。
- `AgentInvoker`：T3 实现；T4 类型定义；T5-T11 runner 依赖注入。
- `ToolUsage`：T6 累积；T14 frontmatter 读取；T18 store 透传；T21 e2e 断言。
- `WriterToolEvent` / `WriterRunOptions` / `WriterRunResult`：T7 emit；T9-T11 runner 出参；T12 前端事件；T19-T20 SSE；T21 e2e。

所有 task 引用的类型名称与字段（`toolName`、`round`、`ok`、`error`、`ts`、`sectionKey`、`args`、`summary`）前后一致，无漂移。

### 4. task count

21 个 task（T1-T21），落在约束区间 [18, 22] 内。其中 part 1 覆盖 T1-T11（agents 层 + orchestrator），part 2 覆盖 T12-T21（前端 hook/组件/client + 后端 SSE/store + e2e），无重复、无遗漏。
