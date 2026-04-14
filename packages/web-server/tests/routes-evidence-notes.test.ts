import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { registerEvidenceRoutes } from "../src/routes/evidence.js";
import { ProjectStore } from "../src/services/project-store.js";

async function mkApp() {
  const vault = mkdtempSync(join(tmpdir(), "evnotes-"));
  const projectsDir = join(vault, "07_projects");
  const store = new ProjectStore(projectsDir);
  const app = Fastify();
  await app.register(multipart);
  registerProjectsRoutes(app, { store });
  registerEvidenceRoutes(app, { store, projectsDir });
  await app.ready();
  const p = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "T" } })).json();
  await store.update(p.id, { status: "case_plan_approved" });
  const cpDir = join(projectsDir, p.id, "mission/case-plan");
  mkdirSync(cpDir, { recursive: true });
  writeFileSync(join(cpDir, "selected-cases.md"),
    `---\ntype: case_plan\nselected_indices: [1]\n---\n\n# Case 1 — Alpha\nbody\n`, "utf-8");
  await app.inject({ method: "GET", url: `/api/projects/${p.id}/evidence` });
  return { app, project: p };
}

describe("GET/PUT notes", () => {
  it("PUT writes valid notes, GET reads back", async () => {
    const { app, project } = await mkApp();
    const putRes = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/evidence/case-01/notes`,
      payload: {
        frontmatter: {
          type: "evidence_notes",
          case_id: "case-01",
          duration_min: 45,
          observations: [{ point: "x", severity: "major" }],
        },
        body: "free text",
      },
    });
    expect(putRes.statusCode).toBe(200);
    const getRes = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/evidence/case-01/notes`,
    });
    expect(getRes.statusCode).toBe(200);
    const data = getRes.json();
    expect(data.frontmatter.duration_min).toBe(45);
    expect(data.body.trim()).toBe("free text");
  });

  it("GET 404 if notes absent", async () => {
    const { app, project } = await mkApp();
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/evidence/case-01/notes`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("PUT 400 on missing type", async () => {
    const { app, project } = await mkApp();
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/evidence/case-01/notes`,
      payload: { frontmatter: { case_id: "case-01" }, body: "x" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PUT 400 on case_id mismatch", async () => {
    const { app, project } = await mkApp();
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/evidence/case-01/notes`,
      payload: {
        frontmatter: { type: "evidence_notes", case_id: "case-99" },
        body: "x",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PUT 400 on invalid severity", async () => {
    const { app, project } = await mkApp();
    const res = await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/evidence/case-01/notes`,
      payload: {
        frontmatter: {
          type: "evidence_notes",
          case_id: "case-01",
          observations: [{ point: "x", severity: "critical" }],
        },
        body: "",
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
