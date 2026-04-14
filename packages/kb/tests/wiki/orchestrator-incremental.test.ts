import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
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
