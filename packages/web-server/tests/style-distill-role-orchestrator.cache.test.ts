import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

vi.mock("@crossing/agents", () => {
  return {
    runSectionSlicer: vi.fn(),
    DEFAULT_SECTION_SLICER_MODEL: "claude-sonnet-4-5",
    StyleDistillerSnippetsAgent: vi.fn(),
    StyleDistillerStructureAgent: vi.fn(),
    StyleDistillerComposerAgent: vi.fn(),
  };
});

import * as agents from "@crossing/agents";
import {
  runRoleDistill,
  runRoleDistillAll,
  type RoleDistillEvent,
} from "../src/services/style-distill-role-orchestrator.js";
import { SlicerCache, SLICER_PROMPT_HASH } from "../src/services/slicer-cache.js";

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
  vault = mkdtempSync(join(tmpdir(), "sp15-cache-vault-"));
  const dbDir = mkdtempSync(join(tmpdir(), "sp15-cache-db-"));
  sqlitePath = join(dbDir, "refs.db");
  mkdirSync(join(vault, "08_experts", "style-panel"), { recursive: true });

  vi.mocked(agents.runSectionSlicer).mockReset();
  (agents.StyleDistillerSnippetsAgent as any).mockReset?.();
  (agents.StyleDistillerStructureAgent as any).mockReset?.();
  (agents.StyleDistillerComposerAgent as any).mockReset?.();

  (agents.StyleDistillerSnippetsAgent as any).mockImplementation(() => ({
    harvest: vi.fn(async () => ({
      candidates: [],
      meta: { cli: "claude", model: null, durationMs: 1 },
    })),
  }));
  (agents.StyleDistillerStructureAgent as any).mockImplementation(() => ({
    distill: vi.fn(async () => ({
      text: "structure md",
      meta: { cli: "claude", model: null, durationMs: 1 },
    })),
  }));
  (agents.StyleDistillerComposerAgent as any).mockImplementation(() => ({
    compose: vi.fn(async () => ({
      kbMd: "# composed",
      meta: { cli: "claude", model: null, durationMs: 1 },
    })),
  }));
});

