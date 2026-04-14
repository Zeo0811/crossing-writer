import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import Database from "better-sqlite3";
import { registerKbAccountsRoutes } from "../src/routes/kb-accounts.js";

function makeDb(dir: string): string {
  const p = join(dir, "refs.sqlite");
  const db = new Database(p);
  db.exec(`CREATE TABLE ref_articles (id TEXT PRIMARY KEY, account TEXT, title TEXT, author TEXT, published_at TEXT, url TEXT, summary TEXT, md_path TEXT, topics_core_json TEXT, topics_fine_json TEXT, body_plain TEXT, word_count INT, is_original INT)`);
  const ins = db.prepare(`INSERT INTO ref_articles VALUES (@id,@account,'t','',@p,'','','','[]','[]','',100,1)`);
  ins.run({ id: "a1", account: "A", p: "2025-01-01" });
  ins.run({ id: "a2", account: "A", p: "2025-06-01" });
  ins.run({ id: "b1", account: "B", p: "2025-03-15" });
  db.close();
  return p;
}

describe("GET /api/kb/accounts", () => {
  it("returns accounts with count + date range, sorted by count desc", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "sp06-acc-"));
    const sqlitePath = makeDb(tmp);
    const app = Fastify();
    registerKbAccountsRoutes(app, { sqlitePath });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/kb/accounts" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ account: string; count: number; earliest_published_at: string; latest_published_at: string }>;
    expect(body[0]!.account).toBe("A");
    expect(body[0]!.count).toBe(2);
    expect(body[0]!.earliest_published_at).toBe("2025-01-01");
    expect(body[0]!.latest_published_at).toBe("2025-06-01");
    expect(body[1]!.account).toBe("B");
  });

  it("returns empty array when sqlite missing", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "sp06-acc-empty-"));
    const app = Fastify();
    registerKbAccountsRoutes(app, { sqlitePath: join(tmp, "does-not-exist.sqlite") });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/api/kb/accounts" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});
