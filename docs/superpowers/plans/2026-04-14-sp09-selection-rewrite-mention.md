# SP-09 Selection Rewrite + @-Mention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SP-08's manual `[🔧 @skill]` flow with inline selection-based rewrite driven by text selection + `@`-mention inline references.

**Architecture:** Frontend adds SelectionBubble + InlineComposer + MentionDropdown; backend adds GET /suggest + POST /rewrite-selection SSE endpoint; Writer agent tool runner unchanged; SP-08 pinned/SkillForm deleted.

**Tech Stack:** Fastify SSE, React 18, vitest, @crossing/kb skills, @crossing/agents runWriterWithTools.

Spec: `/Users/zeoooo/crossing-writer/docs/superpowers/specs/2026-04-14-sp09-selection-rewrite-mention-design.md`

---

## T1 — Backend: GET /api/writer/suggest route

**Files:**
- Create: `/Users/zeoooo/crossing-writer/packages/web-server/src/routes/writer-suggest.ts`
- Create (test): `/Users/zeoooo/crossing-writer/packages/web-server/tests/routes-writer-suggest.test.ts`

Steps:
- [ ] Read `/Users/zeoooo/crossing-writer/packages/web-server/src/routes/kb-wiki.ts` (first 40 lines) to match the fastify route style (esp. imports, handler signature, type-safe query).
- [ ] Create route file with this content:
```ts
import type { FastifyInstance } from "fastify";
import { searchWiki, searchRaw } from "@crossing/kb";

export interface SuggestItem {
  kind: "wiki" | "raw";
  id: string;
  title: string;
  excerpt: string;
  account?: string;
  published_at?: string;
}

export interface WriterSuggestDeps {
  vaultPath: string;
  sqlitePath: string;
}

export function registerWriterSuggestRoutes(app: FastifyInstance, deps: WriterSuggestDeps) {
  app.get<{ Querystring: { q?: string; limit?: string } }>(
    "/api/writer/suggest",
    async (req) => {
      const q = (req.query.q ?? "").trim();
      const limit = Math.max(1, Math.min(30, Number(req.query.limit) || 12));
      if (q.length < 1) return { items: [] as SuggestItem[] };
      const [wiki, raw] = await Promise.all([
        searchWiki({ query: q, limit: Math.min(6, limit) }, { vaultPath: deps.vaultPath }).catch(() => []),
        Promise.resolve(searchRaw({ query: q, limit: Math.min(6, limit) }, { sqlitePath: deps.sqlitePath })).catch(() => []),
      ]);
      const wikiItems: SuggestItem[] = wiki.map((w: any) => ({
        kind: "wiki",
        id: w.path,
        title: w.frontmatter?.title ?? w.path,
        excerpt: (w.excerpt ?? w.frontmatter?.summary ?? "").slice(0, 200),
      }));
      const rawItems: SuggestItem[] = raw.map((r: any) => ({
        kind: "raw",
        id: r.article_id,
        title: r.title,
        excerpt: (r.snippet ?? "").slice(0, 200),
        account: r.account,
        published_at: r.published_at,
      }));
      const merged = [...wikiItems, ...rawItems].slice(0, limit);
      return { items: merged };
    },
  );
}
```
- [ ] Write tests that mock `@crossing/kb` — empty query returns `{items:[]}`, wiki-first ordering, limit clamping. Test skeleton:
```ts
import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";

vi.mock("@crossing/kb", () => ({
  searchWiki: vi.fn(async () => [{ path: "entities/AI.Talk.md", frontmatter: { title: "AI.Talk", summary: "AI studio" }, excerpt: "AI studio" }]),
  searchRaw: vi.fn(() => [{ article_id: "abc", title: "Top100", account: "花叔", published_at: "2024-08-28", snippet: "<b>AI</b>..." }]),
}));

import { registerWriterSuggestRoutes } from "../src/routes/writer-suggest.js";

async function seed() {
  const app = Fastify();
  registerWriterSuggestRoutes(app, { vaultPath: "/tmp/v", sqlitePath: "/tmp/kb.sqlite" });
  await app.ready();
  return app;
}

describe("GET /api/writer/suggest", () => {
  it("empty query returns empty list", async () => {
    const app = await seed();
    const res = await app.inject({ method: "GET", url: "/api/writer/suggest?q=" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
  });
  it("merges wiki-first then raw", async () => {
    const app = await seed();
    const res = await app.inject({ method: "GET", url: "/api/writer/suggest?q=AI" });
    const body = res.json();
    expect(body.items[0].kind).toBe("wiki");
    expect(body.items[0].title).toBe("AI.Talk");
    expect(body.items[1].kind).toBe("raw");
    expect(body.items[1].account).toBe("花叔");
  });
  it("respects limit param", async () => {
    const app = await seed();
    const res = await app.inject({ method: "GET", url: "/api/writer/suggest?q=AI&limit=1" });
    expect(res.json().items.length).toBe(1);
  });
});
```
- [ ] Run: `pnpm --filter @crossing/web-server exec vitest run tests/routes-writer-suggest.test.ts`
  Expected: 3 passing.
- [ ] Commit: `git -c commit.gpgsign=false commit -am "sp09(T1): GET /api/writer/suggest route"`

---

## T2 — web-ui: suggestRefs client + SuggestItem type

**Files:**
- Modify: `/Users/zeoooo/crossing-writer/packages/web-ui/src/api/writer-client.ts`
- Create (test): `/Users/zeoooo/crossing-writer/packages/web-ui/src/api/__tests__/writer-client-suggest.test.ts`

Steps:
- [ ] Read `/Users/zeoooo/crossing-writer/packages/web-ui/src/api/writer-client.ts` fully to see existing fetch-wrapper style.
- [ ] Append to writer-client.ts:
```ts
export interface SuggestItem {
  kind: "wiki" | "raw";
  id: string;
  title: string;
  excerpt: string;
  account?: string;
  published_at?: string;
}

export async function suggestRefs(q: string, limit = 12): Promise<SuggestItem[]> {
  const u = new URL("/api/writer/suggest", window.location.origin);
  u.searchParams.set("q", q);
  u.searchParams.set("limit", String(limit));
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error(`suggest failed: ${res.status}`);
  const json = (await res.json()) as { items: SuggestItem[] };
  return json.items ?? [];
}
```
- [ ] Test (uses global fetch mock):
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { suggestRefs } from "../writer-client";

