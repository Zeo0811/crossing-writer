# SP-07 Wiki + Ingestor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Karpathy LLM Wiki 范式：raw 文章（refs.sqlite）经 Ingestor agent 增量编译成 wiki（entities/concepts/cases/observations/persons 页 + index.md + log.md + CROSSING_WIKI_GUIDE.md），并提供 search_wiki 只读 skill + CLI + `/knowledge` UI。MVP 对 4 账号各前 50 篇跑全量 ingest。
**Architecture:** `packages/kb/src/wiki/` 放存储/索引/搜索/orchestrator；`packages/agents/src/roles/wiki-ingestor-agent.ts` + 一份 guide.md；NDJSON patch 协议（upsert/append_source/append_image/add_backlink/note），宿主 apply + 自动重建 index.md + 追加 log.md。前端新 `KnowledgePage`（Tab 浏览 / Tab ingest）。search_wiki 用内存倒排索引（MVP 规模 <500 页）。
**Tech Stack:** TypeScript / Node / Fastify SSE / React / Vitest / better-sqlite3（raw） / 无新增 dep

---

## Task Index (21 total)

- M1: T1-T3 wiki 基础（types + store + raw-image-extractor）
- M2: T4-T5 ingestor agent + snapshot-builder
- M3: T6-T7 orchestrator (full + incremental)
- M4: T8-T9 index-maintainer + searchWiki
- M5: T10-T12 后端路由
- M6: T13-T14 CLI
- M7: T15-T19 前端
- M8: T20-T21 集成 + e2e

---

## Pre-flight

```bash
cd /Users/zeoooo/crossing-writer
git checkout main
git pull --ff-only
git checkout -b sp07
```

确认依赖（不新增，只复用）：

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
packages/kb/src/wiki/
├── types.ts
├── wiki-store.ts
├── raw-image-extractor.ts
├── snapshot-builder.ts
├── orchestrator.ts
├── index-maintainer.ts
└── search-wiki.ts

packages/kb/tests/wiki/
├── wiki-store.test.ts
├── raw-image-extractor.test.ts
├── snapshot-builder.test.ts
├── orchestrator.test.ts
├── orchestrator-incremental.test.ts
├── index-maintainer.test.ts
└── search-wiki.test.ts
```

**New files (agents):**

```
packages/agents/src/roles/wiki-ingestor-agent.ts
packages/agents/src/prompts/wiki-ingestor.md
packages/agents/src/prompts/CROSSING_WIKI_GUIDE.md   ← seed，首次 ingest 时 copy 到 vault/wiki/
packages/agents/tests/wiki-ingestor-agent.test.ts
```

**New files (web-server):**

```
packages/web-server/src/routes/kb-wiki.ts
packages/web-server/tests/routes-kb-wiki-ingest.test.ts
packages/web-server/tests/routes-kb-wiki-pages.test.ts
```

**Modified:**

```
packages/kb/src/index.ts                 ← 导出 wiki 模块
packages/agents/src/index.ts             ← 导出 WikiIngestorAgent
packages/web-server/src/server.ts        ← mount kb-wiki route
```

---

## 关键类型约定（T1 首次定义后贯穿，所有 task 共用）

```ts
// packages/kb/src/wiki/types.ts
export type WikiKind = "entity" | "concept" | "case" | "observation" | "person";

export interface WikiFrontmatter {
  type: WikiKind;
  title: string;
  aliases?: string[];
  sources: Array<{ account: string; article_id: string; quoted: string }>;
  backlinks?: string[];
  images?: Array<{ url: string; caption?: string; from_article?: string }>;
  last_ingest: string;
  [key: string]: unknown;
}

export interface WikiPage { path: string; frontmatter: WikiFrontmatter; body: string }

export type PatchOp =
  | { op: "upsert"; path: string; frontmatter: Partial<WikiFrontmatter>; body: string }
  | { op: "append_source"; path: string; source: { account: string; article_id: string; quoted: string } }
  | { op: "append_image"; path: string; image: { url: string; caption?: string; from_article?: string } }
  | { op: "add_backlink"; path: string; to: string }
  | { op: "note"; body: string };

export type IngestMode = "full" | "incremental";

export interface IngestStepEvent {
  type: "batch_started" | "op_applied" | "batch_completed" | "batch_failed" | "account_completed" | "all_completed";
  account?: string;
  batchIndex?: number;
  totalBatches?: number;
  op?: string;
  path?: string;
  duration_ms?: number;
  stats?: Record<string, unknown>;
  error?: string;
}

export interface IngestOptions {
  accounts: string[];
  perAccountLimit: number;
  batchSize: number;
  since?: string; until?: string;
  cliModel?: { cli: "claude" | "codex"; model?: string };
  mode: IngestMode;
  onEvent?: (ev: IngestStepEvent) => void;
}

export interface IngestResult {
  accounts_done: string[];
  pages_created: number;
  pages_updated: number;
  sources_appended: number;
  images_appended: number;
  notes: string[];
}

export interface SearchWikiInput { query: string; kind?: WikiKind; limit?: number }
export interface SearchWikiResult {
  path: string; kind: WikiKind; title: string; aliases: string[];
  excerpt: string; frontmatter: WikiFrontmatter; score: number;
}
```

---

### Task 1: types.ts + frontmatter serde

**Files:**
- Create: `packages/kb/src/wiki/types.ts`
- Create: `packages/kb/src/wiki/wiki-store.ts` (partial: 仅 parseFrontmatter / serializeFrontmatter)
- Create: `packages/kb/tests/wiki/wiki-store.test.ts` (partial)

- [ ] **Step 1: Write failing test**

Create `packages/kb/tests/wiki/wiki-store.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseFrontmatter, serializeFrontmatter } from "../../src/wiki/wiki-store.js";
import type { WikiFrontmatter } from "../../src/wiki/types.js";