describe("orchestrator cache integration — SP-15 T6", () => {
  it("writes the slicer result to cache on a miss, no cache-hit events", async () => {
    const body = "intro. practice. closing.";
    setupDb([{ id: "a1", account: "acc", body, published_at: "2026-04-01" }]);
    vi.mocked(agents.runSectionSlicer).mockResolvedValue({
      slices: [{ start_char: 0, end_char: 6, role: "opening" }],
      meta: { cli: "claude", model: null, durationMs: 1 },
    });

    const events: RoleDistillEvent[] = [];
    await runRoleDistill(
      { account: "acc", role: "opening" },
      {
        sqlitePath,
        vaultPath: vault,
        cliModelPerStep: { slicer: { cli: "claude", model: "claude-sonnet-4-5" } },
        onEvent: (ev) => events.push(ev),
      },
    );

    expect(vi.mocked(agents.runSectionSlicer)).toHaveBeenCalledTimes(1);
    const cache = new SlicerCache({ vaultRoot: vault });
    const key = cache.computeKey({
      model: "claude-sonnet-4-5",
      body,
      promptHash: SLICER_PROMPT_HASH,
    });
    const entry = await cache.get(key);
    expect(entry).toBeDefined();
    expect(entry!.article_id).toBe("a1");
    expect(entry!.slicer_model).toBe("claude-sonnet-4-5");
    expect(entry!.slicer_prompt_hash).toBe(SLICER_PROMPT_HASH);
    expect(events.some((e) => e.phase === "slicer_cache_hit")).toBe(false);
  });

  it("short-circuits slicer on cache hit and emits slicer_cache_hit", async () => {
    const body = "intro. practice. closing.";
    setupDb([{ id: "a1", account: "acc", body, published_at: "2026-04-01" }]);
    vi.mocked(agents.runSectionSlicer).mockResolvedValue({
      slices: [{ start_char: 0, end_char: 6, role: "opening" }],
      meta: { cli: "claude", model: null, durationMs: 1 },
    });

    // Prime cache
    await runRoleDistill(
      { account: "acc", role: "opening" },
      {
        sqlitePath,
        vaultPath: vault,
        cliModelPerStep: { slicer: { cli: "claude", model: "claude-sonnet-4-5" } },
      },
    );
    vi.mocked(agents.runSectionSlicer).mockClear();

    const events: RoleDistillEvent[] = [];
    await runRoleDistill(
      { account: "acc", role: "opening" },
      {
        sqlitePath,
        vaultPath: vault,
        cliModelPerStep: { slicer: { cli: "claude", model: "claude-sonnet-4-5" } },
        onEvent: (ev) => events.push(ev),
      },
    );

    expect(vi.mocked(agents.runSectionSlicer)).not.toHaveBeenCalled();
    const hit = events.find((e) => e.phase === "slicer_cache_hit") as any;
    expect(hit).toBeDefined();
    expect(hit.article_id).toBe("a1");
    expect(hit.cache_key).toMatch(/^[a-f0-9]{16}$/);
    expect(hit.cached_at).toBeTruthy();
  });

  it("SP-15 T8 E2E: second run for same article makes zero slicer LLM calls", async () => {
    const body = "intro. practice. closing.";
    setupDb([{ id: "a-same", account: "acc", body, published_at: "2026-04-01" }]);
    vi.mocked(agents.runSectionSlicer).mockResolvedValue({
      slices: [{ start_char: 0, end_char: 6, role: "opening" }],
      meta: { cli: "claude", model: null, durationMs: 1 },
    });

    for (let i = 0; i < 2; i++) {
      await runRoleDistill(
        { account: "acc", role: "opening" },
        {
          sqlitePath,
          vaultPath: vault,
          cliModelPerStep: { slicer: { cli: "claude", model: "claude-sonnet-4-5" } },
        },
      );
    }

    expect(vi.mocked(agents.runSectionSlicer)).toHaveBeenCalledTimes(1);
  });

  it("SP-15 T8: runRoleDistillAll reuses cached slicer across runs", async () => {
    const body = "intro. practice. closing.";
    setupDb([
      { id: "a1", account: "acc", body, published_at: "2026-04-01" },
      { id: "a2", account: "acc", body: body + " extra", published_at: "2026-04-02" },
    ]);
    vi.mocked(agents.runSectionSlicer).mockResolvedValue({
      slices: [
        { start_char: 0, end_char: 6, role: "opening" },
        { start_char: 7, end_char: 15, role: "practice" },
        { start_char: 16, end_char: 24, role: "closing" },
      ],
      meta: { cli: "claude", model: null, durationMs: 1 },
    });

    await runRoleDistillAll(
      { account: "acc" },
      {
        sqlitePath,
        vaultPath: vault,
        cliModelPerStep: { slicer: { cli: "claude", model: "claude-sonnet-4-5" } },
      },
    );
    const firstCallCount = vi.mocked(agents.runSectionSlicer).mock.calls.length;
    expect(firstCallCount).toBe(2); // both articles sliced once

    vi.mocked(agents.runSectionSlicer).mockClear();
    const events: any[] = [];
    await runRoleDistillAll(
      { account: "acc" },
      {
        sqlitePath,
        vaultPath: vault,
        cliModelPerStep: { slicer: { cli: "claude", model: "claude-sonnet-4-5" } },
        onEvent: (ev) => events.push(ev),
      },
    );
    expect(vi.mocked(agents.runSectionSlicer)).not.toHaveBeenCalled();
    const hits = events.filter((e) => e.phase === "slicer_cache_hit");
    expect(hits.length).toBe(2);
  });

  it("cache write failures do not throw (warn and continue)", async () => {
    const body = "intro. practice. closing.";
    setupDb([{ id: "a1", account: "acc", body, published_at: "2026-04-01" }]);
    vi.mocked(agents.runSectionSlicer).mockResolvedValue({
      slices: [{ start_char: 0, end_char: 6, role: "opening" }],
      meta: { cli: "claude", model: null, durationMs: 1 },
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Point vault at a non-existent absolute path with an unwritable parent (use
    // a file path so mkdir fails).
    const badVault = "/proc/definitely-not-writable-sp15";
    // Use a custom vault that exists for panel writes, but poison the cache dir
    // by creating a file where the dir should go.
    const { writeFileSync, mkdirSync: mk } = await import("node:fs");
    mk(join(vault, "08_experts", "_cache"), { recursive: true });
    writeFileSync(join(vault, "08_experts", "_cache", "slicer"), "blocker");

    await expect(
      runRoleDistill(
        { account: "acc", role: "opening" },
        {
          sqlitePath,
          vaultPath: vault,
          cliModelPerStep: { slicer: { cli: "claude", model: "claude-sonnet-4-5" } },
        },
      ),
    ).resolves.toBeDefined();
    warnSpy.mockRestore();
    void badVault;
  });
});