describe("suggestRefs", () => {
  beforeEach(() => {
    (globalThis as any).window = { location: { origin: "http://x" } };
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ items: [{ kind: "wiki", id: "a.md", title: "A", excerpt: "hi" }] }),
    }));
  });
  it("fetches and returns items", async () => {
    const items = await suggestRefs("AI");
    expect(items).toHaveLength(1);
    expect((globalThis as any).fetch).toHaveBeenCalledWith(expect.stringContaining("/api/writer/suggest?q=AI&limit=12"));
  });
  it("empty array on empty response", async () => {
    (globalThis as any).fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    expect(await suggestRefs("x")).toEqual([]);
  });
});
```
- [ ] Run: `pnpm --filter @crossing/web-ui exec vitest run src/api/__tests__/writer-client-suggest.test.ts`
  Expected: 2 passing.
- [ ] Commit: `git -c commit.gpgsign=false commit -am "sp09(T2): suggestRefs client + SuggestItem type"`

---

## T3 — agents: WriterToolEvent adds selection_rewritten branch

**Files:**
- Modify: `/Users/zeoooo/crossing-writer/packages/agents/src/writer-tool-runner.ts`
- Modify: `/Users/zeoooo/crossing-writer/packages/agents/src/index.ts` (ensure `WriterToolEvent` exported — already is)
- Create (test): `/Users/zeoooo/crossing-writer/packages/agents/tests/writer-tool-event-types.test.ts`

Steps:
- [ ] Read `/Users/zeoooo/crossing-writer/packages/agents/src/writer-tool-runner.ts` lines 49-60.
- [ ] Replace the `WriterToolEvent` interface with a discriminated union:
```ts
export type WriterToolEvent =
  | {
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
  | {
      type: "selection_rewritten";
      section_key: string;
      selected_text: string;
      new_text: string;
      ts: string;
    };
```
- [ ] Add test file:
```ts
import { describe, it, expect } from "vitest";
import type { WriterToolEvent } from "../src/writer-tool-runner.js";

describe("WriterToolEvent selection_rewritten branch", () => {
  it("allows selection_rewritten event shape", () => {
    const ev: WriterToolEvent = {
      type: "selection_rewritten",
      section_key: "opening",
      selected_text: "old",
      new_text: "new",
      ts: new Date().toISOString(),
    };
    expect(ev.type).toBe("selection_rewritten");
    if (ev.type === "selection_rewritten") expect(ev.selected_text).toBe("old");
  });
  it("still allows tool_called shape", () => {
    const ev: WriterToolEvent = { type: "tool_called", agent: "writer.opening", round: 1 };
    expect(ev.type).toBe("tool_called");
  });
});
```
- [ ] Run: `pnpm --filter @crossing/agents exec vitest run tests/writer-tool-event-types.test.ts`
  Expected: 2 passing.
- [ ] Run full agents suite to ensure existing event emitters still type-check / behave:
  `pnpm --filter @crossing/agents exec vitest run`
  Expected: all green.
- [ ] Commit: `git -c commit.gpgsign=false commit -am "sp09(T3): WriterToolEvent.selection_rewritten branch"`

---

## T4 — buildSelectionRewriteUserMessage helper (pure)

**Files:**
- Create: `/Users/zeoooo/crossing-writer/packages/web-server/src/services/selection-rewrite-builder.ts`
- Create (test): `/Users/zeoooo/crossing-writer/packages/web-server/tests/selection-rewrite-builder.test.ts`

Steps:
- [ ] Create builder file:
```ts
export interface SelectionRef {
  kind: "wiki" | "raw";
  id: string;
  title: string;
  content: string;
  account?: string;
  published_at?: string;
}

export interface BuildArgs {
  sectionBody: string;
  selectedText: string;
  userPrompt: string;
  references: SelectionRef[];
}

const PER_REF_LIMIT = 3000;

export function buildSelectionRewriteUserMessage(args: BuildArgs): string {
  const refsBlock = args.references.length === 0
    ? "(无)"
    : args.references
        .map((r) => {
          const head = r.kind === "wiki"
            ? `## [wiki] ${r.title}`
            : `## [raw] ${r.title}${r.account ? ` (${r.account}${r.published_at ? " " + r.published_at : ""})` : ""}`;
          const body = r.content.length > PER_REF_LIMIT
            ? r.content.slice(0, PER_REF_LIMIT) + "\n...[truncated]"
            : r.content;
          return `${head}\n${body}`;
        })
        .join("\n\n");
  return [
    "[段落完整上下文]",
    args.sectionBody,
    "",
    "[需要改写的部分]",
    args.selectedText,
    "",
    "[引用素材]",
    refsBlock,
    "",
    "[改写要求]",
    args.userPrompt,
    "",
    "仅输出改写后的新文本（纯文本，不要 markdown 围栏、不要重复原文、不要解释）",
  ].join("\n");
}
```
- [ ] Test:
```ts
import { describe, it, expect } from "vitest";
import { buildSelectionRewriteUserMessage } from "../src/services/selection-rewrite-builder.js";

describe("buildSelectionRewriteUserMessage", () => {
  it("assembles all sections in order", () => {
    const msg = buildSelectionRewriteUserMessage({
      sectionBody: "BODY",
      selectedText: "SEL",
      userPrompt: "make it better",
      references: [
        { kind: "wiki", id: "a.md", title: "AI.Talk", content: "WIKIBODY" },
        { kind: "raw", id: "x", title: "Top", content: "RAWBODY", account: "花叔", published_at: "2024-08-28" },
      ],
    });
    expect(msg).toContain("[段落完整上下文]\nBODY");
    expect(msg).toContain("[需要改写的部分]\nSEL");
    expect(msg).toContain("## [wiki] AI.Talk\nWIKIBODY");
    expect(msg).toContain("## [raw] Top (花叔 2024-08-28)\nRAWBODY");
    expect(msg).toContain("[改写要求]\nmake it better");
    expect(msg.indexOf("[段落完整上下文]"))
      .toBeLessThan(msg.indexOf("[引用素材]"));
    expect(msg.indexOf("[引用素材]"))
      .toBeLessThan(msg.indexOf("[改写要求]"));
  });
  it("truncates per-ref bodies at 3000 chars", () => {
    const big = "x".repeat(4000);
    const msg = buildSelectionRewriteUserMessage({
      sectionBody: "B", selectedText: "S", userPrompt: "p",
      references: [{ kind: "wiki", id: "a", title: "A", content: big }],
    });
    expect(msg).toContain("[truncated]");
    expect(msg.match(/x/g)!.length).toBe(3000);
  });
  it("handles empty references", () => {
    const msg = buildSelectionRewriteUserMessage({
      sectionBody: "B", selectedText: "S", userPrompt: "p", references: [],
    });
    expect(msg).toContain("[引用素材]\n(无)");
  });
});
```
- [ ] Run: `pnpm --filter @crossing/web-server exec vitest run tests/selection-rewrite-builder.test.ts`
  Expected: 3 passing.
- [ ] Commit: `git -c commit.gpgsign=false commit -am "sp09(T4): buildSelectionRewriteUserMessage pure helper"`

---

## T5 — fetchReferenceBodies helper (wiki + raw lookups)

**Files:**
- Modify: `/Users/zeoooo/crossing-writer/packages/web-server/src/services/selection-rewrite-builder.ts`
- Modify: `/Users/zeoooo/crossing-writer/packages/web-server/tests/selection-rewrite-builder.test.ts`

Steps:
- [ ] Append to builder file:
```ts
import { WikiStore } from "@crossing/kb";
import Database from "better-sqlite3";
import { existsSync } from "node:fs";

export interface RefInput {
  kind: "wiki" | "raw";
  id: string;
  title: string;
  account?: string;
  published_at?: string;
}

export interface FetchCtx { vaultPath: string; sqlitePath: string }

export async function fetchReferenceBodies(
  refs: RefInput[],
  ctx: FetchCtx,
  logger?: { warn: (msg: string) => void },
): Promise<SelectionRef[]> {
  const out: SelectionRef[] = [];
  let db: Database.Database | null = null;
  try {
    for (const r of refs) {
      try {
        if (r.kind === "wiki") {
          const store = new WikiStore(ctx.vaultPath);
          const page = store.readPage(r.id);
          if (!page) { logger?.warn(`wiki not found: ${r.id}`); continue; }
          out.push({ ...r, content: page.body ?? "" });
        } else {
          if (!existsSync(ctx.sqlitePath)) { logger?.warn(`sqlite missing: ${ctx.sqlitePath}`); continue; }
          if (!db) db = new Database(ctx.sqlitePath, { readonly: true, fileMustExist: true });
          const row = db.prepare("SELECT body_plain FROM ref_articles WHERE id = ?").get(r.id) as { body_plain?: string } | undefined;
          if (!row) { logger?.warn(`raw not found: ${r.id}`); continue; }
          out.push({ ...r, content: row.body_plain ?? "" });
        }
      } catch (e) {
        logger?.warn(`fetchRef failed ${r.kind}:${r.id}: ${(e as Error).message}`);
      }
    }
  } finally {
    if (db) db.close();
  }
  return out;
}
```
- [ ] Check WikiStore API: `grep -n "readPage\|listPages\|class WikiStore" /Users/zeoooo/crossing-writer/packages/kb/src/wiki/wiki-store.ts` — if method name differs, adjust accordingly (likely `readPage(path)` or `getPage(path)`).
- [ ] Add tests using fixture vault + in-memory sqlite:
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { fetchReferenceBodies } from "../src/services/selection-rewrite-builder.js";

describe("fetchReferenceBodies", () => {
  it("reads wiki body and raw body_plain; skips missing", async () => {
    const vault = mkdtempSync(join(tmpdir(), "sp09-fetch-"));
    mkdirSync(join(vault, "entities"), { recursive: true });
    writeFileSync(join(vault, "entities", "AI.Talk.md"), "---\ntitle: AI.Talk\nkind: entity\n---\nHELLO");
    const sqlitePath = join(vault, "kb.sqlite");
    const db = new Database(sqlitePath);
    db.exec("CREATE TABLE ref_articles (id TEXT PRIMARY KEY, body_plain TEXT)");
    db.prepare("INSERT INTO ref_articles (id, body_plain) VALUES (?, ?)").run("a1", "RAWTEXT");
    db.close();
    const warnings: string[] = [];
    const refs = await fetchReferenceBodies(
      [
        { kind: "wiki", id: "entities/AI.Talk.md", title: "AI.Talk" },
        { kind: "raw", id: "a1", title: "T" },
        { kind: "raw", id: "missing", title: "X" },
      ],
      { vaultPath: vault, sqlitePath },
      { warn: (m) => warnings.push(m) },
    );
    expect(refs).toHaveLength(2);
    expect(refs[0].content).toContain("HELLO");
    expect(refs[1].content).toBe("RAWTEXT");
    expect(warnings.some((w) => w.includes("missing"))).toBe(true);
  });
});
```
- [ ] Run: `pnpm --filter @crossing/web-server exec vitest run tests/selection-rewrite-builder.test.ts`
  Expected: all tests pass (T4 + T5).
- [ ] Commit: `git -c commit.gpgsign=false commit -am "sp09(T5): fetchReferenceBodies helper"`

---

## T6 — POST rewrite-selection route: validation + wiring skeleton

**Files:**
- Create: `/Users/zeoooo/crossing-writer/packages/web-server/src/routes/writer-rewrite-selection.ts`
- Create (test): `/Users/zeoooo/crossing-writer/packages/web-server/tests/routes-writer-rewrite-selection.test.ts`

Steps:
- [ ] Read `/Users/zeoooo/crossing-writer/packages/web-server/src/routes/writer.ts` to find existing rewrite route (for SSE send style + section-body loading + `sectionKeyToAgentKey` pattern).
- [ ] Create route:
```ts
import type { FastifyInstance } from "fastify";
import type { ProjectStore } from "../services/project-store.js";
import type { ConfigStore } from "../services/config-store.js";
import { ArticleStore, type SectionKey } from "../services/article-store.js";
import {
  runWriterOpening, runWriterPractice, runWriterClosing,
  invokeAgent, WriterOpeningAgent, WriterPracticeAgent, WriterClosingAgent,
  type WriterToolEvent,
} from "@crossing/agents";
import { dispatchSkill } from "@crossing/kb";
import { buildSelectionRewriteUserMessage, fetchReferenceBodies, type RefInput } from "../services/selection-rewrite-builder.js";
import { appendEvent } from "../services/event-log.js";

export interface RewriteSelectionDeps {
  store: ProjectStore;
  projectsDir: string;
  vaultPath: string;
  sqlitePath: string;
  configStore: ConfigStore | { get(key: string): Promise<{ cli?: string; model?: string } | undefined> };
}

interface Body {
  selected_text: string;
  user_prompt: string;
  references?: RefInput[];
}

function pickRunner(sectionKey: string) {
  if (sectionKey === "opening") return { run: runWriterOpening, agent: WriterOpeningAgent, name: "writer.opening" };
  if (sectionKey === "closing") return { run: runWriterClosing, agent: WriterClosingAgent, name: "writer.closing" };
  if (sectionKey.startsWith("practice.case-")) return { run: runWriterPractice, agent: WriterPracticeAgent, name: "writer.practice" };
  return null;
}

export function registerWriterRewriteSelectionRoutes(app: FastifyInstance, deps: RewriteSelectionDeps) {
  app.post<{ Params: { id: string; key: string }; Body: Body }>(
    "/api/projects/:id/writer/sections/:key/rewrite-selection",
    async (req, reply) => {
      const project = await deps.store.get(req.params.id);
      if (!project) return reply.code(404).send({ error: "project not found" });
      const { selected_text, user_prompt, references = [] } = req.body ?? ({} as Body);
      if (!selected_text || !user_prompt) return reply.code(400).send({ error: "selected_text and user_prompt required" });
      const runner = pickRunner(req.params.key);
      if (!runner) return reply.code(400).send({ error: "unsupported section key" });

      const articles = new ArticleStore(deps.projectsDir, project.id);
      const current = await articles.readSection(req.params.key as SectionKey).catch(() => null);
      if (!current) return reply.code(404).send({ error: "section not found" });
      const body = current.body ?? "";
      if (!body.includes(selected_text)) return reply.code(400).send({ error: "selected_text not found" });

      reply.raw.setHeader("content-type", "text/event-stream");
      reply.raw.setHeader("cache-control", "no-cache");
      reply.raw.setHeader("connection", "keep-alive");
      reply.raw.flushHeaders?.();
      const send = (event: string, data: unknown) => {
        reply.raw.write(`event: ${event}\n`);
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      try {
        send("writer.started", { sectionKey: req.params.key, mode: "rewrite-selection" });

        const refsWithBodies = await fetchReferenceBodies(references, {
          vaultPath: deps.vaultPath, sqlitePath: deps.sqlitePath,
        }, { warn: (m) => app.log.warn(m) });
        const userMessage = buildSelectionRewriteUserMessage({
          sectionBody: body,
          selectedText: selected_text,
          userPrompt: user_prompt,
          references: refsWithBodies,
        });

        const cfg = await (deps.configStore as any).get(runner.name);
        const agentInvoker = invokeAgent({ agent: runner.agent, cli: cfg?.cli ?? "claude", model: cfg?.model });
        const result = await (runner.run as any)({
          invokeAgent: agentInvoker,
          userMessage,
          dispatchTool: (call: any) => dispatchSkill(call, { vaultPath: deps.vaultPath, sqlitePath: deps.sqlitePath }),
          sectionKey: req.params.key,
          onEvent: (ev: WriterToolEvent) => send(`writer.${ev.type}`, ev),
          maxRounds: 3,
        });

        const content = (result?.content ?? "").trim();
        const newBody = body.replace(selected_text, content);
        const prevTools = current.frontmatter?.tools_used ?? [];
        const mergedTools = [...prevTools, ...(result?.toolsUsed ?? [])];
        await articles.writeSection(req.params.key as SectionKey, {
          key: req.params.key,
          frontmatter: { ...current.frontmatter, tools_used: mergedTools, last_updated_at: new Date().toISOString() },
          body: newBody,
        });

        send("writer.selection_rewritten", {
          sectionKey: req.params.key,
          selected_text,
          new_text: content,
          content_full: newBody,
        });
        appendEvent(deps.projectsDir, project.id, { type: "writer.selection_rewritten", sectionKey: req.params.key });
        send("writer.completed", { sectionKey: req.params.key });
      } catch (e) {
        send("writer.failed", { error: (e as Error).message });
      } finally {
        reply.raw.end();
      }
    },
  );
}
```
- [ ] Test happy-path validation (mocks runner returning static content):
```ts
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";

vi.mock("@crossing/agents", async () => {
  const actual = await vi.importActual<any>("@crossing/agents");
  return {
    ...actual,
    invokeAgent: vi.fn(() => ({ invoke: async () => ({ text: "", meta: { cli: "claude", durationMs: 1 } }) })),
    runWriterOpening: vi.fn(async ({ onEvent }: any) => {
      onEvent?.({ type: "tool_round_completed", agent: "writer.opening", round: 1 });
      return { content: "NEWTEXT", toolsUsed: [], rounds: 1 };
    }),
  };
});
vi.mock("@crossing/kb", async () => {
  const actual = await vi.importActual<any>("@crossing/kb");
  return { ...actual, dispatchSkill: vi.fn() };
});

import { ProjectStore } from "../src/services/project-store.js";
import { ArticleStore } from "../src/services/article-store.js";
import { registerWriterRewriteSelectionRoutes } from "../src/routes/writer-rewrite-selection.js";

async function seed() {
  const projectsDir = mkdtempSync(join(tmpdir(), "sp09-sel-"));
  const store = new ProjectStore(projectsDir);
  const p = await store.create({ name: "T" });
  const articles = new ArticleStore(projectsDir, p.id);
  await articles.writeSection("opening" as any, {
    key: "opening",
    frontmatter: { section: "opening", last_agent: "writer.opening", last_updated_at: "x" },
    body: "hello OLDTEXT world",
  });
  const app = Fastify();
  registerWriterRewriteSelectionRoutes(app, {
    store, projectsDir, vaultPath: "/tmp/v", sqlitePath: "/tmp/kb.sqlite",
    configStore: { async get() { return { cli: "claude" }; } } as any,
  });
  await app.ready();
  return { app, projectId: p.id, articles };
}

describe("POST rewrite-selection — validation", () => {
  it("400 when selected_text missing from body", async () => {
    const { app, projectId } = await seed();
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/writer/sections/opening/rewrite-selection`,
      payload: { selected_text: "NOPE", user_prompt: "x" },
    });
    expect(res.statusCode).toBe(400);
  });
  it("400 on unsupported section key", async () => {
    const { app, projectId } = await seed();
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/writer/sections/brief/rewrite-selection`,
      payload: { selected_text: "x", user_prompt: "y" },
    });
    expect(res.statusCode).toBe(400);
  });
  it("404 when project missing", async () => {
    const { app } = await seed();
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/nope/writer/sections/opening/rewrite-selection`,
      payload: { selected_text: "x", user_prompt: "y" },
    });
    expect(res.statusCode).toBe(404);
  });
});
```
- [ ] Run: `pnpm --filter @crossing/web-server exec vitest run tests/routes-writer-rewrite-selection.test.ts`
  Expected: 3 passing.
- [ ] Commit: `git -c commit.gpgsign=false commit -am "sp09(T6): POST rewrite-selection route + validation tests"`

---

## T7 — SSE event-sequence assertion (happy path)

**Files:**
- Modify: `/Users/zeoooo/crossing-writer/packages/web-server/tests/routes-writer-rewrite-selection.test.ts`

Steps:
- [ ] Append a test that captures streamed SSE and asserts order `writer.started` → (optional tool_*) → `writer.selection_rewritten` → `writer.completed`:
```ts
describe("POST rewrite-selection — SSE sequence", () => {
  it("emits started → tool_round_completed → selection_rewritten → completed", async () => {
    const { app, projectId } = await seed();
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/writer/sections/opening/rewrite-selection`,
      payload: { selected_text: "OLDTEXT", user_prompt: "rewrite it", references: [] },
    });
    expect(res.statusCode).toBe(200);
    const lines = res.body.split("\n").filter((l) => l.startsWith("event:"));
    expect(lines[0]).toBe("event: writer.started");
    expect(lines[lines.length - 1]).toBe("event: writer.completed");
    expect(lines).toContain("event: writer.selection_rewritten");
    const startedIdx = lines.indexOf("event: writer.started");
    const rewrittenIdx = lines.indexOf("event: writer.selection_rewritten");
    const completedIdx = lines.indexOf("event: writer.completed");
    expect(startedIdx).toBeLessThan(rewrittenIdx);
    expect(rewrittenIdx).toBeLessThan(completedIdx);
  });
});
```
- [ ] Run: `pnpm --filter @crossing/web-server exec vitest run tests/routes-writer-rewrite-selection.test.ts`
  Expected: 4 passing total.
- [ ] Commit: `git -c commit.gpgsign=false commit -am "sp09(T7): SSE sequence assertion for rewrite-selection"`

---

## T8 — Selection string-replace + writeSection round-trip

**Files:**
- Modify: `/Users/zeoooo/crossing-writer/packages/web-server/tests/routes-writer-rewrite-selection.test.ts`

Steps:
- [ ] Append a round-trip test that verifies only the selected text is replaced and surrounding text is preserved, and that `tools_used` merged into frontmatter:
```ts
describe("POST rewrite-selection — body replacement + frontmatter merge", () => {
  it("replaces only selected substring and merges tools_used", async () => {
    const { app, projectId, articles } = await seed();
    const agents = await import("@crossing/agents") as any;
    agents.runWriterOpening.mockImplementationOnce(async () => ({
      content: "NEWTEXT",
      toolsUsed: [{ tool: "search_wiki", query: "AI", args: {}, pinned_by: "auto", round: 1, hits_count: 2, hits_summary: [] }],
      rounds: 1,
    }));
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/writer/sections/opening/rewrite-selection`,
      payload: { selected_text: "OLDTEXT", user_prompt: "do it", references: [] },
    });
    expect(res.statusCode).toBe(200);
    const saved = await articles.readSection("opening" as any);
    expect(saved!.body).toBe("hello NEWTEXT world");
    expect(saved!.frontmatter.tools_used).toHaveLength(1);
    expect(saved!.frontmatter.tools_used![0].tool).toBe("search_wiki");
  });
});
```
- [ ] Run: `pnpm --filter @crossing/web-server exec vitest run tests/routes-writer-rewrite-selection.test.ts`
  Expected: 5 passing total.
- [ ] Commit: `git -c commit.gpgsign=false commit -am "sp09(T8): body string-replace + tools_used merge test"`

---

## T9 — Register suggest + rewrite-selection routes in server.ts

**Files:**
- Modify: `/Users/zeoooo/crossing-writer/packages/web-server/src/server.ts`
- Create (test): `/Users/zeoooo/crossing-writer/packages/web-server/tests/routes-writer-sp09-smoke.test.ts`

Steps:
- [ ] Read existing `registerWriterRoutes` call block in `server.ts` (around line 98) to match the deps pattern.
- [ ] Add two imports at top:
```ts
import { registerWriterSuggestRoutes } from "./routes/writer-suggest.js";
import { registerWriterRewriteSelectionRoutes } from "./routes/writer-rewrite-selection.js";
```
- [ ] Directly after `registerWriterRoutes(app, { ... })` call, add:
```ts
registerWriterSuggestRoutes(app, {
  vaultPath: configStore.current.vaultPath,
  sqlitePath: configStore.current.sqlitePath,
});
registerWriterRewriteSelectionRoutes(app, {
  store,
  projectsDir: configStore.current.projectsDir,
  vaultPath: configStore.current.vaultPath,
  sqlitePath: configStore.current.sqlitePath,
  configStore,
});
```
- [ ] Write smoke test that calls `buildApp` with a test config and pings `/api/writer/suggest?q=`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/server.js";

describe("SP-09 route registration smoke", () => {
  it("suggest route is mounted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sp09-smoke-"));
    const app = await buildApp({
      projectsDir: join(dir, "projects"),
      expertsDir: join(dir, "experts"),
      vaultPath: join(dir, "vault"),
      sqlitePath: join(dir, "kb.sqlite"),
      defaultCli: "claude",
      fallbackCli: "claude",
      agents: {},
    } as any);
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/writer/suggest?q=" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
    await app.close();
  });
});
```
- [ ] Run: `pnpm --filter @crossing/web-server exec vitest run tests/routes-writer-sp09-smoke.test.ts`
  Expected: 1 passing.
