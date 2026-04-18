# Raw Source Acquisition — Source Abstraction + Fetch Console

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `source_kind` dimension (wechat / x / web) to the raw article system, a YAML-file-driven source list, and a new 「原素材获取」console on the knowledge base page. Produces working software end-to-end for wechat (dispatched into existing `tools/bulk_import`); X and web crawlers are stubs that emit success events until follow-up sub-projects implement them.

**Architecture:** `ref_articles` gets a `source_kind` column. `~/CrossingVault/sources.yaml` becomes the single source of truth for monitored handles/sites/accounts, with a matching HTTP GET/PUT pair. Fetch triggers go through a new `crossing-kb scrape` CLI dispatcher that emits NDJSON to stdout; a new `/api/kb/scrape` SSE route spawns that CLI and streams events. A `SourceFetchFab` mounts on `KnowledgePage` mirroring the visual shell of `IngestConsoleFab`. The existing `IngestTab` gains a `公众号 / X / 外网` segment that filters its account sidebar/grid/heatmap by source kind.

**Tech Stack:** TypeScript, Fastify, commander.js (CLI), better-sqlite3, React 18, vitest, @testing-library/react, js-yaml.

**Spec:** `docs/superpowers/specs/2026-04-18-raw-source-acquisition-design.md`

---

## T1 — DB migration: add `source_kind` column

**Files:**
- Modify: `packages/kb/src/db.ts` (add migration)
- Test: `packages/kb/tests/migrations-source-kind.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing test.**

Create `packages/kb/tests/migrations-source-kind.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { ensureMigrations } from "../src/db.js";

describe("source_kind migration", () => {
  it("adds source_kind column with default 'wechat' to existing ref_articles rows", () => {
    const db = new Database(":memory:");
    // Start with a pre-migration schema containing one row.
    db.exec(`
      CREATE TABLE ref_articles (
        id TEXT PRIMARY KEY,
        account TEXT NOT NULL,
        title TEXT NOT NULL,
        published_at TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        md_path TEXT NOT NULL,
        html_path TEXT NOT NULL,
        body_plain TEXT NOT NULL DEFAULT '',
        body_segmented TEXT NOT NULL DEFAULT '',
        ingest_status TEXT NOT NULL DEFAULT 'raw',
        imported_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    db.prepare(
      "INSERT INTO ref_articles (id,account,title,published_at,url,md_path,html_path,imported_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run("a1", "量子位", "t", "2026-01-01", "http://x", "a.md", "a.html", "2026-01-01", "2026-01-01");

    ensureMigrations(db);

    const row = db.prepare("SELECT source_kind FROM ref_articles WHERE id = ?").get("a1") as { source_kind: string };
    expect(row.source_kind).toBe("wechat");

    const idx = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_refs_source_kind'",
    ).get();
    expect(idx).toBeTruthy();
  });

  it("is idempotent (second run is a no-op)", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE ref_articles (
        id TEXT PRIMARY KEY,
        account TEXT NOT NULL,
        title TEXT NOT NULL,
        published_at TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        md_path TEXT NOT NULL,
        html_path TEXT NOT NULL,
        body_plain TEXT NOT NULL DEFAULT '',
        body_segmented TEXT NOT NULL DEFAULT '',
        ingest_status TEXT NOT NULL DEFAULT 'raw',
        imported_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    ensureMigrations(db);
    expect(() => ensureMigrations(db)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test. Expected: FAIL** (`source_kind` column doesn't exist).

```bash
pnpm --filter @crossing/kb vitest run tests/migrations-source-kind.test.ts
```

- [ ] **Step 3: Add the migration to `packages/kb/src/db.ts`.**

Find the existing `ensureMigrations(db: Database)` function (search for "CREATE TABLE IF NOT EXISTS ref_articles" — it lives there). Add after the existing schema creation:

```ts
// 2026-04-18: add source_kind column for wechat / x / web raw sources
const hasSourceKind = db.prepare(
  "SELECT 1 FROM pragma_table_info('ref_articles') WHERE name='source_kind'",
).get();
if (!hasSourceKind) {
  db.exec(`
    ALTER TABLE ref_articles ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'wechat';
    CREATE INDEX IF NOT EXISTS idx_refs_source_kind ON ref_articles(source_kind);
  `);
}
```

- [ ] **Step 4: Re-run the test. Expected: PASS.**

- [ ] **Step 5: Commit.**

```bash
git add packages/kb/src/db.ts packages/kb/tests/migrations-source-kind.test.ts
git commit -m "feat(kb): add source_kind column to ref_articles"
```

---

## T2 — `sources.yaml` read/write helper

**Files:**
- Create: `packages/kb/src/sources/sources-yaml.ts`
- Create: `packages/kb/tests/sources/sources-yaml.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readSources, writeSources, type SourcesFile } from "../../src/sources/sources-yaml.js";

let dir: string;
let yamlPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sources-yaml-"));
  yamlPath = join(dir, "sources.yaml");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("readSources", () => {
  it("returns empty defaults when file missing", () => {
    const s = readSources(yamlPath);
    expect(s).toEqual({ version: 1, wechat: [], x: [], web: [] });
  });

  it("parses an existing yaml file", () => {
    const content = [
      "version: 1",
      "wechat:",
      "  - 量子位",
      "x:",
      "  - handle: sama",
      "    note: OpenAI CEO",
      "web:",
      "  - name: Anthropic Blog",
      "    url: https://www.anthropic.com/news",
      "    rss: https://www.anthropic.com/rss.xml",
    ].join("\n");
    require("node:fs").writeFileSync(yamlPath, content, "utf-8");

    const s = readSources(yamlPath);
    expect(s.version).toBe(1);
    expect(s.wechat).toEqual(["量子位"]);
    expect(s.x).toEqual([{ handle: "sama", note: "OpenAI CEO" }]);
    expect(s.web[0]?.name).toBe("Anthropic Blog");
  });
});

describe("writeSources", () => {
  it("writes valid yaml round-trippable by readSources", () => {
    const input: SourcesFile = {
      version: 1,
      wechat: ["量子位", "新智元"],
      x: [{ handle: "sama" }, { handle: "karpathy", note: "前 OpenAI" }],
      web: [{ name: "Simon Willison", url: "https://simonwillison.net", rss: "https://simonwillison.net/atom/everything/" }],
    };
    writeSources(yamlPath, input);
    expect(existsSync(yamlPath)).toBe(true);
    const back = readSources(yamlPath);
    expect(back).toEqual(input);
  });

  it("writes atomically via temp file + rename", () => {
    writeSources(yamlPath, { version: 1, wechat: [], x: [], web: [] });
    const content = readFileSync(yamlPath, "utf-8");
    expect(content).toContain("version: 1");
  });
});
```

- [ ] **Step 2: Run. Expected: FAIL** (module doesn't exist).

```bash
pnpm --filter @crossing/kb vitest run tests/sources/sources-yaml.test.ts
```

- [ ] **Step 3: Create the helper.**

`packages/kb/src/sources/sources-yaml.ts`:
```ts
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import YAML from "js-yaml";

export interface XSource { handle: string; note?: string }
export interface WebSource { name: string; url: string; rss?: string }
export interface SourcesFile {
  version: 1;
  wechat: string[];
  x: XSource[];
  web: WebSource[];
}

export function readSources(path: string): SourcesFile {
  if (!existsSync(path)) return { version: 1, wechat: [], x: [], web: [] };
  const raw = readFileSync(path, "utf-8");
  const parsed = (YAML.load(raw) as Partial<SourcesFile> | null) ?? {};
  return {
    version: 1,
    wechat: Array.isArray(parsed.wechat) ? parsed.wechat.filter((v): v is string => typeof v === "string") : [],
    x: Array.isArray(parsed.x) ? parsed.x.filter((v): v is XSource => !!v && typeof v.handle === "string") : [],
    web: Array.isArray(parsed.web) ? parsed.web.filter((v): v is WebSource => !!v && typeof v.name === "string" && typeof v.url === "string") : [],
  };
}

export function writeSources(path: string, data: SourcesFile): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  const yaml = YAML.dump(data, { noRefs: true, indent: 2, lineWidth: 120 });
  writeFileSync(tmp, yaml, "utf-8");
  renameSync(tmp, path);
}
```

Add `js-yaml` to kb package if missing:
```bash
pnpm --filter @crossing/kb add js-yaml
pnpm --filter @crossing/kb add -D @types/js-yaml
```

- [ ] **Step 4: Run. Expected: PASS (4 tests).**

- [ ] **Step 5: Commit.**

```bash
git add packages/kb/src/sources/sources-yaml.ts packages/kb/tests/sources/sources-yaml.test.ts packages/kb/package.json pnpm-lock.yaml
git commit -m "feat(kb): sources.yaml read/write with atomic rename"
```

---

## T3 — Fetch-cursor read/write helper

**Files:**
- Create: `packages/kb/src/sources/fetch-cursor.ts`
- Create: `packages/kb/tests/sources/fetch-cursor.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readCursor, updateCursor, type FetchCursor } from "../../src/sources/fetch-cursor.js";

let dir: string;
let cursorPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fetch-cursor-"));
  cursorPath = join(dir, "fetch-cursor.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("fetch-cursor", () => {
  it("returns empty cursor when file missing", () => {
    const c = readCursor(cursorPath);
    expect(c).toEqual({ version: 1, wechat: {}, x: {}, web: {} });
  });

  it("updates a single source atomically", () => {
    updateCursor(cursorPath, "x", "sama", { since_id: "1234", last_fetched_at: "2026-04-18T03:00:00Z" });
    const c = readCursor(cursorPath);
    expect(c.x.sama).toEqual({ since_id: "1234", last_fetched_at: "2026-04-18T03:00:00Z" });
  });

  it("preserves unrelated entries on update", () => {
    updateCursor(cursorPath, "x", "sama", { since_id: "1234", last_fetched_at: "2026-04-18T03:00:00Z" });
    updateCursor(cursorPath, "x", "karpathy", { since_id: "5678", last_fetched_at: "2026-04-18T03:05:00Z" });
    const c = readCursor(cursorPath);
    expect(c.x.sama?.since_id).toBe("1234");
    expect(c.x.karpathy?.since_id).toBe("5678");
  });

  it("merges web source keyed by site slug", () => {
    updateCursor(cursorPath, "web", "anthropic-blog", { last_guid: "abc", last_fetched_at: "2026-04-18T03:00:00Z" });
    const c = readCursor(cursorPath);
    expect(c.web["anthropic-blog"]?.last_guid).toBe("abc");
  });
});
```

- [ ] **Step 2: Run. Expected: FAIL.**

```bash
pnpm --filter @crossing/kb vitest run tests/sources/fetch-cursor.test.ts
```

- [ ] **Step 3: Create the helper.**

`packages/kb/src/sources/fetch-cursor.ts`:
```ts
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface XCursorEntry { since_id: string; last_fetched_at: string }
export interface WebCursorEntry { last_guid?: string; last_url_hash?: string; last_fetched_at: string }
export interface WechatCursorEntry { last_fetched_at: string }

export interface FetchCursor {
  version: 1;
  wechat: Record<string, WechatCursorEntry>;
  x: Record<string, XCursorEntry>;
  web: Record<string, WebCursorEntry>;
}

type CursorKind = "wechat" | "x" | "web";
type EntryFor<K extends CursorKind> =
  K extends "wechat" ? WechatCursorEntry :
  K extends "x" ? XCursorEntry :
  WebCursorEntry;

function empty(): FetchCursor {
  return { version: 1, wechat: {}, x: {}, web: {} };
}

export function readCursor(path: string): FetchCursor {
  if (!existsSync(path)) return empty();
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<FetchCursor>;
    return {
      version: 1,
      wechat: parsed.wechat ?? {},
      x: parsed.x ?? {},
      web: parsed.web ?? {},
    };
  } catch {
    return empty();
  }
}

