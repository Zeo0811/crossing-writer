import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const runIngestMock = vi.fn();
vi.mock("../../src/wiki/orchestrator.js", () => ({
  runIngest: (opts: any, ctx: any) => runIngestMock(opts, ctx),
}));

import { buildCli } from "../../src/cli.js";

function mkConfig(tmp: string): string {
  const sqlitePath = join(tmp, "refs.sqlite");
  const vaultPath = join(tmp, "vault");
  mkdirSync(vaultPath, { recursive: true });
  const db = new Database(sqlitePath);
  db.exec(`CREATE TABLE ref_articles (id TEXT PRIMARY KEY, account TEXT, title TEXT, author TEXT, published_at TEXT, url TEXT, summary TEXT, md_path TEXT, topics_core_json TEXT, topics_fine_json TEXT, body_plain TEXT, word_count INT, is_original INT)`);
  db.close();
  const cfg = join(tmp, "config.json");
  writeFileSync(cfg, JSON.stringify({ sqlitePath, vaultPath }), "utf-8");
  return cfg;
}

describe("CLI wiki ingest", () => {
  it("passes flags to runIngest and streams events to stdout", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "cli-wi-"));
    const cfg = mkConfig(tmp);
    runIngestMock.mockImplementation(async (opts: any) => {
      opts.onEvent?.({ type: "batch_started", account: opts.accounts[0], batchIndex: 0, totalBatches: 1 });
      opts.onEvent?.({ type: "op_applied", op: "upsert", path: "entities/X.md" });
      opts.onEvent?.({ type: "all_completed", stats: { pages_created: 1 } });
      return { accounts_done: opts.accounts, pages_created: 1, pages_updated: 0, sources_appended: 0, images_appended: 0, notes: [] };
    });
    const program = buildCli();
    program.exitOverride();
    let out = "";
    const orig = process.stdout.write.bind(process.stdout);
    (process.stdout as any).write = (s: string) => { out += s; return true; };
    try {
      await program.parseAsync([
        "node", "crossing-kb", "wiki", "ingest",
        "-c", cfg,
        "--accounts", "A,B",
        "--per-account", "30",
        "--batch-size", "3",
        "--mode", "full",
        "--cli", "claude",
        "--model", "opus",
      ]);
    } finally {
      (process.stdout as any).write = orig;
    }
    expect(runIngestMock).toHaveBeenCalled();
    const callArgs = runIngestMock.mock.calls[0]![0];
    expect(callArgs.accounts).toEqual(["A", "B"]);
    expect(callArgs.perAccountLimit).toBe(30);
    expect(callArgs.batchSize).toBe(3);
    expect(callArgs.mode).toBe("full");
    expect(callArgs.cliModel).toEqual({ cli: "claude", model: "opus" });
    expect(out).toContain("[ingest] batch_started");
    expect(out).toContain("entities/X.md");
    expect(out).toContain("all_completed");
  });
});