- [ ] Commit: `git -c commit.gpgsign=false commit -am "sp09(T9): register suggest + rewrite-selection in server"`

---

## T10 — Delete SP-08 skill routes, pinned store, and include_pinned_skills branch

**Files:**
- Modify: `/Users/zeoooo/crossing-writer/packages/web-server/src/routes/writer.ts` (delete POST `/skill`, GET `/pinned`, DELETE `/pinned/:index`, `include_pinned_skills` branch, `pendingPinsStore` import)
- Delete: `/Users/zeoooo/crossing-writer/packages/web-server/src/state/pending-pins.ts`
- Delete: `/Users/zeoooo/crossing-writer/packages/web-server/tests/routes-writer-skill.test.ts`
- Delete: `/Users/zeoooo/crossing-writer/packages/web-server/tests/routes-writer-pinned.test.ts`
- Modify: `/Users/zeoooo/crossing-writer/packages/web-server/tests/routes-writer-rewrite-tools.test.ts` (remove `include_pinned_skills` / pinned assertions only; keep other rewrite-tools coverage)
- Modify: `/Users/zeoooo/crossing-writer/packages/web-server/tests/sp08-e2e.test.ts` — if it asserts SkillForm/pinned flow, trim those assertions or delete the file entirely

Steps:
- [ ] `grep -n "pendingPinsStore\|include_pinned_skills\|/skill\|/pinned" /Users/zeoooo/crossing-writer/packages/web-server/src/routes/writer.ts` to enumerate every removal site.
- [ ] In `writer.ts`:
  - Remove import `import { pendingPinsStore, type PinEntry } from "../state/pending-pins.js";`
  - Remove the three route handlers (POST `/skill`, GET `/pinned`, DELETE `/pinned/:index`)
  - Remove the `include_pinned_skills` branch inside the rewrite route (it typically augments `pinnedContext` via `pendingPinsStore.list(...)`)
