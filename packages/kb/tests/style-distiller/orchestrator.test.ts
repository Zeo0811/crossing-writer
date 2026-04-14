import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

vi.mock("@crossing/agents", async () => ({
  StyleDistillerStructureAgent: vi.fn().mockImplementation(() => ({
    distill: vi.fn().mockResolvedValue({ text: "一、核心定位\nMOCK\n", meta: { cli: "claude", model: "opus", durationMs: 100 } }),
  })),
  StyleDistillerSnippetsAgent: vi.fn().mockImplementation(() => ({
    harvest: vi.fn().mockResolvedValue({
      candidates: [
        { tag: "opening.data", from: "a1", excerpt: "据 X 统计", position_ratio: 0.03, length: 8 },
        { tag: "bold.judgment", from: "a2", excerpt: "不是 X 而是 Y", position_ratio: 0.5, length: 10 },
      ],
      meta: { cli: "claude", model: "opus", durationMs: 100 },
    }),
  })),
  StyleDistillerComposerAgent: vi.fn().mockImplementation(() => ({
    compose: vi.fn().mockResolvedValue({ kbMd: "---\ntype: style_expert\n---\n# 正文 MOCK", meta: { cli: "claude", model: "opus", durationMs: 100 } }),
  })),
}));

import { runDistill } from "../../src/style-distiller/orchestrator.js";

function makeDb(dir: string, account: string, articleCount: number): string {
  const p = join(dir, "refs.sqlite");
  const db = new Database(p);
  db.exec(`CREATE TABLE ref_articles (id TEXT PRIMARY KEY, account TEXT, title TEXT, author TEXT, published_at TEXT, url TEXT, summary TEXT, md_path TEXT, topics_core_json TEXT, topics_fine_json TEXT, body_plain TEXT, word_count INT, is_original INT)`);
  const ins = db.prepare(`INSERT INTO ref_articles VALUES (@id,@account,@title,'',@pub,'','','','[]','[]',@body,@wc,1)`);
  for (let i = 0; i < articleCount; i += 1) {
    const m = String((i % 12) + 1).padStart(2, "0");
    ins.run({ id: `${account}_${i}`, account, title: `T${i}`, pub: `2025-${m}-01`, body: `正文${i} `.repeat(100), wc: 500 + i * 10 });
  }
  db.close();
  return p;
}

describe("orchestrator runDistill", () => {
  let vault: string;
  let sqlitePath: string;
  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), "sp06-vault-"));
    mkdirSync(join(vault, "08_experts", "style-panel"), { recursive: true });
    mkdirSync(join(vault, ".distill"), { recursive: true });
    mkdirSync(join(vault, ".index"), { recursive: true });
    sqlitePath = makeDb(join(vault, ".index"), "赛博禅心", 50);
  });

  it("runs 4 steps, writes intermediates + kb.md, emits events", async () => {
    const events: any[] = [];
    const res = await runDistill({
      account: "赛博禅心",
      sampleSize: 25,
      onEvent: (ev) => events.push(ev),
    }, { vaultPath: vault, sqlitePath });

    expect(res.account).toBe("赛博禅心");
    expect(res.steps_run).toEqual(["quant", "structure", "snippets", "composer"]);
    expect(existsSync(join(vault, ".distill", "赛博禅心", "quant.json"))).toBe(true);
    expect(existsSync(join(vault, ".distill", "赛博禅心", "structure.md"))).toBe(true);
    expect(existsSync(join(vault, ".distill", "赛博禅心", "snippets.yaml"))).toBe(true);
    expect(existsSync(join(vault, ".distill", "赛博禅心", "distilled_at.txt"))).toBe(true);
    expect(existsSync(join(vault, "08_experts", "style-panel", "赛博禅心_kb.md"))).toBe(true);

    const quant = JSON.parse(readFileSync(join(vault, ".distill", "赛博禅心", "quant.json"), "utf-8"));
    expect(quant.account).toBe("赛博禅心");
    expect(quant.article_count).toBe(25);

    const kb = readFileSync(join(vault, "08_experts", "style-panel", "赛博禅心_kb.md"), "utf-8");
    expect(kb).toContain("# 正文 MOCK");

    expect(events.find((e) => e.step === "quant" && e.phase === "completed")).toBeTruthy();
    expect(events.find((e) => e.step === "structure" && e.phase === "completed")).toBeTruthy();
    expect(events.find((e) => e.step === "snippets" && e.phase === "completed")).toBeTruthy();
    expect(events.find((e) => e.step === "composer" && e.phase === "completed")).toBeTruthy();
    expect(events.find((e) => e.step === "snippets" && e.phase === "batch_progress")).toBeTruthy();
  });

  it("dry-run: only runs quant, no kb.md", async () => {
    const res = await runDistill({ account: "赛博禅心", sampleSize: 25, dryRun: true }, { vaultPath: vault, sqlitePath });
    expect(res.steps_run).toEqual(["quant"]);
    expect(existsSync(join(vault, ".distill", "赛博禅心", "quant.json"))).toBe(true);
    expect(existsSync(join(vault, "08_experts", "style-panel", "赛博禅心_kb.md"))).toBe(false);
  });

  it("only-step=composer reuses intermediates", async () => {
    const dd = join(vault, ".distill", "赛博禅心");
    mkdirSync(dd, { recursive: true });
    writeFileSync(join(dd, "quant.json"), JSON.stringify({ account: "赛博禅心", article_count: 10, date_range: { start: "2025-01-01", end: "2025-12-01" } }));
    writeFileSync(join(dd, "structure.md"), "一、核心定位\nSEED\n");
    writeFileSync(join(dd, "snippets.yaml"), "opening.data:\n  - from: x\n    excerpt: y\n");
    writeFileSync(join(dd, "deep_read_ids.json"), JSON.stringify(["seed_id"]));
    writeFileSync(join(dd, "sample_stats.json"), JSON.stringify({ sampleSizeRequested: 10, sampleSizeActual: 10, sourcePoolSize: 50, articleDateRange: { start: "2025-01-01", end: "2025-12-01" } }));

    const res = await runDistill({ account: "赛博禅心", sampleSize: 10, onlyStep: "composer" }, { vaultPath: vault, sqlitePath });
    expect(res.steps_run).toEqual(["composer"]);
    expect(existsSync(join(vault, "08_experts", "style-panel", "赛博禅心_kb.md"))).toBe(true);
  });

  it("only-step=snippets throws if quant missing", async () => {
    await expect(runDistill({ account: "赛博禅心", sampleSize: 10, onlyStep: "snippets" }, { vaultPath: vault, sqlitePath })).rejects.toThrow(/missing intermediate/);
  });
});
