import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

vi.mock("@crossing/agents", async () => ({
  StyleDistillerStructureAgent: vi.fn().mockImplementation(() => ({
    distill: vi.fn().mockRejectedValue(new Error("boom-structure")),
  })),
  StyleDistillerSnippetsAgent: vi.fn().mockImplementation(() => ({
    harvest: vi.fn().mockResolvedValue({ candidates: [], meta: { cli: "c", model: "o", durationMs: 1 } }),
  })),
  StyleDistillerComposerAgent: vi.fn().mockImplementation(() => ({
    compose: vi.fn().mockResolvedValue({ kbMd: "---\n---\n#x", meta: { cli: "c", model: "o", durationMs: 1 } }),
  })),
}));

import { runDistill } from "../../src/style-distiller/orchestrator.js";

function makeDb(dir: string, account: string): string {
  const p = join(dir, "refs.sqlite");
  const db = new Database(p);
  db.exec(`CREATE TABLE ref_articles (id TEXT PRIMARY KEY, account TEXT, title TEXT, author TEXT, published_at TEXT, url TEXT, summary TEXT, md_path TEXT, topics_core_json TEXT, topics_fine_json TEXT, body_plain TEXT, word_count INT, is_original INT)`);
  const ins = db.prepare(`INSERT INTO ref_articles VALUES (@id,@account,@title,'',@pub,'','','','[]','[]',@body,@wc,1)`);
  for (let i = 0; i < 30; i += 1) {
    const m = String((i % 12) + 1).padStart(2, "0");
    ins.run({ id: `${account}_${i}`, account, title: `T${i}`, pub: `2025-${m}-01`, body: `正文${i}`, wc: 500 + i });
  }
  db.close();
  return p;
}

describe("orchestrator error path", () => {
  let vault: string;
  let sqlitePath: string;
  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), "sp06-err-"));
    mkdirSync(join(vault, "08_experts", "style-panel"), { recursive: true });
    mkdirSync(join(vault, ".index"), { recursive: true });
    sqlitePath = makeDb(join(vault, ".index"), "X");
  });

  it("emits step_failed and throws; quant.json is preserved", async () => {
    const events: any[] = [];
    await expect(
      runDistill({ account: "X", sampleSize: 20, onEvent: (ev) => events.push(ev) }, { vaultPath: vault, sqlitePath }),
    ).rejects.toThrow(/boom-structure/);
    expect(existsSync(join(vault, ".distill", "X", "quant.json"))).toBe(true);
    expect(existsSync(join(vault, "08_experts", "style-panel", "X_kb.md"))).toBe(false);
    const failEv = events.find((e) => e.phase === "failed");
    expect(failEv).toBeTruthy();
    expect(failEv.step).toBe("structure");
    expect(failEv.error).toContain("boom-structure");
  });

  it("throws when no articles in date range", async () => {
    await expect(
      runDistill({ account: "NONE", sampleSize: 20 }, { vaultPath: vault, sqlitePath }),
    ).rejects.toThrow(/no articles/);
  });
});
