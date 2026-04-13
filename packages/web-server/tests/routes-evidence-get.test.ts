import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { registerEvidenceRoutes } from "../src/routes/evidence.js";
import { ProjectStore } from "../src/services/project-store.js";

async function mkApp() {
  const vault = mkdtempSync(join(tmpdir(), "evget-"));
  const projectsDir = join(vault, "07_projects");
  const store = new ProjectStore(projectsDir);
  const app = Fastify();
  registerProjectsRoutes(app, { store });
  registerEvidenceRoutes(app, { store, projectsDir });
  await app.ready();
  const p = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "T" } })).json();
  await store.update(p.id, { status: "case_plan_approved" });
  const cpDir = join(projectsDir, p.id, "mission/case-plan");
  mkdirSync(cpDir, { recursive: true });
  writeFileSync(join(cpDir, "selected-cases.md"),
    `---\ntype: case_plan\nselected_indices: [1, 2]\n---\n\n# Case 1 — Alpha\nbody A\n# Case 2 — Beta\nbody B\n`,
    "utf-8");
  return { app, store, project: p, projectsDir };
}

describe("GET /api/projects/:id/evidence", () => {
  it("first call lazy-transitions case_plan_approved → evidence_collecting and pre-creates dirs", async () => {
    const { app, store, project } = await mkApp();
    const res = await app.inject({ method: "GET", url: `/api/projects/${project.id}/evidence` });
    expect(res.statusCode).toBe(200);
    const updated = await store.get(project.id);
    expect(updated?.status).toBe("evidence_collecting");
    const body = res.json();
    expect(body.cases).toBeDefined();
    expect(body.all_complete).toBe(false);
    expect(body.submitted_at).toBeNull();
    expect(Object.keys(body.cases).sort()).toEqual(["case-01", "case-02"]);
  });

  it("does NOT transition if status already evidence_collecting", async () => {
    const { app, store, project } = await mkApp();
    await store.update(project.id, { status: "evidence_collecting" });
    await app.inject({ method: "GET", url: `/api/projects/${project.id}/evidence` });
    const updated = await store.get(project.id);
    expect(updated?.status).toBe("evidence_collecting");
  });
});

describe("GET /api/projects/:id/evidence/:caseId", () => {
  it("returns case detail with empty file lists", async () => {
    const { app, project } = await mkApp();
    await app.inject({ method: "GET", url: `/api/projects/${project.id}/evidence` });
    const res = await app.inject({ method: "GET", url: `/api/projects/${project.id}/evidence/case-01` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.case_id).toBe("case-01");
    expect(body.name).toBe("Alpha");
    expect(body.screenshots).toEqual([]);
    expect(body.notes).toBeNull();
  });

  it("404 for unknown case_id", async () => {
    const { app, project } = await mkApp();
    await app.inject({ method: "GET", url: `/api/projects/${project.id}/evidence` });
    const res = await app.inject({ method: "GET", url: `/api/projects/${project.id}/evidence/case-99` });
    expect(res.statusCode).toBe(404);
  });
});
