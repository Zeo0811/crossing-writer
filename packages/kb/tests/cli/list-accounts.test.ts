import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { buildCli } from "../../src/cli.js";

function makeConfig(tmp: string): string {
  const sqlitePath = join(tmp, "refs.sqlite");
  const vaultPath = join(tmp, "vault");
  mkdirSync(vaultPath, { recursive: true });
  const db = new Database(sqlitePath);
  db.exec(`CREATE TABLE ref_articles (id TEXT PRIMARY KEY, account TEXT, title TEXT, author TEXT, published_at TEXT, url TEXT, summary TEXT, md_path TEXT, topics_core_json TEXT, topics_fine_json TEXT, body_plain TEXT, word_count INT, is_original INT)`);
  const ins = db.prepare(`INSERT INTO ref_articles VALUES (@id,@account,@t,'',@p,'','','','[]','[]','',100,1)`);
  ins.run({ id: "a1", account: "A", t: "t", p: "2025-01-01" });
  ins.run({ id: "a2", account: "A", t: "t", p: "2025-06-01" });
  ins.run({ id: "b1", account: "B", t: "t", p: "2025-02-01" });
  db.close();
  const cfg = join(tmp, "config.json");
  writeFileSync(cfg, JSON.stringify({ sqlitePath, vaultPath }), "utf-8");
  return cfg;
}

describe("CLI list-accounts", () => {
  it("prints account count + date range as JSON with --json", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "sp06-cli-"));
    const cfg = makeConfig(tmp);
    const program = buildCli();
    program.exitOverride();
    let out = "";
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout as any).write = (s: string) => { out += s; return true; };
    try {
      await program.parseAsync(["node", "crossing-kb", "list-accounts", "-c", cfg, "--json"]);
    } finally {
      (process.stdout as any).write = origWrite;
    }
    const parsed = JSON.parse(out);
    expect(parsed).toHaveLength(2);
    const a = parsed.find((r: any) => r.account === "A");
    expect(a.count).toBe(2);
    expect(a.earliest_published_at).toBe("2025-01-01");
    expect(a.latest_published_at).toBe("2025-06-01");
  });
});
