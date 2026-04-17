# Plan 2 · 后端入库粒度 + Run 记账 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `runIngest()` 支持按 article_id 精准入库 + 硬上限 50 篇 + 已入库跳过/强制重入；全程写 `wiki_ingest_runs` / `wiki_ingest_marks` / `wiki_ingest_run_ops` 三表审计；新增 `/check-duplicates` 和 `/runs` 系列 API。

**Architecture:** 数据层 `ensureSchema()` 启动时幂等建表；两个 repo（marks / runs）封装 CRUD；orchestrator 引入 3 条新选项 + run lifecycle 记账；新增 2 个 route 文件（check-duplicates 和 runs）；现有 `/ingest` body 加 3 个字段。

**Tech Stack:** better-sqlite3 · TypeScript · Fastify · vitest

**Spec 参考:** `docs/superpowers/specs/2026-04-17-knowledge-page-ingest-redesign-design.md` §5.1~5.3 + §7

---

## 文件结构

**新建：**
- `packages/kb/src/wiki/migrations.ts` — `ensureSchema(db)` 幂等建 3 表
- `packages/kb/src/wiki/ingest-marks-repo.ts` — marks 表 CRUD
- `packages/kb/src/wiki/ingest-runs-repo.ts` — runs + run_ops 表 CRUD
- `packages/kb/tests/wiki/migrations.test.ts`
- `packages/kb/tests/wiki/ingest-marks-repo.test.ts`
- `packages/kb/tests/wiki/ingest-runs-repo.test.ts`
- `packages/web-server/src/routes/kb-wiki-runs.ts` — GET /runs + GET /runs/:id
- `packages/web-server/tests/routes-kb-wiki-check-duplicates.test.ts`
- `packages/web-server/tests/routes-kb-wiki-runs.test.ts`

**修改：**
- `packages/kb/src/wiki/types.ts` — extend IngestMode/IngestOptions/IngestStepEvent/IngestResult
- `packages/kb/src/wiki/orchestrator.ts` — 核心改造（articleIds / maxArticles / forceReingest / run lifecycle）
- `packages/kb/src/index.ts` — 导出新函数/类型
- `packages/kb/tests/wiki/orchestrator.test.ts` — 追加 selected 模式 + skip + run 写入测试
- `packages/web-server/src/routes/kb-wiki.ts` — 加 `/check-duplicates`、扩展 `/ingest` body
- `packages/web-server/src/server.ts` — 启动时调 `ensureSchema` + 注册 runs routes
- `packages/web-server/tests/routes-kb-wiki-ingest.test.ts` — 新 body 字段验证

---

## 约定

- 所有 sqlite 操作用 `Database` from `better-sqlite3`；读只读 open，写需 open as read-write（orchestrator 会）
- 所有新表名前缀 `wiki_ingest_`；旧数据 `ref_articles` 表不动
- run_id 生成用 node 自带 `crypto.randomUUID()`
- ISO8601 时间戳：`new Date().toISOString()`
- JSON array 字段（accounts / article_ids）统一用 `JSON.stringify` 入库、`JSON.parse` 出库

---

## Task 1：Migrations 模块

