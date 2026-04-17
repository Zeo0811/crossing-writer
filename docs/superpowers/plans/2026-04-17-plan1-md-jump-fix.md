# Plan 1 · MD 跳转修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `WikiPagePreview` 支持三种跳转——实体名 auto-link、frontmatter footer（sources/backlinks/images）渲染、source 点击抽屉打开 `10_refs/` 原文。

**Architecture:** 后端加三个读接口（`?meta=1` / `/index.json` / `/raw-articles/:account/:id`）；前端新增 `useWikiIndex` hook 做 60s 缓存，新增 `WikiFrontmatterFooter` + `RawArticleDrawer` 组件，重写 `WikiPagePreview` 用 react-markdown 自定义 renderer 做 auto-link。

**Tech Stack:** Fastify + better-sqlite3（后端）· React + react-markdown + Radix Dialog（前端）· vitest + @testing-library（测试）

**Spec 参考:** `docs/superpowers/specs/2026-04-17-knowledge-page-ingest-redesign-design.md` §6.4 + §5.3

---

## 文件结构

**新建：**
- `packages/web-server/src/routes/kb-raw-articles.ts` — 单职责：读 `ref_articles` 原文
- `packages/web-server/tests/routes-kb-raw-articles.test.ts`
- `packages/web-server/tests/routes-kb-wiki-index-json.test.ts`
- `packages/web-ui/src/hooks/useWikiIndex.ts` — 60s 内存缓存的 wiki index
- `packages/web-ui/src/components/wiki/WikiFrontmatterFooter.tsx` — sources / backlinks / images 三组渲染
- `packages/web-ui/src/components/wiki/RawArticleDrawer.tsx` — 右侧滑出抽屉
- `packages/web-ui/tests/wiki-frontmatter-footer.test.tsx`
- `packages/web-ui/tests/raw-article-drawer.test.tsx`
- `packages/web-ui/tests/wiki-page-preview-v2.test.tsx`

**修改：**
- `packages/web-server/src/routes/kb-wiki.ts` — 加 `?meta=1` 分支、加 `GET /api/kb/wiki/index.json`
- `packages/web-server/src/server.ts` — 注册 `registerKbRawArticlesRoutes`
- `packages/web-server/tests/routes-kb-wiki-pages.test.ts` — 加 `?meta=1` 测试
- `packages/web-ui/src/api/wiki-client.ts` — 加 `getPageMeta` / `getWikiIndex` / `getRawArticle` + 类型
- `packages/web-ui/src/components/wiki/WikiPagePreview.tsx` — 完整重写
- `packages/web-ui/src/pages/KnowledgePage.tsx` — `WikiPagePreview` 传 `onNavigate` / `onOpenSource` 回调，托管抽屉状态

---

## Task 1：后端 — `GET /api/kb/wiki/pages/*?meta=1` 返回 JSON

**Files:**
- Modify: `packages/web-server/src/routes/kb-wiki.ts:100-111`
- Modify: `packages/web-server/tests/routes-kb-wiki-pages.test.ts`

- [ ] **Step 1: Write the failing test**

在 `packages/web-server/tests/routes-kb-wiki-pages.test.ts` 末尾追加：

```ts
describe("GET /api/kb/wiki/pages/* with ?meta=1", () => {
  it("returns JSON with frontmatter and body", async () => {
    const { app } = await mk();
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/pages/entities/A.md?meta=1" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    const body = res.json() as { frontmatter: Record<string, unknown>; body: string };
    expect(body.frontmatter.type).toBe("entity");
    expect(body.frontmatter.title).toBe("A");
    expect(body.body).toContain("# A");
    await app.close();
  });

  it("preserves raw markdown response when meta not set", async () => {
    const { app } = await mk();
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/pages/entities/A.md" });
    expect(res.headers["content-type"]).toMatch(/text\/markdown/);
    expect(res.body).toContain("# A");
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/web-server && pnpm exec vitest run routes-kb-wiki-pages
```

Expected: `returns JSON with frontmatter and body` FAIL（response is text/markdown，不是 JSON）

- [ ] **Step 3: Implement minimal code**

修改 `packages/web-server/src/routes/kb-wiki.ts:100-111`，把原 handler 替换为：

```ts
app.get<{ Params: { "*": string }; Querystring: { meta?: string } }>(
  "/api/kb/wiki/pages/*",
  async (req, reply) => {
    const rel = (req.params as { "*": string })["*"];
    if (!rel || rel.includes("..")) return reply.code(400).send({ error: "invalid path" });
    const { WikiStore, parseFrontmatter } = await import("@crossing/kb");
    const store = new WikiStore(deps.vaultPath);
    let abs: string;
    try { abs = store.absPath(rel); } catch { return reply.code(400).send({ error: "invalid path" }); }
    const { existsSync, readFileSync } = await import("node:fs");
    if (!existsSync(abs)) return reply.code(404).send({ error: "not found" });
    const text = readFileSync(abs, "utf-8");
    if (req.query.meta === "1") {
      const { frontmatter, body } = parseFrontmatter(text);
      return reply.send({ frontmatter, body });
    }
    reply.header("Content-Type", "text/markdown; charset=utf-8");
    return reply.send(text);
  },
);
```

注意 `parseFrontmatter` 需从 `@crossing/kb` 导出。如未导出，先在 `packages/kb/src/index.ts` 加 `export { parseFrontmatter } from "./wiki/wiki-store.js";`

- [ ] **Step 4: Verify @crossing/kb exports parseFrontmatter**

```bash
grep "parseFrontmatter" packages/kb/src/index.ts
```

如为空，编辑 `packages/kb/src/index.ts` 追加：

```ts
export { parseFrontmatter, serializeFrontmatter } from "./wiki/wiki-store.js";
```

然后 rebuild kb：

```bash
cd packages/kb && pnpm build
```

- [ ] **Step 5: Run tests to verify pass**

```bash
cd packages/web-server && pnpm exec vitest run routes-kb-wiki-pages
```

Expected: 所有测试 PASS

- [ ] **Step 6: Commit**

```bash
git add packages/kb/src/index.ts packages/kb/dist \
        packages/web-server/src/routes/kb-wiki.ts \
        packages/web-server/tests/routes-kb-wiki-pages.test.ts
git commit -m "feat(web-server): pages endpoint supports ?meta=1 JSON response"
```

---

## Task 2：后端 — `GET /api/kb/wiki/index.json`

