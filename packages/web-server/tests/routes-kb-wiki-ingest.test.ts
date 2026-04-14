import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { mkdtempSync } from "node:fs";
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
