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
  const vault = mkdtempSync(join(tmpdir(), "evup-"));
  const projectsDir = join(vault, "07_projects");
  const store = new ProjectStore(projectsDir);
  const app = Fastify();
  await app.register(multipart, { limits: { fileSize: 1.5 * 1024 * 1024 * 1024 } });
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
  return { app, store, project: p, projectsDir };
}

function multipartBody(boundary: string, kind: string, filename: string, contentType: string, content: string) {
  return [
    `--${boundary}`,
    `Content-Disposition: form-data; name="kind"`,
    ``,
    kind,
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    `Content-Type: ${contentType}`,
    ``,
    content,
    `--${boundary}--`,
    ``,
  ].join("\r\n");
}

describe("POST /evidence/:caseId/files", () => {
  it("201 on screenshot upload + returned metadata", async () => {
    const { app, project } = await mkApp();
    const boundary = "----b" + Math.random().toString(36).slice(2);
    const body = multipartBody(boundary, "screenshot", "shot.png", "image/png", "fakebytes");
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/evidence/case-01/files`,
      payload: body,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(201);
    const data = res.json();
    expect(data.filename).toBe("shot.png");
    expect(data.relPath).toBe("evidence/case-01/screenshots/shot.png");
    expect(data.kind).toBe("screenshot");
  });

  it("400 on invalid kind", async () => {
    const { app, project } = await mkApp();
    const boundary = "----b" + Math.random().toString(36).slice(2);
    const body = multipartBody(boundary, "audio", "x.mp3", "audio/mpeg", "x");
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/evidence/case-01/files`,
      payload: body,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404 on unknown case_id", async () => {
    const { app, project } = await mkApp();
    const boundary = "----b" + Math.random().toString(36).slice(2);
    const body = multipartBody(boundary, "screenshot", "x.png", "image/png", "x");
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/evidence/case-99/files`,
      payload: body,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("conflict rename appends -2", async () => {
    const { app, project } = await mkApp();
    const boundary1 = "----b1";
    const boundary2 = "----b2";
    await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/evidence/case-01/files`,
      payload: multipartBody(boundary1, "screenshot", "a.png", "image/png", "first"),
      headers: { "content-type": `multipart/form-data; boundary=${boundary1}` },
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/evidence/case-01/files`,
      payload: multipartBody(boundary2, "screenshot", "a.png", "image/png", "second"),
      headers: { "content-type": `multipart/form-data; boundary=${boundary2}` },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().filename).toBe("a-2.png");
  });
});

describe("DELETE /evidence/:caseId/files/:kind/:filename", () => {
  it("204 on delete", async () => {
    const { app, project } = await mkApp();
    const boundary = "----bd";
    await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/evidence/case-01/files`,
      payload: multipartBody(boundary, "screenshot", "x.png", "image/png", "x"),
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    const res = await app.inject({
      method: "DELETE",
      url: `/api/projects/${project.id}/evidence/case-01/files/screenshot/x.png`,
    });
    expect(res.statusCode).toBe(204);
  });

  it("204 silent if file missing (idempotent)", async () => {
    const { app, project } = await mkApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/projects/${project.id}/evidence/case-01/files/screenshot/nope.png`,
    });
    expect(res.statusCode).toBe(204);
  });
});