- [ ] Delete the pending-pins source file: `rm /Users/zeoooo/crossing-writer/packages/web-server/src/state/pending-pins.ts`
- [ ] Delete skill + pinned test files:
  `rm /Users/zeoooo/crossing-writer/packages/web-server/tests/routes-writer-skill.test.ts /Users/zeoooo/crossing-writer/packages/web-server/tests/routes-writer-pinned.test.ts`
- [ ] Inspect `routes-writer-rewrite-tools.test.ts` and `sp08-e2e.test.ts`; remove only the pinned-related assertions (keep general writer-agent-tool coverage).
- [ ] Run entire web-server suite:
  `pnpm --filter @crossing/web-server exec vitest run`
  Expected: all green (with SP-09 new tests). No reference to `pendingPinsStore` anywhere.
- [ ] Sanity grep: `grep -rn "pendingPinsStore\|include_pinned_skills" /Users/zeoooo/crossing-writer/packages/web-server/` — expect 0 matches.
- [ ] Commit: `git -c commit.gpgsign=false commit -am "sp09(T10): remove SP-08 skill routes + pendingPinsStore"`

---

## T11 — Frontend: useTextSelection hook

**Files:**
- Create: `/Users/zeoooo/crossing-writer/packages/web-ui/src/hooks/useTextSelection.ts`
- Create (test): `/Users/zeoooo/crossing-writer/packages/web-ui/src/hooks/__tests__/useTextSelection.test.ts`

Steps:
- [ ] Create the hook file with this content:
```ts
import { useCallback, useEffect, useRef, useState } from "react";

export interface TextSelectionState {
  range: Range | null;
  rect: DOMRect | null;
  text: string;
}

const EMPTY: TextSelectionState = { range: null, rect: null, text: "" };

export function useTextSelection<T extends HTMLElement = HTMLElement>() {
  const elementRef = useRef<T | null>(null);
  const [state, setState] = useState<TextSelectionState>(EMPTY);

  const recompute = useCallback(() => {
    const sel = typeof window !== "undefined" ? window.getSelection() : null;
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setState(EMPTY);
      return;
    }
    const range = sel.getRangeAt(0);
    const host = elementRef.current;
    if (!host || !host.contains(range.commonAncestorContainer)) {
      setState(EMPTY);
      return;
    }
    const text = range.toString();
    if (!text.trim()) {
      setState(EMPTY);
      return;
    }
    setState({ range, rect: range.getBoundingClientRect(), text });
  }, []);

  useEffect(() => {
    const handler = () => recompute();
    document.addEventListener("selectionchange", handler);
    document.addEventListener("mouseup", handler);
    document.addEventListener("keyup", handler);
    return () => {
      document.removeEventListener("selectionchange", handler);
      document.removeEventListener("mouseup", handler);
      document.removeEventListener("keyup", handler);
    };
  }, [recompute]);

  const clear = useCallback(() => setState(EMPTY), []);
  return { elementRef, selection: state, clear };
}
```
- [ ] Create the test:
```ts
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTextSelection } from "../useTextSelection.js";

describe("useTextSelection", () => {
  it("returns empty when collapsed", () => {
    const { result } = renderHook(() => useTextSelection<HTMLDivElement>());
    expect(result.current.selection.text).toBe("");
  });

  it("captures selection text inside host element", () => {
    const host = document.createElement("div");
    host.textContent = "Hello world selection";
    document.body.appendChild(host);
    const { result } = renderHook(() => useTextSelection<HTMLDivElement>());
    act(() => {
      (result.current.elementRef as any).current = host;
      const range = document.createRange();
      range.setStart(host.firstChild!, 0);
      range.setEnd(host.firstChild!, 5);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(result.current.selection.text).toBe("Hello");
    expect(result.current.selection.range).not.toBeNull();
    document.body.removeChild(host);
  });

  it("ignores selection outside the ref'd host", () => {
    const outside = document.createElement("div");
    outside.textContent = "outside text";
    document.body.appendChild(outside);
    const host = document.createElement("div");
    host.textContent = "inside";
    document.body.appendChild(host);
    const { result } = renderHook(() => useTextSelection<HTMLDivElement>());
    act(() => {
      (result.current.elementRef as any).current = host;
      const range = document.createRange();
      range.setStart(outside.firstChild!, 0);
      range.setEnd(outside.firstChild!, 3);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(result.current.selection.text).toBe("");
    document.body.removeChild(outside);
    document.body.removeChild(host);
  });
});
```
- [ ] Run: `pnpm --filter @crossing/web-ui exec vitest run src/hooks/__tests__/useTextSelection.test.ts`
- [ ] Commit: `git -c commit.gpgsign=false commit -am "sp09(T11): useTextSelection hook"`

---

## T12 — Frontend: SelectionBubble component

**Files:**
- Create: `/Users/zeoooo/crossing-writer/packages/web-ui/src/components/writer/SelectionBubble.tsx`
- Create (test): `/Users/zeoooo/crossing-writer/packages/web-ui/src/components/writer/__tests__/SelectionBubble.test.tsx`

Steps:
- [ ] Create the component:
```tsx
import type { CSSProperties } from "react";

export interface SelectionBubbleProps {
  rect: DOMRect | null;
  onClick: () => void;
}

export function SelectionBubble({ rect, onClick }: SelectionBubbleProps) {
  if (!rect) return null;
  const style: CSSProperties = {
    position: "fixed",
    top: Math.max(8, rect.top - 40),
    left: rect.left + rect.width / 2,
    transform: "translateX(-50%)",
    zIndex: 40,
  };
  return (
    <div style={style} data-testid="selection-bubble">
      <button
        type="button"
        onClick={onClick}
        className="px-3 py-1 rounded-md bg-slate-900 text-white text-xs shadow-lg hover:bg-slate-700"
      >
        ✍️ 重写选中
      </button>
    </div>
  );
}
```
- [ ] Create the test:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SelectionBubble } from "../SelectionBubble.js";

