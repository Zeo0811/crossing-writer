import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/services/project-store.js";
import { analyzeBrief } from "../src/services/brief-analyzer-service.js";

vi.mock("@crossing/agents", () => ({
  BriefAnalyst: vi.fn().mockImplementation(() => ({
    analyze: () => ({
      text: "---\ntype: brief_summary\n---\n# ok",
      meta: { cli: "codex", model: "gpt-5.4", durationMs: 1 },
    }),
  })),
  resolveAgent: vi.fn().mockReturnValue({ cli: "codex", model: "gpt-5.4" }),
}));

describe("SSE event schema", () => {
  it("brief analyzer writes agent.started with cli + model", async () => {
    const vault = mkdtempSync(join(tmpdir(), "evt-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const p = await store.create({ name: "T" });
    const projectDir = join(projectsDir, p.id);
    mkdirSync(join(projectDir, "brief"), { recursive: true });
    writeFileSync(join(projectDir, "brief/brief.md"), "body", "utf-8");
    await store.update(p.id, {
      status: "brief_uploaded",
      brief: {
        source_type: "text", raw_path: "r", md_path: "brief/brief.md",
        summary_path: null, uploaded_at: "",
      },
    });

    await analyzeBrief({
      projectId: p.id,
      projectsDir,
      store,
      cli: "codex",
      agents: {},
      defaultCli: "codex",
      fallbackCli: "claude",
    } as any);

    const events = readFileSync(join(projectDir, "events.jsonl"), "utf-8")
      .split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const started = events.find((e) => e.type === "agent.started");
    expect(started).toBeDefined();
    expect(started.data.agent).toBe("brief_analyst");
    expect(started.data.cli).toBe("codex");
    expect(started.data.model).toBe("gpt-5.4");

    const completed = events.find((e) => e.type === "agent.completed");
    expect(completed.data.cli).toBe("codex");
    expect(completed.data.model).toBe("gpt-5.4");
  });
});
