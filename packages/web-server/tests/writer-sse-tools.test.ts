import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@crossing/agents", async () => {
  const actual = await vi.importActual<any>("@crossing/agents");
  return {
    ...actual,
    runWriterBookend: vi.fn(async (opts: any) => {
      // Emit all 4 tool event types to exercise the bridge.
      opts.onEvent?.({
        type: "tool_called",
        section_key: opts.sectionKey,
        agent: "writer.opening",
        tool: "search_raw",
        args: { query: "a" },
        round: 1,
      });
      opts.onEvent?.({
        type: "tool_returned",
        section_key: opts.sectionKey,
        agent: "writer.opening",
        tool: "search_raw",
        round: 1,
        hits_count: 3,
        duration_ms: 5,
      });
      opts.onEvent?.({
        type: "tool_failed",
        section_key: opts.sectionKey,
        agent: "writer.opening",
        tool: "fetch_url",
        round: 1,
        duration_ms: 2,
        error: "net timeout",
      });
      opts.onEvent?.({
        type: "tool_round_completed",
        section_key: opts.sectionKey,
        agent: "writer.opening",
        round: 1,
        total_tools_in_round: 2,
      });
      return {
        finalText: opts.role === "opening" ? "开场" : "结尾",
        toolsUsed: [{
          tool: "search_raw",
          query: "a",
          args: {},
          pinned_by: "auto" as const,
          round: 1,
          hits_count: 3,
          hits_summary: [],
        }],
        rounds: 2,
        meta: { cli: "claude", model: "opus", durationMs: 10, total_duration_ms: 10 },
      };
    }),
    runWriterPractice: vi.fn(async () => ({
      finalText: "## case-01 BODY", toolsUsed: [], rounds: 1,
      meta: { cli: "claude", durationMs: 1, total_duration_ms: 1 },
    })),
    runStyleCritic: vi.fn(async () => ({
      finalText: "NO_CHANGES", toolsUsed: [], rounds: 1,
      meta: { cli: "claude", durationMs: 1, total_duration_ms: 1 },
    })),
    PracticeStitcherAgent: vi.fn().mockImplementation(() => ({
      stitch: vi.fn(async () => ({ transitions: {}, meta: { cli: "claude", durationMs: 1 } })),
    })),
  };
});

import { ProjectStore } from "../src/services/project-store.js";
import { runWriter } from "../src/services/writer-orchestrator.js";

async function seed() {
  const vault = mkdtempSync(join(tmpdir(), "sp08-sse-tools-"));
  const projectsDir = join(vault, "07_projects");
  const store = new ProjectStore(projectsDir);
  const project = await store.create({ name: "T" });
  await store.update(project.id, { status: "writing_configuring", article_type: "实测" });
  const pDir = join(projectsDir, project.id);
  mkdirSync(join(pDir, "mission/case-plan"), { recursive: true });
  mkdirSync(join(pDir, "context"), { recursive: true });
  mkdirSync(join(pDir, "evidence/case-01/screenshots"), { recursive: true });
  writeFileSync(join(pDir, "mission/selected.md"), "mission", "utf-8");
  writeFileSync(join(pDir, "context/product-overview.md"), "overview", "utf-8");
  writeFileSync(join(pDir, "mission/case-plan/selected-cases.md"),
    "---\n---\n\n# Case 1 — Case 01\nbody 01\n", "utf-8");
  writeFileSync(join(pDir, "evidence/case-01/notes.md"), "---\ncase_id: case-01\n---\nnotes\n", "utf-8");
  return { vault, projectsDir, store, pid: project.id, pDir };
}

describe("writer orchestrator forwards tool_* events to SSE via event log", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("publishes writer.tool_called / tool_returned / tool_failed / tool_round_completed", async () => {
    const { vault, projectsDir, store, pid, pDir } = await seed();
    await runWriter({
      projectId: pid,
      projectsDir,
      store,
      vaultPath: vault,
      sqlitePath: join(vault, "kb.sqlite"),
      defaultModel: { writer: { cli: 'claude', model: 'claude-opus-4-7' }, other: { cli: 'claude', model: 'claude-sonnet-4-5' } },
    });

    const events = readFileSync(join(pDir, "events.jsonl"), "utf-8");
    expect(events).toContain("writer.tool_called");
    expect(events).toContain("writer.tool_returned");
    expect(events).toContain("writer.tool_failed");
    expect(events).toContain("writer.tool_round_completed");
  });
});
