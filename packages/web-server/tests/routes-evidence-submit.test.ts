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
  const vault = mkdtempSync(join(tmpdir(), "evsubmit-"));
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
    `---\ntype: case_plan\nselected_indices: [1]\n---\n\n# Case 1 — A\nbody\n`, "utf-8");
  await app.inject({ method: "GET", url: `/api/projects/${p.id}/evidence` });
  return { app, store, project: p, projectsDir };
}

function multipartBody(boundary: string, kind: string, filename: string, contentType: string, content: string) {
  return [
    `--${boundary}`,
    `Content-Disposition: form-data; name="kind"`, ``, kind,
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    `Content-Type: ${contentType}`, ``, content,
    `--${boundary}--`, ``,
  ].join("\r\n");
}

describe("POST /evidence/submit", () => {
  it("409 when not all complete", async () => {
    const { app, project } = await mkApp();
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/evidence/submit`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().incomplete_cases).toEqual(["case-01"]);
  });

  it("200 + state transition when all complete", async () => {
    const { app, store, project } = await mkApp();
    const b1 = "----b1";
    await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/evidence/case-01/files`,
      payload: multipartBody(b1, "screenshot", "a.png", "image/png", "x"),
      headers: { "content-type": `multipart/form-data; boundary=${b1}` },
    });
    const b2 = "----b2";
    await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/evidence/case-01/files`,
      payload: multipartBody(b2, "generated", "out.md", "text/markdown", "g"),
      headers: { "content-type": `multipart/form-data; boundary=${b2}` },
    });
    await app.inject({
      method: "PUT",
      url: `/api/projects/${project.id}/evidence/case-01/notes`,
      payload: {
        frontmatter: { type: "evidence_notes", case_id: "case-01" },
        body: "ok",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/evidence/submit`,
    });
    expect(res.statusCode).toBe(200);
    const updated = await store.get(project.id);
    expect(updated?.status).toBe("evidence_ready");
    expect(updated?.evidence?.submitted_at).toBeTruthy();
  });
});
