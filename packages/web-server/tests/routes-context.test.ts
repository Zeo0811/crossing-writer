import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/services/project-store.js";
import { ProjectOverrideStore } from "../src/services/project-override-store.js";
import { StylePanelStore } from "../src/services/style-panel-store.js";
import { createAgentConfigStore } from "../src/services/agent-config-store.js";
import { ContextBundleService } from "../src/services/context-bundle-service.js";
import { registerContextRoutes } from "../src/routes/context.js";

function fakeConfigStore() {
  let current: any = { agents: {} };
  return {
    get current() { return current; },
    update: vi.fn(async (patch: any) => { if (patch.agents !== undefined) current = { ...current, agents: patch.agents }; }),
  };
}

async function makeApp() {
  const root = mkdtempSync(join(tmpdir(), "cbs-r-"));
  const projectsDir = join(root, "projects");
  const vaultPath = join(root, "vault");
  mkdirSync(projectsDir, { recursive: true });
  mkdirSync(vaultPath, { recursive: true });
  const projectStore = new ProjectStore(projectsDir);
  const stylePanelStore = new StylePanelStore(vaultPath);
  const agentConfigStore = createAgentConfigStore(fakeConfigStore() as any);
  const projectOverrideStore = new ProjectOverrideStore(projectsDir);
  const svc = new ContextBundleService({
    projectStore, projectsDir, stylePanelStore, agentConfigStore, projectOverrideStore,
  });
  const app = Fastify();
  registerContextRoutes(app, { contextBundleService: svc });
  await app.ready();
  return { app, projectStore, projectsDir };
}

describe("GET /api/projects/:id/context", () => {
  it("returns 200 + bundle for existing project", async () => {
    const { app, projectStore, projectsDir } = await makeApp();
    const p = await projectStore.create({ name: "Ctx" });
    mkdirSync(join(projectsDir, p.id, "brief"), { recursive: true });
    writeFileSync(join(projectsDir, p.id, "brief", "brief.md"), "B");
    const res = await app.inject({ method: "GET", url: `/api/projects/${p.id}/context` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.projectId).toBe(p.id);
    expect(body.brief.summary).toBe("B");
    expect(body.sections).toBeInstanceOf(Array);
  });

  it("returns 404 for missing project", async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: "GET", url: `/api/projects/nope/context` });
    expect(res.statusCode).toBe(404);
  });

  it("summary=1 returns compact payload", async () => {
    const { app, projectStore } = await makeApp();
    const p = await projectStore.create({ name: "Ctx2" });
    const res = await app.inject({ method: "GET", url: `/api/projects/${p.id}/context?summary=1` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.projectId).toBe(p.id);
    expect(typeof body.tokensEstimated).toBe("number");
    expect(body.sections).toBeUndefined();
  });
});
