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

function setup() {
  const vault = mkdtempSync(join(tmpdir(), "sp05-start-"));
  const projectsDir = join(vault, "07_projects");
  const store = new ProjectStore(projectsDir);
  return { vault, projectsDir, store };
}

describe("POST /api/projects/:id/writer/start", () => {
  beforeEach(() => { (runWriter as any).mockClear(); });

  it("400 when project status is not evidence_ready/writing_configuring", async () => {
    const { vault, projectsDir, store } = setup();
    const p = await store.create({ name: "T" });
    await store.update(p.id, { status: "brief_ready" });
    const app = Fastify();
    registerWriterRoutes(app, { store, projectsDir, vaultPath: vault, sqlitePath: join(vault, "kb.sqlite"), configStore: { current: { agents: {}, defaultModel: { writer: { cli: 'claude', model: 'claude-opus-4-7' }, other: { cli: 'claude', model: 'claude-sonnet-4-5' } } } } as any });
    await app.ready();
    const res = await app.inject({ method: "POST", url: `/api/projects/${p.id}/writer/start`, payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("200 → writing_configuring; dispatches runWriter with defaultModel", async () => {
    const { vault, projectsDir, store } = setup();
    const p = await store.create({ name: "T" });
    await store.update(p.id, { status: "evidence_ready", article_type: "实测" });
    const app = Fastify();
    const mockAgents = Object.fromEntries(
      ["writer.opening","writer.practice","writer.closing","practice.stitcher","style_critic"]
        .map((k) => [k, { cli: "claude", model: "opus" }])
    );
    registerWriterRoutes(app, { store, projectsDir, vaultPath: vault, sqlitePath: join(vault, "kb.sqlite"), configStore: { current: { agents: mockAgents, defaultModel: { writer: { cli: 'claude', model: 'claude-opus-4-7' }, other: { cli: 'claude', model: 'claude-sonnet-4-5' } } } } as any });
    await app.ready();
    const res = await app.inject({
      method: "POST", url: `/api/projects/${p.id}/writer/start`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    const project = await store.get(p.id);
    expect(project?.status).toBe("writing_configuring");
    expect((runWriter as any).mock.calls.length).toBe(1);
    const opts = (runWriter as any).mock.calls[0][0];
    expect(opts.defaultModel.writer.model).toBe("claude-opus-4-7");
  });
});
