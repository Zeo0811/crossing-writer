import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

vi.mock("@crossing/agents", async () => {
  const actual = await vi.importActual<typeof import("@crossing/agents")>("@crossing/agents");
  return {
    ...actual,
    WikiIngestorAgent: class {
      constructor(_o: unknown) {}
      async ingest() {
        return {
          ops: [
            { op: "upsert", path: "entities/Alice.md", frontmatter: { type: "entity", title: "Alice", aliases: ["A"] }, body: "# Alice\n\nResearcher" },
            { op: "append_source", path: "entities/Alice.md", source: { account: "acc1", article_id: "a1", quoted: "Alice talks RAG" } },
            { op: "upsert", path: "concepts/RAG.md", frontmatter: { type: "concept", title: "RAG" }, body: "# RAG\n\nRetrieval" },
            { op: "add_backlink", path: "concepts/RAG.md", to: "entities/Alice.md" },
            { op: "note", body: "batch ok" },
          ],
          meta: { cli: "claude", model: null, durationMs: 1 },
        };
      }
    },
  };
});

import { registerKbWikiRoutes } from "../src/routes/kb-wiki.js";

function seedRaw(sqlitePath: string): void {
  const db = new Database(sqlitePath);
  db.exec(`CREATE TABLE ref_articles (id TEXT PRIMARY KEY, account TEXT, title TEXT, published_at TEXT, word_count INTEGER, body_plain TEXT, body_html TEXT)`);
  db.prepare(`INSERT INTO ref_articles VALUES (?,?,?,?,?,?,?)`).run("a1", "acc1", "post-1", "2026-04-10", 100, "Alice talks RAG", "");
  db.close();
}

describe("SP-07 e2e", () => {
  it("runs ingest pipeline → wiki produced + status + search", async () => {
    const vault = mkdtempSync(join(tmpdir(), "e2e-sp07-"));
    const sqlitePath = join(vault, "refs.sqlite");
    seedRaw(sqlitePath);

    const app = Fastify();
    registerKbWikiRoutes(app, { vaultPath: vault, sqlitePath });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/kb/wiki/ingest",
      payload: { accounts: ["acc1"], per_account_limit: 5, batch_size: 5, mode: "full", cli_model: { cli: "claude", model: "opus" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("event: ingest.all_completed");

    expect(existsSync(join(vault, "entities", "Alice.md"))).toBe(true);
    expect(existsSync(join(vault, "concepts", "RAG.md"))).toBe(true);
    expect(existsSync(join(vault, "index.md"))).toBe(true);
    expect(existsSync(join(vault, "log.md"))).toBe(true);

    const alice = readFileSync(join(vault, "entities", "Alice.md"), "utf-8");
    expect(alice).toContain("type: entity");
    expect(alice).toContain("a1");

    const rag = readFileSync(join(vault, "concepts", "RAG.md"), "utf-8");
    expect(rag).toContain("entities/Alice.md");

    const idx = readFileSync(join(vault, "index.md"), "utf-8");
    expect(idx).toContain("Alice");
    expect(idx).toContain("RAG");

    const log = readFileSync(join(vault, "log.md"), "utf-8");
    expect(log).toContain("acc1");

    const sres = await app.inject({ method: "GET", url: "/api/kb/wiki/status" });
    const sbody = sres.json() as { total: number; by_kind: Record<string, number> };
    expect(sbody.total).toBe(2);
    expect(sbody.by_kind.entity).toBe(1);
    expect(sbody.by_kind.concept).toBe(1);

    const qres = await app.inject({ method: "GET", url: "/api/kb/wiki/search?q=Alice" });
    const qbody = qres.json() as Array<{ path: string }>;
    expect(qbody[0].path).toBe("entities/Alice.md");

    await app.close();
  }, 20_000);
});
