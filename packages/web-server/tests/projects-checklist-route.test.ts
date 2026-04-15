import { describe, it, expect, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { ProjectStore } from "../src/services/project-store.js";
import { StylePanelStore } from "../src/services/style-panel-store.js";
import { ProjectOverrideStore } from "../src/services/project-override-store.js";
import { ProjectChecklistService } from "../src/services/project-checklist-service.js";
import type { AgentConfigStore, AgentConfigEntry } from "../src/services/agent-config-store.js";

function mkAgentStore(): AgentConfigStore {
  const state: Record<string, AgentConfigEntry> = {};
  return {
    getAll: () => state,
    get: (k) => state[k] ?? null,
    set: async (k, cfg) => { state[k] = cfg; },
    remove: async (k) => { delete state[k]; },
  };
}

interface Ctx {
  app: FastifyInstance;
  store: ProjectStore;
}

function build(): Ctx {
  const root = mkdtempSync(join(tmpdir(), "sp18route-"));
  const projectsDir = join(root, "projects");
  const vault = join(root, "vault");
  mkdirSync(projectsDir, { recursive: true });
  mkdirSync(vault, { recursive: true });
  const store = new ProjectStore(projectsDir);
  const checklistService = new ProjectChecklistService({
    projectStore: store,
    stylePanelStore: new StylePanelStore(vault),
    agentConfigStore: mkAgentStore(),
    projectOverrideStore: new ProjectOverrideStore(projectsDir),
    projectsDir,
  });
  const app = Fastify();
  registerProjectsRoutes(app, { store, checklistService });
  return { app, store };
}

describe("GET /api/projects/:id/checklist", () => {
  let ctx: Ctx;
  beforeEach(() => { ctx = build(); });

  it("happy path — returns 7 items", async () => {
    const p = await ctx.store.create({ name: "x" });
    const res = await ctx.app.inject({ method: "GET", url: `/api/projects/${p.id}/checklist` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.projectId).toBe(p.id);
    expect(body.items).toHaveLength(7);
    expect(typeof body.generatedAt).toBe("string");
  });

  it("404 for unknown project", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/projects/p_nope/checklist" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "project_not_found" });
  });

  it("partial state reflects draft case_plan", async () => {
    const p = await ctx.store.create({ name: "y" });
    await ctx.store.update(p.id, { case_plan: { status: "draft" } } as any);
    const res = await ctx.app.inject({ method: "GET", url: `/api/projects/${p.id}/checklist` });
    const body = res.json();
    const caseStep = body.items.find((i: any) => i.step === "case");
    expect(caseStep.status).toBe("partial");
  });

  it("blocked status surfaces when styleBindings unresolved", async () => {
    const p = await ctx.store.create({ name: "z" });
    const res = await ctx.app.inject({ method: "GET", url: `/api/projects/${p.id}/checklist` });
    const body = res.json();
    expect(body.items.find((i: any) => i.step === "styleBindings").status).toBe("blocked");
  });
});
