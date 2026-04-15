import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { ProjectStore } from "../src/services/project-store.js";

async function mkApp() {
  const vault = mkdtempSync(join(tmpdir(), "vault-arc-"));
  const store = new ProjectStore(join(vault, "07_projects"));
  const app = Fastify();
  registerProjectsRoutes(app, { store });
  await app.ready();
  return { app, store };
}

describe("POST /api/projects/:id/archive", () => {
  it("moves project to _archive and returns 200", async () => {
    const { app, store } = await mkApp();
    const created = (
      await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Alpha" } })
    ).json();
    const res = await app.inject({ method: "POST", url: `/api/projects/${created.id}/archive` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toBe(created.id);
    expect(existsSync(store.archiveDir(created.id))).toBe(true);
    expect(existsSync(store.projectDir(created.id))).toBe(false);
  });

  it("returns 404 when project missing", async () => {
    const { app } = await mkApp();
    const res = await app.inject({ method: "POST", url: "/api/projects/ghost/archive" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("project_not_found");
  });

  it("returns 404 when already archived (no active)", async () => {
    const { app } = await mkApp();
    const created = (
      await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Beta" } })
    ).json();
    await app.inject({ method: "POST", url: `/api/projects/${created.id}/archive` });
    const res = await app.inject({ method: "POST", url: `/api/projects/${created.id}/archive` });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/projects/:id/restore", () => {
  it("moves project back from archive", async () => {
    const { app, store } = await mkApp();
    const created = (
      await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Charlie" } })
    ).json();
    await app.inject({ method: "POST", url: `/api/projects/${created.id}/archive` });
    const res = await app.inject({ method: "POST", url: `/api/projects/${created.id}/restore` });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(existsSync(store.projectDir(created.id))).toBe(true);
    expect(existsSync(store.archiveDir(created.id))).toBe(false);
  });

  it("returns 404 when archived project missing", async () => {
    const { app } = await mkApp();
    const res = await app.inject({ method: "POST", url: "/api/projects/nope/restore" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("project_not_found");
  });
});
