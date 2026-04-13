import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { ProjectStore } from "../src/services/project-store.js";

async function mkApp() {
  const vault = mkdtempSync(join(tmpdir(), "vault-"));
  const store = new ProjectStore(join(vault, "07_projects"));
  const app = Fastify();
  registerProjectsRoutes(app, { store });
  await app.ready();
  return { app, store };
}

describe("projects route", () => {
  it("POST /api/projects creates a project", async () => {
    const { app } = await mkApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "New One" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("New One");
    expect(body.status).toBe("created");
  });

  it("POST /api/projects rejects empty name", async () => {
    const { app } = await mkApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { name: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/projects rejects missing body", async () => {
    const { app } = await mkApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /api/projects lists projects", async () => {
    const { app } = await mkApp();
    await app.inject({ method: "POST", url: "/api/projects", payload: { name: "A" } });
    await app.inject({ method: "POST", url: "/api/projects", payload: { name: "B" } });
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });

  it("GET /api/projects/:id returns details", async () => {
    const { app } = await mkApp();
    const created = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "X" } })).json();
    const ok = await app.inject({ method: "GET", url: `/api/projects/${created.id}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().id).toBe(created.id);
  });

  it("GET /api/projects/:id returns 404 for missing", async () => {
    const { app } = await mkApp();
    const miss = await app.inject({ method: "GET", url: "/api/projects/does-not-exist" });
    expect(miss.statusCode).toBe(404);
  });
});