export function updateCursor<K extends CursorKind>(
  path: string,
  kind: K,
  key: string,
  entry: EntryFor<K>,
): void {
  const cursor = readCursor(path);
  (cursor[kind] as Record<string, EntryFor<K>>)[key] = entry;
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(cursor, null, 2), "utf-8");
  renameSync(tmp, path);
}
```

- [ ] **Step 4: Run. Expected: PASS (4 tests).**

- [ ] **Step 5: Commit.**

```bash
git add packages/kb/src/sources/fetch-cursor.ts packages/kb/tests/sources/fetch-cursor.test.ts
git commit -m "feat(kb): fetch-cursor.json read + per-key atomic update"
```

---

## T4 — CLI `scrape` dispatcher + stubs

**Files:**
- Modify: `packages/kb/src/cli.ts`
- Create: `packages/kb/src/sources/scrape-dispatcher.ts`
- Create: `packages/kb/tests/sources/scrape-dispatcher.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect } from "vitest";
import { dispatchScrape, type ScrapeEvent } from "../../src/sources/scrape-dispatcher.js";

describe("scrape-dispatcher", () => {
  it("emits stub completion events for x when feature not implemented", async () => {
    const events: ScrapeEvent[] = [];
    await dispatchScrape(
      { source: "x", selectors: ["sama"] },
      { cwd: "/tmp" },
      (ev) => events.push(ev),
    );
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("scrape_started");
    expect(types).toContain("scrape_stub");
    expect(types[types.length - 1]).toBe("scrape_completed");
  });

  it("emits stub events for web too", async () => {
    const events: ScrapeEvent[] = [];
    await dispatchScrape(
      { source: "web", selectors: ["anthropic-blog"] },
      { cwd: "/tmp" },
      (ev) => events.push(ev),
    );
    expect(events.map((e) => e.type)).toContain("scrape_stub");
  });

  it("wraps each selector in its own started/completed pair for x", async () => {
    const events: ScrapeEvent[] = [];
    await dispatchScrape(
      { source: "x", selectors: ["sama", "karpathy"] },
      { cwd: "/tmp" },
      (ev) => events.push(ev),
    );
    const startedHandles = events.filter((e) => e.type === "scrape_started").map((e) => e.handle);
    expect(startedHandles).toEqual(["sama", "karpathy"]);
  });
});
```

- [ ] **Step 2: Run. Expected: FAIL.**

```bash
pnpm --filter @crossing/kb vitest run tests/sources/scrape-dispatcher.test.ts
```

- [ ] **Step 3: Implement the dispatcher.**

`packages/kb/src/sources/scrape-dispatcher.ts`:
```ts
export type ScrapeSource = "wechat" | "x" | "web";

export interface ScrapeArgs {
  source: ScrapeSource;
  selectors?: string[];  // handles / site slugs / account names; undefined = all (caller resolves)
}

export interface ScrapeContext {
  cwd: string;  // vault path
}

export type ScrapeEvent =
  | { type: "scrape_started"; source: ScrapeSource; handle?: string }
  | { type: "article_fetched"; source: ScrapeSource; handle?: string; article_id: string; title: string }
  | { type: "article_skipped"; source: ScrapeSource; handle?: string; reason: string; article_id?: string }
  | { type: "scrape_failed"; source: ScrapeSource; handle?: string; error: string }
  | { type: "scrape_stub"; source: ScrapeSource; handle?: string; message: string }
  | { type: "scrape_completed"; source: ScrapeSource; handle?: string; stats: { fetched: number; skipped: number } };

export type ScrapeEmitter = (ev: ScrapeEvent) => void;

export async function dispatchScrape(
  args: ScrapeArgs,
  ctx: ScrapeContext,
  emit: ScrapeEmitter,
): Promise<void> {
  const selectors = args.selectors ?? [];
  if (args.source === "wechat") {
    // TODO in a follow-up: call tools/bulk_import. For now stub-success.
    for (const acc of selectors) {
      emit({ type: "scrape_started", source: "wechat", handle: acc });
      emit({ type: "scrape_stub", source: "wechat", handle: acc,
             message: "wechat dispatch to tools/bulk_import not yet wired" });
      emit({ type: "scrape_completed", source: "wechat", handle: acc, stats: { fetched: 0, skipped: 0 } });
    }
    return;
  }
  if (args.source === "x") {
    for (const handle of selectors) {
      emit({ type: "scrape_started", source: "x", handle });
      emit({ type: "scrape_stub", source: "x", handle,
             message: "x scraper implementation is in sub-project 2" });
      emit({ type: "scrape_completed", source: "x", handle, stats: { fetched: 0, skipped: 0 } });
    }
    return;
  }
  if (args.source === "web") {
    for (const site of selectors) {
      emit({ type: "scrape_started", source: "web", handle: site });
      emit({ type: "scrape_stub", source: "web", handle: site,
             message: "web scraper implementation is in sub-project 3" });
      emit({ type: "scrape_completed", source: "web", handle: site, stats: { fetched: 0, skipped: 0 } });
    }
    return;
  }
}
```

- [ ] **Step 4: Wire it into the CLI.**

In `packages/kb/src/cli.ts`, inside `buildCli()`, add near the end (after existing `wiki` subcommand block):

```ts
program.command("scrape")
  .description("fetch raw articles from wechat/x/web sources and store to ref_articles")
  .requiredOption("--source <kind>", "wechat | x | web")
  .option("--selectors <csv>", "comma-separated handles/sites/accounts; empty = all from sources.yaml")
  .option("-c, --config <path>", "config.json path", "config.json")
  .action(async (opts: { source: string; selectors?: string; config: string }) => {
    const { loadConfig } = await import("./db.js");
    const cfg = loadConfig(opts.config);
    const { readSources } = await import("./sources/sources-yaml.js");
    const { dispatchScrape } = await import("./sources/scrape-dispatcher.js");
    const source = opts.source as "wechat" | "x" | "web";
    if (!["wechat", "x", "web"].includes(source)) {
      process.stderr.write(`invalid --source: ${opts.source}\n`); process.exit(1);
    }
    const yamlPath = `${cfg.vaultPath}/sources.yaml`;
    const sources = readSources(yamlPath);
    let selectors: string[];
    if (opts.selectors) {
      selectors = opts.selectors.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (source === "wechat") {
      selectors = sources.wechat;
    } else if (source === "x") {
      selectors = sources.x.map((s) => s.handle);
    } else {
      selectors = sources.web.map((s) => s.name);
    }
    await dispatchScrape({ source, selectors }, { cwd: cfg.vaultPath }, (ev) => {
      process.stdout.write(JSON.stringify(ev) + "\n");
    });
  });
```

- [ ] **Step 5: Run dispatcher tests. Expected: PASS (3 tests).**

```bash
pnpm --filter @crossing/kb vitest run tests/sources/scrape-dispatcher.test.ts
```

- [ ] **Step 6: Smoke-test the CLI produces NDJSON.**

```bash
node --import tsx packages/kb/src/cli.ts scrape --source x --selectors sama,karpathy
```

Expected: 6 lines of NDJSON (3 events × 2 handles), each a valid JSON object.

- [ ] **Step 7: Commit.**

```bash
git add packages/kb/src/sources/scrape-dispatcher.ts \
        packages/kb/tests/sources/scrape-dispatcher.test.ts \
        packages/kb/src/cli.ts
git commit -m "feat(kb): scrape CLI dispatcher with wechat/x/web stubs"
```

---

## T5 — `/api/kb/sources` GET/PUT route

**Files:**
- Create: `packages/web-server/src/routes/kb-sources.ts`
- Create: `packages/web-server/tests/routes-kb-sources.test.ts`
- Modify: `packages/web-server/src/server.ts` (register route)

**Steps:**

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import { registerKbSourcesRoutes } from "../src/routes/kb-sources.js";

let dir: string;
let vaultPath: string;
let app: ReturnType<typeof Fastify>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kb-sources-"));
  vaultPath = dir;
  app = Fastify();
  registerKbSourcesRoutes(app, { vaultPath });
});
afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

describe("kb-sources routes", () => {
  it("GET returns empty defaults when no file", async () => {
    const res = await app.inject({ method: "GET", url: "/api/kb/sources" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ version: 1, wechat: [], x: [], web: [] });
  });

  it("PUT writes yaml and GET round-trips", async () => {
    const body = {
      version: 1,
      wechat: ["量子位"],
      x: [{ handle: "sama", note: "OpenAI CEO" }],
      web: [{ name: "Anthropic Blog", url: "https://www.anthropic.com/news", rss: "https://www.anthropic.com/rss.xml" }],
    };
    const put = await app.inject({ method: "PUT", url: "/api/kb/sources", payload: body });
    expect(put.statusCode).toBe(200);
    expect(existsSync(join(vaultPath, "sources.yaml"))).toBe(true);

    const get = await app.inject({ method: "GET", url: "/api/kb/sources" });
    expect(get.json()).toEqual(body);
  });

  it("PUT rejects malformed payload", async () => {
    const res = await app.inject({ method: "PUT", url: "/api/kb/sources", payload: { wechat: "not an array" } });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run. Expected: FAIL.**

```bash
pnpm --filter @crossing/web-server vitest run tests/routes-kb-sources.test.ts
```

- [ ] **Step 3: Create the route.**

`packages/web-server/src/routes/kb-sources.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { join } from "node:path";
import { readSources, writeSources, type SourcesFile } from "@crossing/kb";

export interface KbSourcesDeps {
  vaultPath: string;
}

function validate(body: unknown): body is SourcesFile {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.wechat)) return false;
  if (!Array.isArray(b.x)) return false;
  if (!Array.isArray(b.web)) return false;
  if (!b.wechat.every((v) => typeof v === "string")) return false;
  if (!b.x.every((v) => !!v && typeof v === "object" && typeof (v as { handle?: unknown }).handle === "string")) return false;
  if (!b.web.every((v) => !!v && typeof v === "object" &&
        typeof (v as { name?: unknown }).name === "string" &&
        typeof (v as { url?: unknown }).url === "string")) return false;
  return true;
}

