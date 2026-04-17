import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
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
  db.exec(`CREATE TABLE ref_articles (id TEXT PRIMARY KEY, account TEXT, title TEXT, published_at TEXT, word_count INTEGER, body_plain TEXT, html_path TEXT)`);
  const ins = db.prepare(`INSERT INTO ref_articles (id,account,title,published_at,word_count,body_plain,html_path) VALUES (?,?,?,?,?,?,?)`);
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
    const { sqlitePath } = seedSqlite();
    const vault = mkdtempSync(join(tmpdir(), "oc-vault-"));
    const mod = await import("@crossing/agents");
    const Orig = mod.WikiIngestorAgent;
    let call = 0;
    (mod as unknown as { WikiIngestorAgent: unknown }).WikiIngestorAgent = class {
      constructor(_o: unknown) {}
      async ingest(_input: { batchIndex: number }) {
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

describe("runIngest mode=selected + maxArticles validation", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("throws when mode=selected without articleIds", async () => {
    const { sqlitePath } = seedSqlite();
    const vault = mkdtempSync(join(tmpdir(), "oc-v-"));
    const err = await runIngest({
      accounts: [],
      perAccountLimit: 50,
      batchSize: 5,
      mode: "selected",
    }, { vaultPath: vault, sqlitePath }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/article_ids required/);
  });

  it("throws when articleIds provided with mode=full", async () => {
    const { sqlitePath } = seedSqlite();
    const vault = mkdtempSync(join(tmpdir(), "oc-v-"));
    const err = await runIngest({
      accounts: ["AcctA"],
      perAccountLimit: 50,
      batchSize: 5,
      mode: "full",
      articleIds: ["A0"],
    }, { vaultPath: vault, sqlitePath }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/implies mode=selected/);
  });

  it("throws when projected count exceeds maxArticles", async () => {
    const { sqlitePath } = seedSqlite();
    const vault = mkdtempSync(join(tmpdir(), "oc-v-"));
    const err = await runIngest({
      accounts: [],
      perAccountLimit: 50,
      batchSize: 5,
      mode: "selected",
      articleIds: ["A0", "A1", "A2"],
      maxArticles: 2,
    }, { vaultPath: vault, sqlitePath }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/max_articles exceeded/);
  });

  it("throws when accounts×perAccountLimit exceeds maxArticles in full mode", async () => {
    const { sqlitePath } = seedSqlite();
    const vault = mkdtempSync(join(tmpdir(), "oc-v-"));
    const err = await runIngest({
      accounts: ["AcctA", "AcctB"],
      perAccountLimit: 30,
      batchSize: 5,
      mode: "full",
      maxArticles: 50,
    }, { vaultPath: vault, sqlitePath }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/max_articles exceeded/);
  });

  it("processes articles by id in selected mode", async () => {
    const { sqlitePath } = seedSqlite();
    const vault = mkdtempSync(join(tmpdir(), "oc-v-"));
    const events: string[] = [];
    const res = await runIngest({
      accounts: [],
      perAccountLimit: 50,
      batchSize: 2,
      mode: "selected",
      articleIds: ["A0", "A1", "B0"],
      onEvent: (ev) => events.push(ev.type),
    }, { vaultPath: vault, sqlitePath });

    // Should have processed 3 articles — check pages created (mock creates 1 page per article)
    expect(res.pages_created).toBeGreaterThanOrEqual(3);
    // Events should include batch_started / op_applied / batch_completed
    expect(events).toContain("batch_started");
    expect(events).toContain("op_applied");
    expect(events).toContain("all_completed");
  });
});