function makeRect(top = 100, left = 50, width = 80): DOMRect {
  return { top, left, width, height: 20, right: left + width, bottom: top + 20, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

describe("SelectionBubble", () => {
  it("renders nothing when rect is null", () => {
    const { container } = render(<SelectionBubble rect={null} onClick={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders button and positions above rect", () => {
    render(<SelectionBubble rect={makeRect(200, 40, 100)} onClick={() => {}} />);
    const el = screen.getByTestId("selection-bubble") as HTMLElement;
    expect(el.style.top).toBe("160px");
    expect(el.style.left).toBe("90px");
    expect(screen.getByRole("button").textContent).toMatch(/重写选中/);
  });

  it("fires onClick", () => {
    const spy = vi.fn();
    render(<SelectionBubble rect={makeRect()} onClick={spy} />);
    fireEvent.click(screen.getByRole("button"));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
```
- [ ] Run: `pnpm --filter @crossing/web-ui exec vitest run src/components/writer/__tests__/SelectionBubble.test.tsx`
- [ ] Commit: `git -c commit.gpgsign=false commit -am "sp09(T12): SelectionBubble component"`

---

## T13 — Frontend: MentionDropdown component

**Files:**
- Create: `/Users/zeoooo/crossing-writer/packages/web-ui/src/components/writer/MentionDropdown.tsx`
- Create (test): `/Users/zeoooo/crossing-writer/packages/web-ui/src/components/writer/__tests__/MentionDropdown.test.tsx`

Steps:
- [ ] Create the component:
```tsx
import type { SuggestItem } from "../../api/writer-client.js";

export interface MentionDropdownProps {
  items: SuggestItem[];
  activeIndex: number;
  onSelect: (item: SuggestItem) => void;
  onHover: (index: number) => void;
}

export function MentionDropdown({ items, activeIndex, onSelect, onHover }: MentionDropdownProps) {
  if (items.length === 0) return null;
  return (
    <ul
      data-testid="mention-dropdown"
      className="absolute z-50 mt-1 max-h-80 w-[420px] overflow-auto rounded-md border border-slate-200 bg-white shadow-lg"
    >
      {items.slice(0, 12).map((it, i) => {
        const active = i === activeIndex;
        const label =
          it.kind === "wiki"
            ? `[wiki] ${it.title} — ${it.excerpt}`
            : `[raw] ${it.published_at ?? ""} · ${it.account ?? ""} · ${it.title}`;
        return (
          <li
            key={`${it.kind}:${it.id}`}
            data-testid={`mention-item-${i}`}
            data-active={active ? "true" : "false"}
            onMouseEnter={() => onHover(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(it);
            }}
            className={`cursor-pointer px-3 py-2 text-sm ${active ? "bg-slate-100" : "bg-white"}`}
          >
            <span className="truncate block" dangerouslySetInnerHTML={{ __html: label }} />
          </li>
        );
      })}
    </ul>
  );
}
```
- [ ] Create the test:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MentionDropdown } from "../MentionDropdown.js";
import type { SuggestItem } from "../../../api/writer-client.js";

const items: SuggestItem[] = [
  { kind: "wiki", id: "entities/AI.Talk.md", title: "AI.Talk", excerpt: "AI studio" },
  { kind: "raw", id: "abc", title: "Top100", account: "花叔", published_at: "2024-08-28", excerpt: "..." },
];

describe("MentionDropdown", () => {
  it("returns null when empty", () => {
    const { container } = render(
      <MentionDropdown items={[]} activeIndex={0} onSelect={() => {}} onHover={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("formats wiki and raw labels and marks active row", () => {
    render(<MentionDropdown items={items} activeIndex={1} onSelect={() => {}} onHover={() => {}} />);
    expect(screen.getByTestId("mention-item-0").textContent).toMatch(/\[wiki\] AI\.Talk — AI studio/);
    expect(screen.getByTestId("mention-item-1").textContent).toMatch(/\[raw\] 2024-08-28 · 花叔 · Top100/);
    expect(screen.getByTestId("mention-item-1").getAttribute("data-active")).toBe("true");
    expect(screen.getByTestId("mention-item-0").getAttribute("data-active")).toBe("false");
  });

  it("fires onSelect on mouse down and onHover on enter", () => {
    const sel = vi.fn();
    const hov = vi.fn();
    render(<MentionDropdown items={items} activeIndex={0} onSelect={sel} onHover={hov} />);
    fireEvent.mouseEnter(screen.getByTestId("mention-item-1"));
    expect(hov).toHaveBeenCalledWith(1);
    fireEvent.mouseDown(screen.getByTestId("mention-item-0"));
    expect(sel).toHaveBeenCalledWith(items[0]);
  });

  it("caps at 12 rows", () => {
    const many: SuggestItem[] = Array.from({ length: 20 }, (_, i) => ({
      kind: "wiki", id: `p${i}`, title: `T${i}`, excerpt: "e",
    }));
    render(<MentionDropdown items={many} activeIndex={0} onSelect={() => {}} onHover={() => {}} />);
    expect(screen.getAllByTestId(/mention-item-/).length).toBe(12);
  });
});
```
- [ ] Run: `pnpm --filter @crossing/web-ui exec vitest run src/components/writer/__tests__/MentionDropdown.test.tsx`
- [ ] Commit: `git -c commit.gpgsign=false commit -am "sp09(T13): MentionDropdown component"`

---

## T14 — Frontend: InlineComposer (mention engine + submit)

**Files:**
- Create: `/Users/zeoooo/crossing-writer/packages/web-ui/src/components/writer/InlineComposer.tsx`
- Create (test): `/Users/zeoooo/crossing-writer/packages/web-ui/src/components/writer/__tests__/InlineComposer.test.tsx`

Steps:
- [ ] Create the component:
```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { suggestRefs, rewriteSelection, type SuggestItem } from "../../api/writer-client.js";
import { MentionDropdown } from "./MentionDropdown.js";

export interface MentionPill {
  kind: "wiki" | "raw";
  id: string;
  title: string;
  full_excerpt: string;
}

export interface InlineComposerProps {
  projectId: string;
  sectionKey: string;
  selectedText: string;
  onCancel: () => void;
  onCompleted: () => void;
  // optional injection for tests
  _suggest?: typeof suggestRefs;
  _rewrite?: typeof rewriteSelection;
}

interface MentionState {
  active: boolean;
  start: number; // index of `@`
  query: string;
  items: SuggestItem[];
  activeIndex: number;
}

const EMPTY_MENTION: MentionState = { active: false, start: -1, query: "", items: [], activeIndex: 0 };

export function InlineComposer(props: InlineComposerProps) {
  const { projectId, sectionKey, selectedText, onCancel, onCompleted } = props;
  const suggest = props._suggest ?? suggestRefs;
  const rewrite = props._rewrite ?? rewriteSelection;
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState("");
  const [pills, setPills] = useState<MentionPill[]>([]);
  const [mention, setMention] = useState<MentionState>(EMPTY_MENTION);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const closeMention = useCallback(() => setMention(EMPTY_MENTION), []);

  const runQuery = useCallback(
    (q: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        try {
          const items = await suggest(q, 12);
          setMention((m) => (m.active ? { ...m, items, activeIndex: 0 } : m));
        } catch {
          setMention((m) => (m.active ? { ...m, items: [], activeIndex: 0 } : m));
        }
      }, 120);
    },
    [suggest],
  );

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setValue(next);
    const caret = e.target.selectionStart ?? next.length;
    // detect @ trigger
    const before = next.slice(0, caret);
    const at = before.lastIndexOf("@");
    if (at >= 0) {
      const frag = before.slice(at + 1);
      if (!/\s/.test(frag) && frag.length <= 40) {
        setMention({ active: true, start: at, query: frag, items: mention.items, activeIndex: 0 });
        runQuery(frag);
        return;
      }
    }
    closeMention();
  };

  const insertPill = (item: SuggestItem) => {
    const token = `[${item.kind}:${item.title}]`;
    const before = value.slice(0, mention.start);
    const afterCaret = value.slice(taRef.current?.selectionStart ?? value.length);
    const nextVal = before + token + afterCaret;
    const pill: MentionPill = {
      kind: item.kind,
      id: item.id,
      title: item.title,
      full_excerpt: item.excerpt,
    };
    setPills((p) => [...p.filter((x) => !(x.kind === pill.kind && x.id === pill.id)), pill]);
    setValue(nextVal);
    closeMention();
    queueMicrotask(() => {
      const pos = before.length + token.length;
      taRef.current?.setSelectionRange(pos, pos);
      taRef.current?.focus();
    });
  };

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention.active && mention.items.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMention((m) => ({ ...m, activeIndex: Math.min(m.items.length - 1, m.activeIndex + 1) }));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMention((m) => ({ ...m, activeIndex: Math.max(0, m.activeIndex - 1) }));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        insertPill(mention.items[mention.activeIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeMention();
        return;
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key === "Backspace") {
      const caret = e.currentTarget.selectionStart ?? 0;
      if (caret > 0 && value[caret - 1] === "]") {
        // find nearest `[kind:` before
        const open = value.lastIndexOf("[", caret - 1);
        if (open >= 0 && /^\[(wiki|raw):/.test(value.slice(open, caret))) {
          e.preventDefault();
          const token = value.slice(open, caret);
          const m = /^\[(wiki|raw):(.+)\]$/.exec(token);
          setValue(value.slice(0, open) + value.slice(caret));
          if (m) {
            const title = m[2];
            setPills((p) => p.filter((x) => x.title !== title));
          }
          queueMicrotask(() => taRef.current?.setSelectionRange(open, open));
          return;
        }
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (submitting) return;
      setSubmitting(true);
      setError(null);
      try {
        const stream = rewrite(projectId, sectionKey, {
          selected_text: selectedText,
          user_prompt: value,
          references: pills.map((p) => ({
            kind: p.kind,
            id: p.id,
            title: p.title,
            excerpt: p.full_excerpt,
          })),
        });
        await new Promise<void>((resolve, reject) => {
          stream.onEvent((ev: { type: string; error?: string }) => {
            if (ev.type === "writer.completed") resolve();
            if (ev.type === "writer.failed") reject(new Error(ev.error ?? "rewrite failed"));
          });
        });
        onCompleted();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSubmitting(false);
      }
    }
  };

  useEffect(() => {
    taRef.current?.focus();
  }, []);

  const preview = selectedText.length > 60 ? selectedText.slice(0, 60) + "…" : selectedText;

  return (
    <div data-testid="inline-composer" className="mt-2 rounded-md border border-slate-300 bg-white p-3 shadow">
      <div className="mb-2 text-xs text-slate-500" data-testid="composer-preview">
        选中：<span className="text-slate-800">{preview}</span>
      </div>
      <div className="relative">
        <textarea
          ref={taRef}
          data-testid="composer-textarea"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          rows={4}
          placeholder="描述怎么改它，@ 引用素材..."
          className="w-full resize-y rounded-md border border-slate-200 p-2 text-sm focus:outline-none focus:ring-1 focus:ring-slate-500"
        />
        {mention.active && (
          <MentionDropdown
            items={mention.items}
            activeIndex={mention.activeIndex}
            onSelect={insertPill}
            onHover={(i) => setMention((m) => ({ ...m, activeIndex: i }))}
          />
        )}
      </div>
      {error && <div className="mt-1 text-xs text-red-600" data-testid="composer-error">{error}</div>}
      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
        <span>Esc 取消 · ⌘↵ 提交{submitting ? "（提交中…）" : ""}</span>
        <button type="button" className="text-slate-700 underline" onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}
```
- [ ] Create the test:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InlineComposer } from "../InlineComposer.js";
import type { SuggestItem } from "../../../api/writer-client.js";

const sample: SuggestItem[] = [
  { kind: "wiki", id: "entities/AI.Talk.md", title: "AI.Talk", excerpt: "AI studio" },
  { kind: "raw", id: "abc", title: "Top100", account: "花叔", published_at: "2024-08-28", excerpt: "..." },
];

function makeRewrite(capture: { payload?: any }) {
  let cb: ((ev: { type: string }) => void) | null = null;
  const stream = {
    onEvent: (fn: (ev: { type: string }) => void) => { cb = fn; },
    close: vi.fn(),
  };
  const fn = vi.fn((_pid: string, _sk: string, payload: any) => {
    capture.payload = payload;
    queueMicrotask(() => cb?.({ type: "writer.started" }));
    queueMicrotask(() => cb?.({ type: "writer.completed" }));
    return stream;
  });
  return { fn, stream };
}

describe("InlineComposer", () => {
  it("triggers mention dropdown on @ and navigates + inserts pill", async () => {
    const user = userEvent.setup();
    const suggest = vi.fn(async () => sample);
    const cap: { payload?: any } = {};
    const { fn: rewrite } = makeRewrite(cap);
    render(
      <InlineComposer
        projectId="p1"
        sectionKey="intro"
        selectedText="某段文字"
        onCancel={() => {}}
        onCompleted={() => {}}
        _suggest={suggest}
        _rewrite={rewrite}
      />,
    );
    const ta = screen.getByTestId("composer-textarea") as HTMLTextAreaElement;
    await user.click(ta);
    await user.type(ta, "@AI");
    await waitFor(() => expect(suggest).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("mention-dropdown")).toBeTruthy());
    // ArrowDown then Enter → picks raw (index 1)
    fireEvent.keyDown(ta, { key: "ArrowDown" });
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(ta.value).toMatch(/\[raw:Top100\]/);
  });

  it("submits on ⌘↵ with references payload and closes on completed", async () => {
    const user = userEvent.setup();
    const suggest = vi.fn(async () => sample);
    const cap: { payload?: any } = {};
    const { fn: rewrite } = makeRewrite(cap);
    const onCompleted = vi.fn();
    render(
      <InlineComposer
        projectId="p1"
        sectionKey="intro"
        selectedText="AI 内容工作室已经越来越多"
        onCancel={() => {}}
        onCompleted={onCompleted}
        _suggest={suggest}
        _rewrite={rewrite}
      />,
    );
    const ta = screen.getByTestId("composer-textarea") as HTMLTextAreaElement;
    await user.click(ta);
    await user.type(ta, "@AI");
    await waitFor(() => expect(screen.getByTestId("mention-dropdown")).toBeTruthy());
    fireEvent.keyDown(ta, { key: "Enter" }); // insert wiki AI.Talk (active 0)
    await user.type(ta, " 改得更有数据");
    await act(async () => {
      fireEvent.keyDown(ta, { key: "Enter", metaKey: true });
    });
    await waitFor(() => expect(onCompleted).toHaveBeenCalled());
    expect(rewrite).toHaveBeenCalled();
    expect(cap.payload.selected_text).toBe("AI 内容工作室已经越来越多");
    expect(cap.payload.references[0]).toMatchObject({ kind: "wiki", id: "entities/AI.Talk.md", title: "AI.Talk" });
    expect(cap.payload.user_prompt).toMatch(/改得更有数据/);
  });

  it("Esc calls onCancel", () => {
    const onCancel = vi.fn();
    render(
      <InlineComposer
        projectId="p1"
        sectionKey="intro"
        selectedText="x"
        onCancel={onCancel}
        onCompleted={() => {}}
        _suggest={async () => []}
        _rewrite={(() => ({ onEvent: () => {}, close: () => {} })) as any}
      />,
    );
    const ta = screen.getByTestId("composer-textarea");
    fireEvent.keyDown(ta, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("truncates selected-text preview over 60 chars", () => {
    const long = "あ".repeat(80);
    render(
      <InlineComposer
        projectId="p" sectionKey="s" selectedText={long}
        onCancel={() => {}} onCompleted={() => {}}
        _suggest={async () => []}
        _rewrite={(() => ({ onEvent: () => {}, close: () => {} })) as any}
      />,
    );
    expect(screen.getByTestId("composer-preview").textContent).toMatch(/…$/);
  });
});
```
- [ ] Run: `pnpm --filter @crossing/web-ui exec vitest run src/components/writer/__tests__/InlineComposer.test.tsx`
- [ ] Commit: `git -c commit.gpgsign=false commit -am "sp09(T14): InlineComposer + mention engine"`

---

## T15 — Frontend: rewriteSelection SSE client helper

**Files:**
- Modify: `/Users/zeoooo/crossing-writer/packages/web-ui/src/api/writer-client.ts`
- Create (test): `/Users/zeoooo/crossing-writer/packages/web-ui/src/api/__tests__/rewriteSelection.test.ts`

Steps:
- [ ] Read the existing `rewriteSectionStream` implementation in `writer-client.ts` (grep `rewriteSectionStream` to locate it) so the new helper matches its return shape (object with `onEvent` / `close`, parses `data:` lines).
- [ ] Append to `writer-client.ts`:
```ts
export interface SelectionRewriteReference {
  kind: "wiki" | "raw";
  id: string;
  title: string;
  excerpt: string;
}

export interface SelectionRewritePayload {
  selected_text: string;
  user_prompt: string;
  references: SelectionRewriteReference[];
}

export interface SelectionRewriteEvent {
  type: string;
  [key: string]: unknown;
}

export interface SelectionRewriteStream {
  onEvent: (cb: (ev: SelectionRewriteEvent) => void) => void;
  close: () => void;
}

export function rewriteSelection(
  projectId: string,
  sectionKey: string,
  payload: SelectionRewritePayload,
): SelectionRewriteStream {
  const url = `/api/projects/${encodeURIComponent(projectId)}/writer/sections/${encodeURIComponent(sectionKey)}/rewrite-selection`;
  const ctrl = new AbortController();
  const listeners: Array<(ev: SelectionRewriteEvent) => void> = [];
  (async () => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        for (const cb of listeners) cb({ type: "writer.failed", error: `HTTP ${res.status}` });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          try {
            const ev = JSON.parse(line.slice(5).trim()) as SelectionRewriteEvent;
            for (const cb of listeners) cb(ev);
          } catch { /* ignore malformed */ }
        }
      }
    } catch (err) {
      for (const cb of listeners) cb({ type: "writer.failed", error: err instanceof Error ? err.message : String(err) });
    }
  })();
  return {
    onEvent(cb) { listeners.push(cb); },
    close() { ctrl.abort(); },
  };
}
```
- [ ] Create test:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { rewriteSelection } from "../writer-client.js";

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(ctrl) {
      for (const c of chunks) ctrl.enqueue(enc.encode(c));
      ctrl.close();
    },
  });
}

describe("rewriteSelection", () => {
  beforeEach(() => { (globalThis as any).fetch = vi.fn(); });

  it("dispatches parsed SSE events to listeners", async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      body: sseBody([
        `data: ${JSON.stringify({ type: "writer.started" })}\n\n`,
        `data: ${JSON.stringify({ type: "writer.selection_rewritten", new_text: "new" })}\n\n`,
        `data: ${JSON.stringify({ type: "writer.completed" })}\n\n`,
      ]),
    }));
    const events: any[] = [];
    const s = rewriteSelection("p1", "intro", { selected_text: "a", user_prompt: "b", references: [] });
    s.onEvent((e) => events.push(e));
    await new Promise((r) => setTimeout(r, 10));
    expect(events.map((e) => e.type)).toEqual(["writer.started", "writer.selection_rewritten", "writer.completed"]);
  });

  it("emits writer.failed on non-ok response", async () => {
    (globalThis as any).fetch = vi.fn(async () => ({ ok: false, status: 400, body: null }));
    const events: any[] = [];
    const s = rewriteSelection("p1", "intro", { selected_text: "a", user_prompt: "b", references: [] });
    s.onEvent((e) => events.push(e));
    await new Promise((r) => setTimeout(r, 10));
    expect(events[0].type).toBe("writer.failed");
  });
});
```
- [ ] Run: `pnpm --filter @crossing/web-ui exec vitest run src/api/__tests__/rewriteSelection.test.ts`
- [ ] Commit: `git -c commit.gpgsign=false commit -am "sp09(T15): rewriteSelection SSE client"`

---

## T16 — Frontend: integrate into ArticleSection + delete SkillForm

**Files:**
- Modify: `/Users/zeoooo/crossing-writer/packages/web-ui/src/components/writer/ArticleSection.tsx`
- Delete: `/Users/zeoooo/crossing-writer/packages/web-ui/src/components/writer/SkillForm.tsx`
- Delete: `/Users/zeoooo/crossing-writer/packages/web-ui/src/components/writer/__tests__/SkillForm.test.tsx`
- Delete: `/Users/zeoooo/crossing-writer/packages/web-ui/src/components/writer/__tests__/ArticleSection-skill-button.test.tsx`
- Create (test): `/Users/zeoooo/crossing-writer/packages/web-ui/src/components/writer/__tests__/ArticleSection-selection.test.tsx`

Steps:
- [ ] Read `ArticleSection.tsx` fully; locate `[🔧 @skill]` button, `skillOpen` state, `<SkillForm …>` block. Note the ref pattern used for the body element (we need to attach `useTextSelection`'s `elementRef`).
- [ ] Remove imports: `import { SkillForm } from "./SkillForm.js";` and any pinned fetch logic in ReferencePanel (keep the edit minimal for T19 — only remove SkillForm render + button + `skillOpen` in this step).
- [ ] Wire selection bubble + composer. Add near the top of the component:
```tsx
import { useTextSelection } from "../../hooks/useTextSelection.js";
import { SelectionBubble } from "./SelectionBubble.js";
import { InlineComposer } from "./InlineComposer.js";
// ...
const { elementRef, selection, clear } = useTextSelection<HTMLDivElement>();
const [selectionRewriteOpen, setSelectionRewriteOpen] = useState<{ text: string } | null>(null);
```
- [ ] Attach the ref to the body container that renders section markdown: `<div ref={elementRef} className="...">{bodyMarkdown}</div>`.
- [ ] Render bubble and composer:
```tsx
{!selectionRewriteOpen && (
  <SelectionBubble
    rect={selection.rect}
    onClick={() => {
      setSelectionRewriteOpen({ text: selection.text });
      clear();
    }}
  />
)}
{selectionRewriteOpen && (
  <InlineComposer
    projectId={projectId}
    sectionKey={sectionKey}
    selectedText={selectionRewriteOpen.text}
    onCancel={() => setSelectionRewriteOpen(null)}
    onCompleted={() => {
      setSelectionRewriteOpen(null);
      onRefetch?.(); // existing refetch hook in this component
    }}
  />
)}
```
- [ ] Delete dead files:
  ```
  rm /Users/zeoooo/crossing-writer/packages/web-ui/src/components/writer/SkillForm.tsx \
     /Users/zeoooo/crossing-writer/packages/web-ui/src/components/writer/__tests__/SkillForm.test.tsx \
     /Users/zeoooo/crossing-writer/packages/web-ui/src/components/writer/__tests__/ArticleSection-skill-button.test.tsx
  ```
- [ ] Create integration test `ArticleSection-selection.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { ArticleSection } from "../ArticleSection.js";

// minimum props harness — adjust to whatever ArticleSection actually requires;
// mock fetch-backed hooks as needed.
vi.mock("../../api/writer-client.js", async (orig) => {
  const actual: any = await orig();
  return {
    ...actual,
    suggestRefs: vi.fn(async () => []),
    rewriteSelection: vi.fn(() => ({
      onEvent: (cb: any) => queueMicrotask(() => cb({ type: "writer.completed" })),
      close: () => {},
    })),
  };
});

describe("ArticleSection selection→composer", () => {
  it("shows bubble on selection and mounts composer on click", async () => {
    // Render with minimal props — assumes ArticleSection accepts these; align with real signature.
    render(
      <ArticleSection
        projectId="p1"
        sectionKey="intro"
        title="Intro"
        bodyMarkdown="Hello world selection text"
        onRefetch={() => {}}
      />,
    );
    const host = screen.getByText(/Hello world selection text/i).closest("div")!;
    const text = host.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 5);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    await act(async () => { document.dispatchEvent(new Event("selectionchange")); });
    await waitFor(() => expect(screen.getByTestId("selection-bubble")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /重写选中/ }));
    expect(screen.getByTestId("inline-composer")).toBeTruthy();
  });

  it("no SkillForm is present", () => {
    render(
      <ArticleSection
        projectId="p1"
        sectionKey="intro"
        title="Intro"
        bodyMarkdown="x"
        onRefetch={() => {}}
      />,
    );
    expect(screen.queryByText(/@skill/)).toBeNull();
  });
});
```
  > Note: if `ArticleSection`'s actual prop surface differs (e.g., it reads from a store / receives a section object), adapt the render harness to match — keep the two assertions (bubble appears after selection, composer mounts on click; no SkillForm) intact.
- [ ] Run: `pnpm --filter @crossing/web-ui exec vitest run src/components/writer/__tests__/ArticleSection-selection.test.tsx`
- [ ] Sanity grep: `grep -rn "SkillForm\|skillOpen\|callSkill" /Users/zeoooo/crossing-writer/packages/web-ui/src/components/writer/ArticleSection.tsx` should return 0 matches.
- [ ] Commit: `git -c commit.gpgsign=false commit -am "sp09(T16): selection bubble + composer in ArticleSection; delete SkillForm"`

---

## T17 — Frontend: useProjectStream handles writer.selection_rewritten

**Files:**
- Modify: `/Users/zeoooo/crossing-writer/packages/web-ui/src/hooks/useProjectStream.ts`
- Modify or create (test): `/Users/zeoooo/crossing-writer/packages/web-ui/src/hooks/__tests__/useProjectStream.test.ts`

Steps:
- [ ] Locate the `EVENT_TYPES` (or equivalent list / switch) in `useProjectStream.ts`. Add `"writer.selection_rewritten"` to it. If the hook dispatches via a reducer with a typed union, add the corresponding branch:
```ts
case "writer.selection_rewritten":
  return {
    ...state,
    events: [...state.events, { type: "writer.selection_rewritten", sectionKey: payload.sectionKey, selected_text: payload.selected_text, new_text: payload.new_text, ts: payload.ts ?? new Date().toISOString() }],
  };
```
- [ ] Add a test:
```ts
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useProjectStream } from "../useProjectStream.js";

describe("useProjectStream selection_rewritten", () => {
  it("appends writer.selection_rewritten to events", () => {
    const { result } = renderHook(() => useProjectStream("p1"));
    act(() => {
      // @ts-expect-error — test-only event injection (dispatch the event through the hook's public API)
      result.current._testDispatch?.({
        type: "writer.selection_rewritten",
        sectionKey: "intro",
        selected_text: "a",
        new_text: "b",
        ts: "2026-04-14T00:00:00Z",
      });
    });
    const last = result.current.events.at(-1);
    expect(last?.type).toBe("writer.selection_rewritten");
  });
});
```
  > If `useProjectStream` has no test-dispatch hook, use an EventSource mock (same as any existing SSE test in this file's sibling tests) to inject a `data:` line of `{"type":"writer.selection_rewritten",...}` — whichever pattern already exists in repo.
- [ ] Run: `pnpm --filter @crossing/web-ui exec vitest run src/hooks/__tests__/useProjectStream.test.ts`
- [ ] Commit: `git -c commit.gpgsign=false commit -am "sp09(T17): useProjectStream handles writer.selection_rewritten"`

---

## T18 — Frontend: AgentTimeline renders selection_rewritten

**Files:**
- Modify: `/Users/zeoooo/crossing-writer/packages/web-ui/src/components/status/AgentTimeline.tsx`
- Create/modify (test): `/Users/zeoooo/crossing-writer/packages/web-ui/src/components/status/__tests__/AgentTimeline.test.tsx`

Steps:
- [ ] Locate the switch/map rendering event types in `AgentTimeline.tsx`. Add:
```tsx
case "writer.selection_rewritten":
  return (
    <li key={idx} className="text-xs text-slate-700" data-testid={`timeline-row-${idx}`}>
      <span className="mr-1">✂️</span>
      <span className="font-medium">改写选中片段</span>
      <span className="ml-2 text-slate-500">§{ev.sectionKey}</span>
      <span className="ml-2 text-slate-400 truncate">{(ev.selected_text ?? "").slice(0, 24)}…</span>
    </li>
  );
```
- [ ] Add/extend a snapshot test:
```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { AgentTimeline } from "../AgentTimeline.js";

describe("AgentTimeline selection_rewritten", () => {
  it("renders ✂️ 改写选中片段 row", () => {
    const { container } = render(
      <AgentTimeline
        events={[
          {
            type: "writer.selection_rewritten",
            sectionKey: "intro",
            selected_text: "AI 内容工作室已经越来越多",
            new_text: "...",
            ts: "2026-04-14T00:00:00Z",
          } as any,
        ]}
      />,
    );
    expect(container.textContent).toMatch(/✂️/);
    expect(container.textContent).toMatch(/改写选中片段/);
    expect(container).toMatchSnapshot();
  });
});
```
- [ ] Run: `pnpm --filter @crossing/web-ui exec vitest run src/components/status/__tests__/AgentTimeline.test.tsx`
- [ ] Commit: `git -c commit.gpgsign=false commit -am "sp09(T18): AgentTimeline renders selection_rewritten"`

---

## T19 — Frontend cleanup: ReferencePanel + writer-client dead code

**Files:**
- Modify: `/Users/zeoooo/crossing-writer/packages/web-ui/src/components/writer/ArticleSection.tsx` (ReferencePanel block)
- Modify: `/Users/zeoooo/crossing-writer/packages/web-ui/src/api/writer-client.ts`
- Modify or delete: any test referencing `callSkill` / `getPinned` / `deletePin` / `PinnedItem`

Steps:
- [ ] `grep -rn "callSkill\|getPinned\|deletePin\|PinnedItem" /Users/zeoooo/crossing-writer/packages/web-ui/src/` to enumerate.
- [ ] In `writer-client.ts` delete the exports `callSkill`, `getPinned`, `deletePin`, and the `PinnedItem` (plus `SkillResult` if only used by these). Keep `suggestRefs`, `rewriteSelection`, `rewriteSectionStream`, and everything else.
- [ ] In `ArticleSection.tsx` ReferencePanel: remove the pinned fetch branch / `getPinned` useEffect / pinned render column. Keep only the `tools_used` frontmatter render.
- [ ] Update or delete tests that asserted pinned UI; if a test was SP-08-only, delete it. Do NOT touch the T14/T15 SP-08 references test from earlier work — adjust its imports if it still imports the now-deleted names.
- [ ] Sanity grep: `grep -rn "callSkill\|getPinned\|deletePin\|PinnedItem\|pendingPinsStore" /Users/zeoooo/crossing-writer/packages/web-ui/` → 0 matches.
- [ ] Run full web-ui suite:
  `pnpm --filter @crossing/web-ui exec vitest run`
  Expected: all green.
- [ ] Commit: `git -c commit.gpgsign=false commit -am "sp09(T19): remove SP-08 pinned/skill client dead code"`

---

## T20 — End-to-end integration test (happy path)

**Files:**
- Create (test): `/Users/zeoooo/crossing-writer/packages/web-ui/src/__tests__/sp09-e2e.test.tsx`

Steps:
- [ ] Create the e2e test wiring SelectionBubble → InlineComposer → MentionDropdown → SSE completion:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, act, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArticleSection } from "../components/writer/ArticleSection.js";

vi.mock("../api/writer-client.js", async (orig) => {
  const actual: any = await orig();
  return {
    ...actual,
    suggestRefs: vi.fn(async (q: string) => {
      if (!q) return [];
      return [
        { kind: "wiki", id: "entities/AI.Talk.md", title: "AI.Talk", excerpt: "AI studio" },
        { kind: "raw", id: "abc", title: "Top100", account: "花叔", published_at: "2024-08-28", excerpt: "..." },
      ];
    }),
    rewriteSelection: vi.fn((_p, _s, payload) => {
      (globalThis as any).__lastRewritePayload = payload;
      const listeners: Array<(e: any) => void> = [];
      queueMicrotask(() => {
        for (const l of listeners) l({ type: "writer.started" });
        for (const l of listeners) l({
          type: "writer.selection_rewritten",
          sectionKey: "intro",
          selected_text: payload.selected_text,
          new_text: "NEW TEXT",
          ts: "2026-04-14T00:00:00Z",
        });
        for (const l of listeners) l({ type: "writer.completed" });
      });
      return { onEvent: (cb: any) => listeners.push(cb), close: () => {} };
    }),
  };
});

describe("SP-09 e2e: select → bubble → @ mention → submit", () => {
  it("completes the happy path and closes composer", async () => {
    const user = userEvent.setup();
    const refetch = vi.fn();
    render(
      <ArticleSection
        projectId="p1"
        sectionKey="intro"
        title="Intro"
        bodyMarkdown="AI 内容工作室已经越来越多 and more tail text"
        onRefetch={refetch}
      />,
    );
    // 1) select "AI 内容工作室已经越来越多"
    const host = screen.getByText(/AI 内容工作室/).closest("div")!;
    const textNode = host.firstChild as Text;
    const selectedText = "AI 内容工作室已经越来越多";
    const start = textNode.textContent!.indexOf(selectedText);
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + selectedText.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    await act(async () => { document.dispatchEvent(new Event("selectionchange")); });

    // 2) bubble appears → click
    await waitFor(() => expect(screen.getByTestId("selection-bubble")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /重写选中/ }));

    // 3) composer mounts → type @AI → dropdown → arrow + enter
    const ta = (await screen.findByTestId("composer-textarea")) as HTMLTextAreaElement;
    await user.click(ta);
    await user.type(ta, "@AI");
    await waitFor(() => expect(screen.getByTestId("mention-dropdown")).toBeTruthy());
    fireEvent.keyDown(ta, { key: "ArrowDown" });
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(ta.value).toMatch(/\[raw:Top100\]/);

    // 4) type prompt → ⌘↵
    await user.type(ta, " 用更有数据支撑的说法改写");
    await act(async () => {
      fireEvent.keyDown(ta, { key: "Enter", metaKey: true });
    });

    // 5) composer closed + refetch called
    await waitFor(() => expect(screen.queryByTestId("inline-composer")).toBeNull());
    expect(refetch).toHaveBeenCalled();

    // payload shape sanity
    const payload = (globalThis as any).__lastRewritePayload;
    expect(payload.selected_text).toBe(selectedText);
    expect(payload.user_prompt).toMatch(/用更有数据/);
    expect(payload.references.length).toBeGreaterThan(0);
    expect(payload.references[0].kind).toBe("raw");
  });
});
```
- [ ] Run: `pnpm --filter @crossing/web-ui exec vitest run src/__tests__/sp09-e2e.test.tsx`
- [ ] Full gate: `pnpm --filter @crossing/web-server exec vitest run && pnpm --filter @crossing/web-ui exec vitest run` — both green.
- [ ] Commit: `git -c commit.gpgsign=false commit -am "sp09(T20): selection-rewrite-mention e2e happy path"`

---

## Self-Review

### Spec-coverage mapping

| Spec clause | Covered by |
| --- | --- |
| §2.1 划选文本弹 bubble | T11 (hook) · T12 (bubble) · T16 (mount) |
| §2.2 bubble 点击升起 inline composer | T14 (composer) · T16 (state wiring) |
| §2.3 composer 顶部选中预览 (>60 字截断) | T14 `preview` + test |
| §2.3 prompt textarea + 底栏 Esc/⌘↵ | T14 |
| §2.4 `@` 候选列表 ≤12 条 + 防抖 120ms | T14 mention engine · T13 dropdown cap |
| §2.4 wiki / raw 条目格式化 | T13 label formatter + test |
| §2.4 ↑↓ 导航 + Enter 选中 | T14 keydown branches + test |
| §2.5 pill token 插入 + backspace 删除 | T14 insertPill / Backspace branch |
| §2.6 ⌘↵ SSE 提交 | T14 submit + T15 stream helper |
| §2 关闭语义 (Esc only, 点外部不关) | T14 Esc handler; no outside-click listener |
| §3 frontend 新增/删除清单 | T11–T16, T19 |
| §4 POST /rewrite-selection 客户端契约 | T15 payload + event shape |
| §5 SuggestItem / MentionPill / selection_rewritten 类型 | T15 (SuggestItem re-exported part 1) · T14 (MentionPill) · T17 (event branch) |
| §6 删除 SkillForm / ArticleSection-skill-button / callSkill / getPinned / deletePin / PinnedItem | T16, T19 |
| §7 `frontmatter.tools_used` 保留渲染 | T19 ReferencePanel keeps tools_used column |
| §7 整段 rewrite + writer agent 自主 tool 仍正常 | untouched (explicit guardrail in T19) |
| §7 timeline 显示 selection_rewritten | T17 · T18 |

### Placeholder scan

Grepped this document for `TODO`, `TBD`, `FIXME`, `<placeholder>`, `...` standalone — none present outside legitimate string literals (`…` truncation markers in code, SSE `...` snippets in mocked excerpts, and the `// ...` in T16 example showing context continuation). All commands, file paths, route paths, and test names are fully resolved.

### Type consistency check

- `SuggestItem` — defined in part 1 T1 (web-server export) and re-declared/exported by `writer-client.ts` (part 1 T2). Consumed verbatim by T13, T14, T20. Field set: `kind, id, title, excerpt, account?, published_at?` identical everywhere.
- `MentionPill` — only used inside `InlineComposer.tsx` (T14), no cross-module leakage.
- `SelectionRewritePayload` / `SelectionRewriteReference` — defined in T15, consumed by T14 through the `rewriteSelection` import. Backend route in part 1 accepts `{selected_text, user_prompt, references:[{kind,id,title,excerpt}]}` — matches.
- `writer.selection_rewritten` event — backend emits (part 1 T6/T7); client parses in T15; reducer in T17; timeline render in T18. `{type, sectionKey, selected_text, new_text, ts}` consistent at every stop.
- No type imports cross the web-server↔web-ui boundary (structural compat only), matching existing repo convention.

### Known risks

- **T14 mention engine** — hand-rolled caret/`@` detection over a raw `<textarea>` is the trickiest surface: (a) multi-byte characters could make `selectionStart` offsets subtly wrong; (b) paste events aren't wired, so a paste containing `@` won't open the dropdown (acceptable MVP); (c) pill-as-text means a user can type `[wiki:Fake]` manually and it'll be treated as a real reference only if it survives the `pills[]` merge — the submit payload uses the `pills[]` state (not regex-parsing the textarea) so fake tokens are harmless but cosmetically confusing. Worth revisiting if complaints arise.
- **T16 ArticleSection harness assumption** — the e2e and integration tests assume a prop shape `{projectId, sectionKey, title, bodyMarkdown, onRefetch}`. If the actual component reads from a store / context instead, harness wrappers will need adjustment. Called out inline in T16.

