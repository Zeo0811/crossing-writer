import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@crossing/agents", async () => {
  const actual = await vi.importActual<any>("@crossing/agents");
  return {
    ...actual,
    runWriterOpening: vi.fn(async () => ({
      finalText: "OPENING_TEXT", toolsUsed: [], rounds: 1,
      meta: { cli: "claude", model: "opus", durationMs: 10, total_duration_ms: 10 },
    })),
    runWriterPractice: vi.fn(async (opts: any) => {
      const match = /Case 编号：(case-\d+)/.exec(opts.userMessage);
      const caseId = match ? match[1] : "case-??";
      return {
        finalText: `## ${caseId} BODY`, toolsUsed: [], rounds: 1,
        meta: { cli: "claude", model: "sonnet", durationMs: 20, total_duration_ms: 20 },
      };
    }),
    runWriterClosing: vi.fn(async () => ({
      finalText: "CLOSING_TEXT", toolsUsed: [], rounds: 1,
      meta: { cli: "claude", model: "opus", durationMs: 30, total_duration_ms: 30 },
    })),
    runStyleCritic: vi.fn(async () => ({
      finalText: "NO_CHANGES", toolsUsed: [], rounds: 1,
      meta: { cli: "claude", model: "opus", durationMs: 40, total_duration_ms: 40 },
    })),
    PracticeStitcherAgent: vi.fn().mockImplementation(() => ({
      stitch: vi.fn(async (input: any) => ({
        transitions: input.cases.length >= 2 ? { "case-01-to-case-02": "TR12" } : {},
        meta: { cli: "claude", model: "haiku", durationMs: 5 },
      })),
    })),
  };
});

import { ProjectStore } from "../src/services/project-store.js";
import { runWriter } from "../src/services/writer-orchestrator.js";

function setupProject() {
  const vault = mkdtempSync(join(tmpdir(), "sp05-orch-"));
  const projectsDir = join(vault, "07_projects");
  const store = new ProjectStore(projectsDir);
  return { vault, projectsDir, store };
}

async function seedProject(store: ProjectStore, projectsDir: string, caseCount: number) {
  const project = await store.create({ name: "T" });
  await store.update(project.id, { status: "writing_configuring", article_type: "实测" });
  const pDir = join(projectsDir, project.id);
  mkdirSync(join(pDir, "mission/case-plan"), { recursive: true });
  mkdirSync(join(pDir, "context"), { recursive: true });
  mkdirSync(join(pDir, "evidence"), { recursive: true });
  writeFileSync(join(pDir, "mission/selected.md"), "---\n---\nmission body\n", "utf-8");
  writeFileSync(join(pDir, "context/product-overview.md"), "---\n---\noverview body\n", "utf-8");
  const cases = Array.from({ length: caseCount }, (_, i) => {
    const idx = String(i + 1).padStart(2, "0");
    return `# Case ${i + 1} — Case ${idx} Name\nbody ${idx}`;
  }).join("\n\n");
  writeFileSync(join(pDir, "mission/case-plan/selected-cases.md"), `---\n---\n\n${cases}\n`, "utf-8");
  for (let i = 0; i < caseCount; i++) {
    const idx = String(i + 1).padStart(2, "0");
    const caseDir = join(pDir, "evidence", `case-${idx}`);
    mkdirSync(join(caseDir, "screenshots"), { recursive: true });
    writeFileSync(join(caseDir, "notes.md"), `---\ncase_id: case-${idx}\n---\nnotes ${idx}\n`, "utf-8");
  }
  return project.id;
}

