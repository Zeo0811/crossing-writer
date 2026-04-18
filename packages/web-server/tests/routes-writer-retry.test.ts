import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";

vi.mock("../src/services/writer-orchestrator.js", () => ({
  runWriter: vi.fn(async () => {}),
}));
import { runWriter } from "../src/services/writer-orchestrator.js";
import { ProjectStore } from "../src/services/project-store.js";
import { registerWriterRoutes } from "../src/routes/writer.js";

describe("POST /writer/retry-failed", () => {
  beforeEach(() => { (runWriter as any).mockClear(); });

  it("400 when status != writing_failed", async () => {
    const vault = mkdtempSync(join(tmpdir(), "sp05-retry-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const p = await store.create({ name: "T" });
    await store.update(p.id, { status: "writing_ready" });
    const app = Fastify();
    registerWriterRoutes(app, { store, projectsDir, vaultPath: vault, sqlitePath: join(vault, "kb.sqlite"), configStore: { current: { agents: {}, defaultModel: { writer: { cli: 'claude', model: 'claude-opus-4-7' }, other: { cli: 'claude', model: 'claude-sonnet-4-5' } } } } as any });
    await app.ready();
    const res = await app.inject({ method: "POST", url: `/api/projects/${p.id}/writer/retry-failed` });
    expect(res.statusCode).toBe(400);
  });

  it("200 passes writer_failed_sections as sectionsToRun", async () => {
    const vault = mkdtempSync(join(tmpdir(), "sp05-retry2-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const p = await store.create({ name: "T" });
    await store.update(p.id, {
      status: "writing_failed",
      article_type: "实测",
      writer_failed_sections: ["practice.case-01"],
    });
    const app = Fastify();
    registerWriterRoutes(app, { store, projectsDir, vaultPath: vault, sqlitePath: join(vault, "kb.sqlite"), configStore: { current: { agents: {}, defaultModel: { writer: { cli: 'claude', model: 'claude-opus-4-7' }, other: { cli: 'claude', model: 'claude-sonnet-4-5' } } } } as any });
    await app.ready();
    const res = await app.inject({ method: "POST", url: `/api/projects/${p.id}/writer/retry-failed` });
    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    expect((runWriter as any).mock.calls[0][0].sectionsToRun).toEqual(["practice.case-01"]);
  });
});
