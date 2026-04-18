# Style Corpus + Writing Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a unified `styleCorpus` concept + `search_style` tool + tool-call intensity floors, letting writer agents pull richer style material during generation.

**Architecture:** New `styleCorpus` = named article collection stored as markdown in vault. Backed by a sqlite index for fast filtered FTS. Distillation produces panels keyed by corpus_id (not account). Writers bind to `(corpus, role)`. New `search_style` tool queries corpus articles' raw bodies + extracted snippets. Tool-runner enforces per-role minimum call floors before accepting output.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, React, Vitest. Monorepo via pnpm workspaces.

**Spec reference:** `docs/superpowers/specs/2026-04-18-style-corpus-writing-upgrade-design.md`

---

## Phase structure (for pausing between phases)

- **Phase 1 (T1-T3):** styleCorpus foundation — store + sqlite index + migration
- **Phase 2 (T4-T6):** Backend wiring — REST + resolver + config migration
- **Phase 3 (T7):** Distillation accepts corpus
- **Phase 4 (T8-T10):** `search_style` tool
- **Phase 5 (T11-T12):** Tool-runner floor + round cap + prompt rules
- **Phase 6 (T13-T15):** Frontend — corpus page + builder + distill trigger

After Phase 3 everything still works via migration (no visible feature). Phases 4-6 deliver the new writing quality.

---

## File Structure

**New files:**
- `packages/kb/src/style-corpus/types.ts` — `StyleCorpus`, `CorpusArticleRef` types
- `packages/kb/src/style-corpus/parser.ts` — frontmatter read/write
- `packages/kb/src/style-corpus/store.ts` — `StyleCorpusStore` (read/write md + index)
- `packages/kb/src/style-corpus/index-repo.ts` — sqlite `style_corpus_articles` CRUD
- `packages/kb/src/style-corpus/migration.ts` — old panel → default corpus migration
- `packages/kb/src/skills/search-style.ts` — new tool impl
- `packages/kb/src/skills/snippets-index.ts` — in-memory snippets scanner
- `packages/web-server/src/routes/kb-style-corpus.ts` — corpus REST
- `packages/web-ui/src/pages/StyleCorpusPage.tsx` — list/manage corpora (replaces StylePanelsPage)
- `packages/web-ui/src/components/style-corpus/CorpusBuilder.tsx` — new-corpus modal
- `packages/web-ui/src/api/style-corpus-client.ts` — corpus API client

**Modified files:**
- `packages/web-server/src/services/agent-config-store.ts` — `AgentStyleBinding` shape
- `packages/web-server/src/services/style-binding-resolver.ts` — resolve by `(corpus, role)`
- `packages/web-server/src/services/style-panel-store.ts` — key by `corpus_id` not account
- `packages/web-server/src/services/config-store.ts` — run corpus migration on load
- `packages/web-server/src/server.ts` — wire new store + routes
- `packages/kb/src/style-distiller/orchestrator.ts` — accept corpus as input
- `packages/kb/src/style-distiller/orchestrator-v2.ts` — same
- `packages/kb/src/skills/dispatcher.ts` — register `search_style`
- `packages/agents/src/writer-tool-runner.ts` — round cap + floor gate
- `packages/agents/src/prompts/_tool-protocol.md` — new tool + rules

---

## Task 1: styleCorpus types + parser (frontmatter I/O)

**Files:**
- Create: `packages/kb/src/style-corpus/types.ts`
- Create: `packages/kb/src/style-corpus/parser.ts`
- Create: `packages/kb/tests/style-corpus/parser.test.ts`

- [ ] **Step 1: Write failing parser tests**

```ts
// packages/kb/tests/style-corpus/parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseCorpusFile, formatCorpusFile } from '../../src/style-corpus/parser.js';

describe('styleCorpus parser', () => {
  it('parses frontmatter with mixed articles shape', () => {
    const md = `---
id: 十字路口-001
description: Koji 深度访谈
created_at: 2026-04-18T10:30:00Z
articles:
  - account: 十字路口Crossing
    ids: [abc, def]
  - account: 量子位
    all: true
---

备注正文
`;
    const c = parseCorpusFile(md);
    expect(c.id).toBe('十字路口-001');
    expect(c.articles).toHaveLength(2);
    expect(c.articles[0]).toEqual({ account: '十字路口Crossing', ids: ['abc', 'def'] });
    expect(c.articles[1]).toEqual({ account: '量子位', all: true });
    expect(c.notes).toBe('备注正文\n');
  });

  it('round-trips through format → parse', () => {
    const c = {
      id: 'x-1',
      description: 'd',
      created_at: '2026-04-18T00:00:00Z',
      articles: [{ account: 'a', ids: ['1'] }],
      notes: '',
    };
    expect(parseCorpusFile(formatCorpusFile(c))).toEqual(c);
  });

  it('rejects entries with both ids and all=true', () => {
    const bad = `---
id: x
articles:
  - account: a
    ids: [1]
    all: true
---
`;
    expect(() => parseCorpusFile(bad)).toThrow(/both ids and all/);
  });
});
```

- [ ] **Step 2: Run test, verify fails**

Run: `cd packages/kb && pnpm exec vitest run tests/style-corpus/parser.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Create types**

```ts
// packages/kb/src/style-corpus/types.ts
export type CorpusArticleRef =
  | { account: string; ids: string[] }
  | { account: string; all: true };

export interface StyleCorpus {
  id: string;
  description?: string;
  created_at: string;     // ISO timestamp
  articles: CorpusArticleRef[];
  notes?: string;          // markdown body after frontmatter
}
```

- [ ] **Step 4: Create parser**

```ts
// packages/kb/src/style-corpus/parser.ts
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { StyleCorpus, CorpusArticleRef } from './types.js';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export function parseCorpusFile(md: string): StyleCorpus {
  const m = md.match(FRONTMATTER_RE);
  if (!m) throw new Error('styleCorpus: missing frontmatter');
  const fm = parseYaml(m[1]!) as Record<string, unknown>;
  if (typeof fm.id !== 'string') throw new Error('styleCorpus: id required');
  if (!Array.isArray(fm.articles)) throw new Error('styleCorpus: articles[] required');
  const articles: CorpusArticleRef[] = [];
  for (const raw of fm.articles) {
    const e = raw as { account?: string; ids?: string[]; all?: boolean };
    if (!e.account) throw new Error('styleCorpus: article.account required');
    const hasIds = Array.isArray(e.ids) && e.ids.length > 0;
    const isAll = e.all === true;
    if (hasIds && isAll) throw new Error('styleCorpus: entry cannot have both ids and all');
    if (!hasIds && !isAll) throw new Error('styleCorpus: entry needs ids or all');
    articles.push(isAll ? { account: e.account, all: true } : { account: e.account, ids: e.ids! });
  }
  return {
    id: fm.id,
    description: typeof fm.description === 'string' ? fm.description : undefined,
    created_at: typeof fm.created_at === 'string' ? fm.created_at : new Date().toISOString(),
    articles,
    notes: m[2] ?? '',
  };
}

export function formatCorpusFile(c: StyleCorpus): string {
  const fm: Record<string, unknown> = {
    id: c.id,
    ...(c.description ? { description: c.description } : {}),
    created_at: c.created_at,
    articles: c.articles,
  };
  return `---\n${stringifyYaml(fm)}---\n${c.notes ?? ''}`;
}
```

- [ ] **Step 5: Run test, verify passes**

Run: `cd packages/kb && pnpm exec vitest run tests/style-corpus/parser.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/kb/src/style-corpus/types.ts packages/kb/src/style-corpus/parser.ts packages/kb/tests/style-corpus/parser.test.ts
git commit -m "feat(style-corpus): types + frontmatter parser"
```

---

## Task 2: Sqlite index (`style_corpus_articles` table)

**Files:**
- Create: `packages/kb/src/style-corpus/index-repo.ts`
- Create: `packages/kb/tests/style-corpus/index-repo.test.ts`
- Modify: `packages/kb/src/db.ts` (register schema)

- [ ] **Step 1: Write failing tests**

```ts
// packages/kb/tests/style-corpus/index-repo.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createCorpusIndexRepo, ensureCorpusIndexSchema } from '../../src/style-corpus/index-repo.js';

