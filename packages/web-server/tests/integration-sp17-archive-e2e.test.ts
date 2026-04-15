import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { ProjectStore } from "../src/services/project-store.js";

async function mkApp() {
  const vault = mkdtempSync(join(tmpdir(), "vault-sp17-"));
  const store = new ProjectStore(join(vault, "07_projects"));
  const app = Fastify();
  registerProjectsRoutes(app, { store });
  await app.ready();
  return { app, store };
}

describe("SP-17 E2E: list → archive → restore → destroy", () => {
  it("full flow via HTTP", async () => {
    const { app, store } = await mkApp();

    const one = (
      await app.inject({ method: "POST", url: "/api/projects", payload: { name: "E2E One" } })
    ).json();
    const two = (
      await app.inject({ method: "POST", url: "/api/projects", payload: { name: "E2E Two" } })
    ).json();

    let listRes = await app.inject({ method: "GET", url: "/api/projects" });
    expect(listRes.json().items).toHaveLength(2);
    expect(listRes.json().archived_count).toBe(0);

    const arcRes = await app.inject({ method: "POST", url: `/api/projects/${two.id}/archive` });
    expect(arcRes.statusCode).toBe(200);

    listRes = await app.inject({ method: "GET", url: "/api/projects" });
    expect(listRes.json().items.map((p: any) => p.id)).toEqual([one.id]);
    expect(listRes.json().archived_count).toBe(1);

    const archivedList = await app.inject({ method: "GET", url: "/api/projects?only_archived=1" });
    expect(archivedList.json().items.map((p: any) => p.id)).toEqual([two.id]);

    const restRes = await app.inject({ method: "POST", url: `/api/projects/${two.id}/restore` });
    expect(restRes.statusCode).toBe(200);
    expect(existsSync(store.projectDir(two.id))).toBe(true);

    const badDel = await app.inject({
      method: "DELETE",
      url: `/api/projects/${two.id}`,
      payload: { confirm: "not-the-slug" },
    });
    expect(badDel.statusCode).toBe(400);
    expect(existsSync(store.projectDir(two.id))).toBe(true);

    const okDel = await app.inject({
      method: "DELETE",
      url: `/api/projects/${two.id}`,
      payload: { confirm: two.slug },
    });
    expect(okDel.statusCode).toBe(200);
    expect(existsSync(store.projectDir(two.id))).toBe(false);
    expect(existsSync(store.archiveDir(two.id))).toBe(false);

    listRes = await app.inject({ method: "GET", url: "/api/projects" });
    expect(listRes.json().items.map((p: any) => p.id)).toEqual([one.id]);
    expect(listRes.json().archived_count).toBe(0);
  });
});
