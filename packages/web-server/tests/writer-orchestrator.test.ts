import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@crossing/agents", async () => {
  const actual = await vi.importActual<any>("@crossing/agents");
  return {
    ...actual,
    WriterOpeningAgent: vi.fn().mockImplementation(() => ({
      write: vi.fn(async () => ({ text: "OPENING_TEXT", meta: { cli: "claude", model: "opus", durationMs: 10 } })),
    })),
    WriterPracticeAgent: vi.fn().mockImplementation(() => ({
      write: vi.fn(async (input: any) => ({ text: `## ${input.caseId} BODY`, meta: { cli: "claude", model: "sonnet", durationMs: 20 } })),
    })),
    PracticeStitcherAgent: vi.fn().mockImplementation(() => ({
      stitch: vi.fn(async (input: any) => ({
        transitions: input.cases.length >= 2 ? { "case-01-to-case-02": "TR12" } : {},
        meta: { cli: "claude", model: "haiku", durationMs: 5 },
      })),
    })),
    WriterClosingAgent: vi.fn().mockImplementation(() => ({
      write: vi.fn(async () => ({ text: "CLOSING_TEXT", meta: { cli: "claude", model: "opus", durationMs: 30 } })),
    })),
    StyleCriticAgent: vi.fn().mockImplementation(() => ({
      critique: vi.fn(async () => ({ rewrites: {}, meta: { cli: "claude", model: "opus", durationMs: 40 } })),
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
  await store.update(project.id, { status: "writing_configuring" });
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
    (agentsMod.WriterOpeningAgent as any).mockImplementationOnce(() => ({
      write: vi.fn(async () => { throw new Error("opening boom"); }),
    }));
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

    // pre-seed opening/case-01/case-02/closing so that only case-02 gets re-run
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
    const practiceSpy = vi.fn(async (input: any) => ({
      text: `## ${input.caseId} RETRY`, meta: { cli: "claude", model: "sonnet", durationMs: 1 },
    }));
    (agentsMod.WriterPracticeAgent as any).mockImplementation(() => ({ write: practiceSpy }));

    await runWriter({
      projectId: pid, projectsDir, store,
      vaultPath: vault, sqlitePath: join(vault, "kb.sqlite"),
      writerConfig: { cli_model_per_agent: {}, reference_accounts_per_agent: {} },
      sectionsToRun: ["practice.case-02"],
    });

    const callArgs = practiceSpy.mock.calls.map((c: any[]) => c[0].caseId);
    expect(callArgs).toEqual(["case-02"]);
    const project = await store.get(pid);
    expect(project?.status).toBe("writing_ready");
    expect(project?.writer_failed_sections).toEqual([]);
  });

  it("per-project writer_config overrides are applied to agents", async () => {
    const { vault, projectsDir, store } = setupProject();
    const pid = await seedProject(store, projectsDir, 1);
    const agentsMod = await import("@crossing/agents");
    const openingCtor = agentsMod.WriterOpeningAgent as any;
    openingCtor.mockClear();

    await runWriter({
      projectId: pid, projectsDir, store,
      vaultPath: vault, sqlitePath: join(vault, "kb.sqlite"),
      writerConfig: {
        cli_model_per_agent: { "writer.opening": { cli: "codex", model: "gpt-5" } },
        reference_accounts_per_agent: { "writer.opening": ["赛博禅心"] },
      },
    });
    const firstCall = openingCtor.mock.calls[0]![0];
    expect(firstCall.cli).toBe("codex");
    expect(firstCall.model).toBe("gpt-5");
  });
});
