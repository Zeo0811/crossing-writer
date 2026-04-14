import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const runDistillMock = vi.fn();
vi.mock("../../src/style-distiller/orchestrator.js", () => ({
  runDistill: (opts: any, ctx: any) => runDistillMock(opts, ctx),
}));

import { buildCli } from "../../src/cli.js";

function makeConfig(tmp: string): string {
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

describe("CLI distill-style", () => {
  beforeEach(() => { runDistillMock.mockReset(); });

  it("passes flags (sample-size / since / until / only-step / dry-run / model overrides) to orchestrator", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "sp06-cli2-"));
    const cfg = makeConfig(tmp);
    runDistillMock.mockImplementation(async (opts: any) => {
      (opts.onEvent ?? (() => {}))({ step: "quant", phase: "started", account: opts.account });
      (opts.onEvent ?? (() => {}))({ step: "quant", phase: "completed", account: opts.account, stats: { article_count: 10, source_pool: 50 } });
      return { account: opts.account, kb_path: "/tmp/x_kb.md", sample_size_actual: 10, steps_run: ["quant"] };
    });
    const program = buildCli();
    program.exitOverride();
    let out = "";
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout as any).write = (s: string) => { out += s; return true; };
    try {
      await program.parseAsync([
        "node", "crossing-kb", "distill-style", "赛博禅心",
        "-c", cfg,
        "--sample-size", "50",
        "--since", "2025-01-01",
        "--until", "2026-04-01",
        "--only-step", "quant",
        "--structure-cli", "codex",
        "--snippets-model", "haiku",
        "--composer-cli", "claude",
        "--composer-model", "opus",
      ]);
    } finally {
      (process.stdout as any).write = origWrite;
    }
    expect(runDistillMock).toHaveBeenCalled();
    const call = runDistillMock.mock.calls[0];
    expect(call[0].account).toBe("赛博禅心");
    expect(call[0].sampleSize).toBe(50);
    expect(call[0].since).toBe("2025-01-01");
    expect(call[0].until).toBe("2026-04-01");
    expect(call[0].onlyStep).toBe("quant");
    expect(call[0].cliModelPerStep.structure.cli).toBe("codex");
    expect(call[0].cliModelPerStep.snippets.model).toBe("haiku");
    expect(call[0].cliModelPerStep.composer.cli).toBe("claude");
    expect(call[0].cliModelPerStep.composer.model).toBe("opus");
    expect(out).toContain("[1/4] quant-analyzer");
    expect(out).toContain("/tmp/x_kb.md");
  });

  it("--dry-run sets dryRun=true", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "sp06-cli3-"));
    const cfg = makeConfig(tmp);
    runDistillMock.mockResolvedValue({ account: "x", kb_path: "", sample_size_actual: 5, steps_run: ["quant"] });
    const program = buildCli();
    program.exitOverride();
    await program.parseAsync(["node", "crossing-kb", "distill-style", "x", "-c", cfg, "--dry-run"]);
    expect(runDistillMock.mock.calls[0]![0].dryRun).toBe(true);
  });
});
