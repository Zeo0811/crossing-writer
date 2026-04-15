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

describe("DELETE /api/projects/:id", () => {
  it("hard-deletes active project when slug matches", async () => {
    const { app, store } = await mkApp();
    const created = (
      await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Delete Me" } })
    ).json();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/projects/${created.id}`,
      payload: { confirm: created.slug },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(existsSync(store.projectDir(created.id))).toBe(false);
  });

  it("rejects with 400 on slug mismatch and keeps dir", async () => {
    const { app, store } = await mkApp();
    const created = (
      await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Keep Me" } })
    ).json();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/projects/${created.id}`,
      payload: { confirm: "wrong-slug" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("confirmation_mismatch");
    expect(res.json().expected).toBe(created.slug);
    expect(existsSync(store.projectDir(created.id))).toBe(true);
  });

  it("returns 404 when project missing", async () => {
    const { app } = await mkApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/projects/ghost`,
      payload: { confirm: "ghost" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("deletes archived project when found only in _archive", async () => {
    const { app, store } = await mkApp();
    const created = (
      await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Arch Del" } })
    ).json();
    await app.inject({ method: "POST", url: `/api/projects/${created.id}/archive` });
    const res = await app.inject({
      method: "DELETE",
      url: `/api/projects/${created.id}`,
      payload: { confirm: created.slug },
    });
    expect(res.statusCode).toBe(200);
    expect(existsSync(store.archiveDir(created.id))).toBe(false);
  });
});

describe("GET /api/projects with archive query variants", () => {
  it("default returns { items, archived_count }", async () => {
    const { app } = await mkApp();
    const a = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "A" } })).json();
    const b = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "B" } })).json();
    await app.inject({ method: "POST", url: `/api/projects/${b.id}/archive` });
    const res = await app.inject({ method: "GET", url: "/api/projects" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.map((p: any) => p.id)).toEqual([a.id]);
    expect(body.archived_count).toBe(1);
  });

  it("?only_archived=1 returns archived items with active_count", async () => {
    const { app } = await mkApp();
    const a = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "A" } })).json();
    const b = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "B" } })).json();
    await app.inject({ method: "POST", url: `/api/projects/${b.id}/archive` });
    const res = await app.inject({ method: "GET", url: "/api/projects?only_archived=1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.map((p: any) => p.id)).toEqual([b.id]);
    expect(body.active_count).toBe(1);
    // reference a to silence unused-var
    expect(a.id).toBeTypeOf("string");
  });

  it("?include_archived=1 returns union with archived flag", async () => {
    const { app } = await mkApp();
    const a = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "A" } })).json();
    const b = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "B" } })).json();
    await app.inject({ method: "POST", url: `/api/projects/${b.id}/archive` });
    const res = await app.inject({ method: "GET", url: "/api/projects?include_archived=1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const byId = Object.fromEntries(body.items.map((p: any) => [p.id, p.archived]));
    expect(byId[a.id]).toBe(false);
    expect(byId[b.id]).toBe(true);
  });
});
