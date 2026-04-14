import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

vi.mock("@crossing/agents", () => {
  return {
    runSectionSlicer: vi.fn(),
    StyleDistillerSnippetsAgent: vi.fn(),
    StyleDistillerStructureAgent: vi.fn(),
    StyleDistillerComposerAgent: vi.fn(),
  };
});

import * as agents from "@crossing/agents";
import { runRoleDistill, type RoleDistillEvent } from "../src/services/style-distill-role-orchestrator.js";
import { StylePanelStore } from "../src/services/style-panel-store.js";

let vault: string;
let sqlitePath: string;

function setupDb(articles: { id: string; account: string; body: string; published_at: string }[]) {
  const db = new Database(sqlitePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ref_articles (
      id TEXT PRIMARY KEY,
      account TEXT,
      body_plain TEXT,
      published_at TEXT
    );
  `);
  const stmt = db.prepare(
    "INSERT INTO ref_articles (id, account, body_plain, published_at) VALUES (@id, @account, @body, @published_at)",
  );
  for (const a of articles) stmt.run(a);
  db.close();
}

function mockHarvest(returnValue: any = { candidates: [{ tag: "t", from: "a1", excerpt: "x", position_ratio: 0.1, length: 1 }], meta: { cli: "claude", model: null, durationMs: 10 } }) {
  return vi.fn(async () => returnValue);
}
function mockDistill(returnValue: any = { text: "structure md", meta: { cli: "claude", model: null, durationMs: 10 } }) {
  return vi.fn(async () => returnValue);
}
function mockCompose(returnValue: any = { kbMd: "# composed body", meta: { cli: "claude", model: null, durationMs: 25 } }) {
  return vi.fn(async () => returnValue);
}

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "sp10-rd-vault-"));
  const dbDir = mkdtempSync(join(tmpdir(), "sp10-rd-db-"));
  sqlitePath = join(dbDir, "refs.db");
  mkdirSync(join(vault, "08_experts", "style-panel"), { recursive: true });

  vi.mocked(agents.runSectionSlicer).mockReset();
  (agents.StyleDistillerSnippetsAgent as any).mockReset?.();
  (agents.StyleDistillerStructureAgent as any).mockReset?.();
  (agents.StyleDistillerComposerAgent as any).mockReset?.();

  (agents.StyleDistillerSnippetsAgent as any).mockImplementation(() => ({ harvest: mockHarvest() }));
  (agents.StyleDistillerStructureAgent as any).mockImplementation(() => ({ distill: mockDistill() }));
  (agents.StyleDistillerComposerAgent as any).mockImplementation(() => ({ compose: mockCompose() }));
});

describe("runRoleDistill", () => {
  it("happy path: 3 articles -> slicer -> composer -> write panel with version 1", async () => {
    const body = "intro text here. practice section. closing thoughts.";
    setupDb([
      { id: "a1", account: "acc", body, published_at: "2026-04-01" },
      { id: "a2", account: "acc", body, published_at: "2026-04-02" },
      { id: "a3", account: "acc", body, published_at: "2026-04-03" },
    ]);

    vi.mocked(agents.runSectionSlicer).mockResolvedValue({
      slices: [
        { start_char: 0, end_char: 17, role: "opening" },
        { start_char: 18, end_char: 35, role: "practice" },
        { start_char: 36, end_char: body.length, role: "closing" },
      ],
      meta: { cli: "claude", model: null, durationMs: 5 },
    });

    const events: RoleDistillEvent[] = [];
    const result = await runRoleDistill(
      { account: "acc", role: "opening" },
      {
        sqlitePath,
        vaultPath: vault,
        onEvent: (ev) => events.push(ev),
      },
    );

    expect(result.version).toBe(1);
    expect(result.panelPath).toMatch(/opening-v1\.md$/);

    // Verify panel written
    const store = new StylePanelStore(vault);
    const all = store.list();
    expect(all).toHaveLength(1);
    expect(all[0].frontmatter.account).toBe("acc");
    expect(all[0].frontmatter.role).toBe("opening");
    expect(all[0].frontmatter.version).toBe(1);
    expect(all[0].frontmatter.source_article_count).toBe(3);

    // Event sequence: started first, composer_done last
    expect(events[0].phase).toBe("started");
    expect(events[events.length - 1].phase).toBe("composer_done");
    // Must contain each phase at least once
    const phases = events.map((e) => e.phase);
    expect(phases).toContain("slicer_progress");
    expect(phases).toContain("snippets_done");
    expect(phases).toContain("structure_done");
  });

  it("slicer error on 1 article: skip, keep going", async () => {
    const body = "intro. practice. closing.";
    setupDb([
      { id: "a1", account: "acc", body, published_at: "2026-04-01" },
      { id: "a2", account: "acc", body, published_at: "2026-04-02" },
    ]);

    vi.mocked(agents.runSectionSlicer).mockImplementation(async () => {
      const call = vi.mocked(agents.runSectionSlicer).mock.calls.length;
      if (call === 1) throw new Error("slicer boom");
      return {
        slices: [{ start_char: 0, end_char: 6, role: "opening" }],
        meta: { cli: "claude", model: null, durationMs: 1 },
      };
    });

    const events: RoleDistillEvent[] = [];
    const result = await runRoleDistill(
      { account: "acc", role: "opening" },
      { sqlitePath, vaultPath: vault, onEvent: (ev) => events.push(ev) },
    );
    expect(result.version).toBe(1);
    expect(events[events.length - 1].phase).toBe("composer_done");
  });

  it("empty account: throws and emits failed", async () => {
    setupDb([]);
    const events: RoleDistillEvent[] = [];
    await expect(
      runRoleDistill(
        { account: "ghost", role: "opening" },
        { sqlitePath, vaultPath: vault, onEvent: (ev) => events.push(ev) },
      ),
    ).rejects.toThrow(/no articles/i);
    expect(events[events.length - 1].phase).toBe("failed");
  });

  it("version bumps to previous max + 1", async () => {
    const body = "intro text. practice. closing.";
    setupDb([{ id: "a1", account: "acc", body, published_at: "2026-04-01" }]);
    vi.mocked(agents.runSectionSlicer).mockResolvedValue({
      slices: [{ start_char: 0, end_char: 11, role: "opening" }],
      meta: { cli: "claude", model: null, durationMs: 1 },
    });

    // Pre-seed v1, v2 for (acc, opening)
    const store = new StylePanelStore(vault);
    store.write({
      frontmatter: { account: "acc", role: "opening", version: 1, status: "active", created_at: "2026-04-01T00:00:00Z", source_article_count: 1 },
      body: "prev",
      absPath: "",
    });
    store.write({
      frontmatter: { account: "acc", role: "opening", version: 2, status: "deleted", created_at: "2026-04-02T00:00:00Z", source_article_count: 1 },
      body: "prev2",
      absPath: "",
    });

    const result = await runRoleDistill(
      { account: "acc", role: "opening" },
      { sqlitePath, vaultPath: vault },
    );
    expect(result.version).toBe(3);
  });

  it("filters slices by role (only role-matching slices enter corpus)", async () => {
    const body = "AAAA_BBBB_CCCC";
    setupDb([{ id: "a1", account: "acc", body, published_at: "2026-04-01" }]);
    vi.mocked(agents.runSectionSlicer).mockResolvedValue({
      slices: [
        { start_char: 0, end_char: 4, role: "opening" },
        { start_char: 5, end_char: 9, role: "practice" },
        { start_char: 10, end_char: 14, role: "closing" },
      ],
      meta: { cli: "claude", model: null, durationMs: 1 },
    });

    // Capture what the snippets agent receives
    const harvestSpy = vi.fn(async () => ({ candidates: [{ tag: "t", from: "x", excerpt: "e", position_ratio: 0, length: 1 }], meta: { cli: "claude", model: null, durationMs: 1 } }));
    (agents.StyleDistillerSnippetsAgent as any).mockImplementation(() => ({ harvest: harvestSpy }));

    await runRoleDistill(
      { account: "acc", role: "practice" },
      { sqlitePath, vaultPath: vault },
    );

    expect(harvestSpy).toHaveBeenCalledTimes(1);
    const arg = harvestSpy.mock.calls[0]![0] as any;
    const corpus = arg.articles[0].body_plain as string;
    expect(corpus).toContain("BBBB");
    expect(corpus).not.toContain("AAAA");
    expect(corpus).not.toContain("CCCC");
  });
});
