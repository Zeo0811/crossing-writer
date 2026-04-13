import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/services/project-store.js";
import { analyzeBrief } from "../src/services/brief-analyzer-service.js";

vi.mock("@crossing/agents", () => ({
  BriefAnalyst: vi.fn().mockImplementation(() => ({
    analyze: vi.fn().mockReturnValue({
      text: "---\ntype: brief_summary\nproject_id: p\n---\n# summary\n\nOK.",
      meta: { cli: "codex", durationMs: 100 },
    }),
  })),
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

    await analyzeBrief({ projectId: p.id, projectsDir, store, cli: "codex" });

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
      analyzeBrief({ projectId: p.id, projectsDir, store, cli: "codex" }),
    ).rejects.toThrow(/no brief/i);
  });
});