let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  ensureCorpusIndexSchema(db);
});

describe('corpus index repo', () => {
  it('inserts and reads corpus membership', () => {
    const repo = createCorpusIndexRepo(db);
    repo.replaceMembers('x-1', [
      { account: 'a', article_id: '1' },
      { account: 'a', article_id: '2' },
      { account: 'b', article_id: '10' },
    ]);
    expect(repo.listByCorpus('x-1')).toHaveLength(3);
    expect(repo.articleIdsInCorpus('x-1', 'a')).toEqual(['1', '2']);
  });

  it('replaceMembers is idempotent', () => {
    const repo = createCorpusIndexRepo(db);
    repo.replaceMembers('x-1', [{ account: 'a', article_id: '1' }]);
    repo.replaceMembers('x-1', [{ account: 'a', article_id: '2' }]);
    expect(repo.articleIdsInCorpus('x-1', 'a')).toEqual(['2']);
  });

  it('removeCorpus clears all rows', () => {
    const repo = createCorpusIndexRepo(db);
    repo.replaceMembers('x-1', [{ account: 'a', article_id: '1' }]);
    repo.removeCorpus('x-1');
    expect(repo.listByCorpus('x-1')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd packages/kb && pnpm exec vitest run tests/style-corpus/index-repo.test.ts`
Expected: FAIL

- [ ] **Step 3: Create repo**

```ts
// packages/kb/src/style-corpus/index-repo.ts
import type Database from 'better-sqlite3';

export interface CorpusMember { account: string; article_id: string }

export function ensureCorpusIndexSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS style_corpus_articles (
      corpus_id   TEXT NOT NULL,
      account     TEXT NOT NULL,
      article_id  TEXT NOT NULL,
      PRIMARY KEY (corpus_id, account, article_id)
    );
    CREATE INDEX IF NOT EXISTS idx_sca_corpus ON style_corpus_articles(corpus_id);
  `);
}

export interface CorpusIndexRepo {
  replaceMembers(corpusId: string, members: CorpusMember[]): void;
  listByCorpus(corpusId: string): CorpusMember[];
  articleIdsInCorpus(corpusId: string, account: string): string[];
  removeCorpus(corpusId: string): void;
}

export function createCorpusIndexRepo(db: Database.Database): CorpusIndexRepo {
  const del = db.prepare('DELETE FROM style_corpus_articles WHERE corpus_id = ?');
  const ins = db.prepare('INSERT INTO style_corpus_articles (corpus_id, account, article_id) VALUES (?, ?, ?)');
  const listAll = db.prepare('SELECT account, article_id FROM style_corpus_articles WHERE corpus_id = ?');
  const listIds = db.prepare('SELECT article_id FROM style_corpus_articles WHERE corpus_id = ? AND account = ?');

  return {
    replaceMembers(corpusId, members) {
      const tx = db.transaction(() => {
        del.run(corpusId);
        for (const m of members) ins.run(corpusId, m.account, m.article_id);
      });
      tx();
    },
    listByCorpus: (corpusId) => listAll.all(corpusId) as CorpusMember[],
    articleIdsInCorpus: (corpusId, account) =>
      (listIds.all(corpusId, account) as Array<{ article_id: string }>).map(r => r.article_id),
    removeCorpus: (corpusId) => { del.run(corpusId); },
  };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd packages/kb && pnpm exec vitest run tests/style-corpus/index-repo.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/kb/src/style-corpus/index-repo.ts packages/kb/tests/style-corpus/index-repo.test.ts
git commit -m "feat(style-corpus): sqlite index repo with transactional replaceMembers"
```

---

## Task 3: `StyleCorpusStore` (md ↔ sqlite bridge + full-account expansion)

**Files:**
- Create: `packages/kb/src/style-corpus/store.ts`
- Create: `packages/kb/tests/style-corpus/store.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/kb/tests/style-corpus/store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { StyleCorpusStore } from '../../src/style-corpus/store.js';
import { ensureCorpusIndexSchema } from '../../src/style-corpus/index-repo.js';

function seedRefArticles(db: Database.Database, rows: Array<{ id: string; account: string }>): void {
  db.exec(`
    CREATE TABLE ref_articles (id TEXT PRIMARY KEY, account TEXT, title TEXT, url TEXT, md_path TEXT, html_path TEXT, published_at TEXT, body_plain TEXT DEFAULT '', body_segmented TEXT DEFAULT '', imported_at TEXT, updated_at TEXT);
  `);
  const ins = db.prepare('INSERT INTO ref_articles (id, account, title, url, md_path, html_path, published_at, imported_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const r of rows) ins.run(r.id, r.account, 't', 'u', 'm', 'h', '2026-01-01', '2026-01-01', '2026-01-01');
}

let vault: string, db: Database.Database;
beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'corpus-store-'));
  mkdirSync(join(vault, '08_experts/style-corpus'), { recursive: true });
  db = new Database(':memory:');
  ensureCorpusIndexSchema(db);
  seedRefArticles(db, [
    { id: 'a1', account: 'acctA' },
    { id: 'a2', account: 'acctA' },
    { id: 'b1', account: 'acctB' },
  ]);
});

describe('StyleCorpusStore', () => {
  it('save + list round-trip writes md file and populates index', () => {
    const store = new StyleCorpusStore({ vaultPath: vault, db });
    store.save({
      id: 'x-1', created_at: '2026-04-18T00:00:00Z',
      articles: [{ account: 'acctA', ids: ['a1', 'a2'] }],
    });
    expect(store.list().map(c => c.id)).toEqual(['x-1']);
    expect(store.get('x-1')?.articles).toEqual([{ account: 'acctA', ids: ['a1', 'a2'] }]);
  });

  it('save with all:true expands account to all ref_articles in index', () => {
    const store = new StyleCorpusStore({ vaultPath: vault, db });
    store.save({
      id: 'x-all', created_at: '2026-04-18T00:00:00Z',
      articles: [{ account: 'acctA', all: true }],
    });
    const members = db.prepare('SELECT article_id FROM style_corpus_articles WHERE corpus_id=?').all('x-all') as Array<{article_id:string}>;
    expect(members.map(m => m.article_id).sort()).toEqual(['a1', 'a2']);
  });

  it('delete removes md file + clears index', () => {
    const store = new StyleCorpusStore({ vaultPath: vault, db });
    store.save({ id: 'x-1', created_at: '2026-04-18T00:00:00Z', articles: [{ account: 'acctA', ids: ['a1'] }] });
    store.delete('x-1');
    expect(store.get('x-1')).toBeNull();
    expect(db.prepare('SELECT COUNT(*) as c FROM style_corpus_articles WHERE corpus_id=?').get('x-1')).toEqual({ c: 0 });
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd packages/kb && pnpm exec vitest run tests/style-corpus/store.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Create store**

```ts
// packages/kb/src/style-corpus/store.ts
import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { parseCorpusFile, formatCorpusFile } from './parser.js';
import type { StyleCorpus, CorpusArticleRef } from './types.js';
import { createCorpusIndexRepo, type CorpusMember } from './index-repo.js';

export class StyleCorpusStore {
  private readonly corpusDir: string;
  private readonly indexRepo: ReturnType<typeof createCorpusIndexRepo>;

  constructor(opts: { vaultPath: string; db: Database.Database }) {
    this.corpusDir = join(opts.vaultPath, '08_experts/style-corpus');
    this.indexRepo = createCorpusIndexRepo(opts.db);
    this.db = opts.db;
    mkdirSync(this.corpusDir, { recursive: true });
  }

  private readonly db: Database.Database;

  list(): StyleCorpus[] {
    if (!existsSync(this.corpusDir)) return [];
    const files = readdirSync(this.corpusDir).filter(f => f.endsWith('.md'));
    const out: StyleCorpus[] = [];
    for (const f of files) {
      try {
        out.push(parseCorpusFile(readFileSync(join(this.corpusDir, f), 'utf-8')));
      } catch (err) {
        console.warn(`[StyleCorpusStore] skip unparseable ${f}: ${(err as Error).message}`);
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): StyleCorpus | null {
    const path = join(this.corpusDir, `${id}.md`);
    if (!existsSync(path)) return null;
    return parseCorpusFile(readFileSync(path, 'utf-8'));
  }

  save(corpus: StyleCorpus): void {
    writeFileSync(join(this.corpusDir, `${corpus.id}.md`), formatCorpusFile(corpus), 'utf-8');
    this.indexRepo.replaceMembers(corpus.id, this.expandMembers(corpus.articles));
  }

  delete(id: string): void {
    const path = join(this.corpusDir, `${id}.md`);
    if (existsSync(path)) unlinkSync(path);
    this.indexRepo.removeCorpus(id);
  }

  reindexAll(): void {
    for (const c of this.list()) {
      this.indexRepo.replaceMembers(c.id, this.expandMembers(c.articles));
    }
  }

  private expandMembers(articles: CorpusArticleRef[]): CorpusMember[] {
    const members: CorpusMember[] = [];
    const listByAccount = this.db.prepare('SELECT id FROM ref_articles WHERE account = ?');
    for (const ref of articles) {
      if ('all' in ref && ref.all) {
        const rows = listByAccount.all(ref.account) as Array<{ id: string }>;
        for (const r of rows) members.push({ account: ref.account, article_id: r.id });
      } else if ('ids' in ref) {
        for (const id of ref.ids) members.push({ account: ref.account, article_id: id });
      }
    }
    return members;
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd packages/kb && pnpm exec vitest run tests/style-corpus/store.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/kb/src/style-corpus/store.ts packages/kb/tests/style-corpus/store.test.ts
git commit -m "feat(style-corpus): store bridges md files + sqlite index, expands all:true"
```

---

## Task 4: Migration — old panels → default corpora

**Files:**
- Create: `packages/kb/src/style-corpus/migration.ts`
- Create: `packages/kb/tests/style-corpus/migration.test.ts`

**Migration rules:**
1. Scan `vault/08_experts/style-panel/<account>/` where account is NOT already a corpus id
2. Create corpus `<account>-默认` with `articles: [{account, all: true}]`
3. Move panel files to `style-panel/<account>-默认/`
4. Mark migration done via `.corpus-migration-v1` sentinel file

- [ ] **Step 1: Write failing test**

```ts
// packages/kb/tests/style-corpus/migration.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { migrateOldPanelsToCorpora } from '../../src/style-corpus/migration.js';
import { ensureCorpusIndexSchema } from '../../src/style-corpus/index-repo.js';

let vault: string, db: Database.Database;
beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'corpus-mig-'));
  mkdirSync(join(vault, '08_experts/style-panel/十字路口Crossing'), { recursive: true });
  writeFileSync(join(vault, '08_experts/style-panel/十字路口Crossing/opening-v1.md'), '---\nversion: 1\n---\nbody');
  db = new Database(':memory:');
  ensureCorpusIndexSchema(db);
  db.exec(`CREATE TABLE ref_articles (id TEXT, account TEXT)`);
});

describe('migrateOldPanelsToCorpora', () => {
  it('creates default corpus per old account, moves panels, writes sentinel', () => {
    const result = migrateOldPanelsToCorpora({ vaultPath: vault, db });
    expect(result.migrated).toEqual(['十字路口Crossing']);
    expect(existsSync(join(vault, '08_experts/style-corpus/十字路口Crossing-默认.md'))).toBe(true);
    expect(existsSync(join(vault, '08_experts/style-panel/十字路口Crossing-默认/opening-v1.md'))).toBe(true);
    expect(existsSync(join(vault, '08_experts/style-panel/十字路口Crossing/opening-v1.md'))).toBe(false);
    expect(existsSync(join(vault, '08_experts/.corpus-migration-v1'))).toBe(true);
  });

  it('is idempotent (sentinel check)', () => {
    migrateOldPanelsToCorpora({ vaultPath: vault, db });
    const again = migrateOldPanelsToCorpora({ vaultPath: vault, db });
    expect(again.migrated).toEqual([]);
    expect(again.skipped).toBe('sentinel-present');
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd packages/kb && pnpm exec vitest run tests/style-corpus/migration.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement migration**

```ts
// packages/kb/src/style-corpus/migration.ts
import { existsSync, readdirSync, writeFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { StyleCorpusStore } from './store.js';

const SENTINEL = '.corpus-migration-v1';

export interface MigrationResult {
  migrated: string[];        // account names successfully migrated
  skipped?: 'sentinel-present';
}

export function migrateOldPanelsToCorpora(opts: { vaultPath: string; db: Database.Database }): MigrationResult {
  const expertsDir = join(opts.vaultPath, '08_experts');
  const panelDir = join(expertsDir, 'style-panel');
  const sentinelPath = join(expertsDir, SENTINEL);
  if (existsSync(sentinelPath)) return { migrated: [], skipped: 'sentinel-present' };
  if (!existsSync(panelDir)) {
    mkdirSync(expertsDir, { recursive: true });
    writeFileSync(sentinelPath, new Date().toISOString(), 'utf-8');
    return { migrated: [] };
  }

  const store = new StyleCorpusStore({ vaultPath: opts.vaultPath, db: opts.db });
  const entries = readdirSync(panelDir);
  const migrated: string[] = [];

  for (const entry of entries) {
    const abs = join(panelDir, entry);
    if (!statSync(abs).isDirectory()) continue;
    // If entry looks like "<account>-默认" or other corpus-id style, skip (already migrated or new-style)
    if (entry.includes('-')) continue;
    const account = entry;
    const newId = `${account}-默认`;
    const newDir = join(panelDir, newId);
    mkdirSync(newDir, { recursive: true });
    for (const f of readdirSync(abs)) {
      renameSync(join(abs, f), join(newDir, f));
    }
    // old dir now empty; leave it — user can clean manually
    store.save({
      id: newId,
      description: `从 v1 迁移（整账号自动蒸馏）`,
      created_at: new Date().toISOString(),
      articles: [{ account, all: true }],
    });
    migrated.push(account);
  }

  writeFileSync(sentinelPath, new Date().toISOString(), 'utf-8');
  return { migrated };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd packages/kb && pnpm exec vitest run tests/style-corpus/migration.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/kb/src/style-corpus/migration.ts packages/kb/tests/style-corpus/migration.test.ts
git commit -m "feat(style-corpus): one-shot migration wraps legacy panels into <account>-默认 corpora"
```

---

## Task 5: Backend REST — corpus CRUD

**Files:**
- Create: `packages/web-server/src/routes/kb-style-corpus.ts`
- Create: `packages/web-server/tests/routes-kb-style-corpus.test.ts`
- Modify: `packages/web-server/src/server.ts` (wire store + route)

- [ ] **Step 1: Write failing route test**

```ts
// packages/web-server/tests/routes-kb-style-corpus.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import { registerKbStyleCorpusRoutes } from '../src/routes/kb-style-corpus.js';
import { StyleCorpusStore } from '@crossing/kb';
import { ensureCorpusIndexSchema } from '@crossing/kb/style-corpus/index-repo';

let vault: string, db: Database.Database, app: ReturnType<typeof Fastify>;
beforeEach(async () => {
  vault = mkdtempSync(join(tmpdir(), 'corpus-routes-'));
  mkdirSync(join(vault, '08_experts/style-corpus'), { recursive: true });
  db = new Database(':memory:');
  ensureCorpusIndexSchema(db);
  db.exec(`CREATE TABLE ref_articles (id TEXT, account TEXT)`);
  const store = new StyleCorpusStore({ vaultPath: vault, db });
  app = Fastify();
  registerKbStyleCorpusRoutes(app, { store });
  await app.ready();
});

describe('kb/style-corpus routes', () => {
  it('GET empty list', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/kb/style-corpus' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ corpora: [] });
  });

  it('POST creates, GET returns, DELETE removes', async () => {
    const post = await app.inject({
      method: 'POST', url: '/api/kb/style-corpus',
      payload: { id: 'x-1', description: 'd', articles: [{ account: 'a', ids: ['1'] }] },
    });
    expect(post.statusCode).toBe(200);

    const get = await app.inject({ method: 'GET', url: '/api/kb/style-corpus/x-1' });
    expect(get.json().corpus.id).toBe('x-1');

    const del = await app.inject({ method: 'DELETE', url: '/api/kb/style-corpus/x-1' });
    expect(del.statusCode).toBe(200);

    const getAgain = await app.inject({ method: 'GET', url: '/api/kb/style-corpus/x-1' });
    expect(getAgain.statusCode).toBe(404);
  });

  it('POST rejects duplicate id', async () => {
    const body = { id: 'dup', articles: [{ account: 'a', ids: ['1'] }] };
    await app.inject({ method: 'POST', url: '/api/kb/style-corpus', payload: body });
    const dup = await app.inject({ method: 'POST', url: '/api/kb/style-corpus', payload: body });
    expect(dup.statusCode).toBe(409);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd packages/web-server && pnpm exec vitest run tests/routes-kb-style-corpus.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement routes**

```ts
// packages/web-server/src/routes/kb-style-corpus.ts
import type { FastifyInstance } from 'fastify';
import type { StyleCorpusStore, StyleCorpus, CorpusArticleRef } from '@crossing/kb';

interface CreateBody { id: string; description?: string; articles: CorpusArticleRef[] }
interface UpdateBody { description?: string; articles?: CorpusArticleRef[] }

export function registerKbStyleCorpusRoutes(app: FastifyInstance, deps: { store: StyleCorpusStore }) {
  app.get('/api/kb/style-corpus', async (_req, reply) => {
    return reply.send({ corpora: deps.store.list() });
  });

  app.get<{ Params: { id: string } }>('/api/kb/style-corpus/:id', async (req, reply) => {
    const corpus = deps.store.get(req.params.id);
    if (!corpus) return reply.code(404).send({ error: 'corpus not found' });
    return reply.send({ corpus });
  });

  app.post<{ Body: CreateBody }>('/api/kb/style-corpus', async (req, reply) => {
    const body = req.body;
    if (!body?.id) return reply.code(400).send({ error: 'id required' });
    if (!Array.isArray(body.articles) || body.articles.length === 0)
      return reply.code(400).send({ error: 'articles[] required' });
    if (deps.store.get(body.id)) return reply.code(409).send({ error: `corpus "${body.id}" already exists` });
    const corpus: StyleCorpus = {
      id: body.id,
      description: body.description,
      created_at: new Date().toISOString(),
      articles: body.articles,
    };
    try { deps.store.save(corpus); }
    catch (err) { return reply.code(400).send({ error: (err as Error).message }); }
    return reply.send({ corpus });
  });

  app.put<{ Params: { id: string }; Body: UpdateBody }>('/api/kb/style-corpus/:id', async (req, reply) => {
    const existing = deps.store.get(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'corpus not found' });
    const updated: StyleCorpus = {
      ...existing,
      description: req.body.description ?? existing.description,
      articles: req.body.articles ?? existing.articles,
    };
    deps.store.save(updated);
    return reply.send({ corpus: updated });
  });

  app.delete<{ Params: { id: string } }>('/api/kb/style-corpus/:id', async (req, reply) => {
    if (!deps.store.get(req.params.id)) return reply.code(404).send({ error: 'corpus not found' });
    deps.store.delete(req.params.id);
    return reply.send({ ok: true });
  });
}
```

- [ ] **Step 4: Export from @crossing/kb**

Add to `packages/kb/src/index.ts`:
```ts
export { StyleCorpusStore } from './style-corpus/store.js';
export type { StyleCorpus, CorpusArticleRef } from './style-corpus/types.js';
export { migrateOldPanelsToCorpora } from './style-corpus/migration.js';
export { ensureCorpusIndexSchema } from './style-corpus/index-repo.js';
```

- [ ] **Step 5: Wire in server.ts**

Modify `packages/web-server/src/server.ts` — after existing stylePanelStore wiring, add:
```ts
import { StyleCorpusStore, migrateOldPanelsToCorpora, ensureCorpusIndexSchema } from '@crossing/kb';
import { registerKbStyleCorpusRoutes } from './routes/kb-style-corpus.js';

// ... inside buildApp() after db opens:
ensureCorpusIndexSchema(db);
migrateOldPanelsToCorpora({ vaultPath: cfg.vaultPath, db });
const styleCorpusStore = new StyleCorpusStore({ vaultPath: cfg.vaultPath, db });
styleCorpusStore.reindexAll();  // keeps index in sync with md files on each boot
registerKbStyleCorpusRoutes(app, { store: styleCorpusStore });
```

- [ ] **Step 6: Run tests, verify pass**

Run: `cd packages/web-server && pnpm exec vitest run tests/routes-kb-style-corpus.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
git add packages/kb/src/index.ts packages/web-server/src/routes/kb-style-corpus.ts packages/web-server/src/server.ts packages/web-server/tests/routes-kb-style-corpus.test.ts
git commit -m "feat(routes): /api/kb/style-corpus CRUD + boot-time migration + reindex"
```

---

## Task 6: `styleBinding` upgrade — `(corpus, role)` everywhere

Backward-compat accept both shapes: `{account, role}` auto-remapped via `<account>-默认` convention.

**Files:**
- Modify: `packages/web-server/src/services/agent-config-store.ts`
- Modify: `packages/web-server/src/services/style-binding-resolver.ts`
- Modify: `packages/web-server/src/services/style-panel-store.ts` (path keyed by corpus_id)
- Modify: `packages/web-server/tests/writer-orchestrator-style-binding.test.ts`

- [ ] **Step 1: Update test expectations**

Add to `agent-config-store.test.ts`:
```ts
it('accepts new {corpus, role} shape', () => {
  // round-trip
  const cfg = { agentKey: 'writer.opening', styleBinding: { corpus: 'x-1', role: 'opening' as const } };
  // validate should pass without error
  expect(() => validateAgentConfig('writer.opening', cfg)).not.toThrow();
});

it('back-compat: legacy {account, role} is auto-promoted on read', () => {
  // when config.json has { account: 'x', role: 'opening' }, store should emit { corpus: 'x-默认', role: 'opening' } to consumers
});
```

- [ ] **Step 2: Update `AgentStyleBinding` type**

```ts
// packages/web-server/src/services/agent-config-store.ts (replace existing type around line 29)
export interface AgentStyleBinding {
  corpus: string;        // corpus id (previously was account)
  role: StyleBindingRole;
}

// Internal legacy shape (only used during migration reads)
interface LegacyStyleBinding { account: string; role: StyleBindingRole }

export function normalizeStyleBinding(raw: unknown): AgentStyleBinding | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.role !== 'string') return undefined;
  const role = r.role as StyleBindingRole;
  if (typeof r.corpus === 'string') return { corpus: r.corpus, role };
  if (typeof r.account === 'string') return { corpus: `${r.account}-默认`, role };
  return undefined;
}
```

Update `validate()` / read paths to run `normalizeStyleBinding` on load.

- [ ] **Step 3: Update `StylePanelStore` to key by corpus_id**

Modify `packages/web-server/src/services/style-panel-store.ts`:
- Rename method parameters: `account` → `corpusId`
- Path changes: `08_experts/style-panel/<corpus>/<role>-v<version>.md`
- Keep method name `getLatestActive(corpusId, role)` (signature unchanged, semantics updated)

- [ ] **Step 4: Update resolver**

```ts
// packages/web-server/src/services/style-binding-resolver.ts — replace binding shape reads
// Replace `binding.account` → `binding.corpus` throughout
// resolver call: store.getLatestActive(binding.corpus, binding.role)
```

- [ ] **Step 5: Fix downstream type errors + tests**

Run: `cd packages/web-server && pnpm exec tsc --noEmit 2>&1 | head -40`
Fix each `account` → `corpus` reference that typechecks now expects.

Run affected tests:
```bash
cd packages/web-server && pnpm exec vitest run tests/writer-orchestrator-style-binding.test.ts tests/agent-config-store.test.ts
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(style-binding): migrate to (corpus, role) with legacy {account, role} back-compat"
```

---

## Task 7: Distillation orchestrator accepts `corpus`

**Files:**
- Modify: `packages/kb/src/style-distiller/types.ts`
- Modify: `packages/kb/src/style-distiller/orchestrator.ts`
- Modify: `packages/kb/src/style-distiller/orchestrator-v2.ts`
- Modify: `packages/kb/tests/style-distiller/*` (fixtures updated)

Add a new entry mode to `DistillOptions`:
```ts
export interface DistillOptions {
  // Existing (keep for backward compat):
  account?: string;
  sampleSize?: number;
  since?: string;
  until?: string;
  // NEW: corpus mode
  corpusId?: string;       // when set, draws articles from corpus index instead of account
  manualSelection?: boolean; // when true, skip quant step (too few articles for stats)
  // ... rest unchanged
}
```

- [ ] **Step 1: Write failing test — corpus mode**

```ts
// packages/kb/tests/style-distiller/corpus-mode.test.ts
import { describe, it, expect } from 'vitest';
import { runDistill } from '../../src/style-distiller/orchestrator.js';
// (use existing fixture factory to set up vault + sqlite + corpus with 3 articles)

describe('distill via corpus', () => {
  it('draws articles from corpus_id instead of account date range', async () => {
    // seed: corpus "c1" contains 3 article_ids from account "A"
    // run: runDistill({ corpusId: 'c1', manualSelection: true, onlyStep: 'structure' })
    // assert: structure step received exactly those 3 articles as deep-read sample
  });

  it('skips quant step when manualSelection=true', async () => {
    // when manualSelection is true AND articles count < 20, orchestrator skips quant
    // assert: result.steps_run does not include 'quant'
  });
});
```

- [ ] **Step 2: Run, verify fail**

- [ ] **Step 3: Implement corpus article loading**

Add helper to `packages/kb/src/style-distiller/loaders.ts` (new file):
```ts
// packages/kb/src/style-distiller/loaders.ts
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ArticleSample } from './types.js';

export function loadArticlesByCorpus(sqlitePath: string, corpusId: string, vaultPath: string): ArticleSample[] {
  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(`
      SELECT ra.id, ra.account, ra.title, ra.published_at, ra.word_count, ra.md_path
      FROM ref_articles ra
      JOIN style_corpus_articles sca ON sca.account = ra.account AND sca.article_id = ra.id
      WHERE sca.corpus_id = ?
      ORDER BY ra.published_at DESC
    `).all(corpusId) as Array<{
      id: string; account: string; title: string; published_at: string; word_count: number; md_path: string;
    }>;
    return rows.map(r => ({
      id: r.id, account: r.account, title: r.title,
      published_at: r.published_at, word_count: r.word_count,
      body_plain: readFileSync(join(vaultPath, r.md_path), 'utf-8'),
    }));
  } finally { db.close(); }
}
```

Then in `orchestrator.ts` around the existing "load articles by account + date range" block:
```ts
import { loadArticlesByCorpus } from './loaders.js';

// Replace the article-loading branch:
let articles: ArticleSample[];
if (options.corpusId) {
  articles = loadArticlesByCorpus(ctx.sqlitePath, options.corpusId, ctx.vaultPath);
  if (articles.length === 0) throw new Error(`corpus ${options.corpusId} has no articles`);
} else if (options.account) {
  // existing loadArticlesByAccount(...) call unchanged
} else {
  throw new Error('distill requires either corpusId or account');
}

// Skip quant in manual mode (stats are meaningless on <20 articles)
const skipQuant = options.manualSelection === true || articles.length < 20;
const stepsToRun: DistillStep[] = skipQuant
  ? ['structure', 'snippets', 'composer']
  : ['quant', 'structure', 'snippets', 'composer'];
```

Panel output path changes in both orchestrators: use `options.corpusId ?? options.account` as the directory key:
```ts
const panelKey = options.corpusId ?? options.account;
const panelDir = join(ctx.vaultPath, '08_experts/style-panel', panelKey);
```

- [ ] **Step 4: Update orchestrator-v2.ts symmetrically**

Similar branch in orchestrator-v2. Also change its output path: distilled files should go to `08_experts/style-panel/<corpusId>/<role>-v<n>.md` (was `<account>/<role>-v<n>.md`).

- [ ] **Step 5: Run all distiller tests**

Run: `cd packages/kb && pnpm exec vitest run tests/style-distiller/`
Expected: PASS (existing + new corpus tests)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(distill): accept corpusId as input, skip quant in manualSelection mode"
```

---

## Task 8: `search_style` tool — raw source

Queries raw article bodies scoped to `styleReferences` corpora.

**Files:**
- Create: `packages/kb/src/skills/search-style.ts`
- Create: `packages/kb/tests/skills/search-style.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/kb/tests/skills/search-style.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { searchStyle } from '../../src/skills/search-style.js';

let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE ref_articles (id TEXT PRIMARY KEY, account TEXT, title TEXT, body_plain TEXT DEFAULT '');
    CREATE VIRTUAL TABLE ref_articles_fts USING fts5(title, body_plain, content='ref_articles', content_rowid='rowid');
    CREATE TABLE style_corpus_articles (corpus_id TEXT, account TEXT, article_id TEXT, PRIMARY KEY(corpus_id, account, article_id));
  `);
  // seed
  db.prepare(`INSERT INTO ref_articles VALUES ('a1','A','Title A','过渡句：其实我觉得...很奇怪')`).run();
  db.prepare(`INSERT INTO ref_articles VALUES ('b1','B','Title B','无关内容')`).run();
  db.exec(`INSERT INTO ref_articles_fts(rowid, title, body_plain) SELECT rowid, title, body_plain FROM ref_articles`);
  db.prepare(`INSERT INTO style_corpus_articles VALUES ('c1','A','a1'), ('c1','B','b1')`).run();
});

describe('searchStyle raw source', () => {
  it('returns matched snippets filtered by corpus membership', () => {
    const hits = searchStyle({ query: '过渡', corpusIds: ['c1'], source: 'raw', limit: 5, db });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.account).toBe('A');
    expect(hits[0]?.article_id).toBe('a1');
    expect(hits[0]?.snippet).toContain('过渡句');
  });

  it('excludes corpus non-members', () => {
    const hits = searchStyle({ query: '过渡', corpusIds: ['nope'], source: 'raw', limit: 5, db });
    expect(hits).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run, verify fail**

- [ ] **Step 3: Implement**

```ts
// packages/kb/src/skills/search-style.ts
import type Database from 'better-sqlite3';

export interface StyleHit {
  source: 'raw' | 'snippets';
  corpus_id: string;
  account: string;
  article_id: string;
  title: string;
  snippet: string;
  score: number;
}

export interface SearchStyleOptions {
  query: string;
  corpusIds: string[];      // from agent's styleReferences
  source?: 'raw' | 'snippets' | 'all';
  limit?: number;
  db: Database.Database;
}

const SNIPPET_CHARS = 300;

export function searchStyle(opts: SearchStyleOptions): StyleHit[] {
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 10);
  const src = opts.source ?? 'all';
  const out: StyleHit[] = [];
  if (src === 'raw' || src === 'all') {
    out.push(...searchRaw(opts.db, opts.query, opts.corpusIds, limit));
  }
  // snippets implemented in next task
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

function searchRaw(db: Database.Database, query: string, corpusIds: string[], limit: number): StyleHit[] {
  if (corpusIds.length === 0) return [];
  const placeholders = corpusIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT ra.id as article_id, ra.account, ra.title, ra.body_plain, sca.corpus_id, rank as score
    FROM ref_articles_fts
    JOIN ref_articles ra ON ra.rowid = ref_articles_fts.rowid
    JOIN style_corpus_articles sca ON sca.account = ra.account AND sca.article_id = ra.id
    WHERE ref_articles_fts MATCH ? AND sca.corpus_id IN (${placeholders})
    ORDER BY rank LIMIT ?
  `).all(query, ...corpusIds, limit) as Array<{
    article_id: string; account: string; title: string; body_plain: string; corpus_id: string; score: number;
  }>;
  return rows.map(r => ({
    source: 'raw',
    corpus_id: r.corpus_id,
    account: r.account,
    article_id: r.article_id,
    title: r.title,
    snippet: extractSnippet(r.body_plain, query),
    score: -r.score,  // FTS rank lower = better, flip sign
  }));
}

function extractSnippet(body: string, query: string): string {
  const idx = body.indexOf(query);
  if (idx < 0) return body.slice(0, SNIPPET_CHARS);
  const start = Math.max(0, idx - 80);
  const end = Math.min(body.length, idx + SNIPPET_CHARS - 80);
  return (start > 0 ? '…' : '') + body.slice(start, end) + (end < body.length ? '…' : '');
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd packages/kb && pnpm exec vitest run tests/skills/search-style.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/kb/src/skills/search-style.ts packages/kb/tests/skills/search-style.test.ts
git commit -m "feat(search-style): raw FTS scoped to corpus membership"
```

---

## Task 9: `search_style` — snippets source (panel scan)

Scans distilled panel `snippets` sections for matches.

**Files:**
- Create: `packages/kb/src/skills/snippets-index.ts`
- Modify: `packages/kb/src/skills/search-style.ts`

- [ ] **Step 1: Write failing test — extend existing search-style.test.ts**

```ts
// Add to packages/kb/tests/skills/search-style.test.ts
it('returns snippet matches from distilled panels', () => {
  // seed a panel file under vault/08_experts/style-panel/c1/opening-v1.md
  // containing a "## snippets" section with one entry mentioning "过渡句"
  const hits = searchStyle({ query: '过渡', corpusIds: ['c1'], source: 'snippets', limit: 5, db, vaultPath: vault });
  expect(hits.some(h => h.source === 'snippets')).toBe(true);
});

it('merges raw + snippets with boost for snippets', () => {
  const hits = searchStyle({ query: '过渡', corpusIds: ['c1'], source: 'all', limit: 10, db, vaultPath: vault });
  const snippetHit = hits.find(h => h.source === 'snippets');
  const rawHit = hits.find(h => h.source === 'raw');
  if (snippetHit && rawHit) expect(snippetHit.score).toBeGreaterThan(rawHit.score);
});
```

- [ ] **Step 2: Implement snippets scanner**

```ts
// packages/kb/src/skills/snippets-index.ts
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface SnippetEntry {
  corpus_id: string;
  role: 'opening' | 'practice' | 'closing';
  text: string;
  mtime: number;
}

const SNIPPET_RE = /^## snippets\n([\s\S]*?)(?=^## |\z)/m;

export function loadSnippets(vaultPath: string, corpusIds: string[]): SnippetEntry[] {
  const base = join(vaultPath, '08_experts/style-panel');
  if (!existsSync(base)) return [];
  const out: SnippetEntry[] = [];
  for (const corpusId of corpusIds) {
    const dir = join(base, corpusId);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter(n => n.endsWith('.md'))) {
      const role = extractRole(f);
      if (!role) continue;
      const abs = join(dir, f);
      const text = readFileSync(abs, 'utf-8');
      const m = text.match(SNIPPET_RE);
      if (!m) continue;
      out.push({ corpus_id: corpusId, role, text: m[1]!.trim(), mtime: statSync(abs).mtimeMs });
    }
  }
  return out;
}

function extractRole(filename: string): SnippetEntry['role'] | null {
  if (filename.startsWith('opening-')) return 'opening';
  if (filename.startsWith('practice-')) return 'practice';
  if (filename.startsWith('closing-')) return 'closing';
  return null;
}
```

- [ ] **Step 3: Extend `searchStyle` to include snippets**

```ts
// Update packages/kb/src/skills/search-style.ts
import { loadSnippets } from './snippets-index.js';

export interface SearchStyleOptions {
  // ... existing fields ...
  vaultPath?: string;       // required if source includes 'snippets'
}

// Inside searchStyle(), after searchRaw:
if ((src === 'snippets' || src === 'all') && opts.vaultPath) {
  const snippets = loadSnippets(opts.vaultPath, opts.corpusIds);
  for (const s of snippets) {
    const idx = s.text.indexOf(opts.query);
    if (idx < 0) continue;
    out.push({
      source: 'snippets',
      corpus_id: s.corpus_id,
      account: '(snippet)',
      article_id: s.role,
      title: `${s.corpus_id}/${s.role}`,
      snippet: extractSnippet(s.text, opts.query),
      score: 1.0 + (idx < 200 ? 0.2 : 0),  // earlier = more relevant; always > raw max
    });
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `cd packages/kb && pnpm exec vitest run tests/skills/search-style.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(search-style): add snippets source scanning distilled panels"
```

---

## Task 10: Register `search_style` in dispatcher + tool protocol

**Files:**
- Modify: `packages/kb/src/skills/dispatcher.ts`
- Modify: `packages/agents/src/prompts/_tool-protocol.md`
- Modify: `packages/web-server/src/routes/writer.ts` (threading `styleReferences` + `vaultPath` + `db` into dispatcher)

- [ ] **Step 1: Add tool to dispatcher**

Modify `packages/kb/src/skills/dispatcher.ts` — add case for `search_style`:
```ts
// After existing search_wiki/search_raw cases
case 'search_style': {
  const query = parsed.args.query;
  const corpusIds = parsed.args.corpus
    ? [parsed.args.corpus]
    : ctx.styleReferences;  // default: all agent's references
  if (!ctx.db || !ctx.vaultPath) throw new Error('search_style requires db + vaultPath in ctx');
  const hits = searchStyle({
    query, corpusIds, source: parsed.args.source ?? 'all',
    limit: Number(parsed.args.limit ?? 5),
    db: ctx.db, vaultPath: ctx.vaultPath,
  });
  return { ok: true, tool: 'search_style', query, args: parsed.args, hits, hits_count: hits.length, formatted: formatStyleHits(hits) };
}
```

Extend `DispatchContext`:
```ts
export interface DispatchContext {
  // ... existing
  styleReferences?: string[];  // corpus ids agent can query
  db?: Database.Database;
}
```

- [ ] **Step 2: Update tool protocol prompt**

Rewrite `packages/agents/src/prompts/_tool-protocol.md` — add `search_style` section and the "铁律" trigger rules (see spec §4.3):

```markdown
## 可用工具

### search_wiki
<existing>

### search_raw
<existing>

### search_style
查找写作风格参考（其他账号怎么写类似段落）。

Syntax: `search_style "<query>" [--corpus=<id>] [--source=raw|snippets|all] [--limit=5]`

- `--source=snippets`: 只查已蒸馏的 snippets 小节（精选）
- `--source=raw`: 只查 corpus 内文章原文
- `--source=all`（默认）: 两者合并，snippets 优先

## 铁律（违反会被打回）

1. 写具体**数据/专名/人名/产品名** → 必须先 `search_wiki` 确认
2. 写**引用/对话/亲历描述** → 必须先 `search_raw` 核对原文
3. 过渡/金句/段落收尾卡壳 → 先 `search_style` 找范例
4. 每写 2-3 段后，反思一次"没查就写"之处，补查
```

- [ ] **Step 3: Wire in writer route**

In `packages/web-server/src/routes/writer.ts`, find the `dispatchSkill` call sites (there are ~2-3). Update the ctx object passed:
```ts
// Near the top of registerWriterRoutes, open a shared sqlite handle:
import Database from 'better-sqlite3';
const db = new Database(deps.sqlitePath, { readonly: true, fileMustExist: true });
app.addHook('onClose', async () => { db.close(); });

// When building dispatchSkill ctx for each call:
const agentCfg = mergeAgentConfig(...);
const dispatchCtx = {
  vaultPath: deps.vaultPath,
  sqlitePath: deps.sqlitePath,
  styleReferences: agentCfg.styleReferences ?? [],  // new field from AgentConfigEntry
  db,
};
```

Also extend `AgentConfigEntry` in `agent-config-store.ts`:
```ts
export interface AgentConfigEntry {
  agentKey: string;
  promptVersion?: string;
  styleBinding?: AgentStyleBinding;
  styleReferences?: string[];   // NEW: corpus ids agent's search_style can query
  tools?: AgentToolsConfig;
}
```

- [ ] **Step 4: Integration test**

```ts
// packages/web-server/tests/search-style-dispatch.test.ts
it('dispatchSkill routes search_style to correct corpus scope', async () => {
  // build agent config with styleReferences: ['c1']
  // call dispatchSkill with command 'search_style "foo"'
  // assert result.tool === 'search_style' and only c1 articles searched
});
```

- [ ] **Step 5: Run all affected tests**

Run: `pnpm -r --filter=./packages/kb --filter=./packages/web-server --filter=./packages/agents run test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(tool): register search_style in dispatcher, update tool-protocol prompt"
```

---

## Task 11: Round cap 5→12 + tool-protocol rewrite

**Files:**
- Modify: `packages/agents/src/writer-tool-runner.ts:126`

- [ ] **Step 1: Change constant**

```ts
// packages/agents/src/writer-tool-runner.ts — find maxRounds default
const maxRounds = opts.maxRounds ?? 12;  // was 5
```

- [ ] **Step 2: Update existing tests that assert round cap 5**

Grep for tests asserting `maxRounds === 5` and update to 12.

- [ ] **Step 3: Run affected tests**

Run: `cd packages/agents && pnpm exec vitest run tests/writer-tool-runner.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(writer): raise tool-runner round cap 5→12"
```

---

## Task 12: Floor gate — enforce minimum tool calls per role

If a role's minimum hasn't been met by the time agent emits final output, orchestrator sends back a synthetic user message listing what's missing, re-runs the agent. Max 3 gate retries before accepting whatever was produced (with warning).

**Files:**
- Create: `packages/agents/src/writer-tool-floors.ts`
- Modify: `packages/agents/src/writer-tool-runner.ts`
- Create: `packages/agents/tests/writer-tool-floors.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/agents/tests/writer-tool-floors.test.ts
import { describe, it, expect } from 'vitest';
import { computeFloorDelta, FLOOR_BY_ROLE } from '../src/writer-tool-floors.js';

describe('floor gate', () => {
  it('opening role requires 1 wiki + 1 raw + 1 style', () => {
    expect(FLOOR_BY_ROLE.opening).toEqual({ search_wiki: 1, search_raw: 1, search_style: 1 });
  });

  it('computeFloorDelta flags unmet tools', () => {
    const delta = computeFloorDelta('opening', { search_wiki: 1, search_raw: 0, search_style: 0 });
    expect(delta).toEqual({ search_raw: 1, search_style: 1 });
  });

  it('returns empty delta when all floors met', () => {
    const delta = computeFloorDelta('practice', { search_wiki: 2, search_raw: 3, search_style: 1 });
    expect(delta).toEqual({});
  });
});
```

- [ ] **Step 2: Run, verify fail**

- [ ] **Step 3: Implement floors module**

```ts
// packages/agents/src/writer-tool-floors.ts
export type WriterRole = 'opening' | 'practice' | 'closing';
export type ToolName = 'search_wiki' | 'search_raw' | 'search_style';

export const FLOOR_BY_ROLE: Record<WriterRole, Record<ToolName, number>> = {
  opening:  { search_wiki: 1, search_raw: 1, search_style: 1 },
  practice: { search_wiki: 1, search_raw: 2, search_style: 1 },
  closing:  { search_wiki: 1, search_raw: 1, search_style: 1 },
};

export function computeFloorDelta(
  role: WriterRole,
  actual: Partial<Record<ToolName, number>>,
): Partial<Record<ToolName, number>> {
  const floor = FLOOR_BY_ROLE[role];
  const delta: Partial<Record<ToolName, number>> = {};
  for (const [tool, min] of Object.entries(floor) as Array<[ToolName, number]>) {
    const have = actual[tool] ?? 0;
    if (have < min) delta[tool] = min - have;
  }
  return delta;
}

export function renderDeltaMessage(delta: Partial<Record<ToolName, number>>): string {
  const lines = Object.entries(delta).map(([tool, n]) => `- ${tool}: 还差 ${n} 次`);
  return `你还没达到本 role 的工具调用下限，请先补齐再交稿：\n${lines.join('\n')}\n\n补齐后直接继续写。`;
}
```

- [ ] **Step 4: Integrate gate into tool-runner**

In `writer-tool-runner.ts`, after the main round loop produces `finalText`, before returning:
```ts
import { computeFloorDelta, renderDeltaMessage, type WriterRole } from './writer-tool-floors.js';

// opts must include role: WriterRole
const actualCounts = toolsUsed.reduce((acc, t) => {
  acc[t.tool] = (acc[t.tool] ?? 0) + 1;
  return acc;
}, {} as Record<string, number>);

let gateRetries = 0;
while (gateRetries < 3) {
  const delta = computeFloorDelta(opts.role, actualCounts);
  if (Object.keys(delta).length === 0) break;
  // inject synthetic user message and continue round loop
  messages.push({ role: 'user', content: renderDeltaMessage(delta) });
  // re-invoke agent — this is a tight mini-loop that appends to toolsUsed
  const more = await runOneRound({ /* existing params */ });
  toolsUsed.push(...more.toolsUsed);
  finalText = more.finalText;
  for (const t of more.toolsUsed) actualCounts[t.tool] = (actualCounts[t.tool] ?? 0) + 1;
  gateRetries += 1;
}
```

- [ ] **Step 5: Thread `role` through writer routes**

In `packages/web-server/src/routes/writer.ts` where `runWriterBookend` / practice-stitcher are invoked, pass the role explicitly.

- [ ] **Step 6: Run all tests**

```bash
pnpm -r --filter=./packages/agents --filter=./packages/web-server run test
```
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(writer): enforce per-role tool call floors with up to 3 gate retries"
```

---

## Task 13: Frontend — corpus list page

**Files:**
- Create: `packages/web-ui/src/api/style-corpus-client.ts`
- Create: `packages/web-ui/src/pages/StyleCorpusPage.tsx`
- Modify: `packages/web-ui/src/App.tsx` (route)
- Modify: `packages/web-ui/src/components/layout/TopBar.tsx` (nav link)

- [ ] **Step 1: Create API client**

```ts
// packages/web-ui/src/api/style-corpus-client.ts
export interface CorpusArticleRef { account: string; ids?: string[]; all?: boolean }
export interface StyleCorpus {
  id: string;
  description?: string;
  created_at: string;
  articles: CorpusArticleRef[];
  notes?: string;
}

const BASE = '/api/kb/style-corpus';

export async function listCorpora(): Promise<StyleCorpus[]> {
  const r = await fetch(BASE);
  if (!r.ok) throw new Error(`list failed: ${r.status}`);
  return (await r.json()).corpora;
}

export async function getCorpus(id: string): Promise<StyleCorpus> {
  const r = await fetch(`${BASE}/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(`get failed: ${r.status}`);
  return (await r.json()).corpus;
}

export async function createCorpus(body: { id: string; description?: string; articles: CorpusArticleRef[] }): Promise<StyleCorpus> {
  const r = await fetch(BASE, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if (!r.ok) throw new Error((await r.json()).error ?? `create failed: ${r.status}`);
  return (await r.json()).corpus;
}

export async function deleteCorpus(id: string): Promise<void> {
  const r = await fetch(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`delete failed: ${r.status}`);
}
```

- [ ] **Step 2: Create page skeleton**

```tsx
// packages/web-ui/src/pages/StyleCorpusPage.tsx
import { useEffect, useState } from 'react';
import { listCorpora, deleteCorpus, type StyleCorpus } from '../api/style-corpus-client.js';
import { Button, PixelLoader } from '../components/ui';
import { useToast } from '../components/ui/ToastProvider';
import { CorpusBuilder } from '../components/style-corpus/CorpusBuilder';

export function StyleCorpusPage() {
  const [corpora, setCorpora] = useState<StyleCorpus[] | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const toast = useToast();

  async function reload() { setCorpora(await listCorpora()); }
  useEffect(() => { void reload(); }, []);

  if (!corpora) return <PixelLoader label="风格库载入中" />;

  return (
    <div data-testid="page-style-corpus" className="rounded border border-[var(--hair)] bg-[var(--bg-1)] overflow-hidden">
      <header className="flex items-center justify-between px-6 h-12 border-b border-[var(--hair)]">
        <h1 className="text-lg font-semibold text-[var(--heading)]">风格库</h1>
        <Button variant="primary" size="sm" onClick={() => setShowBuilder(true)}>＋ 新建 Corpus</Button>
      </header>
      <div className="p-6 grid grid-cols-2 gap-4">
        {corpora.map(c => (
          <article key={c.id} className="rounded bg-[var(--bg-2)] p-4">
            <h3 className="font-semibold">{c.id}</h3>
            {c.description && <p className="text-xs text-[var(--meta)] mt-1">{c.description}</p>}
            <div className="text-[10px] text-[var(--faint)] mt-2">
              {c.articles.map((a, i) => (
                <span key={i}>{a.account}{a.all ? ' 整账号' : ` ${a.ids?.length ?? 0} 篇`}{i < c.articles.length - 1 ? '、' : ''}</span>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => triggerDistill(c.id)}>蒸馏</Button>
              <Button size="sm" variant="danger" onClick={async () => {
                if (!confirm(`删除 corpus ${c.id}？`)) return;
                await deleteCorpus(c.id);
                toast.success('已删除');
                await reload();
              }}>删除</Button>
            </div>
          </article>
        ))}
      </div>
      {showBuilder && <CorpusBuilder onClose={() => { setShowBuilder(false); void reload(); }} />}
    </div>
  );
}

function triggerDistill(_corpusId: string) { /* filled in Task 15 */ }
```

- [ ] **Step 3: Wire route + nav**

In `App.tsx` replace `/style-panels` route target with `StyleCorpusPage`; in `TopBar.tsx` update the 风格 link label (keep `/style-panels` path for now to avoid breaking bookmarks — rename later if needed).

- [ ] **Step 4: Manual smoke test**

User starts dev server. Visit `/style-panels`. Expected: list of migrated corpora (one per old account named `<account>-默认`).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web-ui): StyleCorpusPage lists corpora with delete + distill triggers"
```

---

## Task 14: CorpusBuilder modal — reuses IngestTab article picker

**Files:**
- Create: `packages/web-ui/src/components/style-corpus/CorpusBuilder.tsx`
- Refactor: extract article-picker bits from `packages/web-ui/src/components/wiki/IngestTab.tsx` into a reusable `ArticlePicker` component (new file `packages/web-ui/src/components/wiki/ArticlePicker.tsx`)

- [ ] **Step 1: Extract `ArticlePicker`**

Look at existing `IngestTab.tsx`: it contains account grid + heatmap + article table + selection state. Pull the selection UI out into `ArticlePicker` which takes a callback `onSelectionChange(ArticleSelection[])` where `ArticleSelection = { account: string; articleIds: string[] } | { account: string; all: true }`.

`IngestTab.tsx` continues to use `ArticlePicker` internally + its "入库 N 篇" submit button.

Verify existing ingest flow still works:
```bash
cd packages/web-ui && pnpm exec vitest run tests/ingest-tab.test.tsx
```

- [ ] **Step 2: Write CorpusBuilder**

```tsx
// packages/web-ui/src/components/style-corpus/CorpusBuilder.tsx
import { useState } from 'react';
import { ArticlePicker, type ArticleSelection } from '../wiki/ArticlePicker';
import { createCorpus } from '../../api/style-corpus-client';
import { Button, Input, Textarea, Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter } from '../ui';
import { useToast } from '../ui/ToastProvider';

export function CorpusBuilder({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [id, setId] = useState('');
  const [description, setDescription] = useState('');
  const [selection, setSelection] = useState<ArticleSelection[]>([]);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function save() {
    setSaving(true);
    try {
      const articles = selection.map(s =>
        'all' in s && s.all ? { account: s.account, all: true } : { account: s.account, ids: s.articleIds }
      );
      await createCorpus({ id, description, articles });
      toast.success(`corpus ${id} 已创建`);
      onClose();
    } catch (err) {
      toast.error(`创建失败：${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>新建 Corpus — 步骤 {step}/2</DialogHeader>
        <DialogBody>
          {step === 1 ? (
            <div className="space-y-4">
              <Input label="Corpus ID" placeholder="例如 十字路口-001" value={id} onChange={e => setId(e.target.value)} />
              <Textarea label="描述 (可选)" value={description} onChange={e => setDescription(e.target.value)} />
            </div>
          ) : (
            <ArticlePicker onSelectionChange={setSelection} />
          )}
        </DialogBody>
        <DialogFooter>
          {step === 1 ? (
            <>
              <Button variant="secondary" onClick={onClose}>取消</Button>
              <Button disabled={!id.trim()} onClick={() => setStep(2)}>下一步</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setStep(1)}>上一步</Button>
              <Button disabled={selection.length === 0 || saving} onClick={save}>创建</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Manual smoke test**

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(web-ui): CorpusBuilder modal with extracted ArticlePicker component"
```

---

## Task 15: Distill trigger from corpus card + finishing touches

**Files:**
- Modify: `packages/web-ui/src/pages/StyleCorpusPage.tsx` (wire trigger button)
- Modify: `packages/web-server/src/routes/config-style-panels-distill.ts` (accept `corpus_id` as input)
- Modify: `packages/web-ui/src/api/style-corpus-client.ts` (add `distillCorpus` SSE client)

- [ ] **Step 1: Backend accepts corpus_id**

In `config-style-panels-distill.ts`, extend `DistillBody`:
```ts
interface DistillBody {
  corpus_id?: string;      // NEW primary input
  account?: string;        // legacy, only used if corpus_id not given
  role?: 'opening' | 'practice' | 'closing';
  limit?: number;
  manual_selection?: boolean;
}
```

Validate: at least one of `corpus_id` / `account` must be set. Pass `corpus_id` through to `runDistillV2` / `runDistill`.

- [ ] **Step 2: Frontend distill client**

Add to `packages/web-ui/src/api/style-corpus-client.ts`:
```ts
export interface DistillEvent { type: string; data?: Record<string, unknown>; error?: string }

export function distillCorpus(corpusId: string, roles: Array<'opening' | 'practice' | 'closing'> = ['opening', 'practice', 'closing']) {
  let listener: ((e: DistillEvent) => void) | null = null;
  void (async () => {
    try {
      const r = await fetch('/api/config/style-panels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ corpus_id: corpusId, roles }),
      });
      if (!r.ok || !r.body) { listener?.({ type: 'distill.failed', error: `HTTP ${r.status}` }); return; }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split('\n\n');
        buf = frames.pop() ?? '';
        for (const f of frames) {
          const type = f.match(/^event: (.+)/m)?.[1] ?? '';
          const dataLine = f.match(/^data: (.+)$/m)?.[1];
          const data = dataLine ? JSON.parse(dataLine) : undefined;
          listener?.({ type, data });
        }
      }
    } catch (err) { listener?.({ type: 'distill.failed', error: String(err) }); }
  })();
  return { onEvent: (cb: (e: DistillEvent) => void) => { listener = cb; } };
}
```

- [ ] **Step 3: Wire `triggerDistill` in StyleCorpusPage**

Replace stub:
```ts
async function triggerDistill(corpusId: string) {
  // open a small modal with SSE progress stream (reuse ProgressView)
}
```

- [ ] **Step 4: e2e smoke**

User triggers distill on a migrated corpus, verifies panel file appears at `<corpus_id>/opening-v1.md` etc.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web-ui): trigger distill per corpus from the style library grid"
```

---

## After-Plan Verification

Full test pass:
```bash
cd /Users/zeoooo/crossing-writer
pnpm -r run test 2>&1 | tail -20
pnpm -r exec tsc --noEmit 2>&1 | tail -20
```

Manual e2e:
1. Start dev server (user does it)
2. Visit `/style-panels` → corpora grid
3. 新建 Corpus (id: `测试-精选`, 从 2 个账号各选 5 篇)
4. 蒸馏该 corpus → 3 个 panel 落盘
5. 回到项目，设 writer.opening styleBinding = `测试-精选/opening` + styleReferences = [`测试-精选`]
6. 跑一篇稿 → 日志里能看到 `search_style` 至少被调 1 次，工具调用次数达到 opening/practice/closing 的 3/4/3 下限

## Self-review checklist
- [x] spec §1 styleCorpus → T1-T3
- [x] spec §2 agent config → T6
- [x] spec §3 search_style → T8-T10
- [x] spec §4 tool intensity floors → T11-T12
- [x] spec §5 UI改动 → T13-T15
- [x] spec §6 migration → T4, wired in T5
- [x] spec §7 file改动清单 → covered across all tasks
- [x] spec §8 testing → unit tests in each task, e2e smoke post-plan
