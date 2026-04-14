import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { registerEvidenceRoutes } from "../src/routes/evidence.js";
import { ProjectStore } from "../src/services/project-store.js";

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

describe("SP-04 e2e", () => {
  it("walks case_plan_approved → upload 3 files + notes → submit → evidence_ready", async () => {
    const vault = mkdtempSync(join(tmpdir(), "sp04-e2e-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const app = Fastify();
    await app.register(multipart);
    registerProjectsRoutes(app, { store });
    registerEvidenceRoutes(app, { store, projectsDir });
    await app.ready();

    const p = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "E2E" } })).json();
    await store.update(p.id, { status: "case_plan_approved" });
    const cpDir = join(projectsDir, p.id, "mission/case-plan");
    mkdirSync(cpDir, { recursive: true });
    writeFileSync(join(cpDir, "selected-cases.md"),
      `---\ntype: case_plan\nselected_indices: [1]\n---\n\n# Case 1 — Solo\nbody\n`, "utf-8");

    const r1 = await app.inject({ method: "GET", url: `/api/projects/${p.id}/evidence` });
    expect(r1.statusCode).toBe(200);
    expect((await store.get(p.id))?.status).toBe("evidence_collecting");

    const b1 = "----b1";
    const r2 = await app.inject({
      method: "POST",
      url: `/api/projects/${p.id}/evidence/case-01/files`,
      payload: multipartBody(b1, "screenshot", "shot.png", "image/png", "img"),
      headers: { "content-type": `multipart/form-data; boundary=${b1}` },
    });
    expect(r2.statusCode).toBe(201);

    const b2 = "----b2";
    const r3 = await app.inject({
      method: "POST",
      url: `/api/projects/${p.id}/evidence/case-01/files`,
      payload: multipartBody(b2, "generated", "out.md", "text/markdown", "x"),
      headers: { "content-type": `multipart/form-data; boundary=${b2}` },
    });
    expect(r3.statusCode).toBe(201);

    const r4 = await app.inject({
      method: "PUT",
      url: `/api/projects/${p.id}/evidence/case-01/notes`,
      payload: {
        frontmatter: {
          type: "evidence_notes",
          case_id: "case-01",
          duration_min: 30,
          observations: [{ point: "good", severity: "positive" }],
        },
        body: "all good",
      },
    });
    expect(r4.statusCode).toBe(200);

    const r5 = await app.inject({ method: "POST", url: `/api/projects/${p.id}/evidence/submit` });
    expect(r5.statusCode).toBe(200);

    const final = await store.get(p.id);
    expect(final?.status).toBe("evidence_ready");
    expect(final?.evidence?.submitted_at).toBeTruthy();
    expect(existsSync(join(projectsDir, p.id, "evidence/index.md"))).toBe(true);
    expect(existsSync(join(projectsDir, p.id, "evidence/case-01/notes.md"))).toBe(true);
  });
});