**Files:**
- Modify: `packages/web-server/src/routes/kb-wiki.ts`
- Create: `packages/web-server/tests/routes-kb-wiki-index-json.test.ts`

- [ ] **Step 1: Write the failing test**

新建 `packages/web-server/tests/routes-kb-wiki-index-json.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WikiStore } from "@crossing/kb";
import { registerKbWikiRoutes } from "../src/routes/kb-wiki.js";

async function mk() {
  const vault = mkdtempSync(join(tmpdir(), "ix-"));
  const store = new WikiStore(vault);
  store.applyPatch({ op: "upsert", path: "entities/A.md", frontmatter: { type: "entity", title: "A", aliases: ["a1", "a2"] }, body: "# A" });
  store.applyPatch({ op: "upsert", path: "concepts/B.md", frontmatter: { type: "concept", title: "B" }, body: "# B" });
  const sqlitePath = join(vault, "refs.sqlite");
  writeFileSync(sqlitePath, "");
  const app = Fastify();
  registerKbWikiRoutes(app, { vaultPath: vault, sqlitePath });
  await app.ready();
  return { app };
}

describe("GET /api/kb/wiki/index.json", () => {
  it("returns path/title/aliases for all pages", async () => {
    const { app } = await mk();
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/index.json" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ path: string; title: string; aliases: string[] }>;
    expect(body).toHaveLength(2);
    const a = body.find((b) => b.path === "entities/A.md");
    expect(a?.title).toBe("A");
    expect(a?.aliases).toEqual(["a1", "a2"]);
    const b = body.find((b) => b.path === "concepts/B.md");
    expect(b?.aliases).toEqual([]);
    await app.close();
  });

  it("sets cache-control max-age=60", async () => {
    const { app } = await mk();
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/index.json" });
    expect(res.headers["cache-control"]).toMatch(/max-age=60/);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/web-server && pnpm exec vitest run routes-kb-wiki-index-json
```

Expected: 404 或 route not found

- [ ] **Step 3: Implement minimal code**

在 `packages/web-server/src/routes/kb-wiki.ts` 的 `registerKbWikiRoutes` 函数内部，紧接 `app.get<...>("/api/kb/wiki/pages/*"...)` 之后追加：

```ts
app.get("/api/kb/wiki/index.json", async (_req, reply) => {
  const { WikiStore } = await import("@crossing/kb");
  const store = new WikiStore(deps.vaultPath);
  const pages = store.listPages();
  const out = pages.map((p) => ({
    path: p.path,
    title: p.frontmatter.title ?? "",
    aliases: p.frontmatter.aliases ?? [],
  }));
  reply.header("Cache-Control", "public, max-age=60");
  return reply.send(out);
});
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd packages/web-server && pnpm exec vitest run routes-kb-wiki-index-json
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web-server/src/routes/kb-wiki.ts \
        packages/web-server/tests/routes-kb-wiki-index-json.test.ts
git commit -m "feat(web-server): GET /api/kb/wiki/index.json for auto-link index"
```

---

## Task 3：后端 — `GET /api/kb/raw-articles/:account/:id`

**Files:**
- Create: `packages/web-server/src/routes/kb-raw-articles.ts`
- Create: `packages/web-server/tests/routes-kb-raw-articles.test.ts`
- Modify: `packages/web-server/src/server.ts`

- [ ] **Step 1: Write the failing test**

新建 `packages/web-server/tests/routes-kb-raw-articles.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { registerKbRawArticlesRoutes } from "../src/routes/kb-raw-articles.js";

function makeSqlite(dir: string) {
  const p = join(dir, "refs.sqlite");
  const db = new Database(p);
  db.exec(`
    CREATE TABLE ref_articles (
      id TEXT PRIMARY KEY,
      account TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT,
      published_at TEXT NOT NULL,
      url TEXT,
      summary TEXT,
      word_count INTEGER,
      body_plain TEXT,
      md_path TEXT,
      html_path TEXT,
      ingest_status TEXT DEFAULT 'raw'
    );
  `);
  db.prepare(`INSERT INTO ref_articles (id, account, title, published_at, url, body_plain, md_path, word_count)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    "abc123", "测试账号", "一篇文章", "2026-04-15",
    "https://mp.example.com/s/xxx",
    "这是正文内容。",
    "10_refs/测试账号/2026/2026-04-15-一篇文章-xxx.md",
    150,
  );
  db.close();
  return p;
}

async function mk() {
  const dir = mkdtempSync(join(tmpdir(), "ra-"));
  const sqlitePath = makeSqlite(dir);
  const app = Fastify();
  registerKbRawArticlesRoutes(app, { sqlitePath });
  await app.ready();
  return { app };
}

