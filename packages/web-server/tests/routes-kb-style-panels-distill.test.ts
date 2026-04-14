import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import Database from "better-sqlite3";

const runDistillMock = vi.fn();
vi.mock("@crossing/kb", () => ({
  runDistill: (opts: any, ctx: any) => runDistillMock(opts, ctx),
}));

import { registerKbStylePanelsRoutes } from "../src/routes/kb-style-panels.js";

function seed() {
  const vault = mkdtempSync(join(tmpdir(), "sp06-distill-"));
  mkdirSync(join(vault, "08_experts", "style-panel"), { recursive: true });
  mkdirSync(join(vault, ".index"), { recursive: true });
  const sqlitePath = join(vault, ".index", "refs.sqlite");
  const db = new Database(sqlitePath);
  db.exec(`CREATE TABLE ref_articles (id TEXT PRIMARY KEY, account TEXT, title TEXT, author TEXT, published_at TEXT, url TEXT, summary TEXT, md_path TEXT, topics_core_json TEXT, topics_fine_json TEXT, body_plain TEXT, word_count INT, is_original INT)`);
  const ins = db.prepare(`INSERT INTO ref_articles VALUES (@id,'赛博禅心','t','',@p,'','','','[]','[]','',100,1)`);
  for (let i = 0; i < 30; i += 1) ins.run({ id: `a${i}`, p: `2025-0${(i % 9) + 1}-01` });
  db.close();
  return { vault, sqlitePath };
}

describe("POST /api/kb/style-panels/:account/distill", () => {
  beforeEach(() => { runDistillMock.mockReset(); });

  it("404 when account not in refs.sqlite", async () => {
    const { vault, sqlitePath } = seed();
    const app = Fastify();
    registerKbStylePanelsRoutes(app, { vaultPath: vault, sqlitePath });
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/api/kb/style-panels/UNKNOWN/distill", payload: { sample_size: 20 } });
    expect(res.statusCode).toBe(404);
  });

  it("400 when since > until", async () => {
    const { vault, sqlitePath } = seed();
    const app = Fastify();
    registerKbStylePanelsRoutes(app, { vaultPath: vault, sqlitePath });
    await app.ready();
    const res = await app.inject({
      method: "POST", url: "/api/kb/style-panels/赛博禅心/distill",
      payload: { sample_size: 20, since: "2026-01-01", until: "2025-01-01" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 when sample_size < 20", async () => {
    const { vault, sqlitePath } = seed();
    const app = Fastify();
    registerKbStylePanelsRoutes(app, { vaultPath: vault, sqlitePath });
    await app.ready();
    const res = await app.inject({
      method: "POST", url: "/api/kb/style-panels/赛博禅心/distill", payload: { sample_size: 5 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 when only_step invalid", async () => {
    const { vault, sqlitePath } = seed();
    const app = Fastify();
    registerKbStylePanelsRoutes(app, { vaultPath: vault, sqlitePath });
    await app.ready();
    const res = await app.inject({
      method: "POST", url: "/api/kb/style-panels/赛博禅心/distill", payload: { sample_size: 20, only_step: "bogus" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("streams SSE events ending with all_completed", async () => {
    const { vault, sqlitePath } = seed();
    runDistillMock.mockImplementation(async (opts: any) => {
      opts.onEvent({ step: "quant", phase: "started", account: opts.account });
      opts.onEvent({ step: "quant", phase: "completed", account: opts.account, duration_ms: 10, stats: { article_count: 20 } });
      return { account: opts.account, kb_path: "/tmp/x.md", sample_size_actual: 20, steps_run: ["quant", "structure", "snippets", "composer"] };
    });
    const app = Fastify();
    registerKbStylePanelsRoutes(app, { vaultPath: vault, sqlitePath });
    await app.ready();
    const res = await app.inject({
      method: "POST", url: "/api/kb/style-panels/赛博禅心/distill", payload: { sample_size: 20 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    expect(res.body).toContain("event: distill.step_started");
    expect(res.body).toContain("event: distill.step_completed");
    expect(res.body).toContain("event: distill.all_completed");
    expect(res.body).toContain("/tmp/x.md");
  });

  it("emits step_failed when orchestrator throws", async () => {
    const { vault, sqlitePath } = seed();
    runDistillMock.mockImplementation(async (opts: any) => {
      opts.onEvent({ step: "structure", phase: "failed", account: opts.account, error: "boom" });
      throw new Error("boom");
    });
    const app = Fastify();
    registerKbStylePanelsRoutes(app, { vaultPath: vault, sqlitePath });
    await app.ready();
    const res = await app.inject({
      method: "POST", url: "/api/kb/style-panels/赛博禅心/distill", payload: { sample_size: 20 },
    });
    expect(res.body).toContain("event: distill.step_failed");
  });
});
