import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WikiStore } from "../../src/wiki/wiki-store.js";
import { buildCli } from "../../src/cli.js";

function setup(): { cfg: string; vault: string } {
  const tmp = mkdtempSync(join(tmpdir(), "cli-wm-"));
  const vault = join(tmp, "vault");
  mkdirSync(vault, { recursive: true });
  const store = new WikiStore(vault);
  store.applyPatch({ op: "upsert", path: "entities/Alice.md", frontmatter: { type: "entity", title: "Alice", last_ingest: "2026-04-14T00:00:00Z" }, body: "Alice researcher" });
  const sqlitePath = join(tmp, "refs.sqlite");
  writeFileSync(sqlitePath, "");
  const cfg = join(tmp, "config.json");
  writeFileSync(cfg, JSON.stringify({ sqlitePath, vaultPath: vault }), "utf-8");
  return { cfg, vault };
}

async function captureCli(args: string[]): Promise<string> {
  const program = buildCli();
  program.exitOverride();
  let out = "";
  const orig = process.stdout.write.bind(process.stdout);
  (process.stdout as any).write = (s: string) => { out += s; return true; };
  try {
    await program.parseAsync(["node", "crossing-kb", ...args]);
  } finally {
    (process.stdout as any).write = orig;
  }
  return out;
}

describe("CLI wiki search/show/status", () => {
  it("search prints hits", async () => {
    const { cfg } = setup();
    const out = await captureCli(["wiki", "search", "Alice", "-c", cfg]);
    expect(out).toContain("entities/Alice.md");
    expect(out).toContain("Alice");
  });

  it("show prints page raw", async () => {
    const { cfg } = setup();
    const out = await captureCli(["wiki", "show", "entities/Alice.md", "-c", cfg]);
    expect(out).toContain("Alice researcher");
    expect(out).toContain("type: entity");
  });

  it("status prints json counts", async () => {
    const { cfg } = setup();
    const out = await captureCli(["wiki", "status", "-c", cfg]);
    const parsed = JSON.parse(out);
    expect(parsed.total).toBe(1);
    expect(parsed.by_kind.entity).toBe(1);
    expect(parsed.last_ingest_at).toBe("2026-04-14T00:00:00Z");
  });
});
