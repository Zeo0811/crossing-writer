import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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
    registerWriterRoutes(app, { store, projectsDir, vaultPath: vault, sqlitePath: join(vault, "kb.sqlite"), configStore: { async get() { return undefined; } } as any });
    await app.ready();
    const res = await app.inject({ method: "POST", url: `/api/projects/${p.id}/writer/start`, payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("400 when a specified reference_account does not exist in kb", async () => {
    const { vault, projectsDir, store } = setup();
    const p = await store.create({ name: "T" });
    await store.update(p.id, { status: "evidence_ready" });
    const app = Fastify();
    registerWriterRoutes(app, { store, projectsDir, vaultPath: vault, sqlitePath: join(vault, "kb.sqlite"), configStore: { async get() { return undefined; } } as any });
    await app.ready();
    const res = await app.inject({
      method: "POST", url: `/api/projects/${p.id}/writer/start`,
      payload: { reference_accounts_per_agent: { "writer.opening": ["不存在账号"] } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("不存在");
  });

  it("200 → writing_configuring → writing_running; persists writer_config; dispatches runWriter", async () => {
    const { vault, projectsDir, store } = setup();
    const dir = join(vault, "08_experts", "style-panel");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "赛博禅心.md"), "x", "utf-8");
    const p = await store.create({ name: "T" });
    await store.update(p.id, { status: "evidence_ready" });
    const app = Fastify();
    registerWriterRoutes(app, { store, projectsDir, vaultPath: vault, sqlitePath: join(vault, "kb.sqlite"), configStore: { async get() { return { cli: "claude", model: "opus" }; } } as any });
    await app.ready();
    const res = await app.inject({
      method: "POST", url: `/api/projects/${p.id}/writer/start`,
      payload: {
        cli_model_per_agent: { "writer.opening": { cli: "claude", model: "opus" } },
        reference_accounts_per_agent: { "writer.opening": ["赛博禅心"] },
      },
    });
    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    const project = await store.get(p.id);
    expect(project?.writer_config?.reference_accounts_per_agent?.["writer.opening"]).toEqual(["赛博禅心"]);
    expect((runWriter as any).mock.calls.length).toBe(1);
  });
});