describe("GET /api/kb/raw-articles/:account/:id", () => {
  it("returns article fields", async () => {
    const { app } = await mk();
    const res = await app.inject({ method: "GET", url: "/api/kb/raw-articles/%E6%B5%8B%E8%AF%95%E8%B4%A6%E5%8F%B7/abc123" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { title: string; published_at: string; url: string; body_plain: string; word_count: number };
    expect(body.title).toBe("一篇文章");
    expect(body.url).toContain("mp.example.com");
    expect(body.body_plain).toContain("正文");
    expect(body.word_count).toBe(150);
    await app.close();
  });

  it("returns 404 for missing id", async () => {
    const { app } = await mk();
    const res = await app.inject({ method: "GET", url: "/api/kb/raw-articles/%E6%B5%8B%E8%AF%95%E8%B4%A6%E5%8F%B7/nope" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 404 when sqlite missing", async () => {
    const app = Fastify();
    registerKbRawArticlesRoutes(app, { sqlitePath: "/tmp/does-not-exist.sqlite" });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/kb/raw-articles/x/y" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/web-server && pnpm exec vitest run routes-kb-raw-articles
```

Expected: Cannot find module `kb-raw-articles`

- [ ] **Step 3: Create route file**

新建 `packages/web-server/src/routes/kb-raw-articles.ts`：

```ts
import type { FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { existsSync } from "node:fs";

export interface KbRawArticlesDeps {
  sqlitePath: string;
}

interface Row {
  id: string;
  account: string;
  title: string;
  author: string | null;
  published_at: string;
  url: string | null;
  body_plain: string | null;
  md_path: string | null;
  word_count: number | null;
}

export function registerKbRawArticlesRoutes(app: FastifyInstance, deps: KbRawArticlesDeps) {
  app.get<{ Params: { account: string; id: string } }>(
    "/api/kb/raw-articles/:account/:id",
    async (req, reply) => {
      if (!existsSync(deps.sqlitePath)) return reply.code(404).send({ error: "db missing" });
      const db = new Database(deps.sqlitePath, { readonly: true, fileMustExist: true });
      try {
        const row = db.prepare(
          `SELECT id, account, title, author, published_at, url, body_plain, md_path, word_count
           FROM ref_articles WHERE account = ? AND id = ? LIMIT 1`,
        ).get(req.params.account, req.params.id) as Row | undefined;
        if (!row) return reply.code(404).send({ error: "not found" });
        return reply.send({
          id: row.id,
          account: row.account,
          title: row.title,
          author: row.author,
          published_at: row.published_at,
          url: row.url,
          body_plain: row.body_plain ?? "",
          md_path: row.md_path,
          word_count: row.word_count,
        });
      } finally {
        db.close();
      }
    },
  );
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd packages/web-server && pnpm exec vitest run routes-kb-raw-articles
```

Expected: 所有三条 PASS

- [ ] **Step 5: Wire route in server.ts**

读 `packages/web-server/src/server.ts`，找到 `registerKbAccountsRoutes` 所在行；在其下面追加：

```ts
import { registerKbRawArticlesRoutes } from "./routes/kb-raw-articles.js";
```

然后在 route 注册段（找到 `registerKbAccountsRoutes(app, ...)` 那行）其下追加：

```ts
registerKbRawArticlesRoutes(app, { sqlitePath: cfg.sqlitePath });
```

- [ ] **Step 6: Build server to verify tsc clean**

```bash
cd packages/web-server && pnpm exec tsc --noEmit
```

Expected: 0 错误（除 pre-existing）

- [ ] **Step 7: Commit**

```bash
git add packages/web-server/src/routes/kb-raw-articles.ts \
        packages/web-server/src/server.ts \
        packages/web-server/tests/routes-kb-raw-articles.test.ts
git commit -m "feat(web-server): GET /api/kb/raw-articles/:account/:id"
```

---

## Task 4：前端 — `wiki-client` 加 3 个新函数

**Files:**
- Modify: `packages/web-ui/src/api/wiki-client.ts`

- [ ] **Step 1: Write new types + functions**

在 `packages/web-ui/src/api/wiki-client.ts` 末尾追加：

```ts
export interface WikiFrontmatter {
  type: WikiKind;
  title: string;
  aliases?: string[];
  sources?: Array<{ account: string; article_id: string; quoted: string }>;
  backlinks?: string[];
  images?: Array<{ url: string; caption?: string; from_article?: string }>;
  last_ingest?: string;
  [k: string]: unknown;
}

export interface WikiPageFull {
  frontmatter: WikiFrontmatter;
  body: string;
}

export async function getPageMeta(path: string): Promise<WikiPageFull> {
  const r = await fetch(`/api/kb/wiki/pages/${path}?meta=1`);
  if (!r.ok) throw new Error(`getPageMeta ${r.status}`);
  return (await r.json()) as WikiPageFull;
}

export interface WikiIndexEntry {
  path: string;
  title: string;
  aliases: string[];
}

export async function getWikiIndex(): Promise<WikiIndexEntry[]> {
  const r = await fetch(`/api/kb/wiki/index.json`);
  if (!r.ok) throw new Error(`getWikiIndex ${r.status}`);
  return (await r.json()) as WikiIndexEntry[];
}

export interface RawArticle {
  id: string;
  account: string;
  title: string;
  author: string | null;
  published_at: string;
  url: string | null;
  body_plain: string;
  md_path: string | null;
  word_count: number | null;
}

export async function getRawArticle(account: string, id: string): Promise<RawArticle> {
  const r = await fetch(`/api/kb/raw-articles/${encodeURIComponent(account)}/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(`getRawArticle ${r.status}`);
  return (await r.json()) as RawArticle;
}
```

- [ ] **Step 2: Run tsc**

```bash
cd packages/web-ui && pnpm exec tsc --noEmit
```

Expected: 0 错误（除 pre-existing）

- [ ] **Step 3: Commit**

```bash
git add packages/web-ui/src/api/wiki-client.ts
git commit -m "feat(web-ui): wiki-client getPageMeta/getWikiIndex/getRawArticle"
```

---

## Task 5：前端 — `useWikiIndex` hook（60s 内存缓存）

**Files:**
- Create: `packages/web-ui/src/hooks/useWikiIndex.ts`
- Create: `packages/web-ui/tests/hooks/use-wiki-index.test.tsx`

- [ ] **Step 1: Write the failing test**

新建 `packages/web-ui/tests/hooks/use-wiki-index.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useWikiIndex, __resetWikiIndexCache } from "../../src/hooks/useWikiIndex";

beforeEach(() => {
  __resetWikiIndexCache();
  vi.restoreAllMocks();
});

describe("useWikiIndex", () => {
  it("fetches index.json once and caches across hook instances", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ path: "entities/A.md", title: "A", aliases: ["a1"] }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { result: r1 } = renderHook(() => useWikiIndex());
    await waitFor(() => expect(r1.current.entries.length).toBe(1));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const { result: r2 } = renderHook(() => useWikiIndex());
    await waitFor(() => expect(r2.current.entries.length).toBe(1));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("exposes error on fetch failure", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));
    const { result } = renderHook(() => useWikiIndex());
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.entries).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/web-ui && pnpm exec vitest run hooks/use-wiki-index
```

Expected: Cannot find module `useWikiIndex`

- [ ] **Step 3: Implement hook**

新建 `packages/web-ui/src/hooks/useWikiIndex.ts`：

```ts
import { useEffect, useState } from "react";
import { getWikiIndex, type WikiIndexEntry } from "../api/wiki-client";

interface CacheShape {
  entries: WikiIndexEntry[];
  ts: number;
}

let cache: CacheShape | null = null;
let inflight: Promise<WikiIndexEntry[]> | null = null;
const TTL_MS = 60_000;

export function __resetWikiIndexCache(): void {
  cache = null;
  inflight = null;
}

async function load(): Promise<WikiIndexEntry[]> {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.entries;
  if (inflight) return inflight;
  inflight = getWikiIndex()
    .then((entries) => {
      cache = { entries, ts: Date.now() };
      inflight = null;
      return entries;
    })
    .catch((err) => {
      inflight = null;
      throw err;
    });
  return inflight;
}

export function useWikiIndex(): { entries: WikiIndexEntry[]; loading: boolean; error: string | null } {
  const [entries, setEntries] = useState<WikiIndexEntry[]>(() => cache?.entries ?? []);
  const [loading, setLoading] = useState<boolean>(!cache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .then((es) => { if (!cancelled) { setEntries(es); setError(null); } })
      .catch((e) => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { entries, loading, error };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd packages/web-ui && pnpm exec vitest run hooks/use-wiki-index
```

Expected: 两条 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web-ui/src/hooks/useWikiIndex.ts \
        packages/web-ui/tests/hooks/use-wiki-index.test.tsx
git commit -m "feat(web-ui): useWikiIndex hook with 60s in-memory cache"
```

---

## Task 6：前端 — `WikiFrontmatterFooter` 组件

**Files:**
- Create: `packages/web-ui/src/components/wiki/WikiFrontmatterFooter.tsx`
- Create: `packages/web-ui/tests/wiki-frontmatter-footer.test.tsx`

- [ ] **Step 1: Write the failing test**

新建 `packages/web-ui/tests/wiki-frontmatter-footer.test.tsx`：

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WikiFrontmatterFooter } from "../src/components/wiki/WikiFrontmatterFooter";

const fm = {
  type: "entity" as const,
  title: "阶跃星辰",
  sources: [
    { account: "十字路口Crossing", article_id: "abc12345def67890", quoted: "阶跃星辰是其中走得比较快的一个。" },
  ],
  backlinks: ["entities/StepClaw.md", "concepts/agent.md"],
  images: [{ url: "https://example.com/a.png", caption: "图 1" }],
  last_ingest: "2026-04-16T00:00:00Z",
};

describe("WikiFrontmatterFooter", () => {
  it("renders sources with account + short id + quoted", () => {
    render(<WikiFrontmatterFooter frontmatter={fm} onNavigate={() => {}} onOpenSource={() => {}} knownPaths={new Set(["entities/StepClaw.md", "concepts/agent.md"])} />);
    expect(screen.getByText("十字路口Crossing")).toBeInTheDocument();
    expect(screen.getByText(/abc12345/)).toBeInTheDocument();
    expect(screen.getByText(/阶跃星辰是其中走得比较快的一个/)).toBeInTheDocument();
  });

  it("click on source triggers onOpenSource with account + id", () => {
    const onOpenSource = vi.fn();
    render(<WikiFrontmatterFooter frontmatter={fm} onNavigate={() => {}} onOpenSource={onOpenSource} knownPaths={new Set()} />);
    fireEvent.click(screen.getByRole("button", { name: /十字路口Crossing.*abc12345/ }));
    expect(onOpenSource).toHaveBeenCalledWith("十字路口Crossing", "abc12345def67890");
  });

  it("click on backlink chip triggers onNavigate", () => {
    const onNavigate = vi.fn();
    render(<WikiFrontmatterFooter frontmatter={fm} onNavigate={onNavigate} onOpenSource={() => {}} knownPaths={new Set(["entities/StepClaw.md", "concepts/agent.md"])} />);
    fireEvent.click(screen.getByRole("button", { name: "entities/StepClaw.md" }));
    expect(onNavigate).toHaveBeenCalledWith("entities/StepClaw.md");
  });

  it("marks unknown backlink paths as disabled", () => {
    render(<WikiFrontmatterFooter frontmatter={fm} onNavigate={() => {}} onOpenSource={() => {}} knownPaths={new Set(["concepts/agent.md"])} />);
    const btn = screen.getByRole("button", { name: "entities/StepClaw.md" });
    expect(btn).toBeDisabled();
  });

  it("renders images with url and caption", () => {
    render(<WikiFrontmatterFooter frontmatter={fm} onNavigate={() => {}} onOpenSource={() => {}} knownPaths={new Set()} />);
    const img = screen.getByAltText("图 1") as HTMLImageElement;
    expect(img.src).toContain("example.com/a.png");
  });

  it("renders nothing when no sources/backlinks/images", () => {
    const { container } = render(
      <WikiFrontmatterFooter
        frontmatter={{ type: "entity", title: "x" }}
        onNavigate={() => {}}
        onOpenSource={() => {}}
        knownPaths={new Set()}
      />,
    );
    expect(container.textContent).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/web-ui && pnpm exec vitest run wiki-frontmatter-footer
```

Expected: Cannot find module `WikiFrontmatterFooter`

- [ ] **Step 3: Implement component**

新建 `packages/web-ui/src/components/wiki/WikiFrontmatterFooter.tsx`：

```tsx
import type { WikiFrontmatter } from "../../api/wiki-client";
import { Chip, Tooltip } from "../ui";

export interface WikiFrontmatterFooterProps {
  frontmatter: WikiFrontmatter;
  onNavigate: (path: string) => void;
  onOpenSource: (account: string, articleId: string) => void;
  knownPaths: Set<string>;
}

export function WikiFrontmatterFooter({ frontmatter, onNavigate, onOpenSource, knownPaths }: WikiFrontmatterFooterProps) {
  const sources = frontmatter.sources ?? [];
  const backlinks = frontmatter.backlinks ?? [];
  const images = frontmatter.images ?? [];
  if (sources.length === 0 && backlinks.length === 0 && images.length === 0) return null;

  return (
    <div className="mt-6 space-y-5">
      {sources.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-[var(--meta)] mb-2">Sources（{sources.length}）</h3>
          <div className="space-y-1.5">
            {sources.map((s, i) => (
              <button
                key={`${s.article_id}-${i}`}
                type="button"
                onClick={() => onOpenSource(s.account, s.article_id)}
                aria-label={`${s.account} ${s.article_id.slice(0, 8)}`}
                className="w-full flex items-start gap-2 px-3 py-2 rounded bg-[var(--bg-2)] hover:bg-[var(--accent-fill)] text-left"
              >
                <Chip variant="neutral" size="sm">{s.account}</Chip>
                <span className="text-[10px] text-[var(--faint)] font-mono mt-0.5">{s.article_id.slice(0, 8)}</span>
                <span className="flex-1 text-xs text-[var(--body)] italic">"{s.quoted}"</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {backlinks.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-[var(--meta)] mb-2">Backlinks（{backlinks.length}）</h3>
          <div className="flex flex-wrap gap-1.5">
            {backlinks.map((p) => {
              const known = knownPaths.has(p);
              const btn = (
                <button
                  key={p}
                  type="button"
                  disabled={!known}
                  onClick={() => known && onNavigate(p)}
                  className={`px-2 py-1 rounded text-xs border ${
                    known
                      ? "border-[var(--hair)] bg-[var(--bg-2)] text-[var(--body)] hover:border-[var(--accent-soft)] hover:text-[var(--accent)]"
                      : "border-[var(--hair)] bg-[var(--bg-2)] text-[var(--faint)] cursor-not-allowed opacity-60"
                  }`}
                >
                  {p}
                </button>
              );
              return known ? btn : (
                <Tooltip key={p} content="页面已不存在">{btn}</Tooltip>
              );
            })}
          </div>
        </section>
      )}

      {images.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-[var(--meta)] mb-2">Images（{images.length}）</h3>
          <div className="grid grid-cols-4 gap-2">
            {images.map((im, i) => (
              <img
                key={`${im.url}-${i}`}
                src={im.url}
                alt={im.caption ?? `image-${i}`}
                className="w-full h-16 object-cover rounded bg-[var(--bg-2)]"
                loading="lazy"
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd packages/web-ui && pnpm exec vitest run wiki-frontmatter-footer
```

Expected: 所有 6 条 PASS

如遇 Tooltip 在 jsdom 里报错，测试中只验 `disabled` 属性即可（已在断言里覆盖）。

- [ ] **Step 5: Commit**

```bash
git add packages/web-ui/src/components/wiki/WikiFrontmatterFooter.tsx \
        packages/web-ui/tests/wiki-frontmatter-footer.test.tsx
git commit -m "feat(web-ui): WikiFrontmatterFooter renders sources/backlinks/images"
```

---

## Task 7：前端 — `RawArticleDrawer` 组件

**Files:**
- Create: `packages/web-ui/src/components/wiki/RawArticleDrawer.tsx`
- Create: `packages/web-ui/tests/raw-article-drawer.test.tsx`

- [ ] **Step 1: Write the failing test**

新建 `packages/web-ui/tests/raw-article-drawer.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { RawArticleDrawer } from "../src/components/wiki/RawArticleDrawer";

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("RawArticleDrawer", () => {
  it("fetches and renders raw article when open", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        id: "abc", account: "acc", title: "Hello", author: "Me",
        published_at: "2026-04-15", url: "https://x.com/a",
        body_plain: "正文第一段。\n正文第二段。", md_path: null, word_count: 20,
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    render(<RawArticleDrawer open={true} account="acc" articleId="abc" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Hello")).toBeInTheDocument());
    expect(screen.getByText(/正文第一段/)).toBeInTheDocument();
    expect(screen.getByText("acc")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /原 URL/ });
    expect(link).toHaveAttribute("href", "https://x.com/a");
  });

  it("shows cleared placeholder on 404", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("not found", { status: 404 }));
    render(<RawArticleDrawer open={true} account="acc" articleId="nope" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/原文档案已清理/)).toBeInTheDocument());
  });

  it("calls onClose when close clicked", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "abc", account: "acc", title: "t", author: null, published_at: "2026-04-15", url: null, body_plain: "", md_path: null, word_count: null }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const onClose = vi.fn();
    render(<RawArticleDrawer open={true} account="acc" articleId="abc" onClose={onClose} />);
    await waitFor(() => screen.getByText("t"));
    fireEvent.click(screen.getByRole("button", { name: /关闭/ }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/web-ui && pnpm exec vitest run raw-article-drawer
```

Expected: Cannot find module

- [ ] **Step 3: Implement component**

新建 `packages/web-ui/src/components/wiki/RawArticleDrawer.tsx`：

```tsx
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogOverlay, DialogPortal, Chip } from "../ui";
import { getRawArticle, type RawArticle } from "../../api/wiki-client";

export interface RawArticleDrawerProps {
  open: boolean;
  account: string | null;
  articleId: string | null;
  onClose: () => void;
}

export function RawArticleDrawer({ open, account, articleId, onClose }: RawArticleDrawerProps) {
  const [article, setArticle] = useState<RawArticle | null>(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !account || !articleId) return;
    let cancelled = false;
    setLoading(true);
    setMissing(false);
    setArticle(null);
    getRawArticle(account, articleId)
      .then((a) => { if (!cancelled) setArticle(a); })
      .catch(() => { if (!cancelled) setMissing(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, account, articleId]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent
          className="!left-auto !top-0 !right-0 !translate-x-0 !translate-y-0 !max-h-screen !h-screen !rounded-none border-l border-[var(--hair-strong)]"
          width="40vw"
          aria-label="原文抽屉"
        >
          <div className="flex items-center justify-between px-5 h-12 border-b border-[var(--hair)]">
            <span className="text-xs text-[var(--meta)]">原文</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="w-7 h-7 flex items-center justify-center rounded text-[var(--meta)] hover:text-[var(--heading)] hover:bg-[var(--bg-2)]"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-auto px-5 py-4">
            {loading && <div className="text-sm text-[var(--meta)]">加载中…</div>}
            {!loading && missing && <div className="text-sm text-[var(--faint)]">原文档案已清理</div>}
            {!loading && article && (
              <article className="space-y-3">
                <header className="space-y-2">
                  <Chip variant="neutral" size="sm">{article.account}</Chip>
                  <h2 className="text-base font-semibold text-[var(--heading)]">{article.title}</h2>
                  <div className="text-xs text-[var(--faint)]">
                    {article.published_at}
                    {article.author && <> · {article.author}</>}
                    {article.word_count != null && <> · {article.word_count} 字</>}
                  </div>
                </header>
                <pre className="whitespace-pre-wrap text-sm text-[var(--body)] font-sans leading-relaxed">{article.body_plain}</pre>
                {article.url && (
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
                  >
                    打开原 URL ↗
                  </a>
                )}
              </article>
            )}
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd packages/web-ui && pnpm exec vitest run raw-article-drawer
```

Expected: 三条 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web-ui/src/components/wiki/RawArticleDrawer.tsx \
        packages/web-ui/tests/raw-article-drawer.test.tsx
git commit -m "feat(web-ui): RawArticleDrawer for source click-to-open"
```

---

## Task 8：前端 — 重写 `WikiPagePreview` 加 auto-link

**Files:**
- Modify: `packages/web-ui/src/components/wiki/WikiPagePreview.tsx`
- Create: `packages/web-ui/src/components/wiki/autoLink.ts` — 纯函数，易测
- Create: `packages/web-ui/tests/auto-link.test.ts`
- Create: `packages/web-ui/tests/wiki-page-preview-v2.test.tsx`

- [ ] **Step 1: Write the failing test for autoLink helper**

新建 `packages/web-ui/tests/auto-link.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { splitByIndex, type IndexEntry } from "../src/components/wiki/autoLink";

const idx: IndexEntry[] = [
  { path: "entities/阶跃星辰.md", title: "阶跃星辰", aliases: ["StepFun"] },
  { path: "entities/StepClaw.md", title: "StepClaw", aliases: ["阶跃龙虾"] },
];

describe("splitByIndex", () => {
  it("splits text around matched entity names", () => {
    const segments = splitByIndex("阶跃星辰发布了 StepClaw 产品", idx, "entities/anywhere.md");
    expect(segments).toEqual([
      { kind: "link", text: "阶跃星辰", path: "entities/阶跃星辰.md" },
      { kind: "text", text: "发布了 " },
      { kind: "link", text: "StepClaw", path: "entities/StepClaw.md" },
      { kind: "text", text: " 产品" },
    ]);
  });

  it("prefers longer matches first", () => {
    const idx2: IndexEntry[] = [
      { path: "concepts/AI.md", title: "AI", aliases: [] },
      { path: "concepts/AIAgent.md", title: "AIAgent", aliases: [] },
    ];
    const segs = splitByIndex("AIAgent 和 AI 的区别", idx2, "x.md");
    expect(segs[0]).toEqual({ kind: "link", text: "AIAgent", path: "concepts/AIAgent.md" });
    // "AI" should still be matched later
    expect(segs.some((s) => s.kind === "link" && s.text === "AI")).toBe(true);
  });

  it("does not self-link the current page", () => {
    const segs = splitByIndex("阶跃星辰和别的公司", idx, "entities/阶跃星辰.md");
    expect(segs).toEqual([{ kind: "text", text: "阶跃星辰和别的公司" }]);
  });

  it("matches aliases", () => {
    const segs = splitByIndex("StepFun 出品", idx, "x.md");
    expect(segs[0]).toEqual({ kind: "link", text: "StepFun", path: "entities/阶跃星辰.md" });
  });

  it("returns single text when no matches", () => {
    const segs = splitByIndex("没有匹配的内容", idx, "x.md");
    expect(segs).toEqual([{ kind: "text", text: "没有匹配的内容" }]);
  });

  it("returns empty array for empty text", () => {
    expect(splitByIndex("", idx, "x.md")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/web-ui && pnpm exec vitest run auto-link
```

Expected: Cannot find module `autoLink`

- [ ] **Step 3: Implement autoLink helper**

新建 `packages/web-ui/src/components/wiki/autoLink.ts`：

```ts
export interface IndexEntry {
  path: string;
  title: string;
  aliases: string[];
}

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; path: string };

interface NameEntry {
  name: string;
  path: string;
}

function buildNameList(index: IndexEntry[], currentPath: string): NameEntry[] {
  const items: NameEntry[] = [];
  for (const e of index) {
    if (e.path === currentPath) continue;
    if (e.title) items.push({ name: e.title, path: e.path });
    for (const a of e.aliases) items.push({ name: a, path: e.path });
  }
  // Longer names first for longest-match priority
  items.sort((a, b) => b.name.length - a.name.length);
  return items;
}

export function splitByIndex(text: string, index: IndexEntry[], currentPath: string): Segment[] {
  if (!text) return [];
  const names = buildNameList(index, currentPath);
  if (names.length === 0) return [{ kind: "text", text }];
  const out: Segment[] = [];
  let i = 0;
  while (i < text.length) {
    let matched: NameEntry | null = null;
    for (const ne of names) {
      if (ne.name.length === 0) continue;
      if (text.startsWith(ne.name, i)) { matched = ne; break; }
    }
    if (matched) {
      out.push({ kind: "link", text: matched.name, path: matched.path });
      i += matched.name.length;
    } else {
      // accumulate into last text segment
      if (out.length > 0 && out[out.length - 1]!.kind === "text") {
        (out[out.length - 1] as { kind: "text"; text: string }).text += text[i]!;
      } else {
        out.push({ kind: "text", text: text[i]! });
      }
      i += 1;
    }
  }
  return out;
}
```

- [ ] **Step 4: Verify autoLink tests pass**

```bash
cd packages/web-ui && pnpm exec vitest run auto-link
```

Expected: 所有 6 条 PASS

- [ ] **Step 5: Write the failing test for WikiPagePreview rewrite**

新建 `packages/web-ui/tests/wiki-page-preview-v2.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { WikiPagePreview } from "../src/components/wiki/WikiPagePreview";
import { __resetWikiIndexCache } from "../src/hooks/useWikiIndex";

beforeEach(() => {
  __resetWikiIndexCache();
  vi.restoreAllMocks();
});
afterEach(() => { vi.restoreAllMocks(); });

function mockResponses(handlers: Record<string, Response>) {
  vi.spyOn(global, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    for (const k of Object.keys(handlers)) {
      if (url.includes(k)) return handlers[k]!.clone();
    }
    return new Response("not mocked: " + url, { status: 500 });
  });
}

describe("WikiPagePreview v2", () => {
  it("fetches meta + renders body and frontmatter footer", async () => {
    mockResponses({
      "/api/kb/wiki/pages/entities/阶跃星辰.md?meta=1": new Response(JSON.stringify({
        frontmatter: {
          type: "entity", title: "阶跃星辰",
          sources: [{ account: "acc", article_id: "abc12345xx", quoted: "quote" }],
          backlinks: ["entities/StepClaw.md"],
        },
        body: "StepClaw 是阶跃星辰的产品",
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
      "/api/kb/wiki/index.json": new Response(JSON.stringify([
        { path: "entities/阶跃星辰.md", title: "阶跃星辰", aliases: ["StepFun"] },
        { path: "entities/StepClaw.md", title: "StepClaw", aliases: [] },
      ]), { status: 200, headers: { "Content-Type": "application/json" } }),
    });
    const onNavigate = vi.fn();
    render(<WikiPagePreview path="entities/阶跃星辰.md" onNavigate={onNavigate} onOpenSource={() => {}} />);
    await waitFor(() => expect(screen.getByText("quote", { exact: false })).toBeInTheDocument());
    // body auto-link: StepClaw should become clickable
    const link = await screen.findByRole("button", { name: "StepClaw" });
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith("entities/StepClaw.md");
  });

  it("does not self-link page title in its own body", async () => {
    mockResponses({
      "/api/kb/wiki/pages/entities/A.md?meta=1": new Response(JSON.stringify({
        frontmatter: { type: "entity", title: "阶跃星辰" },
        body: "阶跃星辰 的正文",
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
      "/api/kb/wiki/index.json": new Response(JSON.stringify([
        { path: "entities/A.md", title: "阶跃星辰", aliases: [] },
      ]), { status: 200, headers: { "Content-Type": "application/json" } }),
    });
    render(<WikiPagePreview path="entities/A.md" onNavigate={() => {}} onOpenSource={() => {}} />);
    await waitFor(() => expect(screen.getByText(/阶跃星辰 的正文/)).toBeInTheDocument());
    // no <button> named "阶跃星辰"
    expect(screen.queryByRole("button", { name: "阶跃星辰" })).toBeNull();
  });

  it("calls onOpenSource when source clicked", async () => {
    mockResponses({
      "/api/kb/wiki/pages/x.md?meta=1": new Response(JSON.stringify({
        frontmatter: { type: "entity", title: "x", sources: [{ account: "acc", article_id: "zzzzzzzzzz", quoted: "q" }] },
        body: "",
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
      "/api/kb/wiki/index.json": new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }),
    });
    const onOpenSource = vi.fn();
    render(<WikiPagePreview path="x.md" onNavigate={() => {}} onOpenSource={onOpenSource} />);
    await waitFor(() => screen.getByText("acc"));
    fireEvent.click(screen.getByRole("button", { name: /acc.*zzzzzzzz/ }));
    expect(onOpenSource).toHaveBeenCalledWith("acc", "zzzzzzzzzz");
  });

  it("renders fallback when path is null", () => {
    render(<WikiPagePreview path={null} onNavigate={() => {}} onOpenSource={() => {}} />);
    expect(screen.getByText(/Select a page/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

```bash
cd packages/web-ui && pnpm exec vitest run wiki-page-preview-v2
```

Expected: FAIL（当前 `WikiPagePreview` 用 `getPage` 不是 `getPageMeta`）

- [ ] **Step 7: Rewrite WikiPagePreview**

整体替换 `packages/web-ui/src/components/wiki/WikiPagePreview.tsx` 为：

```tsx
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { getPageMeta, type WikiPageFull } from "../../api/wiki-client";
import { WikiFrontmatterFooter } from "./WikiFrontmatterFooter";
import { useWikiIndex } from "../../hooks/useWikiIndex";
import { splitByIndex, type IndexEntry } from "./autoLink";

export interface WikiPagePreviewProps {
  path: string | null;
  onNavigate: (path: string) => void;
  onOpenSource: (account: string, articleId: string) => void;
}

function AutoLinkText({
  text, index, currentPath, onNavigate,
}: { text: string; index: IndexEntry[]; currentPath: string; onNavigate: (p: string) => void }) {
  const segs = useMemo(() => splitByIndex(text, index, currentPath), [text, index, currentPath]);
  return (
    <>
      {segs.map((s, i) =>
        s.kind === "text"
          ? <span key={i}>{s.text}</span>
          : (
            <button
              key={i}
              type="button"
              onClick={() => onNavigate(s.path)}
              className="text-[var(--accent)] hover:underline px-0 py-0 bg-transparent border-0 cursor-pointer"
            >
              {s.text}
            </button>
          ),
      )}
    </>
  );
}

export function WikiPagePreview({ path, onNavigate, onOpenSource }: WikiPagePreviewProps) {
  const [page, setPage] = useState<WikiPageFull | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { entries: indexEntries } = useWikiIndex();

  useEffect(() => {
    if (!path) { setPage(null); setError(null); return; }
    let cancelled = false;
    setError(null);
    getPageMeta(path)
      .then((p) => { if (!cancelled) setPage(p); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, [path]);

  const knownPaths = useMemo(() => new Set(indexEntries.map((e) => e.path)), [indexEntries]);

  if (!path) return <div className="p-6 text-[var(--meta)]">Select a page from the left.</div>;
  if (error) return <div className="p-6 text-[var(--red)]">Error: {error}</div>;
  if (!page) return <div className="p-6 text-[var(--meta)]">加载中…</div>;

  const currentPath = path;

  return (
    <div className="p-4 overflow-auto h-full prose prose-sm max-w-none">
      <ReactMarkdown
        components={{
          // Only replace text in plain text nodes of paragraphs/headings/listItems.
          // Inside code/link, react-markdown does not pass through this renderer for the text,
          // because code-block/inlineCode are their own node types.
          p: ({ children }) => <p>{autoLinkChildren(children, indexEntries, currentPath, onNavigate)}</p>,
          li: ({ children }) => <li>{autoLinkChildren(children, indexEntries, currentPath, onNavigate)}</li>,
          h1: ({ children }) => <h1>{autoLinkChildren(children, indexEntries, currentPath, onNavigate)}</h1>,
          h2: ({ children }) => <h2>{autoLinkChildren(children, indexEntries, currentPath, onNavigate)}</h2>,
          h3: ({ children }) => <h3>{autoLinkChildren(children, indexEntries, currentPath, onNavigate)}</h3>,
        }}
      >
        {page.body}
      </ReactMarkdown>
      <WikiFrontmatterFooter
        frontmatter={page.frontmatter}
        onNavigate={onNavigate}
        onOpenSource={onOpenSource}
        knownPaths={knownPaths}
      />
    </div>
  );
}

function autoLinkChildren(
  children: React.ReactNode,
  index: IndexEntry[],
  currentPath: string,
  onNavigate: (p: string) => void,
): React.ReactNode {
  if (typeof children === "string") {
    return <AutoLinkText text={children} index={index} currentPath={currentPath} onNavigate={onNavigate} />;
  }
  if (Array.isArray(children)) {
    return children.map((c, i) =>
      typeof c === "string"
        ? <AutoLinkText key={i} text={c} index={index} currentPath={currentPath} onNavigate={onNavigate} />
        : c,
    );
  }
  return children;
}
```

**原理说明：** react-markdown 的 `components` 属性允许覆盖元素渲染。对 `p/li/h1-3`（常见文本容器）用 `autoLinkChildren` 处理，只替换其中的纯 string 节点；`code/a/inlineCode` 内部的文字走各自 renderer，不会命中我们的覆盖，自然跳过。

- [ ] **Step 8: Run all tests to verify pass**

```bash
cd packages/web-ui && pnpm exec vitest run wiki-page-preview-v2 auto-link wiki-frontmatter-footer
```

Expected: 全部 PASS

- [ ] **Step 9: Commit**

```bash
git add packages/web-ui/src/components/wiki/autoLink.ts \
        packages/web-ui/src/components/wiki/WikiPagePreview.tsx \
        packages/web-ui/tests/auto-link.test.ts \
        packages/web-ui/tests/wiki-page-preview-v2.test.tsx
git commit -m "feat(web-ui): WikiPagePreview auto-link + frontmatter footer"
```

---

## Task 9：`KnowledgePage` 接 `onNavigate` / `onOpenSource` 回调

**Files:**
- Modify: `packages/web-ui/src/pages/KnowledgePage.tsx:166`

- [ ] **Step 1: Read current usage**

查看 `packages/web-ui/src/pages/KnowledgePage.tsx` 第 166 行：

```tsx
<WikiPagePreview path={selected} />
```

- [ ] **Step 2: Modify KnowledgePage**

在 `KnowledgePage.tsx` 顶部 imports 补加：

```tsx
import { RawArticleDrawer } from "../components/wiki/RawArticleDrawer.js";
```

在 `KnowledgePage` 函数 state 声明区（约第 48 行 `const [logOpen, setLogOpen]` 附近）追加：

```tsx
const [drawerSource, setDrawerSource] = useState<{ account: string; articleId: string } | null>(null);
```

修改 `<WikiPagePreview path={selected} />`（约第 166 行）为：

```tsx
<WikiPagePreview
  path={selected}
  onNavigate={(p) => { setHits(null); setQ(""); setSelected(p); }}
  onOpenSource={(account, articleId) => setDrawerSource({ account, articleId })}
/>
```

在组件 return 的最外层 `</div>` 之前插入：

```tsx
<RawArticleDrawer
  open={drawerSource !== null}
  account={drawerSource?.account ?? null}
  articleId={drawerSource?.articleId ?? null}
  onClose={() => setDrawerSource(null)}
/>
```

- [ ] **Step 3: Verify tsc clean**

```bash
cd packages/web-ui && pnpm exec tsc --noEmit
```

Expected: 0 错误（除 pre-existing）

- [ ] **Step 4: Run full UI tests to catch regressions**

```bash
cd packages/web-ui && pnpm exec vitest run
```

Expected: 全部 PASS（若有因重写 `WikiPagePreview` 导致的其他测试失败，需修复；目前仅 `ingest-progress.test.tsx` / `ingest-form.test.tsx` 不涉及 preview）

- [ ] **Step 5: Commit**

```bash
git add packages/web-ui/src/pages/KnowledgePage.tsx
git commit -m "feat(web-ui): wire WikiPagePreview callbacks + RawArticleDrawer"
```

---

## Task 10：人工验收 + 最终清理

- [ ] **Step 1: Build all packages**

```bash
cd /Users/zeoooo/crossing-writer
pnpm -r build
```

Expected: 全部 package build 通过

- [ ] **Step 2: Start dev server and manual check**

```bash
cd packages/web-server && pnpm dev  # 终端 1
cd packages/web-ui && pnpm dev      # 终端 2
```

然后打开 `http://localhost:3000/knowledge`，手工走 5 条：

1. 进入浏览 tab → 任选一页（如 `entities/阶跃星辰.md`）→ Preview 打开
2. ✅ 验：底部能看到 Sources / Backlinks / Images 三区（如 frontmatter 里有）
3. ✅ 验：正文里的已知实体名变链接（绿色），点击切换到该页
4. ✅ 验：点 source 行 → 右侧抽屉打开，原文可读，顶部有"打开原 URL ↗"
5. ✅ 验：点 backlinks Chip → 切换到对应页；不存在的 path 显示灰 + disabled

- [ ] **Step 3: tsc + build final sanity**

```bash
cd /Users/zeoooo/crossing-writer
pnpm exec tsc --noEmit  # 或每个 package 分别
```

Expected: 0 new error

- [ ] **Step 4: Final commit if any cleanup**

```bash
git status
# 若有 lockfile / build 产物需要入库，单独提交
```

---

## 风险与注意事项

1. **`parseFrontmatter` 未导出**：Task 1 Step 4 已提示处理。若用 `export * from "./wiki/wiki-store.js"` 方式会连带 `normalize` 等内部符号；用显式列出更干净
2. **jsdom 下 Tooltip 报错**：Task 6 测试里避开了 Tooltip 交互断言，只验 `disabled` 属性
3. **react-markdown 版本**：若项目装的是 v9+，`components` API 参数签名略有变化（`{ children, node }` 而非裸 children）；Task 8 代码已按解构写法，若失败检查一下 `package.json` 里版本
4. **Auto-link 误伤**：当前只覆盖 `p/li/h1-3`。如 `blockquote` 或 table cell 里的文本想要 auto-link，可后续扩展；本 plan 暂不做
5. **路径中含 `#`**：wiki `path` 目前不会含 `#`（文件名禁用字符），但 `fetch` 时 encodeURI 我依赖现有 route 行为（未 encode，和其他 page endpoint 一致）。Task 3 测试里已 encode 中文 account，保持一致

---

## Self-Review Check

- [x] **Spec coverage：** Plan 1 对应 spec §6.4（MD 跳转三条）+ §5.3（`/index.json`、`?meta=1`、`/raw-articles`）+ §5.1 的 `WikiPagePreview.tsx` 重写（Plan 1 部分）。未覆盖 AccountHeatmap 职责收窄 / D2 布局 / 新表 —— 这些在 Plan 2-5。
- [x] **Placeholder scan：** 所有 code step 含真实代码，所有 commit message 落实际字段，无 TBD/TODO
- [x] **Type consistency：** `WikiFrontmatter` 贯穿 wiki-client / WikiFrontmatterFooter / WikiPagePreview；`IndexEntry` 与 `autoLink.ts` 一致；`RawArticle` 贯穿 API 与 Drawer
- [x] **File paths：** 全部绝对或仓库相对路径，非占位

---

Plan 1 完成。执行顺序：Task 1 → 10 线性，每个 Task 内部 TDD 闭环，独立可 commit。Plan 1 合并后用户可见的收益：打开任意 wiki 页都能看到完整 footer，实体名可点击切换，source 能抽屉打开原文。
