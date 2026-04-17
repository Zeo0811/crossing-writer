import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@crossing/agents", async () => {
  const actual = await vi.importActual<any>("@crossing/agents");
  const fakeToolsUsed = [{
    tool: "search_wiki",
    query: "q",
    args: {},
    pinned_by: "auto" as const,
    round: 1,
    hits_count: 2,
    hits_summary: [{ path: "a.md", title: "A" }],
  }];
  return {
    ...actual,
    runWriterBookend: vi.fn(async (opts: any) => {
      if (opts.role === 'opening') {
        opts.onEvent?.({ type: "tool_called", agent: "writer.opening", tool: "search_wiki", args: { query: "q" }, round: 1, section_key: opts.sectionKey });
        opts.onEvent?.({ type: "tool_returned", agent: "writer.opening", tool: "search_wiki", round: 1, hits_count: 2, duration_ms: 5, section_key: opts.sectionKey });
        return {
          finalText: "OPEN_W_TOOLS", toolsUsed: fakeToolsUsed, rounds: 2,
          meta: { cli: "claude", model: "opus", durationMs: 10, total_duration_ms: 10 },
        };
      }
      return {
        finalText: "CLOSE", toolsUsed: [], rounds: 1,
        meta: { cli: "claude", model: "opus", durationMs: 30, total_duration_ms: 30 },
      };
    }),
    runWriterPractice: vi.fn(async (opts: any) => {
      const match = /Case 编号：(case-\d+)/.exec(opts.userMessage);
      const caseId = match ? match[1] : "case-??";
      return {
        finalText: `## ${caseId} BODY`, toolsUsed: [], rounds: 1,
        meta: { cli: "claude", model: "sonnet", durationMs: 20, total_duration_ms: 20 },
      };
    }),
    runStyleCritic: vi.fn(async () => ({
      finalText: "NO_CHANGES", toolsUsed: [], rounds: 1,
      meta: { cli: "claude", model: "opus", durationMs: 40, total_duration_ms: 40 },
    })),
    PracticeStitcherAgent: vi.fn().mockImplementation(() => ({
      stitch: vi.fn(async () => ({ transitions: {}, meta: { cli: "claude", model: "haiku", durationMs: 5 } })),
    })),
  };
});

import { ProjectStore } from "../src/services/project-store.js";
import { runWriter } from "../src/services/writer-orchestrator.js";
import yaml from "js-yaml";

async function seed() {
  const vault = mkdtempSync(join(tmpdir(), "sp08-orch-tools-"));
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

describe("writer-orchestrator runs agents through runner", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("emits writer.tool_called SSE event and writes tools_used frontmatter", async () => {
    const { vault, projectsDir, store, pid, pDir } = await seed();
    await runWriter({
      projectId: pid, projectsDir, store,
      vaultPath: vault, sqlitePath: join(vault, "kb.sqlite"),
      writerConfig: { cli_model_per_agent: {} },
    });

    // Check events.ndjson contains writer.tool_called
    const events = readFileSync(join(pDir, "events.jsonl"), "utf-8");
    expect(events).toContain("writer.tool_called");
    expect(events).toContain("writer.tool_returned");

    // Check opening.md frontmatter contains tools_used
    const openingMd = readFileSync(join(pDir, "article/sections/opening.md"), "utf-8");
    const fmMatch = /^---\n([\s\S]*?)\n---/.exec(openingMd);
    expect(fmMatch).toBeTruthy();
    const fm = yaml.load(fmMatch![1]!) as any;
    expect(Array.isArray(fm.tools_used)).toBe(true);
    expect(fm.tools_used).toHaveLength(1);
    expect(fm.tools_used[0].tool).toBe("search_wiki");
    expect(fm.tools_used[0].pinned_by).toBe("auto");
  });
});
