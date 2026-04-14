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
import {
  runRoleDistillAll,
  type AllRolesDistillEvent,
} from "../src/services/style-distill-role-orchestrator.js";
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

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), "sp10-rda-vault-"));
  const dbDir = mkdtempSync(join(tmpdir(), "sp10-rda-db-"));
  sqlitePath = join(dbDir, "refs.db");
  mkdirSync(join(vault, "08_experts", "style-panel"), { recursive: true });

  vi.mocked(agents.runSectionSlicer).mockReset();
  (agents.StyleDistillerSnippetsAgent as any).mockReset?.();
  (agents.StyleDistillerStructureAgent as any).mockReset?.();
  (agents.StyleDistillerComposerAgent as any).mockReset?.();

  (agents.StyleDistillerSnippetsAgent as any).mockImplementation(() => ({
    harvest: vi.fn(async () => ({
      candidates: [{ tag: "t", from: "a1", excerpt: "x", position_ratio: 0.1, length: 1 }],
      meta: { cli: "claude", model: null, durationMs: 10 },
    })),
  }));
  (agents.StyleDistillerStructureAgent as any).mockImplementation(() => ({
    distill: vi.fn(async () => ({
      text: "structure md",
      meta: { cli: "claude", model: null, durationMs: 10 },
    })),
  }));
  (agents.StyleDistillerComposerAgent as any).mockImplementation(() => ({
    compose: vi.fn(async () => ({
      kbMd: "# composed body",
      meta: { cli: "claude", model: null, durationMs: 25 },
    })),
  }));
});

describe("runRoleDistillAll", () => {
  it("runs slicer once, writes 3 panels, emits expected events", async () => {
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

    const events: AllRolesDistillEvent[] = [];
    const result = await runRoleDistillAll(
      { account: "acc" },
      {
        sqlitePath,
        vaultPath: vault,
        onEvent: (ev) => events.push(ev),
      },
    );

    // Slicer called exactly once per article (3 articles), not 3×3=9
    expect(vi.mocked(agents.runSectionSlicer)).toHaveBeenCalledTimes(3);

    // 3 panels written
    const store = new StylePanelStore(vault);
    const all = store.list();
    expect(all).toHaveLength(3);
    const roles = all.map((p) => p.frontmatter.role).sort();
    expect(roles).toEqual(["closing", "opening", "practice"]);
    for (const p of all) {
      expect(p.frontmatter.version).toBe(1);
      expect(p.frontmatter.account).toBe("acc");
    }

    // Result summary
    expect(result.results).toHaveLength(3);
    for (const r of result.results) {
      expect(r.panelPath).toMatch(/\.md$/);
      expect(r.version).toBe(1);
      expect(r.error).toBeUndefined();
    }

    // Event sequence
    const phases = events.map((e) => e.phase);
    expect(phases[0]).toBe("all.started");
    expect(phases[phases.length - 1]).toBe("all.finished");
    expect(phases).toContain("slicer_progress");
    expect(phases.filter((p) => p === "role_started")).toHaveLength(3);
    expect(phases.filter((p) => p === "role_done")).toHaveLength(3);

    // Slicer progress events happen before role_started events
    const lastSlicerIdx = phases.lastIndexOf("slicer_progress");
    const firstRoleStartedIdx = phases.indexOf("role_started");
    expect(lastSlicerIdx).toBeLessThan(firstRoleStartedIdx);
  });

  it("emits role_failed for role with empty corpus but continues other roles", async () => {
    const body = "only opening text here.";
    setupDb([{ id: "a1", account: "acc", body, published_at: "2026-04-01" }]);

    // Only opening role present in slices
    vi.mocked(agents.runSectionSlicer).mockResolvedValue({
      slices: [{ start_char: 0, end_char: body.length, role: "opening" }],
      meta: { cli: "claude", model: null, durationMs: 5 },
    });

    const events: AllRolesDistillEvent[] = [];
    const result = await runRoleDistillAll(
      { account: "acc" },
      { sqlitePath, vaultPath: vault, onEvent: (ev) => events.push(ev) },
    );

    const roleDone = result.results.filter((r) => r.panelPath);
    const roleFailed = result.results.filter((r) => r.error);
    expect(roleDone).toHaveLength(1);
    expect(roleDone[0]!.role).toBe("opening");
    expect(roleFailed.map((r) => r.role).sort()).toEqual(["closing", "practice"]);

    const phases = events.map((e) => e.phase);
    expect(phases).toContain("role_failed");
    expect(phases[phases.length - 1]).toBe("all.finished");
  });

  it("empty account: all 3 roles fail, still emits all.finished", async () => {
    setupDb([]);
    const events: AllRolesDistillEvent[] = [];
    const result = await runRoleDistillAll(
      { account: "ghost" },
      { sqlitePath, vaultPath: vault, onEvent: (ev) => events.push(ev) },
    );
    expect(result.results.every((r) => r.error)).toBe(true);
    expect(events[events.length - 1].phase).toBe("all.finished");
    expect(events.filter((e) => e.phase === "role_failed")).toHaveLength(3);
  });
});