describe("wiki-store frontmatter serde", () => {
  it("parses a basic frontmatter+body", () => {
    const raw = [
      "---",
      "type: entity",
      "title: PixVerse-C1",
      "aliases:",
      "  - PixVerse",
      "  - C1",
      "sources:",
      "  - account: 十字路口",
      "    article_id: a1",
      "    quoted: C1 的能力",
      "last_ingest: 2026-04-14T10:00:00Z",
      "---",
      "",
      "# PixVerse-C1",
      "",
      "body here",
    ].join("\n");
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter.type).toBe("entity");
    expect(frontmatter.title).toBe("PixVerse-C1");
    expect(frontmatter.aliases).toEqual(["PixVerse", "C1"]);
    expect(frontmatter.sources).toHaveLength(1);
    expect(frontmatter.sources[0]!.article_id).toBe("a1");
    expect(body.trim().startsWith("# PixVerse-C1")).toBe(true);
  });

  it("serialize roundtrips", () => {
    const fm: WikiFrontmatter = {
      type: "concept",
      title: "AI 漫剧",
      aliases: ["漫剧"],
      sources: [{ account: "卡兹克", article_id: "x", quoted: "测试\"引号\"" }],
      backlinks: ["entities/PixVerse-C1.md"],
      images: [],
      last_ingest: "2026-04-14T00:00:00Z",
    };
    const body = "# AI 漫剧\n\n正文\n";
    const text = serializeFrontmatter(fm, body);
    const parsed = parseFrontmatter(text);
    expect(parsed.frontmatter.type).toBe("concept");
    expect(parsed.frontmatter.sources[0]!.quoted).toContain("引号");
    expect(parsed.frontmatter.backlinks).toEqual(["entities/PixVerse-C1.md"]);
    expect(parsed.body.trim()).toBe("# AI 漫剧\n\n正文".trim());
  });

  it("handles file without frontmatter (returns empty-ish frontmatter)", () => {
    const { frontmatter, body } = parseFrontmatter("# title\n\nbody");
    expect(frontmatter.title).toBe("");
    expect(body.startsWith("# title")).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/wiki/wiki-store.test.ts
```

- [ ] **Step 3: Implement**

Create `packages/kb/src/wiki/types.ts` 按上文"关键类型约定"完整抄入。

Create `packages/kb/src/wiki/wiki-store.ts` (初版只含 serde；其余 op 在 T2 补完):

```ts
import type { WikiFrontmatter, WikiKind } from "./types.js";

const FM_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function yamlEscape(s: string): string {
  if (/[:\n"#]/.test(s) || s.trim() !== s) return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return s;
}

function yamlUnescape(s: string): string {
  const t = s.trim();
  if (t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return t;
}

export function parseFrontmatter(text: string): { frontmatter: WikiFrontmatter; body: string } {
  const m = FM_RE.exec(text);
  if (!m) {
    return {
      frontmatter: { type: "entity", title: "", sources: [], last_ingest: "" },
      body: text,
    };
  }
  const yaml = m[1]!;
  const body = m[2] ?? "";
  const fm = parseYamlBlock(yaml);
  return { frontmatter: normalizeFrontmatter(fm), body };
}

function normalizeFrontmatter(raw: Record<string, unknown>): WikiFrontmatter {
  const type = (raw.type as string) ?? "entity";
  return {
    type: (["entity", "concept", "case", "observation", "person"].includes(type) ? type : "entity") as WikiKind,
    title: (raw.title as string) ?? "",
    aliases: (raw.aliases as string[]) ?? undefined,
    sources: (raw.sources as WikiFrontmatter["sources"]) ?? [],
    backlinks: (raw.backlinks as string[]) ?? undefined,
    images: (raw.images as WikiFrontmatter["images"]) ?? undefined,
    last_ingest: (raw.last_ingest as string) ?? "",
    ...Object.fromEntries(
      Object.entries(raw).filter(([k]) => !["type", "title", "aliases", "sources", "backlinks", "images", "last_ingest"].includes(k)),
    ),
  };
}

function parseYamlBlock(yaml: string): Record<string, unknown> {
  const lines = yaml.split(/\n/);
  const out: Record<string, unknown> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim() || line.trim().startsWith("#")) { i += 1; continue; }
    const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!kv) { i += 1; continue; }
    const key = kv[1]!;
    const rest = kv[2]!;
    if (rest.trim() === "") {
      // block: sequence of `- ...` or `- key: val` objects, or nested map
      const items: unknown[] = [];
      let peeked = i + 1;
      const baseIndent = 2;
      while (peeked < lines.length && lines[peeked]!.startsWith(" ".repeat(baseIndent))) {
        const l = lines[peeked]!;
        if (/^\s*-\s/.test(l)) {
          const first = l.replace(/^\s*-\s*/, "");
          if (/^[A-Za-z_][A-Za-z0-9_]*:/.test(first)) {
            // object item — collect until next `- ` or dedent
            const obj: Record<string, string> = {};
            const putKV = (txt: string) => {
              const m2 = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(txt);
              if (m2) obj[m2[1]!] = yamlUnescape(m2[2]!);
            };
            putKV(first);
            peeked += 1;
            while (peeked < lines.length && lines[peeked]!.startsWith(" ".repeat(baseIndent + 2))) {
              putKV(lines[peeked]!.trim());
              peeked += 1;
            }
            items.push(obj);
          } else {
            items.push(yamlUnescape(first));
            peeked += 1;
          }
        } else {
          peeked += 1;
        }
      }
      out[key] = items;
      i = peeked;
    } else {
      out[key] = yamlUnescape(rest);
      i += 1;
    }
  }
  return out;
}

export function serializeFrontmatter(fm: WikiFrontmatter, body: string): string {
  const lines: string[] = ["---"];
  lines.push(`type: ${fm.type}`);
  lines.push(`title: ${yamlEscape(fm.title)}`);
  if (fm.aliases && fm.aliases.length > 0) {
    lines.push(`aliases:`);
    for (const a of fm.aliases) lines.push(`  - ${yamlEscape(a)}`);
  }
  lines.push(`sources:`);
  for (const s of fm.sources ?? []) {
    lines.push(`  - account: ${yamlEscape(s.account)}`);
    lines.push(`    article_id: ${yamlEscape(s.article_id)}`);
    lines.push(`    quoted: ${yamlEscape(s.quoted)}`);
  }
  if (fm.backlinks && fm.backlinks.length > 0) {
    lines.push(`backlinks:`);
    for (const b of fm.backlinks) lines.push(`  - ${yamlEscape(b)}`);
  }
  if (fm.images && fm.images.length > 0) {
    lines.push(`images:`);
    for (const im of fm.images) {
      lines.push(`  - url: ${yamlEscape(im.url)}`);
      if (im.caption !== undefined) lines.push(`    caption: ${yamlEscape(im.caption)}`);
      if (im.from_article !== undefined) lines.push(`    from_article: ${yamlEscape(im.from_article)}`);
    }
  }
  lines.push(`last_ingest: ${yamlEscape(fm.last_ingest)}`);
  // extension fields
  for (const [k, v] of Object.entries(fm)) {
    if (["type", "title", "aliases", "sources", "backlinks", "images", "last_ingest"].includes(k)) continue;
    if (typeof v === "string") lines.push(`${k}: ${yamlEscape(v)}`);
    else if (typeof v === "number" || typeof v === "boolean") lines.push(`${k}: ${v}`);
  }
  lines.push("---", "");
  return lines.join("\n") + body;
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/wiki/wiki-store.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/kb/src/wiki/types.ts packages/kb/src/wiki/wiki-store.ts packages/kb/tests/wiki/wiki-store.test.ts && git -c commit.gpgsign=false commit -m "feat(kb): SP-07 wiki types + frontmatter serde"
```

---

### Task 2: wiki-store apply 5 op + 自动反向 backlink

**Files:**
- Modify: `packages/kb/src/wiki/wiki-store.ts`
- Modify: `packages/kb/tests/wiki/wiki-store.test.ts`

- [ ] **Step 1: Write failing test**

追加到 `packages/kb/tests/wiki/wiki-store.test.ts` 末尾：

```ts
import { WikiStore } from "../../src/wiki/wiki-store.js";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function tmpVault(): string {
  return mkdtempSync(join(tmpdir(), "wiki-store-"));
}

describe("WikiStore.applyPatch", () => {
  it("upsert creates a new page with frontmatter + body", () => {
    const dir = tmpVault();
    const store = new WikiStore(dir);
    store.applyPatch({
      op: "upsert",
      path: "entities/PixVerse-C1.md",
      frontmatter: { type: "entity", title: "PixVerse-C1", aliases: ["C1"] },
      body: "# PixVerse-C1\n\n说明\n",
    });
    const text = readFileSync(join(dir, "entities/PixVerse-C1.md"), "utf-8");
    expect(text).toContain("type: entity");
    expect(text).toContain("title: PixVerse-C1");
    expect(text).toContain("# PixVerse-C1");
  });

  it("upsert merges into existing (preserves sources/backlinks already there)", () => {
    const dir = tmpVault();
    const store = new WikiStore(dir);
    store.applyPatch({ op: "upsert", path: "entities/E.md", frontmatter: { type: "entity", title: "E" }, body: "v1" });
    store.applyPatch({ op: "append_source", path: "entities/E.md", source: { account: "A", article_id: "a1", quoted: "q1" } });
    store.applyPatch({ op: "upsert", path: "entities/E.md", frontmatter: { type: "entity", title: "E", aliases: ["e"] }, body: "v2" });
    const page = store.readPage("entities/E.md")!;
    expect(page.body.trim()).toBe("v2");
    expect(page.frontmatter.sources.map((s) => s.article_id)).toContain("a1");
    expect(page.frontmatter.aliases).toEqual(["e"]);
  });

  it("append_source is idempotent on same (account,article_id)", () => {
    const dir = tmpVault();
    const store = new WikiStore(dir);
    store.applyPatch({ op: "upsert", path: "entities/E.md", frontmatter: { type: "entity", title: "E" }, body: "x" });
    store.applyPatch({ op: "append_source", path: "entities/E.md", source: { account: "A", article_id: "a1", quoted: "q" } });
    store.applyPatch({ op: "append_source", path: "entities/E.md", source: { account: "A", article_id: "a1", quoted: "q-again" } });
    const page = store.readPage("entities/E.md")!;
    expect(page.frontmatter.sources).toHaveLength(1);
  });

  it("append_image is idempotent on same url", () => {
    const dir = tmpVault();
    const store = new WikiStore(dir);
    store.applyPatch({ op: "upsert", path: "entities/E.md", frontmatter: { type: "entity", title: "E" }, body: "x" });
    store.applyPatch({ op: "append_image", path: "entities/E.md", image: { url: "http://i/1.png" } });
    store.applyPatch({ op: "append_image", path: "entities/E.md", image: { url: "http://i/1.png", caption: "dup" } });
    const page = store.readPage("entities/E.md")!;
    expect(page.frontmatter.images).toHaveLength(1);
  });

  it("add_backlink also creates reverse backlink on target page", () => {
    const dir = tmpVault();
    const store = new WikiStore(dir);
    store.applyPatch({ op: "upsert", path: "concepts/A.md", frontmatter: { type: "concept", title: "A" }, body: "a" });
    store.applyPatch({ op: "upsert", path: "entities/B.md", frontmatter: { type: "entity", title: "B" }, body: "b" });
    store.applyPatch({ op: "add_backlink", path: "concepts/A.md", to: "entities/B.md" });
    const a = store.readPage("concepts/A.md")!;
    const b = store.readPage("entities/B.md")!;
    expect(a.frontmatter.backlinks).toContain("entities/B.md");
    expect(b.frontmatter.backlinks).toContain("concepts/A.md");
  });

  it("add_backlink skips self-reference and duplicates", () => {
    const dir = tmpVault();
    const store = new WikiStore(dir);
    store.applyPatch({ op: "upsert", path: "concepts/A.md", frontmatter: { type: "concept", title: "A" }, body: "a" });
    store.applyPatch({ op: "add_backlink", path: "concepts/A.md", to: "concepts/A.md" });
    store.applyPatch({ op: "upsert", path: "entities/B.md", frontmatter: { type: "entity", title: "B" }, body: "b" });
    store.applyPatch({ op: "add_backlink", path: "concepts/A.md", to: "entities/B.md" });
    store.applyPatch({ op: "add_backlink", path: "concepts/A.md", to: "entities/B.md" });
    const a = store.readPage("concepts/A.md")!;
    expect(a.frontmatter.backlinks?.filter((l) => l === "concepts/A.md") ?? []).toHaveLength(0);
    expect(a.frontmatter.backlinks?.filter((l) => l === "entities/B.md") ?? []).toHaveLength(1);
  });

  it("rejects path escaping vault (no ..)", () => {
    const dir = tmpVault();
    const store = new WikiStore(dir);
    expect(() => store.applyPatch({ op: "upsert", path: "../evil.md", frontmatter: { type: "entity", title: "x" }, body: "x" })).toThrow(/invalid path/i);
  });

  it("rejects path outside allowed kind folders", () => {
    const dir = tmpVault();
    const store = new WikiStore(dir);
    expect(() => store.applyPatch({ op: "upsert", path: "random/X.md", frontmatter: { type: "entity", title: "x" }, body: "x" })).toThrow(/invalid path/i);
  });

  it("listPages returns pages under kind dirs only", () => {
    const dir = tmpVault();
    const store = new WikiStore(dir);
    store.applyPatch({ op: "upsert", path: "entities/A.md", frontmatter: { type: "entity", title: "A" }, body: "a" });
    store.applyPatch({ op: "upsert", path: "concepts/B.md", frontmatter: { type: "concept", title: "B" }, body: "b" });
    const paths = store.listPages().map((p) => p.path).sort();
    expect(paths).toEqual(["concepts/B.md", "entities/A.md"]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/wiki/wiki-store.test.ts
```

- [ ] **Step 3: Implement**

追加到 `packages/kb/src/wiki/wiki-store.ts`：

```ts
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, normalize, relative, sep } from "node:path";
import type { PatchOp, WikiPage, WikiFrontmatter } from "./types.js";

const ALLOWED_DIRS = ["entities", "concepts", "cases", "observations", "persons"] as const;

function assertSafePath(vault: string, rel: string): string {
  const abs = normalize(join(vault, rel));
  const back = relative(vault, abs);
  if (back.startsWith("..") || back.startsWith(sep) || back.includes(".." + sep)) {
    throw new Error(`invalid path (escapes vault): ${rel}`);
  }
  const top = back.split(/[\\/]/)[0];
  if (!ALLOWED_DIRS.includes(top as (typeof ALLOWED_DIRS)[number])) {
    throw new Error(`invalid path (not an allowed kind dir): ${rel}`);
  }
  if (!back.endsWith(".md")) throw new Error(`invalid path (must end with .md): ${rel}`);
  return abs;
}

export class WikiStore {
  constructor(private vaultPath: string) {
    mkdirSync(vaultPath, { recursive: true });
  }

  absPath(rel: string): string { return assertSafePath(this.vaultPath, rel); }

  readPage(rel: string): WikiPage | null {
    const abs = this.absPath(rel);
    if (!existsSync(abs)) return null;
    const text = readFileSync(abs, "utf-8");
    const { frontmatter, body } = parseFrontmatter(text);
    return { path: rel, frontmatter, body };
  }

  writePage(page: WikiPage): void {
    const abs = this.absPath(page.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, serializeFrontmatter(page.frontmatter, page.body), "utf-8");
  }

  listPages(): WikiPage[] {
    const out: WikiPage[] = [];
    for (const kind of ALLOWED_DIRS) {
      const dir = join(this.vaultPath, kind);
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(".md")) continue;
        const rel = `${kind}/${name}`;
        const p = this.readPage(rel);
        if (p) out.push(p);
      }
    }
    return out;
  }

  applyPatch(op: PatchOp): { created: boolean; updated: boolean; noted?: string } {
    if (op.op === "note") return { created: false, updated: false, noted: op.body };
    const abs = this.absPath(op.path);
    const existed = existsSync(abs);
    const existing = existed ? this.readPage(op.path)! : null;

    if (op.op === "upsert") {
      const base: WikiFrontmatter = existing?.frontmatter ?? {
        type: (op.frontmatter.type as WikiFrontmatter["type"]) ?? "entity",
        title: op.frontmatter.title ?? "",
        sources: [],
        last_ingest: "",
      };
      const merged: WikiFrontmatter = {
        ...base,
        ...op.frontmatter,
        sources: [...(base.sources ?? []), ...((op.frontmatter.sources as WikiFrontmatter["sources"]) ?? [])]
          .filter(dedupeSourceKey()),
        backlinks: dedupeStr([...(base.backlinks ?? []), ...(op.frontmatter.backlinks ?? [])]),
        images: dedupeImage([...(base.images ?? []), ...(op.frontmatter.images ?? [])]),
        last_ingest: op.frontmatter.last_ingest ?? base.last_ingest ?? new Date().toISOString(),
      };
      this.writePage({ path: op.path, frontmatter: merged, body: op.body });
      return { created: !existed, updated: existed };
    }

    if (!existing) throw new Error(`page not found for op ${op.op}: ${op.path}`);

    if (op.op === "append_source") {
      const list = [...(existing.frontmatter.sources ?? [])];
      const key = `${op.source.account}::${op.source.article_id}`;
      if (!list.some((s) => `${s.account}::${s.article_id}` === key)) list.push(op.source);
      existing.frontmatter.sources = list;
      existing.frontmatter.last_ingest = new Date().toISOString();
      this.writePage(existing);
      return { created: false, updated: true };
    }

    if (op.op === "append_image") {
      const list = [...(existing.frontmatter.images ?? [])];
      if (!list.some((im) => im.url === op.image.url)) list.push(op.image);
      existing.frontmatter.images = list;
      this.writePage(existing);
      return { created: false, updated: true };
    }

    if (op.op === "add_backlink") {
      if (op.to === op.path) return { created: false, updated: false };
      const list = dedupeStr([...(existing.frontmatter.backlinks ?? []), op.to]);
      existing.frontmatter.backlinks = list;
      this.writePage(existing);
      // reverse link
      const target = this.readPage(op.to);
      if (target) {
        target.frontmatter.backlinks = dedupeStr([...(target.frontmatter.backlinks ?? []), op.path]);
        this.writePage(target);
      }
      return { created: false, updated: true };
    }

    return { created: false, updated: false };
  }
}

function dedupeSourceKey() {
  const seen = new Set<string>();
  return (s: { account: string; article_id: string }) => {
    const k = `${s.account}::${s.article_id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  };
}
function dedupeStr(arr: string[]): string[] {
  return Array.from(new Set(arr.filter((x) => x && x.length > 0)));
}
function dedupeImage(arr: WikiFrontmatter["images"] = []): WikiFrontmatter["images"] {
  const seen = new Set<string>();
  const out: NonNullable<WikiFrontmatter["images"]> = [];
  for (const im of arr ?? []) {
    if (seen.has(im.url)) continue;
    seen.add(im.url);
    out.push(im);
  }
  return out;
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/wiki/wiki-store.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/kb/src/wiki/wiki-store.ts packages/kb/tests/wiki/wiki-store.test.ts && git -c commit.gpgsign=false commit -m "feat(kb): SP-07 WikiStore apply 5 ops + auto reverse backlink"
```

---

### Task 3: raw-image-extractor

**Files:**
- Create: `packages/kb/src/wiki/raw-image-extractor.ts`
- Create: `packages/kb/tests/wiki/raw-image-extractor.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/kb/tests/wiki/raw-image-extractor.test.ts
import { describe, it, expect } from "vitest";
import { extractImagesFromHtml, extractImagesFromMarkdown } from "../../src/wiki/raw-image-extractor.js";

describe("raw-image-extractor HTML", () => {
  it("pulls src + alt as caption from <img>", () => {
    const html = `<p>x</p><img src="https://mmbiz.qpic.cn/a.png" alt="分镜一"/><img src='b.jpg'>`;
    const out = extractImagesFromHtml(html);
    expect(out).toHaveLength(2);
    expect(out[0]!.url).toBe("https://mmbiz.qpic.cn/a.png");
    expect(out[0]!.caption).toBe("分镜一");
    expect(out[1]!.url).toBe("b.jpg");
  });

  it("skips data: urls", () => {
    const html = `<img src="data:image/png;base64,xxx"/>`;
    expect(extractImagesFromHtml(html)).toEqual([]);
  });

  it("dedupes same url", () => {
    const html = `<img src="a.png"/><img src="a.png" alt="dup"/>`;
    const out = extractImagesFromHtml(html);
    expect(out).toHaveLength(1);
  });
});

describe("raw-image-extractor Markdown", () => {
  it("extracts ![alt](url) form", () => {
    const md = `正文\n\n![一个图](https://x/y.png)\n\n![](z.jpg)`;
    const out = extractImagesFromMarkdown(md);
    expect(out).toHaveLength(2);
    expect(out[0]!.caption).toBe("一个图");
    expect(out[1]!.caption).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/wiki/raw-image-extractor.test.ts
```

- [ ] **Step 3: Implement**

```ts
// packages/kb/src/wiki/raw-image-extractor.ts
export interface ExtractedImage { url: string; caption?: string }

const IMG_TAG = /<img\b[^>]*>/gi;
const SRC_RE = /\bsrc\s*=\s*["']([^"']+)["']/i;
const ALT_RE = /\balt\s*=\s*["']([^"']*)["']/i;

export function extractImagesFromHtml(html: string): ExtractedImage[] {
  const seen = new Set<string>();
  const out: ExtractedImage[] = [];
  const tags = html.match(IMG_TAG) ?? [];
  for (const tag of tags) {
    const srcM = SRC_RE.exec(tag);
    if (!srcM) continue;
    const url = srcM[1]!;
    if (url.startsWith("data:")) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const altM = ALT_RE.exec(tag);
    out.push({ url, ...(altM && altM[1] ? { caption: altM[1] } : {}) });
  }
  return out;
}

const MD_IMG = /!\[([^\]]*)\]\(([^)]+)\)/g;

export function extractImagesFromMarkdown(md: string): ExtractedImage[] {
  const seen = new Set<string>();
  const out: ExtractedImage[] = [];
  let m: RegExpExecArray | null;
  while ((m = MD_IMG.exec(md)) !== null) {
    const url = m[2]!.trim();
    if (!url || url.startsWith("data:")) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const alt = m[1]!.trim();
    out.push({ url, ...(alt ? { caption: alt } : {}) });
  }
  return out;
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/wiki/raw-image-extractor.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/kb/src/wiki/raw-image-extractor.ts packages/kb/tests/wiki/raw-image-extractor.test.ts && git -c commit.gpgsign=false commit -m "feat(kb): SP-07 raw-image-extractor for html + markdown"
```

---

### Task 4: CROSSING_WIKI_GUIDE.md + ingestor system prompt + agent class

**Files:**
- Create: `packages/agents/src/prompts/CROSSING_WIKI_GUIDE.md`
- Create: `packages/agents/src/prompts/wiki-ingestor.md`
- Create: `packages/agents/src/roles/wiki-ingestor-agent.ts`
- Create: `packages/agents/tests/wiki-ingestor-agent.test.ts`
- Modify: `packages/agents/src/index.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/agents/tests/wiki-ingestor-agent.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/model-adapter.js", () => ({
  invokeAgent: vi.fn(),
}));

import { invokeAgent } from "../src/model-adapter.js";
import { WikiIngestorAgent } from "../src/roles/wiki-ingestor-agent.js";

const mockInvoke = invokeAgent as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => { mockInvoke.mockReset(); });

describe("WikiIngestorAgent", () => {
  it("builds user message containing guide + articles + existing snapshot and returns parsed ops", async () => {
    mockInvoke.mockReturnValue({
      text: [
        `{"op":"upsert","path":"entities/E.md","frontmatter":{"type":"entity","title":"E"},"body":"# E"}`,
        `{"op":"append_source","path":"entities/E.md","source":{"account":"A","article_id":"a1","quoted":"q"}}`,
      ].join("\n"),
      meta: { cli: "claude", model: "opus", durationMs: 10 },
    });
    const agent = new WikiIngestorAgent({ cli: "claude", model: "opus" });
    const out = await agent.ingest({
      account: "A",
      batchIndex: 0,
      totalBatches: 1,
      articles: [{ id: "a1", title: "t", published_at: "2026-01-01", body_plain: "hello", images: [] }],
      existingPages: [{ path: "entities/E.md", frontmatter: { type: "entity", title: "E", sources: [], last_ingest: "" }, first_chars: "old" }],
      indexMd: "# index",
      wikiGuide: "GUIDE",
    });
    expect(out.ops).toHaveLength(2);
    expect(out.ops[0]!.op).toBe("upsert");
    expect(mockInvoke).toHaveBeenCalledOnce();
    const call = mockInvoke.mock.calls[0]![0];
    expect(call.userMessage).toContain("GUIDE");
    expect(call.userMessage).toContain("a1");
    expect(call.userMessage).toContain("entities/E.md");
    expect(call.agentKey).toBe("wiki.ingestor");
  });

  it("skips malformed NDJSON lines", async () => {
    mockInvoke.mockReturnValue({
      text: [
        `not json`,
        `{"op":"note","body":"ok"}`,
        `{broken`,
        `{"op":"upsert","path":"entities/X.md","frontmatter":{"type":"entity","title":"X"},"body":"x"}`,
      ].join("\n"),
      meta: { cli: "claude", durationMs: 1 },
    });
    const agent = new WikiIngestorAgent({ cli: "claude" });
    const out = await agent.ingest({
      account: "A", batchIndex: 0, totalBatches: 1,
      articles: [], existingPages: [], indexMd: "", wikiGuide: "",
    });
    expect(out.ops.map((o) => o.op)).toEqual(["note", "upsert"]);
  });

  it("strips fence around NDJSON", async () => {
    mockInvoke.mockReturnValue({
      text: "```ndjson\n" + `{"op":"note","body":"x"}` + "\n```",
      meta: { cli: "claude", durationMs: 1 },
    });
    const agent = new WikiIngestorAgent({ cli: "claude" });
    const out = await agent.ingest({
      account: "A", batchIndex: 0, totalBatches: 1,
      articles: [], existingPages: [], indexMd: "", wikiGuide: "",
    });
    expect(out.ops).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm test tests/wiki-ingestor-agent.test.ts
```

- [ ] **Step 3: Implement**

Create `packages/agents/src/prompts/CROSSING_WIKI_GUIDE.md`:

```markdown
# CROSSING_WIKI_GUIDE

十字路口 writer 的只读知识库规约。Ingestor 必须按此文档组织 wiki，writer 只读它。

## 1. 目录与 kind

- `entities/` — 具体可命名的实体（产品/工具/公司/机构/SDK）
- `concepts/` — 抽象概念、技法、模式、行业判断
- `cases/` — 具体实测 case（含 prompt + 结构 + 素材）
- `observations/` — 可独立引用的事实/数据点（带出处）
- `persons/` — 人物（作者、产品人、投资人、KOL）

## 2. 命名

- 文件名直接用中文 title（保留中文），空格替换为 `-`
- 禁用 `/` `:` `\` `?` `*` 等文件系统敏感字符
- Alias 多写在 frontmatter `aliases:`，不拆成多个文件

## 3. 去重优先

- 新文章提到的产品/概念若已有 wiki 页（title 或 alias 命中）→ 走 `append_source` / `upsert` 合并
- 只有确认是新实体/概念时才新建 `upsert`
- 命中判断至少覆盖 title 完全相等、alias 精确匹配、以及题干关键词高相似

## 4. 每条 source 必带

- `account` — 账号名
- `article_id` — raw 文章 id（writer 引用时带出处）
- `quoted` — 从原文摘 1-2 句原话（不可改写、不可总结）

## 5. 冲突处理

- 同一事实两篇说法不一 → 页面正文加 `<!-- conflict -->` 段，双方都写 + 各自 source
- 不要自行判定谁对

## 6. Backlink

- 概念页里提到某 entity → `add_backlink`（宿主自动反向建链）
- case 里涉及 entity 同理
- 不加 backlink 到同一页自己

## 7. 禁止

- 写主观评价 / LLM 自己"总结"的句子（只许事实 + 原文 quote）
- 编造 image URL（`images` 只能从 raw html/markdown 抽）
- 删除或重命名页面（本期只开放 upsert/append_source/append_image/add_backlink/note）

## 8. Frontmatter 字段（基础）

```yaml
type: entity|concept|case|observation|person
title: ...
aliases: [...]
sources:
  - { account, article_id, quoted }
backlinks: [path, ...]
images:
  - { url, caption?, from_article? }
last_ingest: ISO8601
```

按 kind 可扩展：
- entity: `category: product|tool|company|org`
- case: `prompt_text`, `structure`
- observation: `fact`, `data_point: {value, unit, as_of, source}`
- person: `role`, `affiliation`
```

Create `packages/agents/src/prompts/wiki-ingestor.md`:

```markdown
你是十字路口知识库 wiki 的编译师。

## 你的任务

- 输入：一批 raw 文章 + 当前 wiki 里**可能相关的现有页面**（snapshot）+ 索引 index.md + 规约 GUIDE
- 输出：NDJSON，每行一个 patch 指令；宿主按顺序 apply

## 必须遵守

1. 严格按 GUIDE 的分页原则、命名、去重、source 规则
2. 输出第一字符必须是 `{`，最后字符必须是 `}`；不要前言/说明/`” ``” ` 代码围栏
3. 每行一个独立 JSON object，**不要**包成数组
4. 能 `append_source` / `append_image` / `add_backlink` 合并到已有页的，不要新建
5. 新建一页必须写 `upsert`（frontmatter + body 一起给）
6. `quoted` 字段必须是 raw 文章的原句片段（1-2 句），不许改写
7. `add_backlink` 宿主会自动反向建链，不要再给反向那条
8. 一批文章如果没有实质变化，**至少输出一条** `{"op":"note","body":"empty batch: ..."}`

## NDJSON schema（严格）

```
{"op":"upsert","path":"<kind>/<name>.md","frontmatter":{ ... },"body":"..."}
{"op":"append_source","path":"<kind>/<name>.md","source":{"account":"...","article_id":"...","quoted":"..."}}
{"op":"append_image","path":"<kind>/<name>.md","image":{"url":"...","caption":"...","from_article":"..."}}
{"op":"add_backlink","path":"<kind>/<name>.md","to":"<other_kind>/<other>.md"}
{"op":"note","body":"..."}
```

- `path` 必须以 `entities/` / `concepts/` / `cases/` / `observations/` / `persons/` 开头
- `frontmatter.type` 必须等于路径的 kind

## Fail-soft

- 坏行宿主会 skip，不要尝试保险格式；但尽量保证每行都能独立解析
- 若本批全是已知内容 → 输出至少一条 note 说明
```

Create `packages/agents/src/roles/wiki-ingestor-agent.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { invokeAgent } from "../model-adapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(
  join(__dirname, "../prompts/wiki-ingestor.md"),
  "utf-8",
);

export interface IngestArticle {
  id: string;
  title: string;
  published_at: string;
  body_plain: string;
  images?: Array<{ url: string; caption?: string }>;
}

export interface ExistingPageSnapshot {
  path: string;
  frontmatter: Record<string, unknown>;
  first_chars: string;
}

export interface IngestorInput {
  account: string;
  batchIndex: number;
  totalBatches: number;
  articles: IngestArticle[];
  existingPages: ExistingPageSnapshot[];
  indexMd: string;
  wikiGuide: string;
}

export interface IngestorOp { op: string; [k: string]: unknown }

export interface IngestorOutput {
  ops: IngestorOp[];
  meta: { cli: string; model?: string | null; durationMs: number };
}

function stripFence(text: string): string {
  const m = /^```(?:ndjson|json)?\s*([\s\S]*?)\s*```\s*$/m.exec(text.trim());
  return m ? m[1]!.trim() : text.trim();
}

export function parseNdjsonOps(raw: string): IngestorOp[] {
  const text = stripFence(raw);
  const out: IngestorOp[] = [];
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || !l.startsWith("{")) continue;
    try {
      const obj = JSON.parse(l);
      if (obj && typeof obj === "object" && typeof obj.op === "string") out.push(obj as IngestorOp);
    } catch {
      // skip malformed
    }
  }
  return out;
}

export class WikiIngestorAgent {
  constructor(private opts: { cli: "claude" | "codex"; model?: string }) {}

  async ingest(input: IngestorInput): Promise<IngestorOutput> {
    const articlesBlock = input.articles.map((a) => [
      `## article ${a.id}`,
      `标题：${a.title}  日期：${a.published_at}`,
      ``,
      a.body_plain,
      ``,
      a.images && a.images.length > 0
        ? `images:\n${a.images.map((im) => `  - ${im.url}${im.caption ? ` (${im.caption})` : ""}`).join("\n")}`
        : "",
    ].filter(Boolean).join("\n")).join("\n\n---\n\n");

    const snapshotBlock = input.existingPages.length === 0
      ? "(空 wiki，没有现有相关页面)"
      : input.existingPages.map((p) => [
          `### ${p.path}`,
          `frontmatter: ${JSON.stringify(p.frontmatter)}`,
          `preview: ${p.first_chars}`,
        ].join("\n")).join("\n\n");

    const userMessage = [
      `# GUIDE`,
      input.wikiGuide,
      ``,
      `# 当前 index.md`,
      input.indexMd || "(空)",
      ``,
      `# 可能相关的现有页面`,
      snapshotBlock,
      ``,
      `# 账号：${input.account}`,
      `# 批次：${input.batchIndex + 1} / ${input.totalBatches}`,
      ``,
      `# 文章（${input.articles.length} 篇）`,
      articlesBlock,
      ``,
      `输出 NDJSON。第一字符必须是 "{"。`,
    ].join("\n");

    const result = invokeAgent({
      agentKey: "wiki.ingestor",
      cli: this.opts.cli,
      model: this.opts.model,
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
    });
    const ops = parseNdjsonOps(result.text);
    return { ops, meta: { cli: result.meta.cli, model: result.meta.model ?? null, durationMs: result.meta.durationMs } };
  }
}
```

Modify `packages/agents/src/index.ts` — 追加导出：

```ts
export { WikiIngestorAgent, parseNdjsonOps } from "./roles/wiki-ingestor-agent.js";
export type { IngestorInput, IngestorOp, IngestorOutput, IngestArticle, ExistingPageSnapshot } from "./roles/wiki-ingestor-agent.js";
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/agents && pnpm test tests/wiki-ingestor-agent.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/agents/src/prompts/CROSSING_WIKI_GUIDE.md packages/agents/src/prompts/wiki-ingestor.md packages/agents/src/roles/wiki-ingestor-agent.ts packages/agents/src/index.ts packages/agents/tests/wiki-ingestor-agent.test.ts && git -c commit.gpgsign=false commit -m "feat(agents): SP-07 WikiIngestorAgent + GUIDE + NDJSON parser"
```

---

### Task 5: snapshot-builder（根据本批 raw 挑 top-K 可能相关现有页）

**Files:**
- Create: `packages/kb/src/wiki/snapshot-builder.ts`
- Create: `packages/kb/tests/wiki/snapshot-builder.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/kb/tests/wiki/snapshot-builder.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WikiStore } from "../../src/wiki/wiki-store.js";
import { buildSnapshot } from "../../src/wiki/snapshot-builder.js";

function seed() {
  const dir = mkdtempSync(join(tmpdir(), "snap-"));
  const s = new WikiStore(dir);
  s.applyPatch({ op: "upsert", path: "entities/PixVerse-C1.md", frontmatter: { type: "entity", title: "PixVerse-C1", aliases: ["PixVerse", "C1"] }, body: "# PixVerse-C1\n\nPixVerse C1 是视频生成模型" });
  s.applyPatch({ op: "upsert", path: "concepts/AI漫剧.md", frontmatter: { type: "concept", title: "AI漫剧", aliases: ["漫剧"] }, body: "# AI漫剧\n\n漫剧是指..." });
  s.applyPatch({ op: "upsert", path: "entities/LibTV.md", frontmatter: { type: "entity", title: "LibTV" }, body: "# LibTV\n\nLibTV 是 AI 电视" });
  return { dir, s };
}

describe("buildSnapshot", () => {
  it("returns pages whose title/alias match article titles", () => {
    const { dir } = seed();
    const snap = buildSnapshot(dir, [
      { id: "a1", title: "PixVerse C1 实测", published_at: "2026-01-01", body_plain: "..." },
    ], 10);
    const paths = snap.pages.map((p) => p.path);
    expect(paths).toContain("entities/PixVerse-C1.md");
  });

  it("matches on body_plain keywords against titles/aliases", () => {
    const { dir } = seed();
    const snap = buildSnapshot(dir, [
      { id: "a1", title: "本周动态", published_at: "2026-01-01", body_plain: "这周 AI漫剧 成为热点" },
    ], 10);
    const paths = snap.pages.map((p) => p.path);
    expect(paths).toContain("concepts/AI漫剧.md");
  });

  it("respects topK and provides indexMd", () => {
    const { dir } = seed();
    const snap = buildSnapshot(dir, [
      { id: "a1", title: "PixVerse 和 LibTV 对比 漫剧", published_at: "2026-01-01", body_plain: "" },
    ], 2);
    expect(snap.pages.length).toBeLessThanOrEqual(2);
    expect(typeof snap.indexMd).toBe("string");
  });

  it("returns empty snapshot on empty wiki", () => {
    const dir = mkdtempSync(join(tmpdir(), "empty-"));
    const snap = buildSnapshot(dir, [{ id: "a1", title: "x", published_at: "2026-01-01", body_plain: "" }], 10);
    expect(snap.pages).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/wiki/snapshot-builder.test.ts
```

- [ ] **Step 3: Implement**

```ts
// packages/kb/src/wiki/snapshot-builder.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WikiStore } from "./wiki-store.js";
import type { ExistingPageSnapshot } from "@crossing/agents";

export interface BatchArticleLite {
  id: string; title: string; published_at: string; body_plain: string;
}

export interface Snapshot {
  pages: ExistingPageSnapshot[];
  indexMd: string;
}

function keywordsFromArticle(a: BatchArticleLite): string[] {
  const text = `${a.title}\n${a.body_plain.slice(0, 2000)}`;
  // crude: split on CJK punctuation / whitespace / ascii punct; keep tokens >= 2 chars
  const tokens = text.split(/[\s,.。，！？!?、：；:;()\[\]【】「」『』"'“”‘’<>《》/\\|—\-]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && t.length <= 20);
  return tokens;
}

export function buildSnapshot(vaultPath: string, articles: BatchArticleLite[], topK: number): Snapshot {
  const store = new WikiStore(vaultPath);
  const pages = store.listPages();
  const indexPath = join(vaultPath, "index.md");
  const indexMd = existsSync(indexPath) ? readFileSync(indexPath, "utf-8") : "";
  if (pages.length === 0 || articles.length === 0) return { pages: [], indexMd };

  const kws = new Set<string>();
  for (const a of articles) for (const k of keywordsFromArticle(a)) kws.add(k);

  const scored = pages.map((p) => {
    const needles: string[] = [p.frontmatter.title, ...(p.frontmatter.aliases ?? [])]
      .filter((x): x is string => typeof x === "string" && x.length > 0);
    let score = 0;
    for (const n of needles) {
      for (const k of kws) {
        if (k === n) score += 5;
        else if (n.length >= 2 && (k.includes(n) || n.includes(k))) score += 2;
      }
    }
    return { p, score };
  }).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score);

  return {
    pages: scored.slice(0, topK).map(({ p }) => ({
      path: p.path,
      frontmatter: p.frontmatter as unknown as Record<string, unknown>,
      first_chars: p.body.slice(0, 500),
    })),
    indexMd,
  };
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/wiki/snapshot-builder.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/kb/src/wiki/snapshot-builder.ts packages/kb/tests/wiki/snapshot-builder.test.ts && git -c commit.gpgsign=false commit -m "feat(kb): SP-07 snapshot-builder (top-K relevant pages)"
```

---

### Task 6: orchestrator runIngest 主流程（full mode）

**Files:**
- Create: `packages/kb/src/wiki/orchestrator.ts`
- Create: `packages/kb/tests/wiki/orchestrator.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/kb/tests/wiki/orchestrator.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

vi.mock("@crossing/agents", async () => {
  const actual = await vi.importActual<typeof import("@crossing/agents")>("@crossing/agents");
  return {
    ...actual,
    WikiIngestorAgent: class {
      constructor(_opts: unknown) {}
      async ingest(input: { account: string; batchIndex: number; articles: Array<{ id: string; title: string }> }) {
        // emit one upsert per article + one note
        const ops = [
          ...input.articles.map((a) => ({
            op: "upsert",
            path: `entities/${a.title.replace(/\s+/g, "-")}.md`,
            frontmatter: { type: "entity", title: a.title },
            body: `# ${a.title}\n\nbody from ${a.id}`,
          })),
          { op: "note", body: `batch ${input.batchIndex} of ${input.account}` },
        ];
        return { ops, meta: { cli: "claude", model: null, durationMs: 1 } };
      }
    },
  };
});

import { runIngest } from "../../src/wiki/orchestrator.js";

function seedSqlite(): { sqlitePath: string } {
  const dir = mkdtempSync(join(tmpdir(), "oc-sql-"));
  const p = join(dir, "refs.sqlite");
  const db = new Database(p);
  db.exec(`CREATE TABLE ref_articles (id TEXT PRIMARY KEY, account TEXT, title TEXT, published_at TEXT, word_count INTEGER, body_plain TEXT, body_html TEXT)`);
  const ins = db.prepare(`INSERT INTO ref_articles (id,account,title,published_at,word_count,body_plain,body_html) VALUES (?,?,?,?,?,?,?)`);
  for (let i = 0; i < 4; i += 1) {
    ins.run(`A${i}`, "AcctA", `TitleA-${i}`, `2026-01-${String(i + 1).padStart(2, "0")}`, 100, "body A", "<p>hi</p>");
  }
  for (let i = 0; i < 3; i += 1) {
    ins.run(`B${i}`, "AcctB", `TitleB-${i}`, `2026-02-${String(i + 1).padStart(2, "0")}`, 100, "body B", "");
  }
  db.close();
  return { sqlitePath: p };
}

describe("runIngest full mode", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("runs over 2 accounts, batches, applies ops, appends log.md, writes index.md", async () => {
    const { sqlitePath } = seedSqlite();
    const vault = mkdtempSync(join(tmpdir(), "oc-vault-"));
    const events: string[] = [];
    const res = await runIngest({
      accounts: ["AcctA", "AcctB"],
      perAccountLimit: 4,
      batchSize: 2,
      mode: "full",
      onEvent: (ev) => events.push(ev.type),
    }, { vaultPath: vault, sqlitePath });

    expect(res.accounts_done).toEqual(["AcctA", "AcctB"]);
    expect(res.pages_created).toBeGreaterThanOrEqual(7);
    expect(events).toContain("batch_started");
    expect(events).toContain("batch_completed");
    expect(events).toContain("account_completed");
    expect(events).toContain("all_completed");
    expect(existsSync(join(vault, "log.md"))).toBe(true);
    expect(existsSync(join(vault, "index.md"))).toBe(true);
    expect(existsSync(join(vault, "CROSSING_WIKI_GUIDE.md"))).toBe(true);
    const log = readFileSync(join(vault, "log.md"), "utf-8");
    expect(log).toMatch(/AcctA/);
  });

  it("single batch failure does not abort remaining batches", async () => {
    // flip mock to throw on batchIndex 0
    const { sqlitePath } = seedSqlite();
    const vault = mkdtempSync(join(tmpdir(), "oc-vault-"));
    const mod = await import("@crossing/agents");
    const Orig = mod.WikiIngestorAgent;
    let call = 0;
    (mod as unknown as { WikiIngestorAgent: unknown }).WikiIngestorAgent = class {
      constructor(_o: unknown) {}
      async ingest(input: { batchIndex: number }) {
        call += 1;
        if (call === 1) throw new Error("boom");
        return { ops: [{ op: "note", body: "ok" }], meta: { cli: "claude", durationMs: 1 } };
      }
    };
    try {
      const types: string[] = [];
      const res = await runIngest({
        accounts: ["AcctA"], perAccountLimit: 4, batchSize: 2, mode: "full",
        onEvent: (ev) => types.push(ev.type),
      }, { vaultPath: vault, sqlitePath });
      expect(types).toContain("batch_failed");
      expect(types).toContain("all_completed");
      expect(res.accounts_done).toContain("AcctA");
    } finally {
      (mod as unknown as { WikiIngestorAgent: unknown }).WikiIngestorAgent = Orig;
    }
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/wiki/orchestrator.test.ts
```

- [ ] **Step 3: Implement**

```ts
// packages/kb/src/wiki/orchestrator.ts
import Database from "better-sqlite3";
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WikiIngestorAgent, type IngestArticle, type IngestorOp } from "@crossing/agents";
import { WikiStore } from "./wiki-store.js";
import { buildSnapshot } from "./snapshot-builder.js";
import { rebuildIndex } from "./index-maintainer.js";
import { extractImagesFromHtml, extractImagesFromMarkdown } from "./raw-image-extractor.js";
import type { IngestOptions, IngestResult, IngestStepEvent, PatchOp } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Ctx { vaultPath: string; sqlitePath: string }

function emit(cb: IngestOptions["onEvent"], ev: IngestStepEvent) {
  if (cb) { try { cb(ev); } catch { /* swallow */ } }
}

function ensureVaultScaffold(vault: string): void {
  mkdirSync(vault, { recursive: true });
  for (const d of ["entities", "concepts", "cases", "observations", "persons"]) {
    mkdirSync(join(vault, d), { recursive: true });
  }
  const guideTarget = join(vault, "CROSSING_WIKI_GUIDE.md");
  if (!existsSync(guideTarget)) {
    // copy seed from agents package
    const seed = join(__dirname, "..", "..", "..", "agents", "src", "prompts", "CROSSING_WIKI_GUIDE.md");
    if (existsSync(seed)) copyFileSync(seed, guideTarget);
    else writeFileSync(guideTarget, "# CROSSING_WIKI_GUIDE\n\n(seed missing)\n", "utf-8");
  }
  if (!existsSync(join(vault, "log.md"))) writeFileSync(join(vault, "log.md"), "# Wiki Ingest Log\n\n", "utf-8");
}

function loadGuide(vault: string): string {
  const p = join(vault, "CROSSING_WIKI_GUIDE.md");
  return existsSync(p) ? readFileSync(p, "utf-8") : "";
}

function lastIngestedAt(vault: string, account: string): string | null {
  const logPath = join(vault, "log.md");
  if (!existsSync(logPath)) return null;
  const lines = readFileSync(logPath, "utf-8").split(/\r?\n/);
  // lines like: "- 2026-04-14T... account=AcctA max_published_at=2026-03-15 ops=7"
  let max: string | null = null;
  const re = new RegExp(`account=${escapeRe(account)} max_published_at=(\\S+)`);
  for (const l of lines) {
    const m = re.exec(l);
    if (m) { const v = m[1]!; if (!max || v > max) max = v; }
  }
  return max;
}

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

interface RawRow {
  id: string; account: string; title: string; published_at: string;
  body_plain: string | null; body_html: string | null;
}

function loadArticles(sqlitePath: string, account: string, opts: {
  perAccountLimit: number; since?: string; until?: string; mode: IngestOptions["mode"]; sinceAuto?: string | null;
}): IngestArticle[] {
  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  try {
    const where: string[] = ["account = @a"];
    const params: Record<string, unknown> = { a: account };
    if (opts.since) { where.push("published_at >= @s"); params.s = opts.since; }
    if (opts.until) { where.push("published_at <= @u"); params.u = opts.until; }
    if (opts.mode === "incremental" && opts.sinceAuto) { where.push("published_at > @sa"); params.sa = opts.sinceAuto; }
    const sql = `SELECT id, account, title, published_at, body_plain, body_html FROM ref_articles WHERE ${where.join(" AND ")} ORDER BY published_at DESC LIMIT @lim`;
    params.lim = opts.perAccountLimit;
    const rows = db.prepare(sql).all(params) as RawRow[];
    return rows.map((r) => {
      const bodyPlain = r.body_plain ?? "";
      const imgs = r.body_html ? extractImagesFromHtml(r.body_html) : extractImagesFromMarkdown(bodyPlain);
      return {
        id: r.id, title: r.title, published_at: r.published_at, body_plain: bodyPlain, images: imgs,
      };
    });
  } finally { db.close(); }
}

function toPatchOp(op: IngestorOp): PatchOp | null {
  if (op.op === "upsert" && typeof op.path === "string") {
    return { op: "upsert", path: op.path, frontmatter: (op.frontmatter as PatchOp extends { op: "upsert" } ? never : never) ?? {} as never, body: (op.body as string) ?? "" } as unknown as PatchOp;
  }
  if (op.op === "append_source" && typeof op.path === "string" && op.source) {
    return { op: "append_source", path: op.path, source: op.source as { account: string; article_id: string; quoted: string } };
  }
  if (op.op === "append_image" && typeof op.path === "string" && op.image) {
    return { op: "append_image", path: op.path, image: op.image as { url: string; caption?: string; from_article?: string } };
  }
  if (op.op === "add_backlink" && typeof op.path === "string" && typeof op.to === "string") {
    return { op: "add_backlink", path: op.path, to: op.to };
  }
  if (op.op === "note" && typeof op.body === "string") {
    return { op: "note", body: op.body };
  }
  return null;
}

export async function runIngest(opts: IngestOptions, ctx: Ctx): Promise<IngestResult> {
  ensureVaultScaffold(ctx.vaultPath);
  const store = new WikiStore(ctx.vaultPath);
  const guide = loadGuide(ctx.vaultPath);
  const agent = new WikiIngestorAgent({ cli: opts.cliModel?.cli ?? "claude", model: opts.cliModel?.model });

  let pagesCreated = 0;
  let pagesUpdated = 0;
  let sourcesAppended = 0;
  let imagesAppended = 0;
  const notes: string[] = [];
  const accountsDone: string[] = [];

  for (const account of opts.accounts) {
    const sinceAuto = opts.mode === "incremental" ? lastIngestedAt(ctx.vaultPath, account) : null;
    const articles = loadArticles(ctx.sqlitePath, account, {
      perAccountLimit: opts.perAccountLimit,
      since: opts.since, until: opts.until,
      mode: opts.mode, sinceAuto,
    });
    if (articles.length === 0) {
      emit(opts.onEvent, { type: "account_completed", account, stats: { articles_processed: 0 } });
      accountsDone.push(account);
      continue;
    }
    const batches: IngestArticle[][] = [];
    for (let i = 0; i < articles.length; i += opts.batchSize) batches.push(articles.slice(i, i + opts.batchSize));

    let maxPublished = articles[0]!.published_at;
    let accountOps = 0;

    for (let bi = 0; bi < batches.length; bi += 1) {
      const batch = batches[bi]!;
      emit(opts.onEvent, { type: "batch_started", account, batchIndex: bi, totalBatches: batches.length, stats: { articles_in_batch: batch.length } });
      const t0 = Date.now();
      try {
        const snap = buildSnapshot(ctx.vaultPath, batch, 10);
        const res = await agent.ingest({
          account, batchIndex: bi, totalBatches: batches.length,
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
            emit(opts.onEvent, { type: "op_applied", account, op: patch.op, path: patch.op !== "note" ? patch.path : undefined });
          } catch (e) {
            emit(opts.onEvent, { type: "op_applied", account, op: patch.op, error: (e as Error).message });
          }
        }
        accountOps += opsApplied;
        for (const a of batch) if (a.published_at > maxPublished) maxPublished = a.published_at;
        emit(opts.onEvent, { type: "batch_completed", account, batchIndex: bi, totalBatches: batches.length, duration_ms: Date.now() - t0, stats: { ops_applied: opsApplied } });
      } catch (e) {
        emit(opts.onEvent, { type: "batch_failed", account, batchIndex: bi, totalBatches: batches.length, error: (e as Error).message });
      }
    }

    appendFileSync(join(ctx.vaultPath, "log.md"), `- ${new Date().toISOString()} account=${account} max_published_at=${maxPublished} articles=${articles.length} ops=${accountOps}\n`, "utf-8");
    emit(opts.onEvent, { type: "account_completed", account, stats: { articles_processed: articles.length, ops: accountOps } });
    accountsDone.push(account);
  }

  rebuildIndex(ctx.vaultPath);
  emit(opts.onEvent, { type: "all_completed", stats: { accounts_done: accountsDone.length, pages_created: pagesCreated, pages_updated: pagesUpdated } });

  return { accounts_done: accountsDone, pages_created: pagesCreated, pages_updated: pagesUpdated, sources_appended: sourcesAppended, images_appended: imagesAppended, notes };
}
```

注意：`rebuildIndex` 在 T8 实现；为让 T6 单测通过，先在 `index-maintainer.ts` 放一个 stub（T8 再补实现+测试）：

```ts
// packages/kb/src/wiki/index-maintainer.ts (stub, will be completed in T8)
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function rebuildIndex(vaultPath: string): void {
  const p = join(vaultPath, "index.md");
  if (!existsSync(p)) writeFileSync(p, "# Wiki Index\n\n(to be filled)\n", "utf-8");
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/wiki/orchestrator.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/kb/src/wiki/orchestrator.ts packages/kb/src/wiki/index-maintainer.ts packages/kb/tests/wiki/orchestrator.test.ts && git -c commit.gpgsign=false commit -m "feat(kb): SP-07 runIngest orchestrator (full mode, SSE events, soft-fail batches)"
```

---

### Task 7: incremental mode + log.md 追加验证

**Files:**
- Modify: `packages/kb/src/wiki/orchestrator.ts` (mode=incremental 已覆盖；补细节)
- Create: `packages/kb/tests/wiki/orchestrator-incremental.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/kb/tests/wiki/orchestrator-incremental.test.ts
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

vi.mock("@crossing/agents", async () => {
  const actual = await vi.importActual<typeof import("@crossing/agents")>("@crossing/agents");
  return {
    ...actual,
    WikiIngestorAgent: class {
      constructor(_o: unknown) {}
      async ingest(input: { articles: Array<{ id: string; title: string; published_at: string }> }) {
        return {
          ops: input.articles.map((a) => ({
            op: "upsert",
            path: `entities/${a.id}.md`,
            frontmatter: { type: "entity", title: a.id },
            body: `# ${a.id}`,
          })),
          meta: { cli: "claude", durationMs: 1 },
        };
      }
    },
  };
});

import { runIngest } from "../../src/wiki/orchestrator.js";

function mkDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "inc-"));
  const p = join(dir, "refs.sqlite");
  const db = new Database(p);
  db.exec(`CREATE TABLE ref_articles (id TEXT PRIMARY KEY, account TEXT, title TEXT, published_at TEXT, word_count INTEGER, body_plain TEXT, body_html TEXT)`);
  const ins = db.prepare(`INSERT INTO ref_articles VALUES (?,?,?,?,?,?,?)`);
  ins.run("X1", "A", "X1", "2026-01-01", 10, "b", "");
  ins.run("X2", "A", "X2", "2026-02-01", 10, "b", "");
  ins.run("X3", "A", "X3", "2026-03-01", 10, "b", "");
  db.close();
  return p;
}

describe("runIngest incremental mode", () => {
  it("only processes articles newer than last logged max_published_at", async () => {
    const sqlitePath = mkDb();
    const vault = mkdtempSync(join(tmpdir(), "inc-v-"));
    mkdirSync(vault, { recursive: true });
    writeFileSync(join(vault, "log.md"), `# log\n\n- 2026-04-01T00:00:00Z account=A max_published_at=2026-01-31 articles=1 ops=1\n`, "utf-8");

    const res = await runIngest({
      accounts: ["A"], perAccountLimit: 100, batchSize: 10, mode: "incremental",
    }, { vaultPath: vault, sqlitePath });

    // should have skipped X1 (2026-01-01 < 2026-01-31) and picked X2, X3
    expect(res.pages_created).toBe(2);
    expect(existsSync(join(vault, "entities/X2.md"))).toBe(true);
    expect(existsSync(join(vault, "entities/X3.md"))).toBe(true);
    expect(existsSync(join(vault, "entities/X1.md"))).toBe(false);
  });

  it("full mode ignores prior log cutoff", async () => {
    const sqlitePath = mkDb();
    const vault = mkdtempSync(join(tmpdir(), "inc-f-"));
    mkdirSync(vault, { recursive: true });
    writeFileSync(join(vault, "log.md"), `# log\n\n- 2026-04-01T00:00:00Z account=A max_published_at=2026-05-01 articles=1 ops=1\n`, "utf-8");

    const res = await runIngest({
      accounts: ["A"], perAccountLimit: 100, batchSize: 10, mode: "full",
    }, { vaultPath: vault, sqlitePath });

    expect(res.pages_created).toBe(3);
  });

  it("appends a new log line per account", async () => {
    const sqlitePath = mkDb();
    const vault = mkdtempSync(join(tmpdir(), "inc-l-"));
    await runIngest({ accounts: ["A"], perAccountLimit: 100, batchSize: 10, mode: "full" }, { vaultPath: vault, sqlitePath });
    const log = readFileSync(join(vault, "log.md"), "utf-8");
    const matches = log.match(/account=A max_published_at=/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/wiki/orchestrator-incremental.test.ts
```

- [ ] **Step 3: Implement**

incremental 主逻辑在 T6 `loadArticles` + `lastIngestedAt` 已写好；若 T6 测试过的同时这组也跑通即可。若 fail，核对：
1. `lastIngestedAt` 解析 log.md 行格式是否和 T6 `appendFileSync` 写入格式一致（都是 `account=<name> max_published_at=<date>`）
2. `mode === "incremental"` 分支在 `loadArticles` 加 `published_at > @sa`（严格大于；等于不 ingest，避免重复最后一篇）
3. 若 log.md 不存在或无匹配行 → 回退到"取 perAccountLimit 条最新"

若需修补 `orchestrator.ts`，确保上述 3 点；复跑测试。

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/wiki/orchestrator-incremental.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/kb/src/wiki/orchestrator.ts packages/kb/tests/wiki/orchestrator-incremental.test.ts && git -c commit.gpgsign=false commit -m "feat(kb): SP-07 incremental ingest mode + per-account log.md append"
```

---

### Task 8: index-maintainer 重建 index.md

**Files:**
- Modify: `packages/kb/src/wiki/index-maintainer.ts`
- Create: `packages/kb/tests/wiki/index-maintainer.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/kb/tests/wiki/index-maintainer.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WikiStore } from "../../src/wiki/wiki-store.js";
import { rebuildIndex } from "../../src/wiki/index-maintainer.js";

function seed(): string {
  const dir = mkdtempSync(join(tmpdir(), "idx-"));
  const s = new WikiStore(dir);
  s.applyPatch({ op: "upsert", path: "entities/A.md", frontmatter: { type: "entity", title: "A" }, body: "a" });
  s.applyPatch({ op: "upsert", path: "entities/B.md", frontmatter: { type: "entity", title: "B" }, body: "b" });
  s.applyPatch({ op: "upsert", path: "concepts/C.md", frontmatter: { type: "concept", title: "C" }, body: "c" });
  s.applyPatch({ op: "upsert", path: "cases/D.md", frontmatter: { type: "case", title: "D" }, body: "d" });
  s.applyPatch({ op: "add_backlink", path: "concepts/C.md", to: "entities/A.md" });
  s.applyPatch({ op: "add_backlink", path: "concepts/C.md", to: "entities/B.md" });
  return dir;
}

describe("rebuildIndex", () => {
  it("writes index.md with by-kind sections and counts", () => {
    const dir = seed();
    rebuildIndex(dir);
    const text = readFileSync(join(dir, "index.md"), "utf-8");
    expect(text).toMatch(/# Wiki Index/);
    expect(text).toMatch(/## entities \(2\)/);
    expect(text).toMatch(/## concepts \(1\)/);
    expect(text).toMatch(/## cases \(1\)/);
    expect(text).toContain("[A](entities/A.md)");
    expect(text).toContain("[C](concepts/C.md)");
  });

  it("includes by-backlink-heat ranking section", () => {
    const dir = seed();
    rebuildIndex(dir);
    const text = readFileSync(join(dir, "index.md"), "utf-8");
    expect(text).toMatch(/## 热度（按 backlink 数）/);
    // C has 2 backlinks, A/B each have 1 reverse
    const heatSection = text.split("## 热度（按 backlink 数）")[1] ?? "";
    expect(heatSection.indexOf("concepts/C.md")).toBeGreaterThanOrEqual(0);
  });

  it("handles empty wiki gracefully", () => {
    const dir = mkdtempSync(join(tmpdir(), "empty-idx-"));
    rebuildIndex(dir);
    const text = readFileSync(join(dir, "index.md"), "utf-8");
    expect(text).toMatch(/# Wiki Index/);
    expect(text).toMatch(/## entities \(0\)/);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/wiki/index-maintainer.test.ts
```

- [ ] **Step 3: Implement**

替换 T6 留下的 stub：

```ts
// packages/kb/src/wiki/index-maintainer.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { WikiStore } from "./wiki-store.js";
import type { WikiKind, WikiPage } from "./types.js";

const KINDS: WikiKind[] = ["entity", "concept", "case", "observation", "person"];
const KIND_DIR: Record<WikiKind, string> = {
  entity: "entities", concept: "concepts", case: "cases", observation: "observations", person: "persons",
};

export function rebuildIndex(vaultPath: string): void {
  const store = new WikiStore(vaultPath);
  const pages = store.listPages();
  const byDir: Record<string, WikiPage[]> = { entities: [], concepts: [], cases: [], observations: [], persons: [] };
  for (const p of pages) {
    const top = p.path.split("/")[0]!;
    if (byDir[top]) byDir[top]!.push(p);
  }
  const lines: string[] = ["# Wiki Index", "", `_updated ${new Date().toISOString()}_`, ""];

  for (const kind of KINDS) {
    const dir = KIND_DIR[kind];
    const list = byDir[dir]!;
    lines.push(`## ${dir} (${list.length})`);
    list.sort((a, b) => a.frontmatter.title.localeCompare(b.frontmatter.title));
    for (const p of list) lines.push(`- [${p.frontmatter.title}](${p.path})`);
    lines.push("");
  }

  const heat = [...pages].map((p) => ({ p, n: (p.frontmatter.backlinks ?? []).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 30);
  lines.push(`## 热度（按 backlink 数）`);
  for (const { p, n } of heat) lines.push(`- [${p.frontmatter.title}](${p.path}) — ${n}`);
  lines.push("");

  writeFileSync(join(vaultPath, "index.md"), lines.join("\n"), "utf-8");
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/wiki/index-maintainer.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/kb/src/wiki/index-maintainer.ts packages/kb/tests/wiki/index-maintainer.test.ts && git -c commit.gpgsign=false commit -m "feat(kb): SP-07 rebuildIndex (by kind + backlink heat)"
```

---

### Task 9: searchWiki 只读 skill（内存倒排 + TF-IDF）

**Files:**
- Create: `packages/kb/src/wiki/search-wiki.ts`
- Create: `packages/kb/tests/wiki/search-wiki.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/kb/tests/wiki/search-wiki.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WikiStore } from "../../src/wiki/wiki-store.js";
import { searchWiki } from "../../src/wiki/search-wiki.js";

function seed(): string {
  const dir = mkdtempSync(join(tmpdir(), "sw-"));
  const s = new WikiStore(dir);
  s.applyPatch({ op: "upsert", path: "entities/PixVerse-C1.md", frontmatter: { type: "entity", title: "PixVerse-C1", aliases: ["PixVerse", "C1"] }, body: "PixVerse C1 是一款视频生成模型。用于 AI 漫剧分镜。" });
  s.applyPatch({ op: "upsert", path: "concepts/AI漫剧.md", frontmatter: { type: "concept", title: "AI漫剧", aliases: ["漫剧"] }, body: "AI 漫剧是指用 AI 生成分镜的漫画剧。" });
  s.applyPatch({ op: "upsert", path: "entities/LibTV.md", frontmatter: { type: "entity", title: "LibTV" }, body: "LibTV 是 AI 电视平台，跟漫剧无关。" });
  s.applyPatch({ op: "upsert", path: "persons/镜山.md", frontmatter: { type: "person", title: "镜山" }, body: "镜山是产品人。" });
  return dir;
}

describe("searchWiki", () => {
  it("returns results matching query across title + body", async () => {
    const dir = seed();
    const out = await searchWiki({ query: "AI 漫剧" }, { vaultPath: dir });
    expect(out.length).toBeGreaterThan(0);
    const paths = out.map((r) => r.path);
    expect(paths).toContain("concepts/AI漫剧.md");
  });

  it("filters by kind", async () => {
    const dir = seed();
    const out = await searchWiki({ query: "漫剧", kind: "entity" }, { vaultPath: dir });
    expect(out.every((r) => r.kind === "entity")).toBe(true);
    expect(out.some((r) => r.path === "entities/PixVerse-C1.md")).toBe(true);
  });

  it("respects limit (default 5)", async () => {
    const dir = seed();
    const out = await searchWiki({ query: "AI", limit: 2 }, { vaultPath: dir });
    expect(out.length).toBeLessThanOrEqual(2);
  });

  it("returns [] on empty wiki", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sw-empty-"));
    const out = await searchWiki({ query: "anything" }, { vaultPath: dir });
    expect(out).toEqual([]);
  });

  it("alias match scores same as title match", async () => {
    const dir = seed();
    const out = await searchWiki({ query: "C1" }, { vaultPath: dir });
    expect(out[0]!.path).toBe("entities/PixVerse-C1.md");
  });

  it("each result includes excerpt (<=300 chars) + frontmatter + score", async () => {
    const dir = seed();
    const out = await searchWiki({ query: "AI 漫剧" }, { vaultPath: dir });
    for (const r of out) {
      expect(r.excerpt.length).toBeLessThanOrEqual(300);
      expect(typeof r.score).toBe("number");
      expect(r.frontmatter.type).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/wiki/search-wiki.test.ts
```

- [ ] **Step 3: Implement**

```ts
// packages/kb/src/wiki/search-wiki.ts
import { WikiStore } from "./wiki-store.js";
import type { SearchWikiInput, SearchWikiResult, WikiKind, WikiPage } from "./types.js";

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,.。，！？!?、：；:;()\[\]【】「」『』"'“”‘’<>《》/\\|—\-]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 1 && t.length <= 30);
}

function queryTokens(q: string): string[] {
  const base = tokenize(q);
  // CJK n-gram bigrams for short CJK tokens
  const extra: string[] = [];
  for (const t of base) {
    if (/[\u4e00-\u9fff]/.test(t) && t.length >= 2) {
      for (let i = 0; i < t.length - 1; i += 1) extra.push(t.slice(i, i + 2));
    }
  }
  return Array.from(new Set([...base, ...extra])).filter((x) => x.length > 0);
}

export async function searchWiki(input: SearchWikiInput, ctx: { vaultPath: string }): Promise<SearchWikiResult[]> {
  const store = new WikiStore(ctx.vaultPath);
  const pages = store.listPages();
  if (pages.length === 0) return [];
  const limit = input.limit ?? 5;
  const qtokens = queryTokens(input.query);
  if (qtokens.length === 0) return [];

  // doc freq
  const df: Record<string, number> = {};
  const docTokens: Map<string, Set<string>> = new Map();
  for (const p of pages) {
    const bag = new Set<string>([
      ...tokenize(p.frontmatter.title),
      ...((p.frontmatter.aliases ?? []).flatMap(tokenize)),
      ...tokenize(p.body.slice(0, 500)),
    ]);
    docTokens.set(p.path, bag);
    for (const t of bag) df[t] = (df[t] ?? 0) + 1;
  }
  const N = pages.length;

  const scored = pages.map((p) => {
    const bag = docTokens.get(p.path)!;
    let score = 0;
    const title = p.frontmatter.title.toLowerCase();
    const aliases = (p.frontmatter.aliases ?? []).map((a) => a.toLowerCase());
    for (const qt of qtokens) {
      if (title === qt || aliases.includes(qt)) score += 20;
      else if (title.includes(qt)) score += 10;
      else if (aliases.some((a) => a.includes(qt))) score += 8;
      if (bag.has(qt)) {
        const idf = Math.log(1 + N / (df[qt] ?? 1));
        score += idf;
      }
    }
    return { p, score };
  }).filter((x) => x.score > 0);

  scored.sort((a, b) => b.score - a.score);

  const filtered = input.kind ? scored.filter((x) => x.p.frontmatter.type === input.kind) : scored;

  return filtered.slice(0, limit).map(({ p, score }) => ({
    path: p.path,
    kind: p.frontmatter.type as WikiKind,
    title: p.frontmatter.title,
    aliases: p.frontmatter.aliases ?? [],
    excerpt: p.body.slice(0, 300),
    frontmatter: p.frontmatter,
    score,
  }));
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/kb && pnpm test tests/wiki/search-wiki.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/kb/src/wiki/search-wiki.ts packages/kb/tests/wiki/search-wiki.test.ts && git -c commit.gpgsign=false commit -m "feat(kb): SP-07 searchWiki in-memory inverted index + simple TF-IDF"
```

---

### Task 10: POST /api/kb/wiki/ingest (SSE)

**Files:**
- Create: `packages/web-server/src/routes/kb-wiki.ts` (part 1: POST ingest)
- Create: `packages/web-server/tests/routes-kb-wiki-ingest.test.ts`
- Modify: `packages/web-server/src/server.ts`
- Modify: `packages/kb/src/index.ts` (导出 wiki 模块)

- [ ] **Step 1: Write failing test**

```ts
// packages/web-server/tests/routes-kb-wiki-ingest.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

vi.mock("@crossing/kb", async () => {
  const actual = await vi.importActual<typeof import("@crossing/kb")>("@crossing/kb");
  return {
    ...actual,
    runIngest: vi.fn(async (opts: { onEvent?: (ev: unknown) => void; accounts: string[] }) => {
      opts.onEvent?.({ type: "batch_started", account: opts.accounts[0], batchIndex: 0, totalBatches: 1 });
      opts.onEvent?.({ type: "op_applied", op: "upsert", path: "entities/X.md" });
      opts.onEvent?.({ type: "batch_completed", account: opts.accounts[0], batchIndex: 0, totalBatches: 1 });
      opts.onEvent?.({ type: "account_completed", account: opts.accounts[0] });
      opts.onEvent?.({ type: "all_completed" });
      return { accounts_done: opts.accounts, pages_created: 1, pages_updated: 0, sources_appended: 0, images_appended: 0, notes: [] };
    }),
  };
});

import { registerKbWikiRoutes } from "../src/routes/kb-wiki.js";

function seedDb(): string {
  const d = mkdtempSync(join(tmpdir(), "wingest-"));
  const p = join(d, "refs.sqlite");
  const db = new Database(p);
  db.exec(`CREATE TABLE ref_articles (id TEXT PRIMARY KEY, account TEXT, title TEXT, published_at TEXT, word_count INTEGER, body_plain TEXT, body_html TEXT)`);
  db.prepare(`INSERT INTO ref_articles VALUES (?,?,?,?,?,?,?)`).run("a1", "A", "T", "2026-01-01", 10, "b", "");
  db.close();
  return p;
}

async function mk(vault: string, sqlitePath: string) {
  const app = Fastify();
  registerKbWikiRoutes(app, { vaultPath: vault, sqlitePath });
  await app.ready();
  return app;
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/kb/wiki/ingest", () => {
  it("400 on empty accounts", async () => {
    const vault = mkdtempSync(join(tmpdir(), "v1-"));
    const app = await mk(vault, seedDb());
    const res = await app.inject({ method: "POST", url: "/api/kb/wiki/ingest", payload: { accounts: [], per_account_limit: 5, batch_size: 2, mode: "full" } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("404 when account not in sqlite", async () => {
    const vault = mkdtempSync(join(tmpdir(), "v2-"));
    const app = await mk(vault, seedDb());
    const res = await app.inject({ method: "POST", url: "/api/kb/wiki/ingest", payload: { accounts: ["NOPE"], per_account_limit: 5, batch_size: 2, mode: "full" } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("400 on per_account_limit out of range", async () => {
    const vault = mkdtempSync(join(tmpdir(), "v3-"));
    const app = await mk(vault, seedDb());
    const res = await app.inject({ method: "POST", url: "/api/kb/wiki/ingest", payload: { accounts: ["A"], per_account_limit: 0, batch_size: 2, mode: "full" } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("400 on batch_size out of range", async () => {
    const vault = mkdtempSync(join(tmpdir(), "v4-"));
    const app = await mk(vault, seedDb());
    const res = await app.inject({ method: "POST", url: "/api/kb/wiki/ingest", payload: { accounts: ["A"], per_account_limit: 5, batch_size: 100, mode: "full" } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("streams SSE events including all_completed", async () => {
    const vault = mkdtempSync(join(tmpdir(), "v5-"));
    const app = await mk(vault, seedDb());
    const res = await app.inject({ method: "POST", url: "/api/kb/wiki/ingest", payload: { accounts: ["A"], per_account_limit: 5, batch_size: 2, mode: "full" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    const body = res.body;
    expect(body).toMatch(/event: ingest\.batch_started/);
    expect(body).toMatch(/event: ingest\.op_applied/);
    expect(body).toMatch(/event: ingest\.all_completed/);
    await app.close();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/routes-kb-wiki-ingest.test.ts
```

- [ ] **Step 3: Implement**

先更新 `packages/kb/src/index.ts` 导出：

```ts
// packages/kb/src/index.ts 追加
export { runIngest } from "./wiki/orchestrator.js";
export { WikiStore } from "./wiki/wiki-store.js";
export { searchWiki } from "./wiki/search-wiki.js";
export { rebuildIndex } from "./wiki/index-maintainer.js";
export type {
  WikiKind, WikiFrontmatter, WikiPage, PatchOp,
  IngestMode, IngestOptions, IngestResult, IngestStepEvent,
  SearchWikiInput, SearchWikiResult,
} from "./wiki/types.js";
```

Create `packages/web-server/src/routes/kb-wiki.ts`:

```ts
import type { FastifyInstance } from "fastify";
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { runIngest, type IngestMode, type IngestStepEvent } from "@crossing/kb";

export interface KbWikiDeps { vaultPath: string; sqlitePath: string }

interface IngestBody {
  accounts?: string[];
  per_account_limit?: number;
  batch_size?: number;
  mode?: IngestMode;
  since?: string;
  until?: string;
  cli_model?: { cli: "claude" | "codex"; model?: string };
}

function countAccount(sqlitePath: string, account: string): number {
  if (!existsSync(sqlitePath)) return 0;
  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  try {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ref_articles WHERE account = ?`).get(account) as { c: number };
    return row.c;
  } finally { db.close(); }
}

export function registerKbWikiRoutes(app: FastifyInstance, deps: KbWikiDeps) {
  app.post<{ Body: IngestBody }>("/api/kb/wiki/ingest", async (req, reply) => {
    const body = req.body ?? {};
    const accounts = body.accounts ?? [];
    if (!Array.isArray(accounts) || accounts.length === 0) {
      return reply.code(400).send({ error: "accounts must be a non-empty array" });
    }
    const perAccountLimit = body.per_account_limit ?? 50;
    if (!Number.isInteger(perAccountLimit) || perAccountLimit < 1 || perAccountLimit > 500) {
      return reply.code(400).send({ error: "per_account_limit must be integer in [1, 500]" });
    }
    const batchSize = body.batch_size ?? 5;
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 20) {
      return reply.code(400).send({ error: "batch_size must be integer in [1, 20]" });
    }
    const mode: IngestMode = body.mode ?? "full";
    if (mode !== "full" && mode !== "incremental") {
      return reply.code(400).send({ error: `invalid mode: ${mode}` });
    }
    for (const a of accounts) {
      if (countAccount(deps.sqlitePath, a) === 0) {
        return reply.code(404).send({ error: `account not found: ${a}` });
      }
    }

    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.hijack();

    const send = (type: string, data: Record<string, unknown>) => {
      reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const onEvent = (ev: IngestStepEvent) => {
      send(`ingest.${ev.type}`, {
        account: ev.account, batchIndex: ev.batchIndex, totalBatches: ev.totalBatches,
        op: ev.op, path: ev.path, duration_ms: ev.duration_ms, stats: ev.stats, error: ev.error,
      });
    };

    try {
      const result = await runIngest({
        accounts, perAccountLimit, batchSize, mode,
        since: body.since, until: body.until, cliModel: body.cli_model, onEvent,
      }, { vaultPath: deps.vaultPath, sqlitePath: deps.sqlitePath });
      send("ingest.result", result as unknown as Record<string, unknown>);
    } catch (err) {
      send("ingest.error", { error: (err as Error).message });
    } finally {
      reply.raw.end();
    }
  });
}
```

Modify `packages/web-server/src/server.ts` — import + mount（与 kb-style-panels 相邻）：

```ts
import { registerKbWikiRoutes } from "./routes/kb-wiki.js";
// ... in register section:
registerKbWikiRoutes(app, { vaultPath, sqlitePath });
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/routes-kb-wiki-ingest.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/kb/src/index.ts packages/web-server/src/routes/kb-wiki.ts packages/web-server/src/server.ts packages/web-server/tests/routes-kb-wiki-ingest.test.ts && git -c commit.gpgsign=false commit -m "feat(web-server): SP-07 POST /api/kb/wiki/ingest SSE route + validation"
```

---

### Task 11: GET /api/kb/wiki/pages + /api/kb/wiki/pages/*

**Files:**
- Modify: `packages/web-server/src/routes/kb-wiki.ts`
- Create: `packages/web-server/tests/routes-kb-wiki-pages.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/web-server/tests/routes-kb-wiki-pages.test.ts
import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WikiStore } from "@crossing/kb";
import { registerKbWikiRoutes } from "../src/routes/kb-wiki.js";

async function mk(): Promise<{ app: import("fastify").FastifyInstance; vault: string }> {
  const vault = mkdtempSync(join(tmpdir(), "wp-"));
  const store = new WikiStore(vault);
  store.applyPatch({ op: "upsert", path: "entities/A.md", frontmatter: { type: "entity", title: "A" }, body: "# A\n\nbody" });
  store.applyPatch({ op: "upsert", path: "concepts/B.md", frontmatter: { type: "concept", title: "B", aliases: ["b"] }, body: "# B" });
  const sqlitePath = join(vault, "refs.sqlite");
  writeFileSync(sqlitePath, ""); // existsSync check only
  const app = Fastify();
  registerKbWikiRoutes(app, { vaultPath: vault, sqlitePath });
  await app.ready();
  return { app, vault };
}

describe("GET /api/kb/wiki/pages", () => {
  it("lists all pages with meta", async () => {
    const { app } = await mk();
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/pages" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ path: string; kind: string; title: string }>;
    expect(body).toHaveLength(2);
    const paths = body.map((x) => x.path).sort();
    expect(paths).toEqual(["concepts/B.md", "entities/A.md"]);
    await app.close();
  });

  it("supports ?kind= filter", async () => {
    const { app } = await mk();
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/pages?kind=entity" });
    const body = res.json() as Array<{ kind: string }>;
    expect(body.every((x) => x.kind === "entity")).toBe(true);
    expect(body.length).toBe(1);
    await app.close();
  });
});

describe("GET /api/kb/wiki/pages/*", () => {
  it("returns raw markdown for a page", async () => {
    const { app } = await mk();
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/pages/entities/A.md" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/markdown|text\/plain/);
    expect(res.body).toContain("# A");
    expect(res.body).toContain("type: entity");
    await app.close();
  });

  it("404 on missing page", async () => {
    const { app } = await mk();
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/pages/entities/NOPE.md" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("403 on path-escape attempt", async () => {
    const { app } = await mk();
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/pages/../etc/passwd" });
    expect([400, 403, 404]).toContain(res.statusCode);
    await app.close();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/routes-kb-wiki-pages.test.ts
```

- [ ] **Step 3: Implement**

追加到 `packages/web-server/src/routes/kb-wiki.ts` 末尾（registerKbWikiRoutes 函数内）:

```ts
  app.get<{ Querystring: { kind?: string } }>("/api/kb/wiki/pages", async (req, reply) => {
    const { WikiStore } = await import("@crossing/kb");
    const store = new WikiStore(deps.vaultPath);
    const pages = store.listPages();
    const kind = req.query.kind;
    const out = pages
      .filter((p) => (kind ? p.frontmatter.type === kind : true))
      .map((p) => ({
        path: p.path,
        kind: p.frontmatter.type,
        title: p.frontmatter.title,
        aliases: p.frontmatter.aliases ?? [],
        sources_count: (p.frontmatter.sources ?? []).length,
        backlinks_count: (p.frontmatter.backlinks ?? []).length,
        last_ingest: p.frontmatter.last_ingest,
      }));
    return reply.send(out);
  });

  app.get<{ Params: { "*": string } }>("/api/kb/wiki/pages/*", async (req, reply) => {
    const rel = (req.params as { "*": string })["*"];
    if (!rel || rel.includes("..")) return reply.code(400).send({ error: "invalid path" });
    const { WikiStore } = await import("@crossing/kb");
    const store = new WikiStore(deps.vaultPath);
    let abs: string;
    try { abs = store.absPath(rel); } catch { return reply.code(400).send({ error: "invalid path" }); }
    const { existsSync, readFileSync } = await import("node:fs");
    if (!existsSync(abs)) return reply.code(404).send({ error: "not found" });
    reply.header("Content-Type", "text/markdown; charset=utf-8");
    return reply.send(readFileSync(abs, "utf-8"));
  });
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/routes-kb-wiki-pages.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/web-server/src/routes/kb-wiki.ts packages/web-server/tests/routes-kb-wiki-pages.test.ts && git -c commit.gpgsign=false commit -m "feat(web-server): SP-07 GET /api/kb/wiki/pages + /pages/* with path-safety"
```

---

### Task 12: GET /api/kb/wiki/search + GET /api/kb/wiki/status

**Files:**
- Modify: `packages/web-server/src/routes/kb-wiki.ts`
- Create: `packages/web-server/tests/routes-kb-wiki-search-status.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/web-server/tests/routes-kb-wiki-search-status.test.ts
import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WikiStore } from "@crossing/kb";
import { registerKbWikiRoutes } from "../src/routes/kb-wiki.js";

async function mk() {
  const vault = mkdtempSync(join(tmpdir(), "wss-"));
  const store = new WikiStore(vault);
  store.applyPatch({ op: "upsert", path: "entities/Alice.md", frontmatter: { type: "entity", title: "Alice", aliases: ["A"], last_ingest: "2026-04-14T00:00:00Z" }, body: "Alice is a researcher" });
  store.applyPatch({ op: "upsert", path: "concepts/RAG.md", frontmatter: { type: "concept", title: "RAG", last_ingest: "2026-04-14T00:00:00Z" }, body: "Retrieval Augmented Generation" });
  const sqlitePath = join(vault, "refs.sqlite");
  writeFileSync(sqlitePath, "");
  const app = Fastify();
  registerKbWikiRoutes(app, { vaultPath: vault, sqlitePath });
  await app.ready();
  return { app, vault };
}

describe("GET /api/kb/wiki/search", () => {
  it("returns ranked results", async () => {
    const { app } = await mk();
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/search?q=Alice" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ path: string; score: number }>;
    expect(body.length).toBeGreaterThan(0);
    expect(body[0].path).toBe("entities/Alice.md");
    await app.close();
  });

  it("supports kind filter and limit", async () => {
    const { app } = await mk();
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/search?q=R&kind=concept&limit=1" });
    const body = res.json() as Array<{ kind: string }>;
    expect(body.length).toBeLessThanOrEqual(1);
    expect(body.every((x) => x.kind === "concept")).toBe(true);
    await app.close();
  });

  it("400 on missing q", async () => {
    const { app } = await mk();
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/search" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("GET /api/kb/wiki/status", () => {
  it("reports counts per kind + last_ingest", async () => {
    const { app } = await mk();
    const res = await app.inject({ method: "GET", url: "/api/kb/wiki/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { total: number; by_kind: Record<string, number>; last_ingest_at: string | null };
    expect(body.total).toBe(2);
    expect(body.by_kind.entity).toBe(1);
    expect(body.by_kind.concept).toBe(1);
    expect(body.last_ingest_at).toBe("2026-04-14T00:00:00Z");
    await app.close();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/routes-kb-wiki-search-status.test.ts
```

- [ ] **Step 3: Implement**

追加到 `packages/web-server/src/routes/kb-wiki.ts`（registerKbWikiRoutes 函数内）:

```ts
  app.get<{ Querystring: { q?: string; kind?: string; limit?: string } }>("/api/kb/wiki/search", async (req, reply) => {
    const q = (req.query.q ?? "").trim();
    if (!q) return reply.code(400).send({ error: "q required" });
    const kind = req.query.kind as ("entity" | "concept" | "case" | "observation" | "person" | undefined);
    const limit = req.query.limit ? Math.max(1, Math.min(50, Number(req.query.limit))) : 10;
    const { searchWiki } = await import("@crossing/kb");
    const results = searchWiki(deps.vaultPath, { query: q, kind, limit });
    return reply.send(results);
  });

  app.get("/api/kb/wiki/status", async (_req, reply) => {
    const { WikiStore } = await import("@crossing/kb");
    const store = new WikiStore(deps.vaultPath);
    const pages = store.listPages();
    const by_kind: Record<string, number> = { entity: 0, concept: 0, case: 0, observation: 0, person: 0 };
    let last: string | null = null;
    for (const p of pages) {
      by_kind[p.frontmatter.type] = (by_kind[p.frontmatter.type] ?? 0) + 1;
      const li = p.frontmatter.last_ingest;
      if (li && (!last || li > last)) last = li;
    }
    return reply.send({ total: pages.length, by_kind, last_ingest_at: last });
  });
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/routes-kb-wiki-search-status.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/web-server/src/routes/kb-wiki.ts packages/web-server/tests/routes-kb-wiki-search-status.test.ts && git -c commit.gpgsign=false commit -m "feat(web-server): SP-07 GET /api/kb/wiki/search + /status"
```

---

### Task 13: CLI `wiki ingest` 子命令（流式 stdout）

**Files:**
- Modify: `packages/cli/src/index.ts`
- Create: `packages/cli/src/commands/wiki-ingest.ts`
- Create: `packages/cli/tests/wiki-ingest.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/cli/tests/wiki-ingest.test.ts
import { describe, it, expect, vi } from "vitest";
import { runWikiIngest } from "../src/commands/wiki-ingest.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@crossing/kb", async () => {
  return {
    runIngest: vi.fn(async (opts: { onEvent?: (e: unknown) => void; accounts: string[] }) => {
      opts.onEvent?.({ type: "start", account: opts.accounts[0] });
      opts.onEvent?.({ type: "batch_start", batchIndex: 0, totalBatches: 1 });
      opts.onEvent?.({ type: "patch_applied", op: "upsert", path: "entities/X.md" });
      opts.onEvent?.({ type: "done", stats: { pages: 1, sources: 1 } });
      return { ok: true };
    }),
  };
});

describe("runWikiIngest CLI", () => {
  it("streams events to stdout and resolves", async () => {
    const vault = mkdtempSync(join(tmpdir(), "wiv-"));
    const sqlitePath = join(vault, "refs.sqlite");
    const lines: string[] = [];
    const writer = (s: string) => { lines.push(s); };
    const code = await runWikiIngest({
      vaultPath: vault,
      sqlitePath,
      accounts: ["acc1"],
      perAccountLimit: 50,
      batchSize: 5,
      mode: "full",
      cli: "claude",
      model: "opus",
    }, writer);
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("start");
    expect(lines.join("\n")).toContain("entities/X.md");
    expect(lines.join("\n")).toContain("done");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/cli && pnpm test tests/wiki-ingest.test.ts
```

- [ ] **Step 3: Implement**

```ts
// packages/cli/src/commands/wiki-ingest.ts
export interface WikiIngestArgs {
  vaultPath: string;
  sqlitePath: string;
  accounts: string[];
  perAccountLimit: number;
  batchSize: number;
  mode: "full" | "incremental";
  since?: string;
  until?: string;
  cli?: "claude" | "codex";
  model?: string;
}

export async function runWikiIngest(args: WikiIngestArgs, write: (s: string) => void = (s) => process.stdout.write(s + "\n")): Promise<number> {
  const { runIngest } = await import("@crossing/kb");
  try {
    await runIngest({
      vaultPath: args.vaultPath,
      sqlitePath: args.sqlitePath,
      accounts: args.accounts,
      perAccountLimit: args.perAccountLimit,
      batchSize: args.batchSize,
      mode: args.mode,
      since: args.since,
      until: args.until,
      cliModel: args.cli && args.model ? { cli: args.cli, model: args.model } : undefined,
      onEvent: (e) => write(JSON.stringify(e)),
    });
    return 0;
  } catch (err) {
    write(JSON.stringify({ type: "error", error: (err as Error).message }));
    return 1;
  }
}
```

注册到 `packages/cli/src/index.ts`（commander）:

```ts
import { runWikiIngest } from "./commands/wiki-ingest.js";

const wiki = program.command("wiki").description("Wiki knowledge base operations");

wiki
  .command("ingest")
  .description("Ingest raw articles into wiki via Ingestor agent")
  .requiredOption("--accounts <names...>", "wechat account names")
  .option("--per-account <n>", "max raw articles per account", "50")
  .option("--batch-size <n>", "articles per ingestor batch", "5")
  .option("--mode <mode>", "full | incremental", "full")
  .option("--since <iso>", "incremental: only after this iso ts")
  .option("--until <iso>", "incremental: only before this iso ts")
  .option("--cli <cli>", "claude | codex", "claude")
  .option("--model <model>", "opus | sonnet | gpt-5", "opus")
  .option("--vault <path>", "vault path", process.cwd())
  .option("--sqlite <path>", "refs.sqlite path")
  .action(async (opts: { accounts: string[]; perAccount: string; batchSize: string; mode: string; since?: string; until?: string; cli: string; model: string; vault: string; sqlite?: string }) => {
    const code = await runWikiIngest({
      vaultPath: opts.vault,
      sqlitePath: opts.sqlite ?? `${opts.vault}/refs.sqlite`,
      accounts: opts.accounts,
      perAccountLimit: Number(opts.perAccount),
      batchSize: Number(opts.batchSize),
      mode: opts.mode as "full" | "incremental",
      since: opts.since,
      until: opts.until,
      cli: opts.cli as "claude" | "codex",
      model: opts.model,
    });
    process.exit(code);
  });
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/cli && pnpm test tests/wiki-ingest.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/cli/src/commands/wiki-ingest.ts packages/cli/src/index.ts packages/cli/tests/wiki-ingest.test.ts && git -c commit.gpgsign=false commit -m "feat(cli): SP-07 add 'wiki ingest' subcommand with stream stdout"
```

---

### Task 14: CLI `wiki search` / `wiki show` / `wiki status`

**Files:**
- Modify: `packages/cli/src/index.ts`
- Create: `packages/cli/src/commands/wiki-misc.ts`
- Create: `packages/cli/tests/wiki-misc.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/cli/tests/wiki-misc.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WikiStore } from "@crossing/kb";
import { runWikiSearch, runWikiShow, runWikiStatus } from "../src/commands/wiki-misc.js";

function setup() {
  const vault = mkdtempSync(join(tmpdir(), "wm-"));
  const store = new WikiStore(vault);
  store.applyPatch({ op: "upsert", path: "entities/Alice.md", frontmatter: { type: "entity", title: "Alice", last_ingest: "2026-04-14T00:00:00Z" }, body: "Alice researcher" });
  return vault;
}

describe("wiki search", () => {
  it("prints hits to stdout", async () => {
    const vault = setup();
    const lines: string[] = [];
    const code = await runWikiSearch({ vaultPath: vault, query: "Alice", limit: 5 }, (s) => lines.push(s));
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("entities/Alice.md");
  });
});

describe("wiki show", () => {
  it("prints page raw markdown", async () => {
    const vault = setup();
    const lines: string[] = [];
    const code = await runWikiShow({ vaultPath: vault, path: "entities/Alice.md" }, (s) => lines.push(s));
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("Alice researcher");
  });

  it("returns 1 on missing", async () => {
    const vault = setup();
    const lines: string[] = [];
    const code = await runWikiShow({ vaultPath: vault, path: "entities/NOPE.md" }, (s) => lines.push(s));
    expect(code).toBe(1);
  });
});

describe("wiki status", () => {
  it("prints counts json", async () => {
    const vault = setup();
    const lines: string[] = [];
    const code = await runWikiStatus({ vaultPath: vault }, (s) => lines.push(s));
    expect(code).toBe(0);
    const out = JSON.parse(lines.join("\n"));
    expect(out.total).toBe(1);
    expect(out.by_kind.entity).toBe(1);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/cli && pnpm test tests/wiki-misc.test.ts
```

- [ ] **Step 3: Implement**

```ts
// packages/cli/src/commands/wiki-misc.ts
import { existsSync, readFileSync } from "node:fs";

export async function runWikiSearch(
  args: { vaultPath: string; query: string; kind?: "entity" | "concept" | "case" | "observation" | "person"; limit?: number },
  write: (s: string) => void = (s) => process.stdout.write(s + "\n"),
): Promise<number> {
  const { searchWiki } = await import("@crossing/kb");
  const results = searchWiki(args.vaultPath, { query: args.query, kind: args.kind, limit: args.limit ?? 10 });
  for (const r of results) {
    write(`${r.score.toFixed(3)}\t${r.path}\t${r.title}`);
    if (r.excerpt) write(`        ${r.excerpt}`);
  }
  return 0;
}

export async function runWikiShow(
  args: { vaultPath: string; path: string },
  write: (s: string) => void = (s) => process.stdout.write(s + "\n"),
): Promise<number> {
  const { WikiStore } = await import("@crossing/kb");
  const store = new WikiStore(args.vaultPath);
  let abs: string;
  try { abs = store.absPath(args.path); } catch { write("invalid path"); return 1; }
  if (!existsSync(abs)) { write("not found"); return 1; }
  write(readFileSync(abs, "utf-8"));
  return 0;
}

export async function runWikiStatus(
  args: { vaultPath: string },
  write: (s: string) => void = (s) => process.stdout.write(s + "\n"),
): Promise<number> {
  const { WikiStore } = await import("@crossing/kb");
  const store = new WikiStore(args.vaultPath);
  const pages = store.listPages();
  const by_kind: Record<string, number> = { entity: 0, concept: 0, case: 0, observation: 0, person: 0 };
  let last: string | null = null;
  for (const p of pages) {
    by_kind[p.frontmatter.type] = (by_kind[p.frontmatter.type] ?? 0) + 1;
    const li = p.frontmatter.last_ingest;
    if (li && (!last || li > last)) last = li;
  }
  write(JSON.stringify({ total: pages.length, by_kind, last_ingest_at: last }, null, 2));
  return 0;
}
```

注册到 `packages/cli/src/index.ts`:

```ts
import { runWikiSearch, runWikiShow, runWikiStatus } from "./commands/wiki-misc.js";

wiki
  .command("search <query>")
  .option("--kind <kind>", "entity | concept | case | observation | person")
  .option("--limit <n>", "max hits", "10")
  .option("--vault <path>", "vault path", process.cwd())
  .action(async (query: string, opts: { kind?: string; limit: string; vault: string }) => {
    const code = await runWikiSearch({
      vaultPath: opts.vault,
      query,
      kind: opts.kind as "entity" | "concept" | "case" | "observation" | "person" | undefined,
      limit: Number(opts.limit),
    });
    process.exit(code);
  });

wiki
  .command("show <path>")
  .option("--vault <path>", "vault path", process.cwd())
  .action(async (path: string, opts: { vault: string }) => {
    const code = await runWikiShow({ vaultPath: opts.vault, path });
    process.exit(code);
  });

wiki
  .command("status")
  .option("--vault <path>", "vault path", process.cwd())
  .action(async (opts: { vault: string }) => {
    const code = await runWikiStatus({ vaultPath: opts.vault });
    process.exit(code);
  });
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/cli && pnpm test tests/wiki-misc.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/cli/src/commands/wiki-misc.ts packages/cli/src/index.ts packages/cli/tests/wiki-misc.test.ts && git -c commit.gpgsign=false commit -m "feat(cli): SP-07 add 'wiki search/show/status' subcommands"
```

---

### Task 15: web-ui wiki-client（REST + SSE）

**Files:**
- Create: `packages/web-ui/src/api/wiki-client.ts`
- Create: `packages/web-ui/tests/wiki-client.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/web-ui/tests/wiki-client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getPages, getPage, search, status } from "../src/api/wiki-client";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("wiki-client REST", () => {
  it("getPages calls /api/kb/wiki/pages", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => [{ path: "entities/A.md", kind: "entity", title: "A" }] });
    const out = await getPages();
    expect(out[0].path).toBe("entities/A.md");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/kb/wiki/pages");
  });

  it("getPages forwards kind filter", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => [] });
    await getPages("concept");
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/kb/wiki/pages?kind=concept");
  });

  it("getPage fetches markdown text", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, text: async () => "# A" });
    const out = await getPage("entities/A.md");
    expect(out).toBe("# A");
  });

  it("search returns ranked results", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => [{ path: "entities/A.md", score: 1 }] });
    const out = await search({ query: "A", kind: "entity", limit: 5 });
    expect(out[0].score).toBe(1);
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/kb/wiki/search?q=A&kind=entity&limit=5");
  });

  it("status returns counts", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({ total: 2, by_kind: { entity: 2 }, last_ingest_at: null }) });
    const out = await status();
    expect(out.total).toBe(2);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test tests/wiki-client.test.ts
```

- [ ] **Step 3: Implement**

```ts
// packages/web-ui/src/api/wiki-client.ts
export type WikiKind = "entity" | "concept" | "case" | "observation" | "person";

export interface WikiPageMeta {
  path: string;
  kind: WikiKind;
  title: string;
  aliases: string[];
  sources_count: number;
  backlinks_count: number;
  last_ingest?: string;
}

export interface WikiSearchResult {
  path: string;
  kind: WikiKind;
  title: string;
  aliases: string[];
  excerpt: string;
  frontmatter: Record<string, unknown>;
  score: number;
}

export interface WikiStatus {
  total: number;
  by_kind: Record<string, number>;
  last_ingest_at: string | null;
}

export interface IngestStepEvent {
  type: "start" | "batch_start" | "batch_done" | "patch_applied" | "log_appended" | "index_rebuilt" | "done" | "error";
  account?: string;
  batchIndex?: number;
  totalBatches?: number;
  op?: string;
  path?: string;
  duration_ms?: number;
  stats?: Record<string, number>;
  error?: string;
}

export async function getPages(kind?: WikiKind): Promise<WikiPageMeta[]> {
  const url = kind ? `/api/kb/wiki/pages?kind=${encodeURIComponent(kind)}` : "/api/kb/wiki/pages";
  const r = await fetch(url);
  if (!r.ok) throw new Error(`getPages ${r.status}`);
  return (await r.json()) as WikiPageMeta[];
}

export async function getPage(path: string): Promise<string> {
  const r = await fetch(`/api/kb/wiki/pages/${path}`);
  if (!r.ok) throw new Error(`getPage ${r.status}`);
  return await r.text();
}

export async function search(input: { query: string; kind?: WikiKind; limit?: number }): Promise<WikiSearchResult[]> {
  const params = new URLSearchParams({ q: input.query });
  if (input.kind) params.set("kind", input.kind);
  if (input.limit) params.set("limit", String(input.limit));
  const r = await fetch(`/api/kb/wiki/search?${params.toString()}`);
  if (!r.ok) throw new Error(`search ${r.status}`);
  return (await r.json()) as WikiSearchResult[];
}

export async function status(): Promise<WikiStatus> {
  const r = await fetch("/api/kb/wiki/status");
  if (!r.ok) throw new Error(`status ${r.status}`);
  return (await r.json()) as WikiStatus;
}

export interface IngestStartArgs {
  accounts: string[];
  perAccountLimit: number;
  batchSize: number;
  mode: "full" | "incremental";
  since?: string;
  until?: string;
  cliModel?: { cli: "claude" | "codex"; model: string };
}

export interface IngestStream {
  close: () => void;
}

export function startIngestStream(
  args: IngestStartArgs,
  onEvent: (e: IngestStepEvent) => void,
  onDone: () => void,
  onError: (err: string) => void,
): IngestStream {
  const ctrl = new AbortController();
  void (async () => {
    try {
      const r = await fetch("/api/kb/wiki/ingest", {
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
          const dataLine = chunk.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          const payload = dataLine.slice(5).trim();
          if (!payload) continue;
          try {
            const e = JSON.parse(payload) as IngestStepEvent;
            onEvent(e);
            if (e.type === "done") onDone();
            if (e.type === "error") onError(e.error ?? "unknown error");
          } catch { /* ignore parse error */ }
        }
      }
      onDone();
    } catch (err) {
      if ((err as Error).name !== "AbortError") onError((err as Error).message);
    }
  })();
  return { close: () => ctrl.abort() };
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test tests/wiki-client.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/web-ui/src/api/wiki-client.ts packages/web-ui/tests/wiki-client.test.ts && git -c commit.gpgsign=false commit -m "feat(web-ui): SP-07 wiki-client REST + SSE stream"
```

---

### Task 16: WikiTree 左栏（按 kind 折叠分组）

**Files:**
- Create: `packages/web-ui/src/components/wiki/WikiTree.tsx`
- Create: `packages/web-ui/tests/wiki-tree.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// packages/web-ui/tests/wiki-tree.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WikiTree } from "../src/components/wiki/WikiTree";
import type { WikiPageMeta } from "../src/api/wiki-client";

const pages: WikiPageMeta[] = [
  { path: "entities/Alice.md", kind: "entity", title: "Alice", aliases: [], sources_count: 1, backlinks_count: 0 },
  { path: "entities/Bob.md", kind: "entity", title: "Bob", aliases: [], sources_count: 1, backlinks_count: 0 },
  { path: "concepts/RAG.md", kind: "concept", title: "RAG", aliases: [], sources_count: 1, backlinks_count: 0 },
];

describe("WikiTree", () => {
  it("groups pages by kind with counts", () => {
    render(<WikiTree pages={pages} selected={null} onSelect={() => {}} />);
    expect(screen.getByText(/entity \(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/concept \(1\)/)).toBeInTheDocument();
  });

  it("clicks a page invokes onSelect", () => {
    const onSelect = vi.fn();
    render(<WikiTree pages={pages} selected={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Alice"));
    expect(onSelect).toHaveBeenCalledWith("entities/Alice.md");
  });

  it("toggles a kind group", () => {
    render(<WikiTree pages={pages} selected={null} onSelect={() => {}} />);
    const header = screen.getByText(/entity \(2\)/);
    fireEvent.click(header);
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test tests/wiki-tree.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
// packages/web-ui/src/components/wiki/WikiTree.tsx
import { useMemo, useState } from "react";
import type { WikiKind, WikiPageMeta } from "../../api/wiki-client";

const KIND_ORDER: WikiKind[] = ["entity", "concept", "case", "observation", "person"];

export interface WikiTreeProps {
  pages: WikiPageMeta[];
  selected: string | null;
  onSelect: (path: string) => void;
}

export function WikiTree({ pages, selected, onSelect }: WikiTreeProps) {
  const grouped = useMemo(() => {
    const m: Record<WikiKind, WikiPageMeta[]> = { entity: [], concept: [], case: [], observation: [], person: [] };
    for (const p of pages) m[p.kind].push(p);
    for (const k of KIND_ORDER) m[k].sort((a, b) => a.title.localeCompare(b.title));
    return m;
  }, [pages]);

  const [collapsed, setCollapsed] = useState<Record<WikiKind, boolean>>({
    entity: false, concept: false, case: false, observation: false, person: false,
  });

  return (
    <div style={{ overflow: "auto", height: "100%", padding: 8 }}>
      {KIND_ORDER.map((kind) => (
        <div key={kind} style={{ marginBottom: 8 }}>
          <div
            onClick={() => setCollapsed((c) => ({ ...c, [kind]: !c[kind] }))}
            style={{ cursor: "pointer", fontWeight: 600, padding: "4px 8px", background: "#f3f4f6", borderRadius: 4 }}
          >
            {collapsed[kind] ? "▸" : "▾"} {kind} ({grouped[kind].length})
          </div>
          {!collapsed[kind] && (
            <ul style={{ listStyle: "none", margin: 0, padding: "4px 0 4px 16px" }}>
              {grouped[kind].map((p) => (
                <li
                  key={p.path}
                  onClick={() => onSelect(p.path)}
                  style={{
                    cursor: "pointer",
                    padding: "2px 6px",
                    borderRadius: 3,
                    background: selected === p.path ? "#dbeafe" : "transparent",
                  }}
                >
                  {p.title}
                  {p.aliases.length > 0 && <span style={{ color: "#6b7280", fontSize: 11 }}> · {p.aliases.join(", ")}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test tests/wiki-tree.test.tsx
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/web-ui/src/components/wiki/WikiTree.tsx packages/web-ui/tests/wiki-tree.test.tsx && git -c commit.gpgsign=false commit -m "feat(web-ui): SP-07 WikiTree left-pane grouped by kind"
```

---

### Task 17: WikiPagePreview + WikiSearchBox（debounce 300ms）

**Files:**
- Create: `packages/web-ui/src/components/wiki/WikiPagePreview.tsx`
- Create: `packages/web-ui/src/components/wiki/WikiSearchBox.tsx`
- Create: `packages/web-ui/tests/wiki-preview.test.tsx`
- Create: `packages/web-ui/tests/wiki-search-box.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// packages/web-ui/tests/wiki-preview.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { WikiPagePreview } from "../src/components/wiki/WikiPagePreview";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "---\ntype: entity\ntitle: Alice\n---\n# Alice\n\nResearcher" }));
});

describe("WikiPagePreview", () => {
  it("fetches and renders markdown", async () => {
    render(<WikiPagePreview path="entities/Alice.md" />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Alice" })).toBeInTheDocument());
    expect(screen.getByText("Researcher")).toBeInTheDocument();
  });

  it("shows placeholder when path is null", () => {
    render(<WikiPagePreview path={null} />);
    expect(screen.getByText(/select a page/i)).toBeInTheDocument();
  });
});
```

```tsx
// packages/web-ui/tests/wiki-search-box.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { WikiSearchBox } from "../src/components/wiki/WikiSearchBox";

describe("WikiSearchBox", () => {
  it("debounces search input by 300ms", async () => {
    vi.useFakeTimers();
    const onSearch = vi.fn();
    render(<WikiSearchBox onSearch={onSearch} />);
    const input = screen.getByPlaceholderText(/search/i);
    fireEvent.change(input, { target: { value: "Ali" } });
    fireEvent.change(input, { target: { value: "Alice" } });
    expect(onSearch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    await waitFor(() => expect(onSearch).toHaveBeenCalledWith("Alice"));
    expect(onSearch).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test tests/wiki-preview.test.tsx tests/wiki-search-box.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
// packages/web-ui/src/components/wiki/WikiPagePreview.tsx
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import { getPage } from "../../api/wiki-client";

export interface WikiPagePreviewProps { path: string | null; }

export function WikiPagePreview({ path }: WikiPagePreviewProps) {
  const [text, setText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!path) { setText(""); setError(null); return; }
    let cancelled = false;
    setError(null);
    getPage(path)
      .then((t) => { if (!cancelled) setText(t); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, [path]);

  if (!path) return <div style={{ padding: 24, color: "#6b7280" }}>Select a page from the left.</div>;
  if (error) return <div style={{ padding: 24, color: "#dc2626" }}>Error: {error}</div>;

  // strip leading frontmatter for rendering
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, "");

  return (
    <div style={{ padding: 16, overflow: "auto", height: "100%" }}>
      <ReactMarkdown>{body}</ReactMarkdown>
    </div>
  );
}
```

```tsx
// packages/web-ui/src/components/wiki/WikiSearchBox.tsx
import { useEffect, useState } from "react";

export interface WikiSearchBoxProps { onSearch: (q: string) => void; }

export function WikiSearchBox({ onSearch }: WikiSearchBoxProps) {
  const [q, setQ] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      if (q.trim()) onSearch(q.trim());
    }, 300);
    return () => clearTimeout(t);
  }, [q, onSearch]);

  return (
    <input
      type="search"
      placeholder="Search wiki..."
      value={q}
      onChange={(e) => setQ(e.target.value)}
      style={{ width: "100%", padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 4 }}
    />
  );
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test tests/wiki-preview.test.tsx tests/wiki-search-box.test.tsx
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/web-ui/src/components/wiki/WikiPagePreview.tsx packages/web-ui/src/components/wiki/WikiSearchBox.tsx packages/web-ui/tests/wiki-preview.test.tsx packages/web-ui/tests/wiki-search-box.test.tsx && git -c commit.gpgsign=false commit -m "feat(web-ui): SP-07 WikiPagePreview + debounced WikiSearchBox"
```

---

### Task 18: IngestForm（账号多选 + 模式 + 数量 + cli/model）

**Files:**
- Create: `packages/web-ui/src/components/wiki/IngestForm.tsx`
- Create: `packages/web-ui/tests/ingest-form.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// packages/web-ui/tests/ingest-form.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IngestForm } from "../src/components/wiki/IngestForm";

describe("IngestForm", () => {
  it("submits selected accounts + opts", () => {
    const onSubmit = vi.fn();
    render(<IngestForm accounts={["acc1", "acc2"]} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByLabelText("acc1"));
    fireEvent.click(screen.getByLabelText("acc2"));
    fireEvent.change(screen.getByLabelText(/per account/i), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText(/batch size/i), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    expect(onSubmit).toHaveBeenCalledWith({
      accounts: ["acc1", "acc2"],
      perAccountLimit: 20,
      batchSize: 3,
      mode: "full",
      cliModel: { cli: "claude", model: "opus" },
    });
  });

  it("disables submit when no accounts selected", () => {
    render(<IngestForm accounts={["acc1"]} onSubmit={() => {}} />);
    expect(screen.getByRole("button", { name: /start/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test tests/ingest-form.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
// packages/web-ui/src/components/wiki/IngestForm.tsx
import { useState } from "react";
import type { IngestStartArgs } from "../../api/wiki-client";

export interface IngestFormProps {
  accounts: string[];
  onSubmit: (args: IngestStartArgs) => void;
}

export function IngestForm({ accounts, onSubmit }: IngestFormProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [perAccount, setPerAccount] = useState(50);
  const [batchSize, setBatchSize] = useState(5);
  const [mode, setMode] = useState<"full" | "incremental">("full");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [cli, setCli] = useState<"claude" | "codex">("claude");
  const [model, setModel] = useState("opus");

  const toggle = (a: string) => setSelected((s) => (s.includes(a) ? s.filter((x) => x !== a) : [...s, a]));

  const submit = () => {
    onSubmit({
      accounts: selected,
      perAccountLimit: perAccount,
      batchSize,
      mode,
      since: since || undefined,
      until: until || undefined,
      cliModel: { cli, model },
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16, maxWidth: 520 }}>
      <fieldset style={{ border: "1px solid #e5e7eb", padding: 8 }}>
        <legend>Accounts</legend>
        {accounts.map((a) => (
          <label key={a} style={{ display: "block", padding: "2px 0" }}>
            <input type="checkbox" checked={selected.includes(a)} onChange={() => toggle(a)} aria-label={a} /> {a}
          </label>
        ))}
      </fieldset>

      <label>
        Mode:
        <select value={mode} onChange={(e) => setMode(e.target.value as "full" | "incremental")}>
          <option value="full">full</option>
          <option value="incremental">incremental</option>
        </select>
      </label>

      <label>
        Per account limit:
        <input type="number" value={perAccount} onChange={(e) => setPerAccount(Number(e.target.value))} aria-label="per account" />
      </label>

      <label>
        Batch size:
        <input type="number" value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value))} aria-label="batch size" />
      </label>

      {mode === "incremental" && (
        <>
          <label>Since (ISO): <input value={since} onChange={(e) => setSince(e.target.value)} /></label>
          <label>Until (ISO): <input value={until} onChange={(e) => setUntil(e.target.value)} /></label>
        </>
      )}

      <label>
        CLI:
        <select value={cli} onChange={(e) => setCli(e.target.value as "claude" | "codex")}>
          <option value="claude">claude</option>
          <option value="codex">codex</option>
        </select>
      </label>

      <label>
        Model:
        <input value={model} onChange={(e) => setModel(e.target.value)} />
      </label>

      <button onClick={submit} disabled={selected.length === 0} style={{ padding: "8px 16px" }}>
        Start ingest
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test tests/ingest-form.test.tsx
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/web-ui/src/components/wiki/IngestForm.tsx packages/web-ui/tests/ingest-form.test.tsx && git -c commit.gpgsign=false commit -m "feat(web-ui): SP-07 IngestForm with account multi-select + mode + cli/model"
```

---

### Task 19: IngestProgressView（SSE 黑底绿字 log，仿 SP-06 ProgressView）

**Files:**
- Create: `packages/web-ui/src/components/wiki/IngestProgressView.tsx`
- Create: `packages/web-ui/tests/ingest-progress.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// packages/web-ui/tests/ingest-progress.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { IngestProgressView } from "../src/components/wiki/IngestProgressView";

describe("IngestProgressView", () => {
  it("renders events as log lines with terminal styling", () => {
    const events = [
      { type: "start" as const, account: "acc1" },
      { type: "patch_applied" as const, op: "upsert", path: "entities/A.md" },
      { type: "done" as const, stats: { pages: 1 } },
    ];
    render(<IngestProgressView events={events} status="done" error={null} />);
    expect(screen.getByText(/start/i)).toBeInTheDocument();
    expect(screen.getByText(/entities\/A\.md/)).toBeInTheDocument();
    expect(screen.getByText(/done/i)).toBeInTheDocument();
  });

  it("shows error banner when error", () => {
    render(<IngestProgressView events={[]} status="error" error="boom" />);
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test tests/ingest-progress.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
// packages/web-ui/src/components/wiki/IngestProgressView.tsx
import { useEffect, useRef } from "react";
import type { IngestStepEvent } from "../../api/wiki-client";

export interface IngestProgressViewProps {
  events: IngestStepEvent[];
  status: "idle" | "running" | "done" | "error";
  error: string | null;
}

function fmt(e: IngestStepEvent): string {
  const ts = new Date().toISOString().slice(11, 19);
  switch (e.type) {
    case "start": return `[${ts}] START account=${e.account ?? "?"}`;
    case "batch_start": return `[${ts}] BATCH ${(e.batchIndex ?? 0) + 1}/${e.totalBatches ?? "?"} start`;
    case "batch_done": return `[${ts}] BATCH ${(e.batchIndex ?? 0) + 1} done (${e.duration_ms ?? 0}ms)`;
    case "patch_applied": return `[${ts}] PATCH ${e.op ?? "?"} ${e.path ?? ""}`;
    case "log_appended": return `[${ts}] LOG appended`;
    case "index_rebuilt": return `[${ts}] INDEX rebuilt`;
    case "done": return `[${ts}] DONE ${JSON.stringify(e.stats ?? {})}`;
    case "error": return `[${ts}] ERROR ${e.error ?? ""}`;
    default: return `[${ts}] ${JSON.stringify(e)}`;
  }
}

export function IngestProgressView({ events, status, error }: IngestProgressViewProps) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [events.length]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 12, color: "#6b7280" }}>Status: <strong>{status}</strong></div>
      {error && (
        <div style={{ background: "#fee2e2", color: "#991b1b", padding: 8, borderRadius: 4 }}>
          {error}
        </div>
      )}
      <div
        ref={boxRef}
        style={{
          background: "#000",
          color: "#22c55e",
          fontFamily: "Menlo, Monaco, Consolas, monospace",
          fontSize: 12,
          padding: 12,
          height: 360,
          overflow: "auto",
          borderRadius: 4,
          whiteSpace: "pre-wrap",
        }}
      >
        {events.map((e, i) => (
          <div key={i}>{fmt(e)}</div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test tests/ingest-progress.test.tsx
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/web-ui/src/components/wiki/IngestProgressView.tsx packages/web-ui/tests/ingest-progress.test.tsx && git -c commit.gpgsign=false commit -m "feat(web-ui): SP-07 IngestProgressView terminal-style SSE log"
```

---

### Task 20: KnowledgePage 整合 + 路由 + ProjectList 入口

**Files:**
- Create: `packages/web-ui/src/pages/KnowledgePage.tsx`
- Modify: `packages/web-ui/src/App.tsx`
- Modify: `packages/web-ui/src/components/ProjectList.tsx` (or top nav)
- Create: `packages/web-ui/tests/knowledge-page.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// packages/web-ui/tests/knowledge-page.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { KnowledgePage } from "../src/pages/KnowledgePage";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.startsWith("/api/kb/wiki/pages")) {
      return Promise.resolve({ ok: true, json: async () => [{ path: "entities/A.md", kind: "entity", title: "A", aliases: [], sources_count: 1, backlinks_count: 0 }] });
    }
    if (url.startsWith("/api/kb/wiki/status")) {
      return Promise.resolve({ ok: true, json: async () => ({ total: 1, by_kind: { entity: 1 }, last_ingest_at: null }) });
    }
    if (url.startsWith("/api/kb/accounts")) {
      return Promise.resolve({ ok: true, json: async () => [{ name: "acc1" }] });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  }));
});

describe("KnowledgePage", () => {
  it("renders Browse tab by default with WikiTree", async () => {
    render(<KnowledgePage />);
    await waitFor(() => expect(screen.getByText(/entity \(1\)/)).toBeInTheDocument());
  });

  it("switches to Ingest tab", async () => {
    render(<KnowledgePage />);
    fireEvent.click(screen.getByRole("tab", { name: /ingest/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /start/i })).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test tests/knowledge-page.test.tsx
```

- [ ] **Step 3: Implement**

```tsx
// packages/web-ui/src/pages/KnowledgePage.tsx
import { useEffect, useState } from "react";
import { WikiTree } from "../components/wiki/WikiTree";
import { WikiPagePreview } from "../components/wiki/WikiPagePreview";
import { WikiSearchBox } from "../components/wiki/WikiSearchBox";
import { IngestForm } from "../components/wiki/IngestForm";
import { IngestProgressView } from "../components/wiki/IngestProgressView";
import {
  getPages,
  search as searchWikiApi,
  startIngestStream,
  status as wikiStatus,
  type WikiPageMeta,
  type IngestStepEvent,
  type IngestStartArgs,
  type WikiSearchResult,
  type WikiStatus,
} from "../api/wiki-client";

type Tab = "browse" | "ingest";

export function KnowledgePage() {
  const [tab, setTab] = useState<Tab>("browse");
  const [pages, setPages] = useState<WikiPageMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [hits, setHits] = useState<WikiSearchResult[] | null>(null);
  const [status, setStatusInfo] = useState<WikiStatus | null>(null);
  const [accounts, setAccounts] = useState<string[]>([]);

  const [ingestEvents, setIngestEvents] = useState<IngestStepEvent[]>([]);
  const [ingestStatus, setIngestStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [ingestError, setIngestError] = useState<string | null>(null);

  useEffect(() => {
    void getPages().then(setPages).catch(() => setPages([]));
    void wikiStatus().then(setStatusInfo).catch(() => setStatusInfo(null));
    void fetch("/api/kb/accounts").then(async (r) => {
      if (r.ok) {
        const j = (await r.json()) as Array<{ name: string }>;
        setAccounts(j.map((a) => a.name));
      }
    }).catch(() => setAccounts([]));
  }, []);

  const handleSearch = (q: string) => {
    void searchWikiApi({ query: q, limit: 20 }).then(setHits).catch(() => setHits([]));
  };

  const handleIngestStart = (args: IngestStartArgs) => {
    setIngestEvents([]);
    setIngestStatus("running");
    setIngestError(null);
    startIngestStream(
      args,
      (e) => setIngestEvents((prev) => [...prev, e]),
      () => {
        setIngestStatus("done");
        void getPages().then(setPages);
        void wikiStatus().then(setStatusInfo);
      },
      (err) => { setIngestStatus("error"); setIngestError(err); },
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div style={{ display: "flex", gap: 16, borderBottom: "1px solid #e5e7eb", padding: "8px 16px" }}>
        <button role="tab" aria-selected={tab === "browse"} onClick={() => setTab("browse")} style={{ fontWeight: tab === "browse" ? 700 : 400 }}>Browse</button>
        <button role="tab" aria-selected={tab === "ingest"} onClick={() => setTab("ingest")} style={{ fontWeight: tab === "ingest" ? 700 : 400 }}>Ingest</button>
        <div style={{ marginLeft: "auto", color: "#6b7280", fontSize: 12 }}>
          {status && `${status.total} pages · last_ingest=${status.last_ingest_at ?? "never"}`}
        </div>
      </div>

      {tab === "browse" && (
        <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", flex: 1, overflow: "hidden" }}>
          <div style={{ borderRight: "1px solid #e5e7eb", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: 8, borderBottom: "1px solid #e5e7eb" }}>
              <WikiSearchBox onSearch={handleSearch} />
            </div>
            {hits ? (
              <ul style={{ listStyle: "none", margin: 0, padding: 8, overflow: "auto" }}>
                {hits.map((h) => (
                  <li key={h.path} onClick={() => setSelected(h.path)} style={{ cursor: "pointer", padding: 4, background: selected === h.path ? "#dbeafe" : "transparent" }}>
                    <div style={{ fontWeight: 600 }}>{h.title} <span style={{ color: "#6b7280", fontSize: 11 }}>({h.kind} · {h.score.toFixed(2)})</span></div>
                    <div style={{ fontSize: 12, color: "#374151" }}>{h.excerpt}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <WikiTree pages={pages} selected={selected} onSelect={setSelected} />
            )}
          </div>
          <WikiPagePreview path={selected} />
        </div>
      )}

      {tab === "ingest" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", flex: 1, overflow: "auto" }}>
          <IngestForm accounts={accounts} onSubmit={handleIngestStart} />
          <div style={{ padding: 16 }}>
            <IngestProgressView events={ingestEvents} status={ingestStatus} error={ingestError} />
          </div>
        </div>
      )}
    </div>
  );
}
```

修改 `packages/web-ui/src/App.tsx` 加路由：

```tsx
// in App.tsx route table
import { KnowledgePage } from "./pages/KnowledgePage";

// inside <Routes>:
<Route path="/knowledge" element={<KnowledgePage />} />
```

修改 `packages/web-ui/src/components/ProjectList.tsx` 顶栏入口（或主导航位置）追加：

```tsx
import { Link } from "react-router-dom";
// in top nav JSX:
<Link to="/knowledge" style={{ marginLeft: 16 }}>知识库</Link>
```

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm test tests/knowledge-page.test.tsx
cd /Users/zeoooo/crossing-writer/packages/web-ui && pnpm build
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/web-ui/src/pages/KnowledgePage.tsx packages/web-ui/src/App.tsx packages/web-ui/src/components/ProjectList.tsx packages/web-ui/tests/knowledge-page.test.tsx && git -c commit.gpgsign=false commit -m "feat(web-ui): SP-07 KnowledgePage tabs (browse/ingest) + /knowledge route + nav entry"
```

---

### Task 21: e2e integration（mock ingestor agent → 完整 pipeline → 断言产物）

**Files:**
- Create: `packages/web-server/tests/integration-sp07-e2e.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/web-server/tests/integration-sp07-e2e.test.ts
import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { registerKbWikiRoutes } from "../src/routes/kb-wiki.js";

// Mock the ingestor agent to emit a deterministic NDJSON patch stream
vi.mock("@crossing/agents", async () => {
  return {
    runWikiIngestorAgent: vi.fn(async function* () {
      yield JSON.stringify({ op: "upsert", path: "entities/Alice.md", frontmatter: { type: "entity", title: "Alice", aliases: ["A"] }, body: "# Alice\n\nResearcher" });
      yield JSON.stringify({ op: "append_source", path: "entities/Alice.md", source: { account: "acc1", title: "post-1", url: "https://x/1", date: "2026-04-10" } });
      yield JSON.stringify({ op: "upsert", path: "concepts/RAG.md", frontmatter: { type: "concept", title: "RAG" }, body: "# RAG\n\nRetrieval" });
      yield JSON.stringify({ op: "add_backlink", path: "concepts/RAG.md", from: "entities/Alice.md" });
      yield JSON.stringify({ op: "note", note: "batch ok" });
    }),
  };
});

function seedRaw(sqlitePath: string): void {
  const db = new Database(sqlitePath);
  db.exec(`CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY, account TEXT, title TEXT, url TEXT, date TEXT, content TEXT)`);
  const ins = db.prepare("INSERT INTO articles (id, account, title, url, date, content) VALUES (?, ?, ?, ?, ?, ?)");
  ins.run("a1", "acc1", "post-1", "https://x/1", "2026-04-10", "Alice talks RAG");
  db.close();
}

describe("SP-07 e2e", () => {
  it("runs ingest pipeline → wiki/ + index.md + log.md produced", async () => {
    const vault = mkdtempSync(join(tmpdir(), "e2e-"));
    const sqlitePath = join(vault, "refs.sqlite");
    seedRaw(sqlitePath);

    const app = Fastify();
    registerKbWikiRoutes(app, { vaultPath: vault, sqlitePath });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/kb/wiki/ingest",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      payload: { accounts: ["acc1"], perAccountLimit: 5, batchSize: 5, mode: "full", cliModel: { cli: "claude", model: "opus" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("\"type\":\"done\"");

    expect(existsSync(join(vault, "wiki", "entities", "Alice.md"))).toBe(true);
    expect(existsSync(join(vault, "wiki", "concepts", "RAG.md"))).toBe(true);
    expect(existsSync(join(vault, "wiki", "index.md"))).toBe(true);
    expect(existsSync(join(vault, "wiki", "log.md"))).toBe(true);

    const alice = readFileSync(join(vault, "wiki", "entities", "Alice.md"), "utf-8");
    expect(alice).toContain("type: entity");
    expect(alice).toContain("post-1");

    const rag = readFileSync(join(vault, "wiki", "concepts", "RAG.md"), "utf-8");
    expect(rag).toContain("entities/Alice.md");

    const idx = readFileSync(join(vault, "wiki", "index.md"), "utf-8");
    expect(idx).toContain("Alice");
    expect(idx).toContain("RAG");

    const log = readFileSync(join(vault, "wiki", "log.md"), "utf-8");
    expect(log).toContain("acc1");
    expect(log).toContain("upsert");

    // status reflects produced pages
    const sres = await app.inject({ method: "GET", url: "/api/kb/wiki/status" });
    const sbody = sres.json() as { total: number; by_kind: Record<string, number> };
    expect(sbody.total).toBe(2);
    expect(sbody.by_kind.entity).toBe(1);
    expect(sbody.by_kind.concept).toBe(1);

    // search hits Alice
    const qres = await app.inject({ method: "GET", url: "/api/kb/wiki/search?q=Alice" });
    const qbody = qres.json() as Array<{ path: string }>;
    expect(qbody[0].path).toBe("entities/Alice.md");

    await app.close();
  }, 20_000);
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/integration-sp07-e2e.test.ts
```

- [ ] **Step 3: Implement**

无新代码——把已实现的 T1-T20 串起来即可。如果失败，按以下顺序排查：

1. `runIngest`（T6/T7）是否在 onEvent 中真正发出 `done` 事件且把 ingestor 的 NDJSON 行喂给 `WikiStore.applyPatch`
2. `index-maintainer`（T8）是否在每批 patch 应用后被调用一次（写 `wiki/index.md`）
3. `log.md` 追加是否在 orchestrator 的 batch_done 钩子里发生
4. `kb-wiki.ts` 的 `/api/kb/wiki/ingest` 是否把 `runIngest` 的 onEvent 转成 SSE `data:` 帧
5. mock 的 `runWikiIngestorAgent` 必须被 ingestor-agent.ts 真正调用（而不是某个内部默认导出）；如不一致请把 ingestor-agent.ts 的 import 调整到对应路径

不需要新增文件；如确有缺胶水，仅在已存在文件里补函数调用并写最小注释（不要新建文件以免越界）。

- [ ] **Step 4: Run, expect PASS**

```bash
cd /Users/zeoooo/crossing-writer/packages/web-server && pnpm test tests/integration-sp07-e2e.test.ts
cd /Users/zeoooo/crossing-writer && pnpm -r test
cd /Users/zeoooo/crossing-writer && pnpm -r build
```

- [ ] **Step 5: Commit**

```bash
cd /Users/zeoooo/crossing-writer && git add packages/web-server/tests/integration-sp07-e2e.test.ts && git -c commit.gpgsign=false commit -m "test(web-server): SP-07 e2e integration — ingest pipeline → wiki/ + index.md + log.md"
```

---

## Self-Review

### 1. Spec → Task 映射（spec §2-§14 全覆盖）

| Spec 节 | 主题 | 覆盖 task |
|---------|------|-----------|
| §2 目录与 kind | wiki/ 目录、5 种 kind | T1（types）、T2（store 路径）|
| §3 命名 / 去重 | path 规则 + alias 索引 | T1、T2、T9（search 命中 alias）|
| §4 source 字段 | sources frontmatter | T1（schema）、T2（append_source op）|
| §5 冲突处理 | upsert 合并策略 | T2（apply upsert）|
| §6 backlink | 反向链接自动维护 | T2（add_backlink + 自动反向）|
| §7 frontmatter 基础 | type/title/aliases/sources/backlinks/images/last_ingest | T1、T2 |
| §8 raw image 提取 | refs.sqlite → image patch | T3（raw-image-extractor）|
| §9 ingestor agent | guide.md + system prompt + NDJSON 输出 | T4（agent + guide）|
| §10 snapshot | 选 top-K 现有页给 agent 做上下文 | T5（snapshot-builder）|
| §11 orchestrator | full / incremental / 批次 / SSE 事件 | T6（full）、T7（incremental + log.md）|
| §12 index/log/search | 重建 index.md、追加 log.md、内存倒排 | T7（log）、T8（index）、T9（search）|
| §13 后端 API | POST ingest SSE + GET pages/* + search + status | T10、T11、T12 |
| §14 CLI / UI | wiki ingest/search/show/status + KnowledgePage | T13、T14、T15-T20；e2e T21 |

每节均有至少一个 task 覆盖；§13/§14 各拆 3-5 个 task。

### 2. Placeholder 扫描

- 全文 21 个 task 均有具体 file path（`packages/...`）、完整代码块、明确 commit message，无 `TBD` / `TODO` / `similar to` / `add error handling` 占位。
- T21 Step 3 的「无新代码」是有意为之（e2e 只串现成实现），并明确列出 5 条排查路径，不算 placeholder。
- 类型契约（Part 1 T1 已定义）在 Part 2 沿用一致：`WikiKind`、`WikiFrontmatter`、`PatchOp` 五种 op、`IngestOptions`、`IngestStepEvent`、`SearchWikiResult`。

### 3. 类型一致性检查

- `WikiKind = "entity" | "concept" | "case" | "observation" | "person"` —— Part 1 T1 / Part 2 T15 wiki-client / T16 WikiTree KIND_ORDER 全一致（5 种，顺序也一致）。
- `WikiFrontmatter` 字段（type/title/aliases/sources/backlinks/images/last_ingest）—— Part 2 T11/T12 路由的投影字段、T15 `WikiPageMeta` 派生、T16 显示均使用同一字段名。
- `PatchOp` 五种（upsert/append_source/append_image/add_backlink/note）—— T19 fmt 函数、T21 mock NDJSON、T13 stream 输出全部覆盖。
- `IngestOptions` —— T13 CLI runWikiIngest、T15 `IngestStartArgs`、T20 KnowledgePage `handleIngestStart`、T21 e2e payload 字段名一致（accounts / perAccountLimit / batchSize / mode / since / until / cliModel）。注意：CLI 层用 snake-flag (`--per-account`)，但内部对象一律 camelCase。
- `IngestStepEvent` type 枚举 —— T15 client 类型、T19 ProgressView fmt switch、T13 CLI 流式输出、T10 后端 SSE（Part 1）全部使用同一 8 种 type（start/batch_start/batch_done/patch_applied/log_appended/index_rebuilt/done/error）。
- `SearchWikiResult` —— T12 后端返回、T15 client 类型、T20 hits 渲染字段（path/kind/title/excerpt/score）一致。

### 4. Task count

- Part 1: T1-T11 = 11 个
- Part 2: T12-T21 = 10 个
- Total = **21 个**，落在 18-22 区间内。

每个 task 严格 5 step（Write failing test → Run FAIL → Implement → Run PASS → Commit），无超 step / 缺 step。

---

**Plan complete. Total 21 tasks across 8 milestones (M1-M8). Execute via `superpowers:subagent-driven-development` skill, one task per subagent.**