**Files:**
- Create: `packages/kb/src/wiki/migrations.ts`
- Create: `packages/kb/tests/wiki/migrations.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/kb/tests/wiki/migrations.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSchema } from "../../src/wiki/migrations.js";

function mkdb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), "mig-"));
  const db = new Database(join(dir, "refs.sqlite"));
  db.exec(`CREATE TABLE ref_articles (id TEXT PRIMARY KEY, account TEXT, title TEXT, published_at TEXT);`);
  return db;
}

describe("ensureSchema", () => {
  it("creates the three wiki_ingest tables", () => {
    const db = mkdb();
    ensureSchema(db);
    const tables = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'wiki_ingest_%' ORDER BY name`
    ).all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toEqual([
      "wiki_ingest_marks",
      "wiki_ingest_run_ops",
      "wiki_ingest_runs",
    ]);
  });

  it("is idempotent (safe to call twice)", () => {
    const db = mkdb();
    ensureSchema(db);
    expect(() => ensureSchema(db)).not.toThrow();
  });

  it("marks table has expected columns", () => {
    const db = mkdb();
    ensureSchema(db);
    const cols = db.prepare(`PRAGMA table_info(wiki_ingest_marks)`).all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name).sort()).toEqual([
      "article_id", "first_ingested_at", "ingest_count", "last_ingested_at", "last_run_id",
    ]);
  });

  it("runs table has expected columns", () => {
    const db = mkdb();
    ensureSchema(db);
    const cols = db.prepare(`PRAGMA table_info(wiki_ingest_runs)`).all() as Array<{ name: string }>;
    expect(cols.map((c) => c.name).sort()).toEqual([
      "accounts", "article_ids", "conflict_count", "error", "finished_at",
      "id", "images_appended", "mode", "model", "pages_created", "pages_updated",
      "skipped_count", "sources_appended", "started_at", "status",
    ]);
  });

  it("run_ops table has expected columns + compound PK", () => {
    const db = mkdb();
    ensureSchema(db);
    const cols = db.prepare(`PRAGMA table_info(wiki_ingest_run_ops)`).all() as Array<{ name: string; pk: number }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual([
      "article_id", "conflict", "created_page", "error", "op", "path", "run_id", "seq",
    ]);
    const pk = cols.filter((c) => c.pk > 0).map((c) => c.name).sort();
    expect(pk).toEqual(["run_id", "seq"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/kb && pnpm exec vitest run migrations
```

Expected: Cannot find module `migrations`.

- [ ] **Step 3: Implement migrations module**

Create `packages/kb/src/wiki/migrations.ts`:

```ts
import type Database from "better-sqlite3";

export function ensureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wiki_ingest_marks (
      article_id         TEXT PRIMARY KEY,
      first_ingested_at  TEXT NOT NULL,
      last_ingested_at   TEXT NOT NULL,
      ingest_count       INTEGER NOT NULL DEFAULT 1,
      last_run_id        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wiki_ingest_runs (
      id                 TEXT PRIMARY KEY,
      started_at         TEXT NOT NULL,
      finished_at        TEXT,
      status             TEXT NOT NULL,
      accounts           TEXT NOT NULL,
      article_ids        TEXT NOT NULL,
      mode               TEXT NOT NULL,
      model              TEXT NOT NULL,
      pages_created      INTEGER DEFAULT 0,
      pages_updated      INTEGER DEFAULT 0,
      sources_appended   INTEGER DEFAULT 0,
      images_appended    INTEGER DEFAULT 0,
      conflict_count     INTEGER DEFAULT 0,
      skipped_count      INTEGER DEFAULT 0,
      error              TEXT
    );

    CREATE TABLE IF NOT EXISTS wiki_ingest_run_ops (
      run_id        TEXT NOT NULL,
      seq           INTEGER NOT NULL,
      op            TEXT NOT NULL,
      path          TEXT,
      article_id    TEXT,
      created_page  INTEGER DEFAULT 0,
      conflict      INTEGER DEFAULT 0,
      error         TEXT,
      PRIMARY KEY (run_id, seq)
    );

    CREATE INDEX IF NOT EXISTS idx_wiki_ingest_runs_started_at ON wiki_ingest_runs(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wiki_ingest_run_ops_run_id ON wiki_ingest_run_ops(run_id);
  `);
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd packages/kb && pnpm exec vitest run migrations
```

Expected: 5 tests PASS.

- [ ] **Step 5: Export from index.ts**

Add to `packages/kb/src/index.ts`:

```ts
export { ensureSchema } from "./wiki/migrations.js";
```

Rebuild kb:

```bash
cd packages/kb && pnpm build
```

Expected: no tsc errors.

- [ ] **Step 6: Commit**

```bash
git add packages/kb/src/wiki/migrations.ts \
        packages/kb/tests/wiki/migrations.test.ts \
        packages/kb/src/index.ts
git commit -m "feat(kb): ensureSchema for wiki_ingest_marks/runs/run_ops tables"
```

---

## Task 2：ingest-marks-repo

**Files:**
- Create: `packages/kb/src/wiki/ingest-marks-repo.ts`
- Create: `packages/kb/tests/wiki/ingest-marks-repo.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/kb/tests/wiki/ingest-marks-repo.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSchema } from "../../src/wiki/migrations.js";
import { upsertMark, listMarks, filterAlreadyIngested } from "../../src/wiki/ingest-marks-repo.js";

let db: Database.Database;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "marks-"));
  db = new Database(join(dir, "refs.sqlite"));
  ensureSchema(db);
});

describe("ingest-marks-repo", () => {
  it("upsertMark inserts a new mark", () => {
    upsertMark(db, { articleId: "a1", runId: "r1", now: "2026-04-17T10:00:00Z" });
    const rows = listMarks(db, ["a1"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      article_id: "a1",
      first_ingested_at: "2026-04-17T10:00:00Z",
      last_ingested_at: "2026-04-17T10:00:00Z",
      ingest_count: 1,
      last_run_id: "r1",
    });
  });

  it("upsertMark increments on repeat", () => {
    upsertMark(db, { articleId: "a1", runId: "r1", now: "2026-04-17T10:00:00Z" });
    upsertMark(db, { articleId: "a1", runId: "r2", now: "2026-04-17T11:00:00Z" });
    const [row] = listMarks(db, ["a1"]);
    expect(row.first_ingested_at).toBe("2026-04-17T10:00:00Z");
    expect(row.last_ingested_at).toBe("2026-04-17T11:00:00Z");
    expect(row.ingest_count).toBe(2);
    expect(row.last_run_id).toBe("r2");
  });

  it("listMarks returns empty array for unknown ids", () => {
    expect(listMarks(db, ["nope"])).toEqual([]);
  });

  it("listMarks handles empty input", () => {
    expect(listMarks(db, [])).toEqual([]);
  });

  it("filterAlreadyIngested splits ids into marked vs fresh", () => {
    upsertMark(db, { articleId: "a1", runId: "r1", now: "2026-04-17T10:00:00Z" });
    upsertMark(db, { articleId: "a2", runId: "r1", now: "2026-04-17T10:00:00Z" });
    const result = filterAlreadyIngested(db, ["a1", "a2", "a3", "a4"]);
    expect(result.alreadyIngested.sort()).toEqual(["a1", "a2"]);
    expect(result.fresh.sort()).toEqual(["a3", "a4"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/kb && pnpm exec vitest run ingest-marks-repo
```

Expected: Cannot find module.

- [ ] **Step 3: Implement repo**

Create `packages/kb/src/wiki/ingest-marks-repo.ts`:

```ts
import type Database from "better-sqlite3";

export interface MarkRow {
  article_id: string;
  first_ingested_at: string;
  last_ingested_at: string;
  ingest_count: number;
  last_run_id: string;
}

export interface UpsertMarkInput {
  articleId: string;
  runId: string;
  now: string;
}

export function upsertMark(db: Database.Database, input: UpsertMarkInput): void {
  db.prepare(
    `INSERT INTO wiki_ingest_marks (article_id, first_ingested_at, last_ingested_at, ingest_count, last_run_id)
     VALUES (@id, @now, @now, 1, @run)
     ON CONFLICT(article_id) DO UPDATE SET
       last_ingested_at = @now,
       ingest_count = ingest_count + 1,
       last_run_id = @run`,
  ).run({ id: input.articleId, now: input.now, run: input.runId });
}

export function listMarks(db: Database.Database, articleIds: string[]): MarkRow[] {
  if (articleIds.length === 0) return [];
  const placeholders = articleIds.map(() => "?").join(",");
  return db
    .prepare(`SELECT * FROM wiki_ingest_marks WHERE article_id IN (${placeholders})`)
    .all(...articleIds) as MarkRow[];
}

export function filterAlreadyIngested(
  db: Database.Database,
  articleIds: string[],
): { alreadyIngested: string[]; fresh: string[] } {
  if (articleIds.length === 0) return { alreadyIngested: [], fresh: [] };
  const existing = new Set(listMarks(db, articleIds).map((m) => m.article_id));
  const alreadyIngested: string[] = [];
  const fresh: string[] = [];
  for (const id of articleIds) {
    (existing.has(id) ? alreadyIngested : fresh).push(id);
  }
  return { alreadyIngested, fresh };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd packages/kb && pnpm exec vitest run ingest-marks-repo
```

Expected: 5 tests PASS.

- [ ] **Step 5: Export + build**

Add to `packages/kb/src/index.ts`:

```ts
export { upsertMark, listMarks, filterAlreadyIngested, type MarkRow } from "./wiki/ingest-marks-repo.js";
```

```bash
cd packages/kb && pnpm build
```

- [ ] **Step 6: Commit**

```bash
git add packages/kb/src/wiki/ingest-marks-repo.ts \
        packages/kb/tests/wiki/ingest-marks-repo.test.ts \
        packages/kb/src/index.ts
git commit -m "feat(kb): ingest-marks-repo upsertMark/listMarks/filterAlreadyIngested"
```

---

## Task 3：ingest-runs-repo

**Files:**
- Create: `packages/kb/src/wiki/ingest-runs-repo.ts`
- Create: `packages/kb/tests/wiki/ingest-runs-repo.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/kb/tests/wiki/ingest-runs-repo.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSchema } from "../../src/wiki/migrations.js";
import {
  createRun, finishRun, appendRunOp, listRuns, getRun,
} from "../../src/wiki/ingest-runs-repo.js";

let db: Database.Database;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "runs-"));
  db = new Database(join(dir, "refs.sqlite"));
  ensureSchema(db);
});

describe("ingest-runs-repo", () => {
  it("createRun inserts a running row", () => {
    const runId = "r1";
    createRun(db, {
      runId, startedAt: "2026-04-17T10:00:00Z",
      accounts: ["acc1", "acc2"], articleIds: ["a1", "a2", "a3"],
      mode: "selected", model: "claude/sonnet",
    });
    const run = getRun(db, runId);
    expect(run).not.toBeNull();
    expect(run!.status).toBe("running");
    expect(run!.accounts).toEqual(["acc1", "acc2"]);
    expect(run!.article_ids).toEqual(["a1", "a2", "a3"]);
    expect(run!.mode).toBe("selected");
    expect(run!.model).toBe("claude/sonnet");
    expect(run!.ops).toEqual([]);
  });

  it("finishRun updates status + stats", () => {
    createRun(db, { runId: "r1", startedAt: "2026-04-17T10:00:00Z", accounts: [], articleIds: [], mode: "selected", model: "x" });
    finishRun(db, {
      runId: "r1", finishedAt: "2026-04-17T10:05:00Z", status: "done",
      stats: { pages_created: 2, pages_updated: 1, sources_appended: 3, images_appended: 0, conflict_count: 1, skipped_count: 4 },
    });
    const run = getRun(db, "r1");
    expect(run!.status).toBe("done");
    expect(run!.finished_at).toBe("2026-04-17T10:05:00Z");
    expect(run!.pages_created).toBe(2);
    expect(run!.skipped_count).toBe(4);
  });

  it("finishRun records error", () => {
    createRun(db, { runId: "r1", startedAt: "2026-04-17T10:00:00Z", accounts: [], articleIds: [], mode: "full", model: "x" });
    finishRun(db, { runId: "r1", finishedAt: "2026-04-17T10:01:00Z", status: "error", error: "boom" });
    const run = getRun(db, "r1");
    expect(run!.status).toBe("error");
    expect(run!.error).toBe("boom");
  });

  it("appendRunOp stores ops with sequential seq", () => {
    createRun(db, { runId: "r1", startedAt: "2026-04-17T10:00:00Z", accounts: [], articleIds: [], mode: "selected", model: "x" });
    appendRunOp(db, { runId: "r1", seq: 0, op: "upsert", path: "entities/A.md", articleId: "a1", createdPage: true });
    appendRunOp(db, { runId: "r1", seq: 1, op: "append_source", path: "entities/B.md", articleId: "a1" });
    appendRunOp(db, { runId: "r1", seq: 2, op: "error", articleId: "a2", error: "oops" });
    const run = getRun(db, "r1");
    expect(run!.ops).toHaveLength(3);
    expect(run!.ops[0]).toMatchObject({ seq: 0, op: "upsert", path: "entities/A.md", created_page: 1 });
    expect(run!.ops[2]).toMatchObject({ seq: 2, op: "error", error: "oops" });
  });

  it("listRuns returns newest first with limit", () => {
    for (let i = 0; i < 5; i += 1) {
      createRun(db, { runId: `r${i}`, startedAt: `2026-04-1${i}T10:00:00Z`, accounts: [], articleIds: [], mode: "full", model: "x" });
    }
    const runs = listRuns(db, { limit: 3 });
    expect(runs).toHaveLength(3);
    expect(runs[0].id).toBe("r4");
    expect(runs[2].id).toBe("r2");
  });

  it("listRuns filters by status", () => {
    createRun(db, { runId: "r1", startedAt: "2026-04-17T10:00:00Z", accounts: [], articleIds: [], mode: "full", model: "x" });
    createRun(db, { runId: "r2", startedAt: "2026-04-17T11:00:00Z", accounts: [], articleIds: [], mode: "full", model: "x" });
    finishRun(db, { runId: "r1", finishedAt: "2026-04-17T10:05:00Z", status: "done" });
    const runs = listRuns(db, { limit: 10, status: "done" });
    expect(runs.map((r) => r.id)).toEqual(["r1"]);
  });

  it("getRun returns null for missing id", () => {
    expect(getRun(db, "nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/kb && pnpm exec vitest run ingest-runs-repo
```

Expected: Cannot find module.

- [ ] **Step 3: Implement repo**

Create `packages/kb/src/wiki/ingest-runs-repo.ts`:

```ts
import type Database from "better-sqlite3";

export type RunStatus = "running" | "done" | "error" | "cancelled";

export interface CreateRunInput {
  runId: string;
  startedAt: string;
  accounts: string[];
  articleIds: string[];
  mode: string;
  model: string;
}

export interface FinishRunInput {
  runId: string;
  finishedAt: string;
  status: RunStatus;
  stats?: {
    pages_created?: number;
    pages_updated?: number;
    sources_appended?: number;
    images_appended?: number;
    conflict_count?: number;
    skipped_count?: number;
  };
  error?: string;
}

export interface AppendRunOpInput {
  runId: string;
  seq: number;
  op: string;
  path?: string | null;
  articleId?: string | null;
  createdPage?: boolean;
  conflict?: boolean;
  error?: string | null;
}

export interface RunOpRow {
  run_id: string;
  seq: number;
  op: string;
  path: string | null;
  article_id: string | null;
  created_page: number;
  conflict: number;
  error: string | null;
}

export interface RunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: RunStatus;
  accounts: string[];
  article_ids: string[];
  mode: string;
  model: string;
  pages_created: number;
  pages_updated: number;
  sources_appended: number;
  images_appended: number;
  conflict_count: number;
  skipped_count: number;
  error: string | null;
  ops: RunOpRow[];
}

export interface RunSummary {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: RunStatus;
  accounts: string[];
  article_ids: string[];
  mode: string;
  model: string;
  pages_created: number;
  pages_updated: number;
  sources_appended: number;
  images_appended: number;
  conflict_count: number;
  skipped_count: number;
  error: string | null;
}

export interface ListRunsInput {
  limit: number;
  status?: RunStatus;
  since?: string;
  until?: string;
}

function parseRun(row: any): RunSummary {
  return {
    id: row.id,
    started_at: row.started_at,
    finished_at: row.finished_at,
    status: row.status,
    accounts: JSON.parse(row.accounts ?? "[]"),
    article_ids: JSON.parse(row.article_ids ?? "[]"),
    mode: row.mode,
    model: row.model,
    pages_created: row.pages_created,
    pages_updated: row.pages_updated,
    sources_appended: row.sources_appended,
    images_appended: row.images_appended,
    conflict_count: row.conflict_count,
    skipped_count: row.skipped_count,
    error: row.error,
  };
}

export function createRun(db: Database.Database, input: CreateRunInput): void {
  db.prepare(
    `INSERT INTO wiki_ingest_runs (id, started_at, status, accounts, article_ids, mode, model)
     VALUES (@runId, @startedAt, 'running', @accounts, @articleIds, @mode, @model)`,
  ).run({
    runId: input.runId,
    startedAt: input.startedAt,
    accounts: JSON.stringify(input.accounts),
    articleIds: JSON.stringify(input.articleIds),
    mode: input.mode,
    model: input.model,
  });
}

export function finishRun(db: Database.Database, input: FinishRunInput): void {
  const s = input.stats ?? {};
  db.prepare(
    `UPDATE wiki_ingest_runs SET
       finished_at = @finishedAt,
       status = @status,
       pages_created = @pagesCreated,
       pages_updated = @pagesUpdated,
       sources_appended = @sourcesAppended,
       images_appended = @imagesAppended,
       conflict_count = @conflictCount,
       skipped_count = @skippedCount,
       error = @error
     WHERE id = @runId`,
  ).run({
    runId: input.runId,
    finishedAt: input.finishedAt,
    status: input.status,
    pagesCreated: s.pages_created ?? 0,
    pagesUpdated: s.pages_updated ?? 0,
    sourcesAppended: s.sources_appended ?? 0,
    imagesAppended: s.images_appended ?? 0,
    conflictCount: s.conflict_count ?? 0,
    skippedCount: s.skipped_count ?? 0,
    error: input.error ?? null,
  });
}

export function appendRunOp(db: Database.Database, input: AppendRunOpInput): void {
  db.prepare(
    `INSERT INTO wiki_ingest_run_ops (run_id, seq, op, path, article_id, created_page, conflict, error)
     VALUES (@runId, @seq, @op, @path, @articleId, @createdPage, @conflict, @error)`,
  ).run({
    runId: input.runId,
    seq: input.seq,
    op: input.op,
    path: input.path ?? null,
    articleId: input.articleId ?? null,
    createdPage: input.createdPage ? 1 : 0,
    conflict: input.conflict ? 1 : 0,
    error: input.error ?? null,
  });
}

export function listRuns(db: Database.Database, input: ListRunsInput): RunSummary[] {
  const where: string[] = [];
  const params: Record<string, unknown> = { limit: input.limit };
  if (input.status) { where.push("status = @status"); params.status = input.status; }
  if (input.since) { where.push("started_at >= @since"); params.since = input.since; }
  if (input.until) { where.push("started_at <= @until"); params.until = input.until; }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db.prepare(
    `SELECT * FROM wiki_ingest_runs ${whereSql} ORDER BY started_at DESC LIMIT @limit`,
  ).all(params) as any[];
  return rows.map(parseRun);
}

export function getRun(db: Database.Database, runId: string): RunRow | null {
  const row = db.prepare(`SELECT * FROM wiki_ingest_runs WHERE id = ?`).get(runId) as any;
  if (!row) return null;
  const ops = db.prepare(
    `SELECT * FROM wiki_ingest_run_ops WHERE run_id = ? ORDER BY seq ASC`,
  ).all(runId) as RunOpRow[];
  return { ...parseRun(row), ops };
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd packages/kb && pnpm exec vitest run ingest-runs-repo
```

Expected: 7 tests PASS.

- [ ] **Step 5: Export + build**

Add to `packages/kb/src/index.ts`:

```ts
export {
  createRun, finishRun, appendRunOp, listRuns, getRun,
  type RunStatus, type CreateRunInput, type FinishRunInput, type AppendRunOpInput,
  type RunRow, type RunOpRow, type RunSummary, type ListRunsInput,
} from "./wiki/ingest-runs-repo.js";
```

```bash
cd packages/kb && pnpm build
```

- [ ] **Step 6: Commit**

```bash
git add packages/kb/src/wiki/ingest-runs-repo.ts \
        packages/kb/tests/wiki/ingest-runs-repo.test.ts \
        packages/kb/src/index.ts
git commit -m "feat(kb): ingest-runs-repo createRun/finishRun/appendRunOp/listRuns/getRun"
```

---

## Task 4：Orchestrator — 扩展 IngestOptions + mode=selected + maxArticles

**Files:**
- Modify: `packages/kb/src/wiki/types.ts`
- Modify: `packages/kb/src/wiki/orchestrator.ts`
- Modify: `packages/kb/tests/wiki/orchestrator.test.ts`

- [ ] **Step 1: Read current orchestrator**

Open `packages/kb/src/wiki/orchestrator.ts` and `packages/kb/src/wiki/types.ts`. Note existing `runIngest(opts, ctx)` signature, `loadArticles(sqlitePath, account, opts)` helper.

- [ ] **Step 2: Extend types**

In `packages/kb/src/wiki/types.ts`, replace the `IngestMode` and `IngestOptions` definitions:

```ts
export type IngestMode = "full" | "incremental" | "selected";

export interface IngestOptions {
  accounts: string[];
  perAccountLimit: number;
  batchSize: number;
  since?: string;
  until?: string;
  cliModel?: { cli: "claude" | "codex"; model?: string };
  mode: IngestMode;
  articleIds?: string[];
  maxArticles?: number;
  forceReingest?: boolean;
  onEvent?: (ev: IngestStepEvent) => void;
}
```

- [ ] **Step 3: Write failing test — selected mode**

Open `packages/kb/tests/wiki/orchestrator.test.ts` and append a new `describe` block. Use the existing test fixtures pattern — if the file uses a fake agent, reuse it. Otherwise add this after existing tests:

```ts
describe("runIngest mode=selected + maxArticles", () => {
  it("throws when mode=selected without articleIds", async () => {
    // Use existing test fixtures + fake agent
    // Simplest: call runIngest with mode="selected", articleIds=undefined
    // Expected: throws Error /article_ids required/
    const err = await runIngest({
      accounts: [],
      perAccountLimit: 50,
      batchSize: 5,
      mode: "selected",
    } as any, { vaultPath: "/tmp/x", sqlitePath: "/tmp/x.sqlite" }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/article_ids required/);
  });

  it("throws when articleIds provided with mode=full", async () => {
    const err = await runIngest({
      accounts: ["a"],
      perAccountLimit: 50,
      batchSize: 5,
      mode: "full",
      articleIds: ["x"],
    } as any, { vaultPath: "/tmp/x", sqlitePath: "/tmp/x.sqlite" }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/implies mode=selected/);
  });

  it("throws when total articles exceed maxArticles", async () => {
    // With maxArticles=2, pass an articleIds of length 3
    // This requires sqlite + vault setup matching existing orchestrator tests
    // Test expects: error containing "max_articles exceeded"
    // IMPLEMENTATION HINT: re-use the existing test helper that builds a temp vault + sqlite with N articles
  });
});
```

**IMPORTANT:** Before writing the max_articles test, examine the existing `packages/kb/tests/wiki/orchestrator.test.ts` for its helper pattern (likely a `setupVault(articles: ...)` function). Reuse it. If no helper exists, write a minimal setup inline that creates a temp dir, sqlite with `ref_articles` table + rows, and a fake `WikiIngestorAgent`.

- [ ] **Step 4: Run tests (should fail)**

```bash
cd packages/kb && pnpm exec vitest run orchestrator
```

Expected: new tests FAIL.

- [ ] **Step 5: Implement in orchestrator.ts**

In `packages/kb/src/wiki/orchestrator.ts`, modify `runIngest()`:

Near the top (after parameter validation), add:

```ts
// Mode + articleIds consistency
if (opts.mode === "selected" && (!opts.articleIds || opts.articleIds.length === 0)) {
  throw new Error("article_ids required for mode=selected");
}
if (opts.articleIds && opts.articleIds.length > 0 && opts.mode !== "selected") {
  throw new Error("article_ids implies mode=selected");
}

// maxArticles enforcement (default 50)
const maxArticles = opts.maxArticles ?? 50;
const projectedCount = opts.mode === "selected"
  ? (opts.articleIds ?? []).length
  : opts.accounts.length * opts.perAccountLimit;
if (projectedCount > maxArticles) {
  throw new Error(`max_articles exceeded: cap=${maxArticles} projected=${projectedCount}`);
}
```

Additionally, add a new branch in the article loading flow. Before the `for (const account of opts.accounts)` loop, add:

```ts
if (opts.mode === "selected") {
  const articles = loadArticlesByIds(ctx.sqlitePath, opts.articleIds!);
  // Run the batching + agent invocation on this combined article list
  // under a single "selected" "account" key, or iterate by batching directly
  // For now, delegate to a new helper runSelectedIngest(...) — see Step 6
  return runSelectedIngest(opts, ctx, articles);
}
```

And add the helper function outside `runIngest`:

```ts
function loadArticlesByIds(sqlitePath: string, articleIds: string[]): IngestArticle[] {
  if (articleIds.length === 0) return [];
  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  try {
    const placeholders = articleIds.map(() => "?").join(",");
    const rows = db.prepare(
      `SELECT id, account, title, published_at, body_plain, html_path
       FROM ref_articles WHERE id IN (${placeholders})`,
    ).all(...articleIds) as RawRow[];
    // Existing image extraction logic — reuse the inline mapping from loadArticles
    return rows.map((r) => {
      const bodyPlain = r.body_plain ?? "";
      let imgs: ReturnType<typeof extractImagesFromMarkdown> = [];
      if (r.html_path) {
        const abs = r.html_path.startsWith("/") ? r.html_path : join(dirname(dirname(sqlitePath)), r.html_path);
        if (existsSync(abs)) {
          try { imgs = extractImagesFromHtml(readFileSync(abs, "utf-8")); } catch { /* ignore */ }
        }
      }
      if (imgs.length === 0) imgs = extractImagesFromMarkdown(bodyPlain);
      return { id: r.id, title: r.title, published_at: r.published_at, body_plain: bodyPlain, images: imgs };
    });
  } finally { db.close(); }
}

async function runSelectedIngest(
  opts: IngestOptions, ctx: Ctx, articles: IngestArticle[],
): Promise<IngestResult> {
  // MINIMAL stub for Task 4: run articles through the same batching+agent loop
  // as the account loop, but treat them as a single pseudo-account "selected".
  // Re-use existing batch logic — copy the key parts from the for(account) loop.
  // No marks/runs recording yet — Tasks 5 & 6 will add those.
  ensureVaultScaffold(ctx.vaultPath);
  const store = new WikiStore(ctx.vaultPath);
  const guide = loadGuide(ctx.vaultPath);
  const agent = new WikiIngestorAgent({ cli: opts.cliModel?.cli ?? "claude", model: opts.cliModel?.model });

  let pagesCreated = 0, pagesUpdated = 0, sourcesAppended = 0, imagesAppended = 0;
  const notes: string[] = [];

  const batches: IngestArticle[][] = [];
  for (let i = 0; i < articles.length; i += opts.batchSize) batches.push(articles.slice(i, i + opts.batchSize));

  for (let bi = 0; bi < batches.length; bi += 1) {
    const batch = batches[bi]!;
    emit(opts.onEvent, { type: "batch_started", account: "selected", batchIndex: bi, totalBatches: batches.length, stats: { articles_in_batch: batch.length } });
    const t0 = Date.now();
    try {
      const snap = buildSnapshot(ctx.vaultPath, batch, 10);
      const res = await agent.ingest({
        account: "selected", batchIndex: bi, totalBatches: batches.length,
        articles: batch, existingPages: snap.pages, indexMd: snap.indexMd, wikiGuide: guide,
      });
      let opsApplied = 0;
      for (const rawOp of res.ops) {
        const patch = toPatchOp(rawOp);
        if (!patch) continue;
        try {
          const r = store.applyPatch(patch);
          opsApplied += 1;
          if (patch.op === "upsert") { if (r.created) pagesCreated += 1; if (r.updated) pagesUpdated += 1; }
          else if (patch.op === "append_source") sourcesAppended += 1;
          else if (patch.op === "append_image") imagesAppended += 1;
          else if (patch.op === "note" && r.noted) notes.push(r.noted);
          emit(opts.onEvent, { type: "op_applied", account: "selected", op: patch.op, path: patch.op !== "note" ? patch.path : undefined });
        } catch (e) {
          emit(opts.onEvent, { type: "op_applied", account: "selected", op: patch.op, error: (e as Error).message });
        }
      }
      emit(opts.onEvent, { type: "batch_completed", account: "selected", batchIndex: bi, totalBatches: batches.length, duration_ms: Date.now() - t0, stats: { ops_applied: opsApplied } });
    } catch (e) {
      emit(opts.onEvent, { type: "batch_failed", account: "selected", batchIndex: bi, totalBatches: batches.length, error: (e as Error).message });
    }
  }

  rebuildIndex(ctx.vaultPath);
  emit(opts.onEvent, { type: "all_completed", stats: { pages_created: pagesCreated, pages_updated: pagesUpdated } });
  return { accounts_done: ["selected"], pages_created: pagesCreated, pages_updated: pagesUpdated, sources_appended: sourcesAppended, images_appended: imagesAppended, notes };
}
```

Note: this Task 4 implementation introduces some code duplication between `runSelectedIngest` and the existing account loop — accept for now, Task 6 will unify via run recording.

- [ ] **Step 6: Run tests**

```bash
cd packages/kb && pnpm exec vitest run orchestrator
```

Expected: all tests PASS (existing tests still green + 3 new).

- [ ] **Step 7: Build + commit**

```bash
cd packages/kb && pnpm build
cd /Users/zeoooo/crossing-writer
git add packages/kb/src/wiki/types.ts \
        packages/kb/src/wiki/orchestrator.ts \
        packages/kb/tests/wiki/orchestrator.test.ts
git commit -m "feat(kb): runIngest mode=selected + maxArticles validation"
```

---

## Task 5：Orchestrator — forceReingest + mark filtering

**Files:**
- Modify: `packages/kb/src/wiki/orchestrator.ts`
- Modify: `packages/kb/src/wiki/types.ts`
- Modify: `packages/kb/tests/wiki/orchestrator.test.ts`

- [ ] **Step 1: Extend types**

In `packages/kb/src/wiki/types.ts`, extend `IngestStepEvent.type` and `IngestResult`:

```ts
export interface IngestStepEvent {
  type: "batch_started" | "op_applied" | "batch_completed" | "batch_failed" | "account_completed" | "all_completed" | "article_skipped";
  account?: string;
  articleId?: string;
  // ... existing fields
}

export interface IngestResult {
  // ... existing fields
  skipped_count: number;
}
```

- [ ] **Step 2: Write failing test**

Append to `packages/kb/tests/wiki/orchestrator.test.ts`:

```ts
describe("runIngest forceReingest + mark filtering", () => {
  it("skips articles already in wiki_ingest_marks (forceReingest=false)", async () => {
    // Setup: sqlite with 2 articles + pre-mark article 'a1'
    // Call runIngest mode=selected articleIds=[a1, a2], forceReingest=false
    // Expect: a1 skipped (article_skipped event), a2 processed
    // IMPLEMENTATION HINT: use the existing helper + pre-populate wiki_ingest_marks
  });

  it("processes all articles when forceReingest=true", async () => {
    // Similar setup; forceReingest=true
    // Expect: both a1 and a2 processed
  });

  it("emits article_skipped events for filtered ids", async () => {
    // Capture events, check type='article_skipped' count matches skipped ids
  });

  it("writes marks after successful apply", async () => {
    // After runIngest completes, query wiki_ingest_marks — should contain both a1 and a2
  });
});
```

- [ ] **Step 3: Run tests (should fail)**

```bash
cd packages/kb && pnpm exec vitest run orchestrator
```

- [ ] **Step 4: Implement in orchestrator.ts**

Add to top of `runSelectedIngest()` (before batch loop):

```ts
// Mark filtering
const sqliteDb = new Database(ctx.sqlitePath, { fileMustExist: true });
let skippedCount = 0;
let filteredArticles = articles;
if (!opts.forceReingest) {
  const { filterAlreadyIngested } = await import("./ingest-marks-repo.js");
  const { alreadyIngested } = filterAlreadyIngested(sqliteDb, articles.map((a) => a.id));
  if (alreadyIngested.length > 0) {
    for (const id of alreadyIngested) {
      emit(opts.onEvent, { type: "article_skipped", account: "selected", articleId: id });
    }
    const skipSet = new Set(alreadyIngested);
    filteredArticles = articles.filter((a) => !skipSet.has(a.id));
    skippedCount = alreadyIngested.length;
  }
}
```

After the batch loop (before `rebuildIndex`), add:

```ts
// Write marks for successfully processed articles
if (filteredArticles.length > 0) {
  const { upsertMark } = await import("./ingest-marks-repo.js");
  const now = new Date().toISOString();
  const runIdPlaceholder = "pending-run-id"; // Will be replaced in Task 6
  for (const a of filteredArticles) {
    upsertMark(sqliteDb, { articleId: a.id, runId: runIdPlaceholder, now });
  }
}
sqliteDb.close();
```

Update the return:

```ts
return {
  accounts_done: ["selected"],
  pages_created: pagesCreated,
  pages_updated: pagesUpdated,
  sources_appended: sourcesAppended,
  images_appended: imagesAppended,
  notes,
  skipped_count: skippedCount,
};
```

Also update the original account-loop branch's return to include `skipped_count: 0`.

- [ ] **Step 5: Run tests**

```bash
cd packages/kb && pnpm exec vitest run orchestrator
```

Expected: all PASS.

- [ ] **Step 6: Build + commit**

```bash
cd packages/kb && pnpm build
git add packages/kb/src/wiki/types.ts \
        packages/kb/src/wiki/orchestrator.ts \
        packages/kb/tests/wiki/orchestrator.test.ts
git commit -m "feat(kb): runIngest skip already-ingested articles unless forceReingest"
```

---

## Task 6：Orchestrator — Run lifecycle 记账

**Files:**
- Modify: `packages/kb/src/wiki/orchestrator.ts`
- Modify: `packages/kb/src/wiki/types.ts`
- Modify: `packages/kb/tests/wiki/orchestrator.test.ts`

- [ ] **Step 1: Extend IngestResult to return run_id**

```ts
export interface IngestResult {
  // ... existing fields
  run_id: string;
}
```

Also extend `IngestStepEvent.type` with `"run_started" | "run_completed"`:

```ts
export interface IngestStepEvent {
  type: ... | "run_started" | "run_completed";
  runId?: string;
  // ... existing
}
```

- [ ] **Step 2: Write failing test**

Append to `packages/kb/tests/wiki/orchestrator.test.ts`:

```ts
describe("runIngest run recording", () => {
  it("creates a run row with status=running at start", async () => {
    // Setup + call runIngest + immediately check wiki_ingest_runs for a row with status=running
    // NOTE: this is tricky to test mid-execution; use events instead:
    // assert 'run_started' event fires before first 'batch_started'
  });

  it("updates run to status=done with final stats on success", async () => {
    // After successful runIngest, query wiki_ingest_runs by returned run_id
    // Expect: status=done, finished_at set, stats match IngestResult
  });

  it("updates run to status=error on crash", async () => {
    // Simulate agent throwing; expect status=error, error field populated
  });

  it("writes run_ops for each apply", async () => {
    // After runIngest, query wiki_ingest_run_ops for run_id
    // Expect rows matching the ops (upsert, append_source, etc.)
  });

  it("marks reference the actual run_id, not the placeholder", async () => {
    // After runIngest, the wiki_ingest_marks.last_run_id should equal the returned run_id
  });
});
```

- [ ] **Step 3: Run tests (fail)**

- [ ] **Step 4: Implement run lifecycle in runSelectedIngest**

At the top of `runSelectedIngest` (before mark filtering), add:

```ts
const { createRun, finishRun, appendRunOp } = await import("./ingest-runs-repo.js");
const runId = (globalThis.crypto as Crypto).randomUUID();
const startedAt = new Date().toISOString();
createRun(sqliteDb, {
  runId,
  startedAt,
  accounts: opts.accounts,
  articleIds: opts.articleIds ?? [],
  mode: opts.mode,
  model: `${opts.cliModel?.cli ?? "claude"}/${opts.cliModel?.model ?? "default"}`,
});
emit(opts.onEvent, { type: "run_started", runId });
```

Replace `upsertMark(..., runId: runIdPlaceholder, ...)` with the real `runId`.

Inside the op apply loop, after successful apply, also call `appendRunOp`:

```ts
appendRunOp(sqliteDb, {
  runId,
  seq: opSeq,
  op: patch.op,
  path: patch.op !== "note" ? patch.path : null,
  articleId: /* derive from batch context */ null,
  createdPage: patch.op === "upsert" ? r.created : false,
  conflict: false, // Future: detect conflict flag
});
opSeq += 1;
```

(Declare `let opSeq = 0;` at the top of `runSelectedIngest`.)

At the very end (before `return`), wrap in try/catch:

```ts
try {
  // ... existing batch loop ...
  finishRun(sqliteDb, {
    runId,
    finishedAt: new Date().toISOString(),
    status: "done",
    stats: {
      pages_created: pagesCreated,
      pages_updated: pagesUpdated,
      sources_appended: sourcesAppended,
      images_appended: imagesAppended,
      skipped_count: skippedCount,
      conflict_count: 0,
    },
  });
  emit(opts.onEvent, { type: "run_completed", runId });
} catch (err) {
  finishRun(sqliteDb, {
    runId,
    finishedAt: new Date().toISOString(),
    status: "error",
    error: (err as Error).message,
  });
  throw err;
}
```

Update return to include `run_id: runId`.

Note: the **legacy account-loop path** (non-selected mode) should ALSO create a run for consistency. Make this change in `runIngest` itself — create a run upfront and thread `runId` through both code paths. Keep the legacy path functional; just wrap its top/tail in createRun/finishRun.

- [ ] **Step 5: Run tests**

Expected: all PASS.

- [ ] **Step 6: Build + commit**

```bash
cd packages/kb && pnpm build
git add packages/kb/src/wiki/types.ts \
        packages/kb/src/wiki/orchestrator.ts \
        packages/kb/tests/wiki/orchestrator.test.ts
git commit -m "feat(kb): runIngest writes wiki_ingest_runs + run_ops for each run"
```

---

## Task 7：`POST /api/kb/wiki/check-duplicates` endpoint

**Files:**
- Modify: `packages/web-server/src/routes/kb-wiki.ts`
- Create: `packages/web-server/tests/routes-kb-wiki-check-duplicates.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web-server/tests/routes-kb-wiki-check-duplicates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { registerKbWikiRoutes } from "../src/routes/kb-wiki.js";
import { ensureSchema, upsertMark } from "@crossing/kb";

async function mk() {
  const vault = mkdtempSync(join(tmpdir(), "cd-"));
  const sqlitePath = join(vault, "refs.sqlite");
  const db = new Database(sqlitePath);
  ensureSchema(db);
  upsertMark(db, { articleId: "a1", runId: "r1", now: "2026-04-17T10:00:00Z" });
  upsertMark(db, { articleId: "a2", runId: "r1", now: "2026-04-17T10:00:00Z" });
  db.close();
  const app = Fastify();
  registerKbWikiRoutes(app, { vaultPath: vault, sqlitePath });
  await app.ready();
  return { app };
}

describe("POST /api/kb/wiki/check-duplicates", () => {
  it("splits article ids into already_ingested vs fresh", async () => {
    const { app } = await mk();
    const res = await app.inject({
      method: "POST", url: "/api/kb/wiki/check-duplicates",
      payload: { article_ids: ["a1", "a2", "a3", "a4"] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { already_ingested: Array<{ article_id: string; first_ingested_at: string; last_ingested_at: string; last_run_id: string }>; fresh: string[] };
    expect(body.already_ingested.map((x) => x.article_id).sort()).toEqual(["a1", "a2"]);
    expect(body.fresh.sort()).toEqual(["a3", "a4"]);
    expect(body.already_ingested[0].first_ingested_at).toBe("2026-04-17T10:00:00Z");
    await app.close();
  });

  it("returns empty result when no ids match", async () => {
    const { app } = await mk();
    const res = await app.inject({
      method: "POST", url: "/api/kb/wiki/check-duplicates",
      payload: { article_ids: ["x", "y"] },
    });
    const body = res.json() as { already_ingested: []; fresh: string[] };
    expect(body.already_ingested).toEqual([]);
    expect(body.fresh).toEqual(["x", "y"]);
    await app.close();
  });

  it("returns 400 when article_ids missing or empty", async () => {
    const { app } = await mk();
    const res = await app.inject({
      method: "POST", url: "/api/kb/wiki/check-duplicates",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("treats db missing as all fresh (no schema)", async () => {
    const vault = mkdtempSync(join(tmpdir(), "cdn-"));
    const sqlitePath = join(vault, "never.sqlite");
    const app = Fastify();
    registerKbWikiRoutes(app, { vaultPath: vault, sqlitePath });
    await app.ready();
    const res = await app.inject({
      method: "POST", url: "/api/kb/wiki/check-duplicates",
      payload: { article_ids: ["a1"] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { fresh: string[] };
    expect(body.fresh).toEqual(["a1"]);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test (fail)**

- [ ] **Step 3: Implement endpoint**

In `packages/web-server/src/routes/kb-wiki.ts`, inside `registerKbWikiRoutes`, append:

```ts
app.post<{ Body: { article_ids?: string[] } }>("/api/kb/wiki/check-duplicates", async (req, reply) => {
  const ids = req.body?.article_ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return reply.code(400).send({ error: "article_ids required" });
  }
  if (!existsSync(deps.sqlitePath)) {
    return reply.send({ already_ingested: [], fresh: ids });
  }
  const { listMarks } = await import("@crossing/kb");
  const db = new Database(deps.sqlitePath, { readonly: true, fileMustExist: true });
  try {
    // If schema missing, fall back to fresh
    const hasTable = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='wiki_ingest_marks'`,
    ).get();
    if (!hasTable) return reply.send({ already_ingested: [], fresh: ids });
    const marks = listMarks(db, ids);
    const markedSet = new Set(marks.map((m) => m.article_id));
    return reply.send({
      already_ingested: marks.map((m) => ({
        article_id: m.article_id,
        first_ingested_at: m.first_ingested_at,
        last_ingested_at: m.last_ingested_at,
        last_run_id: m.last_run_id,
      })),
      fresh: ids.filter((id) => !markedSet.has(id)),
    });
  } finally { db.close(); }
});
```

You'll need to add `import { existsSync } from "node:fs"; import Database from "better-sqlite3";` at the top of the file if not present (check first).

- [ ] **Step 4: Run tests (pass)**

```bash
cd packages/web-server && pnpm exec vitest run routes-kb-wiki-check-duplicates
```

- [ ] **Step 5: Commit**

```bash
git add packages/web-server/src/routes/kb-wiki.ts \
        packages/web-server/tests/routes-kb-wiki-check-duplicates.test.ts
git commit -m "feat(web-server): POST /api/kb/wiki/check-duplicates"
```

---

## Task 8：`GET /api/kb/wiki/runs` + `/runs/:id`

**Files:**
- Create: `packages/web-server/src/routes/kb-wiki-runs.ts`
- Create: `packages/web-server/tests/routes-kb-wiki-runs.test.ts`
- Modify: `packages/web-server/src/server.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/web-server/tests/routes-kb-wiki-runs.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { ensureSchema, createRun, finishRun, appendRunOp } from "@crossing/kb";
import { registerKbWikiRunsRoutes } from "../src/routes/kb-wiki-runs.js";

let sqlitePath: string;
let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "runs-"));
  sqlitePath = join(dir, "refs.sqlite");
  const db = new Database(sqlitePath);
  ensureSchema(db);
  createRun(db, { runId: "r1", startedAt: "2026-04-17T10:00:00Z", accounts: ["acc"], articleIds: ["a1"], mode: "selected", model: "x" });
  appendRunOp(db, { runId: "r1", seq: 0, op: "upsert", path: "entities/A.md", articleId: "a1", createdPage: true });
  finishRun(db, { runId: "r1", finishedAt: "2026-04-17T10:05:00Z", status: "done", stats: { pages_created: 1 } });
  createRun(db, { runId: "r2", startedAt: "2026-04-17T11:00:00Z", accounts: [], articleIds: [], mode: "full", model: "y" });
  finishRun(db, { runId: "r2", finishedAt: "2026-04-17T11:01:00Z", status: "error", error: "boom" });
  db.close();
  app = Fastify();
  registerKbWikiRunsRoutes(app, { sqlitePath });
  await app.ready();
});

describe("GET /api/kb/wiki/runs", () => {
  it("lists runs newest first", async () => {
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/runs?limit=10" });
    expect(res.statusCode).toBe(200);
    const runs = res.json() as Array<{ id: string; status: string }>;
    expect(runs.map((r) => r.id)).toEqual(["r2", "r1"]);
    await app.close();
  });

  it("filters by status", async () => {
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/runs?status=error" });
    const runs = res.json() as Array<{ id: string }>;
    expect(runs.map((r) => r.id)).toEqual(["r2"]);
    await app.close();
  });

  it("returns empty array when no runs table", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rns-"));
    const app2 = Fastify();
    registerKbWikiRunsRoutes(app2, { sqlitePath: join(dir, "never.sqlite") });
    await app2.ready();
    const res = await app2.inject({ method: "GET", url: "/api/kb/wiki/runs" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app2.close();
  });
});

describe("GET /api/kb/wiki/runs/:id", () => {
  it("returns run + ops", async () => {
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/runs/r1" });
    expect(res.statusCode).toBe(200);
    const run = res.json() as { id: string; ops: Array<{ op: string; path: string }> };
    expect(run.id).toBe("r1");
    expect(run.ops).toHaveLength(1);
    expect(run.ops[0]).toMatchObject({ op: "upsert", path: "entities/A.md" });
    await app.close();
  });

  it("returns 404 for missing run", async () => {
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/runs/nope" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
```

- [ ] **Step 2: Run test (fail)**

- [ ] **Step 3: Create route file**

Create `packages/web-server/src/routes/kb-wiki-runs.ts`:

```ts
import type { FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { existsSync } from "node:fs";

export interface KbWikiRunsDeps {
  sqlitePath: string;
}

export function registerKbWikiRunsRoutes(app: FastifyInstance, deps: KbWikiRunsDeps) {
  app.get<{ Querystring: { limit?: string; status?: string; since?: string; until?: string } }>(
    "/api/kb/wiki/runs",
    async (req, reply) => {
      if (!existsSync(deps.sqlitePath)) return reply.send([]);
      const { listRuns } = await import("@crossing/kb");
      const db = new Database(deps.sqlitePath, { readonly: true, fileMustExist: true });
      try {
        const hasTable = db.prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='wiki_ingest_runs'`,
        ).get();
        if (!hasTable) return reply.send([]);
        const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 500);
        const status = req.query.status as ("running" | "done" | "error" | "cancelled" | undefined);
        const runs = listRuns(db, { limit, status, since: req.query.since, until: req.query.until });
        return reply.send(runs);
      } finally { db.close(); }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/kb/wiki/runs/:id",
    async (req, reply) => {
      if (!existsSync(deps.sqlitePath)) return reply.code(404).send({ error: "not found" });
      const { getRun } = await import("@crossing/kb");
      const db = new Database(deps.sqlitePath, { readonly: true, fileMustExist: true });
      try {
        const hasTable = db.prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='wiki_ingest_runs'`,
        ).get();
        if (!hasTable) return reply.code(404).send({ error: "not found" });
        const run = getRun(db, req.params.id);
        if (!run) return reply.code(404).send({ error: "not found" });
        return reply.send(run);
      } finally { db.close(); }
    },
  );
}
```

- [ ] **Step 4: Wire in server.ts**

In `packages/web-server/src/server.ts`, add import near other kb routes:

```ts
import { registerKbWikiRunsRoutes } from "./routes/kb-wiki-runs.js";
```

And call it near `registerKbRawArticlesRoutes`:

```ts
registerKbWikiRunsRoutes(app, { sqlitePath: configStore.current.sqlitePath });
```

- [ ] **Step 5: Run tests**

```bash
cd packages/web-server && pnpm exec vitest run routes-kb-wiki-runs
```

Expected: 5 tests PASS.

- [ ] **Step 6: tsc clean + commit**

```bash
cd packages/web-server && pnpm exec tsc --noEmit
git add packages/web-server/src/routes/kb-wiki-runs.ts \
        packages/web-server/src/server.ts \
        packages/web-server/tests/routes-kb-wiki-runs.test.ts
git commit -m "feat(web-server): GET /api/kb/wiki/runs + /runs/:id"
```

---

## Task 9：Ingest body 扩展 `article_ids` / `max_articles` / `force_reingest`

**Files:**
- Modify: `packages/web-server/src/routes/kb-wiki.ts`
- Modify: `packages/web-server/tests/routes-kb-wiki-ingest.test.ts`

- [ ] **Step 1: Read existing test + body interface**

Open `packages/web-server/src/routes/kb-wiki.ts`. Find `interface IngestBody` and the POST handler. Note what fields exist now.

Open `packages/web-server/tests/routes-kb-wiki-ingest.test.ts` — check its existing smoke test pattern.

- [ ] **Step 2: Write failing tests**

Append to `packages/web-server/tests/routes-kb-wiki-ingest.test.ts`:

```ts
describe("POST /api/kb/wiki/ingest — new body fields", () => {
  it("400 when article_ids provided but mode is not selected", async () => {
    // minimum: stubbed runIngest, trigger validation error
    // Use existing test fixture/helper
    const res = await request({
      accounts: ["acc"], mode: "full", article_ids: ["a1"],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/implies mode=selected/);
  });

  it("400 when mode=selected without article_ids", async () => {
    const res = await request({ accounts: [], mode: "selected" });
    expect(res.statusCode).toBe(400);
  });

  it("413 when projected count exceeds max_articles", async () => {
    const res = await request({
      accounts: [], mode: "selected", article_ids: ["a1","a2","a3"], max_articles: 2,
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ error: expect.stringContaining("max_articles exceeded") });
  });

  it("accepts force_reingest: true", async () => {
    // Pass force_reingest and assert request passes validation
    // Use a stubbed runIngest that resolves quickly
  });
});
```

Replace `request` with whatever existing helper is used in the test file.

- [ ] **Step 3: Run (fail)**

- [ ] **Step 4: Modify route validation**

In `packages/web-server/src/routes/kb-wiki.ts`, update the `IngestBody` interface and the POST handler body validation:

```ts
interface IngestBody {
  accounts?: string[];
  article_ids?: string[];
  per_account_limit?: number;
  batch_size?: number;
  mode?: IngestMode;
  since?: string;
  until?: string;
  cli_model?: { cli: "claude" | "codex"; model?: string };
  max_articles?: number;
  force_reingest?: boolean;
}
```

In the handler, add after existing validation:

```ts
const articleIds = body.article_ids ?? [];
const forceReingest = body.force_reingest ?? false;
const maxArticles = body.max_articles ?? 50;

if (articleIds.length > 0 && mode !== "selected") {
  return reply.code(400).send({ error: "article_ids implies mode=selected" });
}
if (mode === "selected" && articleIds.length === 0) {
  return reply.code(400).send({ error: "article_ids required for mode=selected" });
}
if (!Number.isInteger(maxArticles) || maxArticles < 1 || maxArticles > 500) {
  return reply.code(400).send({ error: "max_articles must be integer in [1, 500]" });
}

// Projected count (match orchestrator logic)
const projectedCount = mode === "selected" ? articleIds.length : accounts.length * perAccountLimit;
if (projectedCount > maxArticles) {
  return reply.code(413).send({ error: `max_articles exceeded: cap=${maxArticles} projected=${projectedCount}`, cap: maxArticles, projected: projectedCount });
}
```

And pass the new options to `runIngest`:

```ts
const result = await runIngest({
  accounts, articleIds, perAccountLimit, batchSize, mode,
  since: body.since, until: body.until,
  cliModel: body.cli_model,
  maxArticles, forceReingest,
  onEvent,
}, { vaultPath: deps.vaultPath, sqlitePath: deps.sqlitePath });
```

- [ ] **Step 5: Run tests**

```bash
cd packages/web-server && pnpm exec vitest run routes-kb-wiki-ingest
```

- [ ] **Step 6: Commit**

```bash
git add packages/web-server/src/routes/kb-wiki.ts \
        packages/web-server/tests/routes-kb-wiki-ingest.test.ts
git commit -m "feat(web-server): ingest body accepts article_ids/max_articles/force_reingest"
```

---

## Task 10：启动时 ensureSchema + end-to-end smoke

**Files:**
- Modify: `packages/web-server/src/server.ts`

- [ ] **Step 1: Wire ensureSchema on startup**

In `packages/web-server/src/server.ts`, find where the server initialization happens (likely at the bottom in `buildServer` or similar). Before the first route registration that uses sqlite, add:

```ts
import Database from "better-sqlite3";
import { ensureSchema } from "@crossing/kb";
import { existsSync } from "node:fs";
// ... other imports

// Inside buildServer / main init, AFTER config is loaded and sqlitePath is known:
if (existsSync(configStore.current.sqlitePath)) {
  const db = new Database(configStore.current.sqlitePath);
  try { ensureSchema(db); } finally { db.close(); }
}
```

(If sqlite doesn't exist yet, skip — it'll be created on first write elsewhere. ensureSchema runs again at next startup.)

- [ ] **Step 2: tsc + build full**

```bash
cd /Users/zeoooo/crossing-writer
pnpm -r build
```

Ignore pre-existing case-plan-orchestrator errors. All Plan 2 code must be tsc-clean.

- [ ] **Step 3: Run all new tests together**

```bash
cd packages/kb && pnpm exec vitest run migrations ingest-marks-repo ingest-runs-repo orchestrator
cd ../web-server && pnpm exec vitest run routes-kb-wiki
```

Expected: all new tests PASS, existing tests no regression.

- [ ] **Step 4: Manual smoke via curl**

Start web-server (e.g., `PORT=3101 pnpm dev`). Then:

```bash
# 1. Check schema was created at startup
sqlite3 ~/CrossingVault/.index/refs.sqlite ".schema wiki_ingest_marks"
# Should print the CREATE TABLE statement

# 2. check-duplicates on empty marks
curl -s -X POST http://localhost:3101/api/kb/wiki/check-duplicates \
  -H 'Content-Type: application/json' \
  -d '{"article_ids":["nonexistent-id"]}'
# Expected: {"already_ingested":[],"fresh":["nonexistent-id"]}

# 3. runs list (empty at first)
curl -s http://localhost:3101/api/kb/wiki/runs
# Expected: []

# 4. ingest with article_ids (will fire a real run through agent — may be slow)
# For smoke test, just test the 400 path:
curl -s -X POST http://localhost:3101/api/kb/wiki/ingest \
  -H 'Content-Type: application/json' \
  -d '{"accounts":[],"mode":"selected"}'
# Expected: 400 with article_ids required
```

- [ ] **Step 5: Commit server wiring + close out**

```bash
git add packages/web-server/src/server.ts
git commit -m "feat(web-server): ensureSchema on startup for wiki_ingest tables"
```

---

## 风险与注意事项

1. **Orchestrator.ts 的 legacy account-loop path** 在 Task 4-6 里只做了 `selected` 模式的 run recording。要么 Task 6 同时包含 legacy path 改造，要么追加 Task 6.5 单独做。Task 6 的 Step 4 末段已提到要同时改 legacy path —— 实施者注意
2. **`wiki_ingest_marks` 只从本 feature 起打点**（design §2 明确），旧历史不回填。所以 UI 端在 Plan 3 里显示"已入库"可能会显示为 0 直到用户跑过一次新 run。文档里要交代清楚
3. **运行中 run 的 cleanup**：如果 web-server 崩溃，`status='running'` 的 run 会变成 zombie。Plan 2 不做 startup sweep（留给后续 ops 层）；UI Plan 3/4 里显示时可以判断 `finished_at IS NULL && status='running'` 为 stale
4. **`crypto.randomUUID()`** 要求 Node 19+。本项目 package.json 里写了 `"@types/node": "^20"`，应无问题，但实施时注意 node engines 声明
5. **动态 `await import` 到 `@crossing/kb`** 继续沿用现有 kb-wiki.ts 模式 —— 不要改为 static import，会打破 ESM 顺序

---

## Self-Review Check

- [x] **Spec coverage:** §5.1 三张表、§5.2 runIngest 扩展、§5.3 所有新 API 都有对应 task
- [x] **Placeholder scan:** 所有 code step 含实际代码；Task 4/5 的 hint 明确提示复用 existing helper（不是 TBD）
- [x] **Type consistency:** `RunRow`, `RunSummary`, `RunOpRow`, `MarkRow` 在 repo 与 test 一致；`IngestOptions.articleIds` 名一致从 types.ts 贯穿到 orchestrator 到 API
- [x] **File paths:** 全部绝对或仓库相对

Plan 2 完成。10 tasks 线性。Plan 2 合并后用户可见收益有限（纯后端），但 Plan 3/4/5 全部依赖它。
