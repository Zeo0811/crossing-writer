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

<!-- PART2_MARKER -->