export function registerKbSourcesRoutes(app: FastifyInstance, deps: KbSourcesDeps) {
  const yamlPath = () => join(deps.vaultPath, "sources.yaml");

  app.get("/api/kb/sources", async (_req, reply) => {
    return reply.send(readSources(yamlPath()));
  });

  app.put("/api/kb/sources", async (req, reply) => {
    if (!validate(req.body)) {
      return reply.code(400).send({ error: "invalid sources payload" });
    }
    const payload: SourcesFile = { version: 1, ...req.body };
    writeSources(yamlPath(), payload);
    return reply.send({ ok: true });
  });
}
```

Make sure `SourcesFile`, `readSources`, `writeSources` are exported from `packages/kb/src/index.ts`:
```ts
export { readSources, writeSources, type SourcesFile, type XSource, type WebSource } from "./sources/sources-yaml.js";
```

- [ ] **Step 4: Register the route in `packages/web-server/src/server.ts`.**

Add import near the other route imports:
```ts
import { registerKbSourcesRoutes } from "./routes/kb-sources.js";
```

Add inside `buildServer()` after the other `registerKbXxxRoutes` calls:
```ts
registerKbSourcesRoutes(app, { vaultPath: configStore.current.vaultPath });
```

- [ ] **Step 5: Build agents/kb packages so the symlink resolves the new exports.**

```bash
pnpm --filter @crossing/kb build
```

- [ ] **Step 6: Run the test. Expected: PASS (3 tests).**

```bash
pnpm --filter @crossing/web-server vitest run tests/routes-kb-sources.test.ts
```

- [ ] **Step 7: Commit.**

```bash
git add packages/web-server/src/routes/kb-sources.ts \
        packages/web-server/tests/routes-kb-sources.test.ts \
        packages/web-server/src/server.ts \
        packages/kb/src/index.ts \
        packages/kb/dist/
git commit -m "feat(web-server): GET/PUT /api/kb/sources yaml r/w"
```

---

## T6 — `/api/kb/scrape` SSE route

**Files:**
- Create: `packages/web-server/src/routes/kb-scrape.ts`
- Create: `packages/web-server/tests/routes-kb-scrape.test.ts`
- Modify: `packages/web-server/src/server.ts` (register route)

**Steps:**

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import { registerKbScrapeRoutes } from "../src/routes/kb-scrape.js";

let app: ReturnType<typeof Fastify>;
beforeEach(() => {
  app = Fastify();
  // Use a no-op CLI spawner that emits three events and exits 0.
  registerKbScrapeRoutes(app, {
    vaultPath: "/tmp",
    spawnScrapeCli: (_args, onLine, onExit) => {
      setImmediate(() => {
        onLine(JSON.stringify({ type: "scrape_started", source: "x", handle: "sama" }));
        onLine(JSON.stringify({ type: "scrape_completed", source: "x", handle: "sama",
                                stats: { fetched: 0, skipped: 0 } }));
        onExit(0);
      });
      return () => {};
    },
  });
});
afterEach(async () => { await app.close(); });

describe("kb-scrape SSE", () => {
  it("streams NDJSON events as SSE", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/kb/scrape",
      payload: { source: "x", selectors: ["sama"] },
      headers: { accept: "text/event-stream" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.body).toContain("event: scrape.scrape_started");
    expect(res.body).toContain("event: scrape.scrape_completed");
    expect(res.body).toContain("\"handle\":\"sama\"");
  });

  it("400s when source missing", async () => {
    const res = await app.inject({ method: "POST", url: "/api/kb/scrape", payload: {} });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run. Expected: FAIL.**

```bash
pnpm --filter @crossing/web-server vitest run tests/routes-kb-scrape.test.ts
```

- [ ] **Step 3: Create the route.**

`packages/web-server/src/routes/kb-scrape.ts`:
```ts
import type { FastifyInstance } from "fastify";
import { spawn } from "node:child_process";

export interface KbScrapeDeps {
  vaultPath: string;
  // Injectable for testing. Default uses real CLI spawn.
  spawnScrapeCli?: (
    args: string[],
    onLine: (line: string) => void,
    onExit: (code: number | null) => void,
  ) => () => void;
}

function defaultSpawner(
  args: string[],
  onLine: (line: string) => void,
  onExit: (code: number | null) => void,
): () => void {
  const child = spawn("node", ["--import", "tsx", "packages/kb/src/cli.ts", "scrape", ...args]);
  let buf = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buf += chunk.toString("utf-8");
    let idx: number;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) onLine(line);
    }
  });
  child.on("close", (code) => onExit(code));
  return () => child.kill();
}

interface ScrapeBody { source?: string; selectors?: string[] }

