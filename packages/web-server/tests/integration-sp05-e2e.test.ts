import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";

vi.mock("@crossing/agents", async () => {
  const actual = await vi.importActual<any>("@crossing/agents");
  return {
    ...actual,
    // Class-based mocks for rewrite route (surgical & section-level)
    WriterOpeningAgent: vi.fn().mockImplementation(() => ({
      write: vi.fn(async () => ({ text: "OPEN", meta: { cli: "claude", model: "opus", durationMs: 1 } })),
    })),
    WriterPracticeAgent: vi.fn().mockImplementation(() => ({
      write: vi.fn(async (i: any) => ({ text: `## Case ${i.caseId}`, meta: { cli: "claude", model: "sonnet", durationMs: 1 } })),
    })),
    WriterClosingAgent: vi.fn().mockImplementation(() => ({
      write: vi.fn(async () => ({ text: "CLOSE", meta: { cli: "claude", model: "opus", durationMs: 1 } })),
    })),
    PracticeStitcherAgent: vi.fn().mockImplementation(() => ({
      stitch: vi.fn(async () => ({ transitions: {}, meta: null })),
    })),
    StyleCriticAgent: vi.fn().mockImplementation(() => ({
      critique: vi.fn(async () => ({ rewrites: {}, meta: { cli: "claude", model: "opus", durationMs: 1 } })),
    })),
    // Runner-based mocks for orchestrator
    runWriterOpening: vi.fn(async () => ({
      finalText: "OPEN", toolsUsed: [], rounds: 1,
      meta: { cli: "claude", model: "opus", durationMs: 1, total_duration_ms: 1 },
    })),
    runWriterPractice: vi.fn(async (opts: any) => {
      const m = /Case 编号：(case-\d+)/.exec(opts.userMessage);
      const caseId = m ? m[1] : "case-??";
      return {
        finalText: `## Case ${caseId}`, toolsUsed: [], rounds: 1,
        meta: { cli: "claude", model: "sonnet", durationMs: 1, total_duration_ms: 1 },
      };
    }),
    runWriterClosing: vi.fn(async () => ({
      finalText: "CLOSE", toolsUsed: [], rounds: 1,
      meta: { cli: "claude", model: "opus", durationMs: 1, total_duration_ms: 1 },
    })),
    runStyleCritic: vi.fn(async () => ({
      finalText: "NO_CHANGES", toolsUsed: [], rounds: 1,
      meta: { cli: "claude", model: "opus", durationMs: 1, total_duration_ms: 1 },
    })),
  };
});

import { ProjectStore } from "../src/services/project-store.js";
import { registerWriterRoutes } from "../src/routes/writer.js";
import { registerKbStylePanelsRoutes } from "../src/routes/kb-style-panels.js";

describe("SP-05 e2e", () => {
  it("evidence_ready → start → writing_ready → sections readable → PUT → rewrite → final.md correct", async () => {
    const vault = mkdtempSync(join(tmpdir(), "sp05-e2e-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const p = await store.create({ name: "E2E" });
    await store.update(p.id, { status: "evidence_ready", article_type: "实测" });
    const pDir = join(projectsDir, p.id);
    mkdirSync(join(pDir, "mission/case-plan"), { recursive: true });
    mkdirSync(join(pDir, "context"), { recursive: true });
    mkdirSync(join(pDir, "evidence/case-01/screenshots"), { recursive: true });
    writeFileSync(join(pDir, "mission/selected.md"), "---\n---\nmission\n", "utf-8");
    writeFileSync(join(pDir, "context/product-overview.md"), "---\n---\noverview\n", "utf-8");
    writeFileSync(join(pDir, "mission/case-plan/selected-cases.md"), "---\n---\n\n# Case 1 — C1\nbody\n", "utf-8");
    writeFileSync(join(pDir, "evidence/case-01/notes.md"), "---\ncase_id: case-01\n---\nn\n", "utf-8");

    const app = Fastify();
    const cfg = { async get(_k: string) { return { cli: "claude" as const, model: "opus" }; } } as any;
    registerWriterRoutes(app, { store, projectsDir, vaultPath: vault, sqlitePath: join(vault, "kb.sqlite"), configStore: cfg });
    registerKbStylePanelsRoutes(app, { vaultPath: vault });
    await app.ready();

    const r1 = await app.inject({ method: "POST", url: `/api/projects/${p.id}/writer/start`, payload: {} });
    expect(r1.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 300));
    const project = await store.get(p.id);
    expect(project?.status).toBe("writing_ready");

    const r2 = await app.inject({ method: "GET", url: `/api/projects/${p.id}/writer/sections` });
    const body2 = r2.json();
    expect(body2.sections.some((s: any) => s.key === "opening")).toBe(true);

    const r3 = await app.inject({
      method: "PUT", url: `/api/projects/${p.id}/writer/sections/opening`,
      payload: { body: "MANUAL OPEN" },
    });
    expect(r3.statusCode).toBe(200);

    const r4 = await app.inject({ method: "GET", url: `/api/projects/${p.id}/writer/final` });
    expect(r4.body).toContain("MANUAL OPEN");
    expect(r4.body).toContain("## Case case-01");
    expect(r4.body).toContain("CLOSE");

    const r5 = await app.inject({
      method: "POST", url: `/api/projects/${p.id}/writer/sections/opening/rewrite`,
      payload: { user_hint: "" },
    });
    expect(r5.statusCode).toBe(200);
    expect(r5.body).toContain("writer.rewrite_completed");

    const r6 = await app.inject({ method: "GET", url: `/api/projects/${p.id}/writer/sections/opening` });
    expect(r6.json().body).toBe("OPEN");

    expect(existsSync(join(pDir, "article/final.md"))).toBe(true);
  });
});
