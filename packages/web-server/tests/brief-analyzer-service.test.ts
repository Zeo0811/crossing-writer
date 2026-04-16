import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/services/project-store.js";
import { analyzeBrief } from "../src/services/brief-analyzer-service.js";

const analyzeMock = vi.fn().mockReturnValue({
  text: "---\ntype: brief_summary\nproject_id: p\n---\n# summary\n\nOK.",
  meta: { cli: "codex", durationMs: 100 },
});

vi.mock("@crossing/agents", () => ({
  stripAgentPreamble: (s: string) => s,
  BriefAnalyst: vi.fn().mockImplementation(() => ({
    analyze: analyzeMock,
  })),
  resolveAgent: (_cfg: any, _key: string) => ({ cli: _cfg.modelAdapter.defaultCli }),
}));

describe("analyzeBrief", () => {
  it("reads brief.md, runs analyst, writes brief-summary.md, updates status", async () => {
    const vault = mkdtempSync(join(tmpdir(), "ana-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const p = await store.create({ name: "X" });
    const projectDir = join(projectsDir, p.id);
    mkdirSync(join(projectDir, "brief"), { recursive: true });
    writeFileSync(join(projectDir, "brief/brief.md"), "brief body", "utf-8");
    await store.update(p.id, {
      status: "brief_uploaded",
      brief: { source_type: "text", raw_path: "brief/raw/brief.txt", md_path: "brief/brief.md", summary_path: null, uploaded_at: "" },
    });

    await analyzeBrief({
      projectId: p.id,
      projectsDir,
      store,
      cli: "codex",
      agents: {},
      defaultCli: "codex",
      fallbackCli: "claude",
    });

    const updated = await store.get(p.id);
    expect(updated!.status).toBe("brief_ready");
    expect(updated!.brief!.summary_path).toBe("brief/brief-summary.md");
    const summary = readFileSync(join(projectDir, "brief/brief-summary.md"), "utf-8");
    expect(summary).toMatch(/brief_summary/);
  });

  it("writes agent.started and agent.completed events", async () => {
    const vault = mkdtempSync(join(tmpdir(), "ana-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const p = await store.create({ name: "Y" });
    const projectDir = join(projectsDir, p.id);
    mkdirSync(join(projectDir, "brief"), { recursive: true });
    writeFileSync(join(projectDir, "brief/brief.md"), "brief body", "utf-8");
    await store.update(p.id, {
      status: "brief_uploaded",
      brief: { source_type: "text", raw_path: "brief/raw/brief.txt", md_path: "brief/brief.md", summary_path: null, uploaded_at: "" },
    });

    await analyzeBrief({ projectId: p.id, projectsDir, store, cli: "codex", agents: {}, defaultCli: "codex", fallbackCli: "claude" });

    const events = readFileSync(join(projectDir, "events.jsonl"), "utf-8");
    expect(events).toMatch(/"agent.started"/);
    expect(events).toMatch(/"agent.completed"/);
    expect(events).toMatch(/brief_analyzing/);
    expect(events).toMatch(/brief_ready/);
  });

  it("throws on missing brief", async () => {
    const vault = mkdtempSync(join(tmpdir(), "ana-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const p = await store.create({ name: "Z" });
    await expect(
      analyzeBrief({ projectId: p.id, projectsDir, store, cli: "codex", agents: {}, defaultCli: "codex", fallbackCli: "claude" }),
    ).rejects.toThrow(/no brief/i);
  });

  it("strips /api/projects/<pid>/brief/ prefix from image refs and resolves to filesystem path", async () => {
    analyzeMock.mockClear();
    const vault = mkdtempSync(join(tmpdir(), "ana-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const p = await store.create({ name: "PrefixTest" });
    const projectDir = join(projectsDir, p.id);
    mkdirSync(join(projectDir, "brief/images"), { recursive: true });
    writeFileSync(
      join(projectDir, "brief/brief.md"),
      `![legacy](/api/projects/${p.id}/brief/images/legacy.png)\n![new](images/new.png)\n`,
      "utf-8",
    );
    await store.update(p.id, {
      status: "brief_uploaded",
      brief: { source_type: "text", raw_path: "brief/raw/brief.txt", md_path: "brief/brief.md", summary_path: null, uploaded_at: "" },
    });

    await analyzeBrief({ projectId: p.id, projectsDir, store, cli: "codex", agents: {}, defaultCli: "codex", fallbackCli: "claude" });

    expect(analyzeMock).toHaveBeenCalledTimes(1);
    const args = analyzeMock.mock.calls[0]![0] as { images: string[] };
    // Both should resolve to absolute paths under the project's brief/images dir,
    // independent of whether the markdown stored a relative path or an API URL.
    const expectedLegacy = join(projectDir, "brief/images/legacy.png");
    const expectedNew = join(projectDir, "brief/images/new.png");
    expect(args.images).toContain(expectedLegacy);
    expect(args.images).toContain(expectedNew);
    // No raw API-URL strings should leak into images[]
    expect(args.images.some((p) => p.startsWith("/api/"))).toBe(false);
  });
});