export function registerKbScrapeRoutes(app: FastifyInstance, deps: KbScrapeDeps) {
  const spawner = deps.spawnScrapeCli ?? defaultSpawner;

  app.post<{ Body: ScrapeBody }>("/api/kb/scrape", async (req, reply) => {
    const body = req.body ?? {};
    const source = body.source;
    if (source !== "wechat" && source !== "x" && source !== "web") {
      return reply.code(400).send({ error: "source must be one of wechat|x|web" });
    }

    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.hijack();

    const write = (type: string, data: unknown) => {
      reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const cliArgs = ["--source", source];
    if (body.selectors && body.selectors.length > 0) {
      cliArgs.push("--selectors", body.selectors.join(","));
    }

    const stop = spawner(
      cliArgs,
      (line) => {
        try {
          const obj = JSON.parse(line) as { type: string };
          write(`scrape.${obj.type}`, obj);
        } catch { /* skip malformed */ }
      },
      (code) => {
        write("scrape.done", { code });
        reply.raw.end();
      },
    );

    reply.raw.on("close", () => stop());
  });
}
```

- [ ] **Step 4: Register the route.**

In `packages/web-server/src/server.ts`:
```ts
import { registerKbScrapeRoutes } from "./routes/kb-scrape.js";
// …
registerKbScrapeRoutes(app, { vaultPath: configStore.current.vaultPath });
```

- [ ] **Step 5: Run the test. Expected: PASS (2 tests).**

```bash
pnpm --filter @crossing/web-server vitest run tests/routes-kb-scrape.test.ts
```

- [ ] **Step 6: Commit.**

```bash
git add packages/web-server/src/routes/kb-scrape.ts \
        packages/web-server/tests/routes-kb-scrape.test.ts \
        packages/web-server/src/server.ts
git commit -m "feat(web-server): POST /api/kb/scrape SSE stream"
```

---

## T7 — `/api/kb/accounts` + `/articles` filter by `source_kind`

**Files:**
- Modify: `packages/web-server/src/routes/kb-accounts.ts`
- Modify: `packages/web-server/tests/routes-kb-accounts.test.ts`

**Steps:**

- [ ] **Step 1: Extend the existing route test.**

Add these cases to `packages/web-server/tests/routes-kb-accounts.test.ts` (create the file if it doesn't exist; mirror the existing kb-accounts test shape):
```ts
it("filters accounts by source_kind when query param provided", async () => {
  // Seed two rows with different source_kind
  db.prepare(`INSERT INTO ref_articles (id,account,title,published_at,url,md_path,html_path,source_kind,imported_at,updated_at)
              VALUES ('w1','量子位','a','2026-01-01','http://x1','a.md','a.html','wechat','2026-01-01','2026-01-01'),
                     ('x1','sama','b','2026-01-01','http://x2','b.md','b.html','x','2026-01-01','2026-01-01')`).run();

  const wechat = await app.inject({ method: "GET", url: "/api/kb/accounts?source_kind=wechat" });
  const accounts = wechat.json() as Array<{ account: string; source_kind?: string }>;
  expect(accounts.map((a) => a.account)).toEqual(["量子位"]);

  const x = await app.inject({ method: "GET", url: "/api/kb/accounts?source_kind=x" });
  expect((x.json() as Array<{ account: string }>).map((a) => a.account)).toEqual(["sama"]);
});

it("articles endpoint filters by source_kind too", async () => {
  const res = await app.inject({ method: "GET", url: "/api/kb/accounts/sama/articles?source_kind=x" });
  expect(res.statusCode).toBe(200);
});
```

- [ ] **Step 2: Run. Expected: FAIL.**

```bash
pnpm --filter @crossing/web-server vitest run tests/routes-kb-accounts.test.ts
```

- [ ] **Step 3: Add `source_kind` filter to both routes.**

In `packages/web-server/src/routes/kb-accounts.ts`:

Replace the `/api/kb/accounts` route handler body so it reads `req.query.source_kind` and narrows the grouping:
```ts
app.get<{ Querystring: { source_kind?: string } }>("/api/kb/accounts", async (req, reply) => {
  if (!existsSync(deps.sqlitePath)) return reply.send([]);
  const db = new Database(deps.sqlitePath, { readonly: true, fileMustExist: true });
  try {
    const hasMarks = !!db.prepare(HAS_MARKS_TABLE_SQL).get();
    const ingestedExpr = hasMarks
      ? `CASE WHEN ingest_status NOT IN ('raw','tag_failed') THEN 1
              WHEN EXISTS (SELECT 1 FROM wiki_ingest_marks m WHERE m.article_id = ref_articles.id) THEN 1
              ELSE 0 END`
      : `CASE WHEN ingest_status NOT IN ('raw','tag_failed') THEN 1 ELSE 0 END`;
    const kind = req.query.source_kind;
    const whereSql = kind ? "WHERE source_kind = @kind" : "";
    const rows = db.prepare(
      `SELECT account,
              COUNT(*) AS count,
              SUM(${ingestedExpr}) AS ingested_count,
              MIN(published_at) AS earliest_published_at,
              MAX(published_at) AS latest_published_at,
              source_kind
       FROM ref_articles
       ${whereSql}
       GROUP BY account, source_kind
       ORDER BY count DESC`,
    ).all(kind ? { kind } : {}) as AccountRow[];
    return reply.send(rows);
  } finally { db.close(); }
});
```

For the articles route, also accept `?source_kind=` and narrow the `WHERE`:
```ts
app.get<{ Params: { account: string }; Querystring: { limit?: string; source_kind?: string } }>(
  "/api/kb/accounts/:account/articles",
  async (req, reply) => {
    if (!existsSync(deps.sqlitePath)) return reply.send([]);
    const db = new Database(deps.sqlitePath, { readonly: true, fileMustExist: true });
    try {
      const hasMarks = !!db.prepare(HAS_MARKS_TABLE_SQL).get();
      const limit = Math.min(Number(req.query.limit) || 2000, 5000);
      const kind = req.query.source_kind;
      const sourceKindClause = kind ? "AND r.source_kind = @kind" : "";
      const rows = db.prepare(
        hasMarks
          ? `SELECT r.id, r.title, r.published_at,
                    CASE WHEN m.article_id IS NOT NULL AND r.ingest_status IN ('raw','tag_failed')
                         THEN 'wiki_marked' ELSE r.ingest_status END AS ingest_status,
                    r.word_count, r.source_kind
             FROM ref_articles r LEFT JOIN wiki_ingest_marks m ON m.article_id = r.id
             WHERE r.account = @account ${sourceKindClause}
             ORDER BY r.published_at DESC LIMIT @limit`
          : `SELECT id, title, published_at, ingest_status, word_count, source_kind
             FROM ref_articles WHERE account = @account ${sourceKindClause}
             ORDER BY published_at DESC LIMIT @limit`,
      ).all({ account: req.params.account, limit, ...(kind ? { kind } : {}) }) as ArticleRow[];
      return reply.send(rows);
    } finally { db.close(); }
  },
);
```

Add `source_kind: string` to both `AccountRow` and `ArticleRow` interfaces at the top of the file.

- [ ] **Step 4: Run. Expected: PASS.**

- [ ] **Step 5: Commit.**

```bash
git add packages/web-server/src/routes/kb-accounts.ts packages/web-server/tests/routes-kb-accounts.test.ts
git commit -m "feat(web-server): filter accounts + articles by source_kind query param"
```

---

## T8 — Frontend API client: sources + scrape

**Files:**
- Modify: `packages/web-ui/src/api/wiki-client.ts` (or create `sources-client.ts` — prefer the latter since it's a new concern)
- Create: `packages/web-ui/src/api/sources-client.ts`
- Create: `packages/web-ui/tests/sources-client.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getSources, putSources, type SourcesFile } from "../src/api/sources-client";

describe("sources-client", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it("GETs /api/kb/sources and returns data", async () => {
    const data: SourcesFile = { version: 1, wechat: ["量子位"], x: [], web: [] };
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, json: async () => data,
    } as Response);
    const res = await getSources();
    expect(res).toEqual(data);
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/kb/sources", expect.anything());
  });

  it("PUTs /api/kb/sources with json body", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, json: async () => ({ ok: true }),
    } as Response);
    const data: SourcesFile = { version: 1, wechat: [], x: [{ handle: "sama" }], web: [] };
    await putSources(data);
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe("/api/kb/sources");
    expect(call[1].method).toBe("PUT");
    expect(JSON.parse(call[1].body as string)).toEqual(data);
  });
});
```

- [ ] **Step 2: Run. Expected: FAIL.**

```bash
pnpm --filter @crossing/web-ui vitest run tests/sources-client.test.ts
```

- [ ] **Step 3: Implement client.**

`packages/web-ui/src/api/sources-client.ts`:
```ts
export interface XSource { handle: string; note?: string }
export interface WebSource { name: string; url: string; rss?: string }
export interface SourcesFile {
  version: 1;
  wechat: string[];
  x: XSource[];
  web: WebSource[];
}

export async function getSources(signal?: AbortSignal): Promise<SourcesFile> {
  const r = await fetch("/api/kb/sources", { signal });
  if (!r.ok) throw new Error(`getSources ${r.status}`);
  return (await r.json()) as SourcesFile;
}

export async function putSources(data: SourcesFile): Promise<void> {
  const r = await fetch("/api/kb/sources", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`putSources ${r.status}`);
}

export type ScrapeSource = "wechat" | "x" | "web";

export interface ScrapeEvent {
  type: string;
  source?: ScrapeSource;
  handle?: string;
  article_id?: string;
  title?: string;
  reason?: string;
  error?: string;
  message?: string;
  stats?: { fetched: number; skipped: number };
  code?: number;
}

export interface ScrapeStream { close: () => void }

export function startScrapeStream(
  args: { source: ScrapeSource; selectors?: string[] },
  onEvent: (e: ScrapeEvent) => void,
  onDone: () => void,
  onError: (msg: string) => void,
): ScrapeStream {
  const ctrl = new AbortController();
  void (async () => {
    try {
      const r = await fetch("/api/kb/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(args),
        signal: ctrl.signal,
      });
      if (!r.ok || !r.body) { onError(`HTTP ${r.status}`); return; }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const chunk of parts) {
          const lines = chunk.split("\n");
          const typeLine = lines.find((l) => l.startsWith("event:"));
          const dataLine = lines.find((l) => l.startsWith("data:"));
          if (!typeLine || !dataLine) continue;
          try {
            const payload = JSON.parse(dataLine.slice(5).trim()) as ScrapeEvent;
            onEvent(payload);
          } catch { /* skip */ }
        }
      }
      onDone();
    } catch (err) {
      onError((err as Error).message);
    }
  })();
  return { close: () => ctrl.abort() };
}
```

- [ ] **Step 4: Run. Expected: PASS (2 tests).**

- [ ] **Step 5: Commit.**

```bash
git add packages/web-ui/src/api/sources-client.ts packages/web-ui/tests/sources-client.test.ts
git commit -m "feat(web-ui): sources-client for yaml r/w + scrape SSE"
```

---

## T9 — `SourceListPanel` component

**Files:**
- Create: `packages/web-ui/src/components/wiki/SourceListPanel.tsx`
- Create: `packages/web-ui/tests/components/SourceListPanel.test.tsx`

**Steps:**

- [ ] **Step 1: Write the failing test.**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SourceListPanel } from "../../src/components/wiki/SourceListPanel";

describe("SourceListPanel", () => {
  it("renders each item with primary + secondary labels", () => {
    render(
      <SourceListPanel
        items={[
          { key: "sama", primary: "@sama", secondary: "OpenAI CEO" },
          { key: "karpathy", primary: "@karpathy", secondary: "前 Tesla AI" },
        ]}
        selectedKeys={new Set()}
        onToggle={() => {}}
        onAdd={() => {}}
        onRemove={() => {}}
        addPlaceholder="handle"
      />,
    );
    expect(screen.getByText("@sama")).toBeTruthy();
    expect(screen.getByText("OpenAI CEO")).toBeTruthy();
    expect(screen.getByText("@karpathy")).toBeTruthy();
  });

  it("checkbox toggles selection", () => {
    const onToggle = vi.fn();
    render(
      <SourceListPanel
        items={[{ key: "sama", primary: "@sama" }]}
        selectedKeys={new Set()}
        onToggle={onToggle}
        onAdd={() => {}}
        onRemove={() => {}}
        addPlaceholder="handle"
      />,
    );
    const cb = screen.getByRole("checkbox", { name: /sama/i });
    fireEvent.click(cb);
    expect(onToggle).toHaveBeenCalledWith("sama");
  });

  it("calls onAdd when user types a value and clicks +", () => {
    const onAdd = vi.fn();
    render(
      <SourceListPanel
        items={[]}
        selectedKeys={new Set()}
        onToggle={() => {}}
        onAdd={onAdd}
        onRemove={() => {}}
        addPlaceholder="handle"
      />,
    );
    const input = screen.getByPlaceholderText("handle") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "dario_amodei" } });
    fireEvent.click(screen.getByRole("button", { name: /添加/ }));
    expect(onAdd).toHaveBeenCalledWith("dario_amodei");
  });

  it("remove button fires onRemove with the item key", () => {
    const onRemove = vi.fn();
    render(
      <SourceListPanel
        items={[{ key: "sama", primary: "@sama" }]}
        selectedKeys={new Set()}
        onToggle={() => {}}
        onAdd={() => {}}
        onRemove={onRemove}
        addPlaceholder="handle"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /删除 sama/i }));
    expect(onRemove).toHaveBeenCalledWith("sama");
  });
});
```