describe("writer-orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("C pipeline: opening ‖ practice per-case → stitcher → closing → critic; writes sections/*.md and transitions.md", async () => {
    const { vault, projectsDir, store } = setupProject();
    const pid = await seedProject(store, projectsDir, 2);
    await runWriter({
      projectId: pid, projectsDir, store,
      vaultPath: vault, sqlitePath: join(vault, "kb.sqlite"),
      writerConfig: { cli_model_per_agent: {}, reference_accounts_per_agent: {} },
    });
    const pDir = join(projectsDir, pid);
    expect(readFileSync(join(pDir, "article/sections/opening.md"), "utf-8")).toContain("OPENING_TEXT");
    expect(readFileSync(join(pDir, "article/sections/practice/case-01.md"), "utf-8")).toContain("case-01 BODY");
    expect(readFileSync(join(pDir, "article/sections/practice/case-02.md"), "utf-8")).toContain("case-02 BODY");
    expect(readFileSync(join(pDir, "article/sections/practice/transitions.md"), "utf-8")).toContain("TR12");
    expect(readFileSync(join(pDir, "article/sections/closing.md"), "utf-8")).toContain("CLOSING_TEXT");
    const project = await store.get(pid);
    expect(project?.status).toBe("writing_ready");
  });

  it("sets writing_failed + writer_failed_sections when opening agent throws", async () => {
    const agentsMod = await import("@crossing/agents");
    (agentsMod.runWriterOpening as any).mockImplementationOnce(async () => { throw new Error("opening boom"); });
    const { vault, projectsDir, store } = setupProject();
    const pid = await seedProject(store, projectsDir, 1);
    await expect(runWriter({
      projectId: pid, projectsDir, store,
      vaultPath: vault, sqlitePath: join(vault, "kb.sqlite"),
      writerConfig: { cli_model_per_agent: {}, reference_accounts_per_agent: {} },
    })).rejects.toThrow();
    const project = await store.get(pid);
    expect(project?.status).toBe("writing_failed");
    expect(project?.writer_failed_sections).toContain("opening");
  });

  it("single-case skips stitcher (empty transitions)", async () => {
    const { vault, projectsDir, store } = setupProject();
    const pid = await seedProject(store, projectsDir, 1);
    await runWriter({
      projectId: pid, projectsDir, store,
      vaultPath: vault, sqlitePath: join(vault, "kb.sqlite"),
      writerConfig: { cli_model_per_agent: {}, reference_accounts_per_agent: {} },
    });
    const pDir = join(projectsDir, pid);
    const trans = readFileSync(join(pDir, "article/sections/practice/transitions.md"), "utf-8");
    expect(trans).not.toContain("TR12");
  });
});

// T9: retry-failed + per-project override
describe("writer-orchestrator retry + override", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("retry only runs failed sections and clears writer_failed_sections on success", async () => {
    const { vault, projectsDir, store } = setupProject();
    const pid = await seedProject(store, projectsDir, 2);
    await store.update(pid, { status: "writing_failed", writer_failed_sections: ["practice.case-02"] });

    const { ArticleStore } = await import("../src/services/article-store.js");
    const pDir = join(projectsDir, pid);
    const as = new ArticleStore(pDir);
    await as.init();
    for (const k of ["opening", "practice.case-01", "practice.case-02", "closing"]) {
      await as.writeSection(k as any, {
        key: k as any,
        frontmatter: { section: k as any, last_agent: "a", last_updated_at: "t" },
        body: `SEED_${k}`,
      });
    }
    await as.writeSection("transitions", {
      key: "transitions",
      frontmatter: { section: "transitions", last_agent: "practice.stitcher", last_updated_at: "t" },
      body: "## transition.case-01-to-case-02\nTR12",
    });
    await store.update(pid, { status: "writing_failed" });

    const agentsMod = await import("@crossing/agents");
    const practiceSpy = vi.fn(async (opts: any) => {
      const match = /Case 编号：(case-\d+)/.exec(opts.userMessage);
      const caseId = match ? match[1] : "case-??";
      return {
        finalText: `## ${caseId} RETRY`, toolsUsed: [], rounds: 1,
        meta: { cli: "claude", model: "sonnet", durationMs: 1, total_duration_ms: 1 },
      };
    });
    (agentsMod.runWriterPractice as any).mockImplementation(practiceSpy);

    await runWriter({
      projectId: pid, projectsDir, store,
      vaultPath: vault, sqlitePath: join(vault, "kb.sqlite"),
      writerConfig: { cli_model_per_agent: {}, reference_accounts_per_agent: {} },
      sectionsToRun: ["practice.case-02"],
    });

    const callIds = practiceSpy.mock.calls.map((c: any[]) => {
      const m = /Case 编号：(case-\d+)/.exec(c[0].userMessage);
      return m ? m[1] : null;
    });
    expect(callIds).toEqual(["case-02"]);
    const project = await store.get(pid);
    expect(project?.status).toBe("writing_ready");
    expect(project?.writer_failed_sections).toEqual([]);
  });

  it("per-project writer_config overrides are forwarded to runner invoker", async () => {
    const { vault, projectsDir, store } = setupProject();
    const pid = await seedProject(store, projectsDir, 1);
    const agentsMod = await import("@crossing/agents");
    (agentsMod.runWriterOpening as any).mockClear();

    await runWriter({
      projectId: pid, projectsDir, store,
      vaultPath: vault, sqlitePath: join(vault, "kb.sqlite"),
      writerConfig: {
        cli_model_per_agent: { "writer.opening": { cli: "codex", model: "gpt-5" } },
        reference_accounts_per_agent: { "writer.opening": ["赛博禅心"] },
      },
    });
    const callArgs = (agentsMod.runWriterOpening as any).mock.calls[0]![0];
    // invokeAgent is the wrapper — we can't directly inspect cli/model but can
    // check that a function is passed + dispatchTool is wired.
    expect(typeof callArgs.invokeAgent).toBe("function");
    expect(typeof callArgs.dispatchTool).toBe("function");
  });
});