- [ ] **Step 2: Run. Expected: FAIL.**

```bash
pnpm --filter @crossing/web-ui vitest run tests/components/SourceListPanel.test.tsx
```

- [ ] **Step 3: Create the component.**

`packages/web-ui/src/components/wiki/SourceListPanel.tsx`:
```tsx
import { useState } from "react";
import { Button } from "../ui";

export interface SourceListItem {
  key: string;
  primary: string;
  secondary?: string;
  meta?: string; // e.g. "3 新 · 20h 前"
}

export interface SourceListPanelProps {
  items: SourceListItem[];
  selectedKeys: Set<string>;
  onToggle: (key: string) => void;
  onAdd: (value: string) => void;
  onRemove: (key: string) => void;
  addPlaceholder: string;
}

export function SourceListPanel({ items, selectedKeys, onToggle, onAdd, onRemove, addPlaceholder }: SourceListPanelProps) {
  const [draft, setDraft] = useState("");
  const submit = () => {
    const v = draft.trim();
    if (!v) return;
    onAdd(v);
    setDraft("");
  };
  return (
    <div className="rounded border border-[var(--hair)] bg-[var(--bg-2)]">
      <ul className="max-h-80 overflow-y-auto">
        {items.map((it) => (
          <li key={it.key} className="flex items-center gap-3 px-3 py-2 border-b border-[var(--hair)] last:border-b-0">
            <input
              type="checkbox"
              aria-label={it.primary}
              checked={selectedKeys.has(it.key)}
              onChange={() => onToggle(it.key)}
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-[var(--heading)] truncate">{it.primary}</div>
              {it.secondary && <div className="text-xs text-[var(--meta)] truncate">{it.secondary}</div>}
            </div>
            {it.meta && <span className="text-[10px] text-[var(--faint)] whitespace-nowrap">{it.meta}</span>}
            <button
              type="button"
              aria-label={`删除 ${it.key}`}
              onClick={() => onRemove(it.key)}
              className="w-6 h-6 flex items-center justify-center rounded text-[var(--meta)] hover:text-[var(--red)] hover:bg-[var(--bg-1)]"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2 border-t border-[var(--hair)] px-3 py-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder={addPlaceholder}
          className="flex-1 h-8 px-2 rounded border border-[var(--hair)] bg-[var(--bg-1)] text-sm"
        />
        <Button size="sm" variant="secondary" onClick={submit}>＋ 添加</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run. Expected: PASS (4 tests).**

- [ ] **Step 5: Commit.**

```bash
git add packages/web-ui/src/components/wiki/SourceListPanel.tsx packages/web-ui/tests/components/SourceListPanel.test.tsx
git commit -m "feat(web-ui): SourceListPanel shared CRUD list"
```

---

## T10 — `SourceFetchLog` (streaming events view)

**Files:**
- Create: `packages/web-ui/src/components/wiki/SourceFetchLog.tsx`
- Create: `packages/web-ui/tests/components/SourceFetchLog.test.tsx`

**Steps:**

- [ ] **Step 1: Write the failing test.**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SourceFetchLog } from "../../src/components/wiki/SourceFetchLog";
import type { ScrapeEvent } from "../../src/api/sources-client";

describe("SourceFetchLog", () => {
  it("renders each event with tag + text", () => {
    const events: ScrapeEvent[] = [
      { type: "scrape_started", source: "x", handle: "sama" },
      { type: "article_fetched", source: "x", handle: "sama", article_id: "1", title: "GPT-5" },
      { type: "scrape_completed", source: "x", handle: "sama", stats: { fetched: 1, skipped: 0 } },
    ];
    render(<SourceFetchLog events={events} running={false} />);
    expect(screen.getByText(/scrape_started/)).toBeTruthy();
    expect(screen.getByText(/GPT-5/)).toBeTruthy();
    expect(screen.getByText(/scrape_completed/)).toBeTruthy();
  });

  it("shows placeholder when no events", () => {
    render(<SourceFetchLog events={[]} running={false} />);
    expect(screen.getByText(/尚未开始/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run. Expected: FAIL.**

```bash
pnpm --filter @crossing/web-ui vitest run tests/components/SourceFetchLog.test.tsx
```

- [ ] **Step 3: Create the component.**

`packages/web-ui/src/components/wiki/SourceFetchLog.tsx`:
```tsx
import { useEffect, useRef } from "react";
import type { ScrapeEvent } from "../../api/sources-client";
import { formatBeijingTime } from "../../utils/time";

export interface SourceFetchLogProps {
  events: Array<ScrapeEvent & { receivedAt?: string }>;
  running: boolean;
}

function summarize(e: ScrapeEvent): { tag: string; text: string; tone: "info" | "ok" | "err" } {
  switch (e.type) {
    case "scrape_started":
      return { tag: e.type, text: `${e.source ?? "?"} @ ${e.handle ?? "-"}`, tone: "info" };
    case "article_fetched":
      return { tag: e.type, text: `${e.handle ?? "-"} · ${e.title ?? "(no title)"}`, tone: "ok" };
    case "article_skipped":
      return { tag: e.type, text: `${e.handle ?? "-"} · ${e.reason ?? ""}`, tone: "info" };
    case "scrape_stub":
      return { tag: e.type, text: `${e.handle ?? "-"} · ${e.message ?? ""}`, tone: "info" };
    case "scrape_failed":
      return { tag: e.type, text: `${e.handle ?? "-"} · ${e.error ?? ""}`, tone: "err" };
    case "scrape_completed":
      return { tag: e.type, text: `${e.handle ?? "-"} · fetched=${e.stats?.fetched ?? 0} skipped=${e.stats?.skipped ?? 0}`, tone: "ok" };
    case "scrape.done":
    case "scrape_done":
      return { tag: "done", text: `exit=${e.code ?? 0}`, tone: e.code ? "err" : "ok" };
    default:
      return { tag: e.type, text: JSON.stringify(e).slice(0, 200), tone: "info" };
  }
}

export function SourceFetchLog({ events, running }: SourceFetchLogProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [events.length]);
  return (
    <div
      ref={boxRef}
      className="flex-1 min-h-0 rounded bg-[var(--log-bg)] border border-[var(--hair)] overflow-auto"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {events.length === 0 ? (
        <div className="p-6 text-center text-[var(--faint)] text-sm">
          {running ? "运行中，等待事件…" : "尚未开始。选源后点「拉取」按钮"}
        </div>
      ) : (
        <div className="p-3 space-y-0.5">
          {events.map((e, i) => {
            const { tag, text, tone } = summarize(e);
            const color = tone === "ok" ? "var(--accent)" : tone === "err" ? "var(--red)" : "var(--meta)";
            return (
              <div key={i} className="flex gap-3 text-[11px] leading-relaxed">
                <span className="text-[var(--faint)] shrink-0">
                  [{formatBeijingTime(e.receivedAt ?? new Date().toISOString())}]
                </span>
                <span className="shrink-0 w-28 text-right" style={{ color }}>{tag}</span>
                <span className="text-[var(--body)] whitespace-pre-wrap break-all flex-1 min-w-0">{text}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run. Expected: PASS (2 tests).**

- [ ] **Step 5: Commit.**

```bash
git add packages/web-ui/src/components/wiki/SourceFetchLog.tsx packages/web-ui/tests/components/SourceFetchLog.test.tsx
git commit -m "feat(web-ui): SourceFetchLog streaming events panel"
```

---

## T11 — `SourceFetchConsole` (segmented, with tabs)

**Files:**
- Create: `packages/web-ui/src/components/wiki/SourceFetchConsole.tsx`
- Create: `packages/web-ui/tests/components/SourceFetchConsole.test.tsx`
- Create: `packages/web-ui/src/hooks/useSourcesYaml.ts`

**Steps:**

- [ ] **Step 1: Write the failing test.**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SourceFetchConsole } from "../../src/components/wiki/SourceFetchConsole";

vi.mock("../../src/api/sources-client", () => ({
  getSources: vi.fn().mockResolvedValue({
    version: 1,
    wechat: ["量子位"],
    x: [{ handle: "sama", note: "OpenAI" }],
    web: [{ name: "Anthropic Blog", url: "https://www.anthropic.com/news" }],
  }),
  putSources: vi.fn().mockResolvedValue(undefined),
  startScrapeStream: vi.fn(),
}));

describe("SourceFetchConsole", () => {
  it("renders three tabs and defaults to wechat", async () => {
    render(<SourceFetchConsole onClose={() => {}} />);
    expect(screen.getByRole("button", { name: /公众号/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /X 博主/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /AI 外网/ })).toBeTruthy();
    await waitFor(() => expect(screen.getByText("量子位")).toBeTruthy());
  });

  it("switches to X tab and shows @sama", async () => {
    render(<SourceFetchConsole onClose={() => {}} />);
    await waitFor(() => screen.getByText("量子位"));
    fireEvent.click(screen.getByRole("button", { name: /X 博主/ }));
    await waitFor(() => expect(screen.getByText("@sama")).toBeTruthy());
  });

  it("close button fires onClose", () => {
    const onClose = vi.fn();
    render(<SourceFetchConsole onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("关闭"));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run. Expected: FAIL.**

```bash
pnpm --filter @crossing/web-ui vitest run tests/components/SourceFetchConsole.test.tsx
```

- [ ] **Step 3: Create the `useSourcesYaml` hook.**

`packages/web-ui/src/hooks/useSourcesYaml.ts`:
```ts
import { useCallback, useEffect, useState } from "react";
import { getSources, putSources, type SourcesFile } from "../api/sources-client";

export function useSourcesYaml() {
  const [data, setData] = useState<SourcesFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    void getSources(ctrl.signal)
      .then((d) => { setData(d); setError(null); })
      .catch((e: unknown) => {
        const msg = (e as Error)?.name === "AbortError" ? "加载超时" : `加载失败：${(e as Error)?.message ?? ""}`;
        setError(msg);
      })
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, []);

  useEffect(() => { return reload(); }, [reload]);

  const save = useCallback(async (next: SourcesFile) => {
    await putSources(next);
    setData(next);
  }, []);

  return { data, error, reload, save };
}
```

- [ ] **Step 4: Create the console.**

`packages/web-ui/src/components/wiki/SourceFetchConsole.tsx`:
```tsx
import { useMemo, useRef, useState } from "react";
import { Button } from "../ui";
import { SourceListPanel, type SourceListItem } from "./SourceListPanel";
import { SourceFetchLog } from "./SourceFetchLog";
import { useSourcesYaml } from "../../hooks/useSourcesYaml";
import { useTheme } from "../../hooks/useTheme";
import { startScrapeStream, type ScrapeEvent, type ScrapeSource, type SourcesFile } from "../../api/sources-client";

export interface SourceFetchConsoleProps { onClose: () => void }

type Tab = "wechat" | "x" | "web";

export function SourceFetchConsole({ onClose }: SourceFetchConsoleProps) {
  const { data, error, save } = useSourcesYaml();
  const { theme, toggle: toggleTheme } = useTheme();
  const [tab, setTab] = useState<Tab>("wechat");
  const [selected, setSelected] = useState<Record<Tab, Set<string>>>({
    wechat: new Set(), x: new Set(), web: new Set(),
  });
  const [events, setEvents] = useState<Array<ScrapeEvent & { receivedAt?: string }>>([]);
  const [running, setRunning] = useState(false);
  const streamRef = useRef<{ close: () => void } | null>(null);

  const items: SourceListItem[] = useMemo(() => {
    if (!data) return [];
    if (tab === "wechat") return data.wechat.map((acc) => ({ key: acc, primary: acc }));
    if (tab === "x") return data.x.map((s) => ({ key: s.handle, primary: `@${s.handle}`, secondary: s.note }));
    return data.web.map((s) => ({ key: s.name, primary: s.name, secondary: s.url }));
  }, [data, tab]);

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = { ...prev, [tab]: new Set(prev[tab]) };
      if (next[tab].has(key)) next[tab].delete(key); else next[tab].add(key);
      return next;
    });

  const add = (value: string) => {
    if (!data) return;
    const next: SourcesFile = { ...data };
    if (tab === "wechat") {
      if (!next.wechat.includes(value)) next.wechat = [...next.wechat, value];
    } else if (tab === "x") {
      if (!next.x.some((s) => s.handle === value)) next.x = [...next.x, { handle: value }];
    } else {
      if (!next.web.some((s) => s.name === value))
        next.web = [...next.web, { name: value, url: value.startsWith("http") ? value : `https://${value}` }];
    }
    void save(next);
  };

  const remove = (key: string) => {
    if (!data) return;
    const next: SourcesFile =
      tab === "wechat" ? { ...data, wechat: data.wechat.filter((a) => a !== key) } :
      tab === "x" ? { ...data, x: data.x.filter((s) => s.handle !== key) } :
      { ...data, web: data.web.filter((s) => s.name !== key) };
    void save(next);
    setSelected((prev) => {
      const n = new Set(prev[tab]);
      n.delete(key);
      return { ...prev, [tab]: n };
    });
  };

  const runScrape = (which: "all" | "selected") => {
    if (!data || running) return;
    const selectors = which === "all"
      ? items.map((i) => i.key)
      : Array.from(selected[tab]);
    if (selectors.length === 0) return;
    setEvents([]);
    setRunning(true);
    streamRef.current?.close();
    streamRef.current = startScrapeStream(
      { source: tab as ScrapeSource, selectors },
      (e) => setEvents((prev) => [...prev, { ...e, receivedAt: new Date().toISOString() }]),
      () => setRunning(false),
      (msg) => {
        setEvents((prev) => [...prev, { type: "scrape_failed", error: msg, receivedAt: new Date().toISOString() }]);
        setRunning(false);
      },
    );
  };

  const tabLabel: Record<Tab, string> = { wechat: "公众号", x: "X 博主", web: "AI 外网" };
  const addPlaceholder: Record<Tab, string> = { wechat: "公众号名", x: "handle（不带 @）", web: "站点名或 URL" };

  return (
    <div role="dialog" aria-label="原素材获取" className="fixed inset-0 z-50 flex flex-col bg-[var(--bg-0)]">
      <header className="flex items-center justify-between px-6 h-12 border-b border-[var(--hair)] bg-[var(--bg-1)]">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-semibold text-[var(--heading)]">原素材获取</h1>
          <div className="inline-flex items-center gap-0.5 p-0.5 rounded border border-[var(--hair)]">
            {(Object.keys(tabLabel) as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`px-2.5 py-1 text-xs rounded transition-colors ${
                  tab === t ? "bg-[var(--accent-fill)] text-[var(--accent)] font-semibold"
                            : "text-[var(--meta)] hover:text-[var(--heading)] hover:bg-[var(--bg-2)]"}`}
              >
                {tabLabel[t]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="w-7 h-7 flex items-center justify-center rounded text-[var(--meta)] hover:text-[var(--heading)] hover:bg-[var(--bg-2)]"
          >{theme === "dark" ? "☾" : "☀"}</button>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="w-7 h-7 flex items-center justify-center rounded text-[var(--meta)] hover:text-[var(--heading)] hover:bg-[var(--bg-2)]"
          >✕</button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden p-6 flex flex-col gap-4">
        {error && <div className="text-xs text-[var(--red)]">{error}</div>}
        {data ? (
          <>
            <SourceListPanel
              items={items}
              selectedKeys={selected[tab]}
              onToggle={toggle}
              onAdd={add}
              onRemove={remove}
              addPlaceholder={addPlaceholder[tab]}
            />
            <div className="flex items-center gap-2">
              <Button size="sm" variant="primary" onClick={() => runScrape("all")} disabled={running}>
                {running ? "运行中…" : `拉取全部（${items.length}）`}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => runScrape("selected")} disabled={running || selected[tab].size === 0}>
                拉取选中（{selected[tab].size}）
              </Button>
            </div>
            <SourceFetchLog events={events} running={running} />
          </>
        ) : (
          <div className="text-sm text-[var(--meta)]">加载中…</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run. Expected: PASS (3 tests).**

- [ ] **Step 6: Commit.**

```bash
git add packages/web-ui/src/components/wiki/SourceFetchConsole.tsx \
        packages/web-ui/src/hooks/useSourcesYaml.ts \
        packages/web-ui/tests/components/SourceFetchConsole.test.tsx
git commit -m "feat(web-ui): SourceFetchConsole full-screen segmented panel"
```

---

## T12 — `SourceFetchFab` entry button + wire into `KnowledgePage`

**Files:**
- Create: `packages/web-ui/src/components/wiki/SourceFetchFab.tsx`
- Modify: `packages/web-ui/src/pages/KnowledgePage.tsx`

**Steps:**

- [ ] **Step 1: Create the fab wrapper.**

`packages/web-ui/src/components/wiki/SourceFetchFab.tsx`:
```tsx
import { useState } from "react";
import { Button } from "../ui";
import { SourceFetchConsole } from "./SourceFetchConsole";

export function SourceFetchFab() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        data-testid="source-fetch-open"
        variant="secondary"
        size="sm"
        leftSlot="⇣"
        onClick={() => setOpen(true)}
      >
        原素材获取
      </Button>
      {open && <SourceFetchConsole onClose={() => setOpen(false)} />}
    </>
  );
}
```

- [ ] **Step 2: Mount it in the `KnowledgePage` header.**

In `packages/web-ui/src/pages/KnowledgePage.tsx`, find the header block (look for `<header className="flex items-center justify-between px-6 h-14 border-b">`). Add the import at top:
```tsx
import { SourceFetchFab } from "../components/wiki/SourceFetchFab.js";
```

Add the fab inside the right-hand cluster, before `ModelSelector`:
```tsx
<div className="flex items-center gap-3">
  {statusInfo && (
    <div className="text-xs text-[var(--meta)]" style={{ fontFamily: "var(--font-mono)" }}>
      {`${statusInfo.total} 条 · 上次入库 ${formatBeijingShort(statusInfo.last_ingest_at)}`}
    </div>
  )}
  <SourceFetchFab />   {/* ← add here */}
  <ModelSelector onChange={setModel} />
</div>
```

- [ ] **Step 3: Manual smoke test.**

```bash
# In another terminal with dev server running:
# 1. Open http://localhost:3000/knowledge
# 2. Click 「原素材获取」 in the top-right
# 3. Confirm the full-screen console opens
# 4. Switch between 公众号 / X 博主 / AI 外网 tabs
# 5. Close via ✕
```

- [ ] **Step 4: Commit.**

```bash
git add packages/web-ui/src/components/wiki/SourceFetchFab.tsx packages/web-ui/src/pages/KnowledgePage.tsx
git commit -m "feat(web-ui): mount SourceFetchFab on KnowledgePage"
```

---

## T13 — `IngestTab` segment filter by `source_kind`

**Files:**
- Modify: `packages/web-ui/src/components/wiki/IngestTab.tsx`

**Steps:**

- [ ] **Step 1: Add a segment state and pass it through queries.**

Find the top of the `IngestTab` component (look for `const [accounts, setAccounts] = useState`). Add:

```tsx
type SourceKind = "wechat" | "x" | "web";
const [sourceKind, setSourceKind] = useState<SourceKind>("wechat");
```

- [ ] **Step 2: Update the accounts fetch to include `source_kind`.**

Find the effect that calls `fetch("/api/kb/accounts")` and change it to:
```tsx
useEffect(() => {
  void fetch(`/api/kb/accounts?source_kind=${sourceKind}`)
    .then(async (r) => { if (r.ok) setAccounts(await r.json()); })
    .catch(() => {});
  setActiveAccount(null); // reset selection when switching tabs
}, [ingest.completedSeq, sourceKind]);
```

Also update the per-account articles fetch(es):
```tsx
void fetch(`/api/kb/accounts/${encodeURIComponent(activeAccount)}/articles?limit=3000&source_kind=${sourceKind}`)
```

(Apply to both the initial load effect and the `completedSeq` refetch effect.)

- [ ] **Step 3: Render a segment control at the top.**

Find the current return's top-level wrapper `<div className="flex flex-col gap-4 h-full min-h-0">` and insert right after the opening tag:

```tsx
<div className="shrink-0 flex items-center gap-2">
  <div className="inline-flex items-center gap-0.5 p-0.5 rounded border border-[var(--hair)]">
    {(["wechat", "x", "web"] as const).map((k) => (
      <button
        key={k}
        type="button"
        onClick={() => setSourceKind(k)}
        className={`px-2.5 py-1 text-xs rounded ${
          sourceKind === k
            ? "bg-[var(--accent-fill)] text-[var(--accent)] font-semibold"
            : "text-[var(--meta)] hover:text-[var(--heading)] hover:bg-[var(--bg-2)]"
        }`}
      >
        {k === "wechat" ? "公众号" : k === "x" ? "X 博主" : "AI 外网"}
      </button>
    ))}
  </div>
  <span className="text-xs text-[var(--faint)]">{accounts.length} 个源</span>
</div>
```

- [ ] **Step 4: Manual smoke test.**

```bash
# Dev server running
# 1. Open http://localhost:3000/knowledge
# 2. Click 入库 button
# 3. Confirm three segments appear at the top
# 4. Click X 博主 — expect empty list (no x articles yet since scrape stub doesn't insert)
# 5. Click 公众号 — confirm existing account grid is present
```

- [ ] **Step 5: Commit.**

```bash
git add packages/web-ui/src/components/wiki/IngestTab.tsx
git commit -m "feat(web-ui): IngestTab filter accounts by source_kind segment"
```

---

## T14 — Seed `sources.yaml` with defaults

**Files:**
- Create: `packages/kb/src/sources/seed.ts`
- Modify: `packages/kb/src/cli.ts` (add `sources-seed` subcommand)
- Create: `packages/kb/tests/sources/seed.test.ts`

**Steps:**

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import Database from "better-sqlite3";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { seedSourcesYaml } from "../../src/sources/seed.js";
import { readSources } from "../../src/sources/sources-yaml.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "seed-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("seedSourcesYaml", () => {
  it("creates sources.yaml with default x + web lists + empty wechat when DB empty", () => {
    const dbPath = join(dir, ".index", "refs.sqlite");
    const yamlPath = join(dir, "sources.yaml");
    // ensure .index dir + empty db
    require("node:fs").mkdirSync(join(dir, ".index"));
    const db = new Database(dbPath);
    db.exec("CREATE TABLE ref_articles (id TEXT, account TEXT, source_kind TEXT);");
    db.close();

    seedSourcesYaml({ vaultPath: dir, sqlitePath: dbPath });
    const s = readSources(yamlPath);
    expect(s.wechat).toEqual([]);
    expect(s.x.length).toBeGreaterThan(10);
    expect(s.x.some((h) => h.handle === "sama")).toBe(true);
    expect(s.web.some((w) => w.name.includes("Anthropic"))).toBe(true);
  });

  it("seeds wechat from existing DB accounts", () => {
    const dbPath = join(dir, ".index", "refs.sqlite");
    const yamlPath = join(dir, "sources.yaml");
    require("node:fs").mkdirSync(join(dir, ".index"));
    const db = new Database(dbPath);
    db.exec(`CREATE TABLE ref_articles (id TEXT, account TEXT, source_kind TEXT);
             INSERT INTO ref_articles VALUES ('a1','量子位','wechat'),('a2','新智元','wechat');`);
    db.close();

    seedSourcesYaml({ vaultPath: dir, sqlitePath: dbPath });
    const s = readSources(yamlPath);
    expect(s.wechat).toContain("量子位");
    expect(s.wechat).toContain("新智元");
  });

  it("is idempotent (second run preserves existing yaml)", () => {
    const dbPath = join(dir, ".index", "refs.sqlite");
    const yamlPath = join(dir, "sources.yaml");
    require("node:fs").mkdirSync(join(dir, ".index"));
    const db = new Database(dbPath);
    db.exec("CREATE TABLE ref_articles (id TEXT, account TEXT, source_kind TEXT);");
    db.close();
    seedSourcesYaml({ vaultPath: dir, sqlitePath: dbPath });
    const before = readSources(yamlPath);
    seedSourcesYaml({ vaultPath: dir, sqlitePath: dbPath });
    const after = readSources(yamlPath);
    expect(after).toEqual(before);
  });
});
```

- [ ] **Step 2: Run. Expected: FAIL.**

```bash
pnpm --filter @crossing/kb vitest run tests/sources/seed.test.ts
```

- [ ] **Step 3: Implement the seeder.**

`packages/kb/src/sources/seed.ts`:
```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { readSources, writeSources, type SourcesFile } from "./sources-yaml.js";

const DEFAULT_X_HANDLES: Array<{ handle: string; note?: string }> = [
  // 厂商官号
  { handle: "AnthropicAI" }, { handle: "OpenAI" }, { handle: "GoogleDeepMind" },
  { handle: "MistralAI" }, { handle: "xai" }, { handle: "HuggingFace" },
  { handle: "perplexity_ai" }, { handle: "cursor_ai" }, { handle: "togethercompute" },
  { handle: "groqinc" }, { handle: "cohere" }, { handle: "Replicate" },
  // 创始人 / 高管
  { handle: "sama", note: "OpenAI CEO" },
  { handle: "dario_amodei", note: "Anthropic CEO" },
  { handle: "demishassabis", note: "Google DeepMind CEO" },
  { handle: "arav_ind_srinivas", note: "Perplexity CEO" },
  { handle: "gdb", note: "Greg Brockman" },
  { handle: "satyanadella", note: "Microsoft CEO" },
  { handle: "elonmusk", note: "xAI / Tesla" },
  { handle: "miramurati", note: "Thinking Machines" },
  { handle: "JohnSchulman2", note: "ex-OpenAI" },
  { handle: "lexfridman", note: "Lex Fridman" },
  { handle: "jensenhuang", note: "Nvidia" },
  // 研究员 / 意见领袖
  { handle: "karpathy", note: "前 Tesla AI / OpenAI" },
  { handle: "ylecun", note: "Meta Chief AI" },
  { handle: "geoffreyhinton", note: "Godfather of AI" },
  { handle: "AndrewYNg" },
  { handle: "hardmaru", note: "David Ha" },
  { handle: "jeremyphoward" },
  { handle: "simonw", note: "Simon Willison" },
  { handle: "swyx", note: "Latent Space" },
  { handle: "jxnlco", note: "Jason Liu, instructor" },
  { handle: "alexalbert__", note: "Anthropic" },
  { handle: "polynoamial", note: "Noam Brown" },
  { handle: "percyliang" },
  // 产品 demo / 开发者秀
  { handle: "mckaywrigley" }, { handle: "omarsar0", note: "elvis" },
  { handle: "_akhaliq", note: "AK" }, { handle: "rauchg", note: "Vercel" },
  { handle: "hwchase17", note: "LangChain" }, { handle: "levelsio", note: "Pieter Levels" },
];

const DEFAULT_WEB_SITES: Array<{ name: string; url: string; rss?: string }> = [
  { name: "Anthropic Blog", url: "https://www.anthropic.com/news", rss: "https://www.anthropic.com/rss.xml" },
  { name: "OpenAI Research", url: "https://openai.com/research/", rss: "https://openai.com/research/index.xml" },
  { name: "Google DeepMind", url: "https://deepmind.google/blog/" },
  { name: "Meta AI", url: "https://ai.meta.com/blog/" },
  { name: "Mistral AI", url: "https://mistral.ai/news/" },
  { name: "Hugging Face Blog", url: "https://huggingface.co/blog", rss: "https://huggingface.co/blog/feed.xml" },
  { name: "Microsoft Research", url: "https://www.microsoft.com/en-us/research/blog/" },
  { name: "Cohere Blog", url: "https://cohere.com/blog" },
  { name: "Scale AI Blog", url: "https://scale.com/blog" },
  { name: "Allen AI (AI2)", url: "https://allenai.org/blog" },
  { name: "MIT Tech Review AI", url: "https://www.technologyreview.com/topic/artificial-intelligence/" },
  { name: "Stanford HAI", url: "https://hai.stanford.edu/news" },
  { name: "Berkeley AI Research (BAIR)", url: "https://bair.berkeley.edu/blog/" },
  { name: "Simon Willison", url: "https://simonwillison.net", rss: "https://simonwillison.net/atom/everything/" },
  { name: "Lilian Weng", url: "https://lilianweng.github.io", rss: "https://lilianweng.github.io/feed.xml" },
  { name: "Latent Space", url: "https://www.latent.space", rss: "https://www.latent.space/feed" },
  { name: "Interconnects", url: "https://www.interconnects.ai", rss: "https://www.interconnects.ai/feed" },
  { name: "Sebastian Raschka", url: "https://sebastianraschka.com", rss: "https://sebastianraschka.com/feed.xml" },
  { name: "Chip Huyen", url: "https://huyenchip.com", rss: "https://huyenchip.com/feed" },
  { name: "Import AI", url: "https://importai.substack.com" },
  { name: "The Batch", url: "https://www.deeplearning.ai/the-batch/" },
  { name: "Matt Rickard", url: "https://mattrickard.com" },
  { name: "Vicki Boykis", url: "https://vickiboykis.com" },
  { name: "TLDR AI", url: "https://tldr.tech/ai" },
  { name: "Smol.AI News", url: "https://buttondown.email/ainews" },
  { name: "The Neuron Daily", url: "https://www.theneurondaily.com" },
  { name: "Ben's Bites", url: "https://bensbites.co" },
];

export interface SeedOpts {
  vaultPath: string;
  sqlitePath: string;
}

export function seedSourcesYaml(opts: SeedOpts): void {
  const yamlPath = join(opts.vaultPath, "sources.yaml");
  if (existsSync(yamlPath)) return; // idempotent: never overwrite
  const wechat: string[] = [];
  if (existsSync(opts.sqlitePath)) {
    const db = new Database(opts.sqlitePath, { readonly: true, fileMustExist: true });
    try {
      const rows = db.prepare(
        "SELECT DISTINCT account FROM ref_articles ORDER BY account",
      ).all() as Array<{ account: string }>;
      wechat.push(...rows.map((r) => r.account));
    } finally { db.close(); }
  }
  const data: SourcesFile = {
    version: 1,
    wechat,
    x: DEFAULT_X_HANDLES,
    web: DEFAULT_WEB_SITES,
  };
  writeSources(yamlPath, data);
}
```

- [ ] **Step 4: Add CLI subcommand.**

In `packages/kb/src/cli.ts`, near the other commands:
```ts
program.command("sources-seed")
  .description("create sources.yaml with defaults if missing")
  .option("-c, --config <path>", "config.json path", "config.json")
  .action(async (opts: { config: string }) => {
    const { loadConfig } = await import("./db.js");
    const cfg = loadConfig(opts.config);
    const { seedSourcesYaml } = await import("./sources/seed.js");
    seedSourcesYaml({ vaultPath: cfg.vaultPath, sqlitePath: cfg.sqlitePath });
    process.stdout.write(`sources.yaml seeded at ${cfg.vaultPath}/sources.yaml\n`);
  });
```

- [ ] **Step 5: Run the tests. Expected: PASS (3 tests).**

```bash
pnpm --filter @crossing/kb vitest run tests/sources/seed.test.ts
```

- [ ] **Step 6: Smoke-test.**

```bash
node --import tsx packages/kb/src/cli.ts sources-seed
ls ~/CrossingVault/sources.yaml
head -30 ~/CrossingVault/sources.yaml
```

Expected: file exists, starts with `version: 1`, contains wechat accounts from DB, plus the default X/web lists.

- [ ] **Step 7: Commit.**

```bash
git add packages/kb/src/sources/seed.ts \
        packages/kb/tests/sources/seed.test.ts \
        packages/kb/src/cli.ts
git commit -m "feat(kb): sources-seed CLI with ~45 X handles + ~27 web sites"
```

---

## T15 — End-to-end smoke test

**Files:**
- Create: `packages/web-server/tests/e2e-source-acquisition.test.ts`

**Steps:**

- [ ] **Step 1: Write an end-to-end test that exercises the full stack.**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import { registerKbSourcesRoutes } from "../src/routes/kb-sources.js";
import { registerKbScrapeRoutes } from "../src/routes/kb-scrape.js";

let dir: string;
let app: ReturnType<typeof Fastify>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "e2e-source-"));
  app = Fastify();
  registerKbSourcesRoutes(app, { vaultPath: dir });
  registerKbScrapeRoutes(app, {
    vaultPath: dir,
    spawnScrapeCli: (args, onLine, onExit) => {
      setImmediate(() => {
        const idx = args.indexOf("--selectors");
        const sels = idx >= 0 ? args[idx + 1]!.split(",") : [];
        for (const h of sels) {
          onLine(JSON.stringify({ type: "scrape_started", source: "x", handle: h }));
          onLine(JSON.stringify({ type: "scrape_completed", source: "x", handle: h,
                                  stats: { fetched: 0, skipped: 0 } }));
        }
        onExit(0);
      });
      return () => {};
    },
  });
});
afterEach(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

describe("e2e raw source acquisition", () => {
  it("PUT sources → GET sees the same → POST scrape streams events for the handles", async () => {
    const put = await app.inject({
      method: "PUT", url: "/api/kb/sources",
      payload: {
        version: 1,
        wechat: [],
        x: [{ handle: "sama" }, { handle: "karpathy" }],
        web: [],
      },
    });
    expect(put.statusCode).toBe(200);
    expect(existsSync(join(dir, "sources.yaml"))).toBe(true);

    const get = await app.inject({ method: "GET", url: "/api/kb/sources" });
    const data = get.json() as { x: Array<{ handle: string }> };
    expect(data.x.map((e) => e.handle)).toEqual(["sama", "karpathy"]);

    const scrape = await app.inject({
      method: "POST", url: "/api/kb/scrape",
      payload: { source: "x", selectors: ["sama", "karpathy"] },
    });
    expect(scrape.statusCode).toBe(200);
    const body = scrape.body;
    expect(body).toContain("\"handle\":\"sama\"");
    expect(body).toContain("\"handle\":\"karpathy\"");
    expect(body).toContain("scrape_completed");
  });
});
```

- [ ] **Step 2: Run. Expected: PASS (1 test). If fails, fix whatever link in the chain is broken.**

```bash
pnpm --filter @crossing/web-server vitest run tests/e2e-source-acquisition.test.ts
```

- [ ] **Step 3: Commit.**

```bash
git add packages/web-server/tests/e2e-source-acquisition.test.ts
git commit -m "test(web-server): e2e source acquisition flow"
```

---

## T16 — Final integration smoke + push

**Steps:**

- [ ] **Step 1: Run the entire workspace test suite.**

```bash
pnpm -r --parallel test
```

Expected: all existing tests plus the new ones pass. If any existing test breaks (e.g. kb-accounts test didn't know about the new `source_kind` column in rows), fix inline.

- [ ] **Step 2: Start dev, click through.**

```bash
# Dev server is managed by the user, do not restart.
# Just manually verify in a browser:
# 1. http://localhost:3000/knowledge — top-right "原素材获取" button present
# 2. Click it — console opens with 3 tabs
# 3. Default tab (公众号) shows existing wechat accounts from seed
# 4. Switch to X — shows the seeded list, items checkboxable
# 5. Add a handle via the + input, verify sources.yaml on disk reflects it
# 6. Click "拉取选中" with 1 handle → streaming log shows scrape_started / scrape_stub / scrape_completed
# 7. Click 入库 button → segment at top → switch to X / 外网 → accounts list empty (stub scraper didn't insert)
```

- [ ] **Step 3: Push.**

```bash
git push origin main
```

---

## Self-review summary (for future reference)

**Spec coverage:**
- ref_articles + source_kind column → T1
- sources.yaml single source of truth → T2 + T5 + T8 + T11
- fetch-cursor state → T3 (used by future scrapers)
- CLI dispatcher + stubs → T4
- /api/kb/scrape SSE → T6
- /api/kb/accounts + /articles filter → T7
- SourceFetchFab + Console + Panel + Log → T9 / T10 / T11 / T12
- IngestTab segment → T13
- Seed defaults → T14
- End-to-end integration → T15 / T16
- Wechat continues via existing bulk_import (unchanged; dispatcher stub emits success) → documented in T4
- X / web scrapers deferred to sub-projects 2/3 → documented in T4

**Type consistency:**
- `SourcesFile` shape (version, wechat, x, web) used consistently in T2, T5, T8, T11, T14
- `ScrapeEvent` union imported from sources-client used in T8, T10, T11
- `SourceKind = "wechat" | "x" | "web"` used in T7, T8, T11, T13

**Placeholder scan:** clean — every step has concrete code / commands / expected output.
