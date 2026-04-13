import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { registerOverviewRoutes } from "../src/routes/overview.js";
import { ProjectStore } from "../src/services/project-store.js";
import { ImageStore } from "../src/services/image-store.js";
import { createConfigStore } from "../src/services/config-store.js";

async function mkApp() {
  const vault = mkdtempSync(join(tmpdir(), "ov-"));
  const projectsDir = join(vault, "07_projects");
  const store = new ProjectStore(projectsDir);
  const imageStore = new ImageStore(projectsDir);
  const app = Fastify();
  await app.register(multipart);
  const cfgPath = join(vault, "config.json");
  writeFileSync(cfgPath, JSON.stringify({
    vaultPath: vault,
    sqlitePath: "",
    modelAdapter: { defaultCli: "claude", fallbackCli: "codex" },
    agents: {},
  }, null, 2), "utf-8");
  const configStore = createConfigStore(cfgPath);
  registerProjectsRoutes(app, { store });
  registerOverviewRoutes(app, {
    store, imageStore, projectsDir,
    analyzeOverviewDeps: {
      vaultPath: vault,
      sqlitePath: "",
      configStore,
    },
  });
  await app.ready();
  const created = (await app.inject({
    method: "POST", url: "/api/projects", payload: { name: "T" },
  })).json();
  return { app, store, imageStore, project: created, projectsDir };
}

describe("overview images route", () => {
  it("accepts multipart image upload with source=brief", async () => {
    const { app, project } = await mkApp();
    const boundary = "----Boundary" + Math.random().toString(36).slice(2);
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="source"',
      '',
      'brief',
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="x.png"',
      'Content-Type: image/png',
      '',
      'pretend-png-bytes',
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/overview/images`,
      payload: body,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(201);
    const data = res.json();
    expect(data.filename).toMatch(/^brief-fig-1/);
    expect(data.source).toBe("brief");
  });

  it("lists uploaded images", async () => {
    const { app, project, imageStore } = await mkApp();
    await imageStore.save({
      projectId: project.id, filename: "a.png",
      buffer: Buffer.from("x"), source: "brief",
    });
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/overview/images`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it("deletes image by filename", async () => {
    const { app, project, imageStore } = await mkApp();
    const saved = await imageStore.save({
      projectId: project.id, filename: "a.png",
      buffer: Buffer.from("x"), source: "brief",
    });
    const res = await app.inject({
      method: "DELETE",
      url: `/api/projects/${project.id}/overview/images/${saved.filename}`,
    });
    expect(res.statusCode).toBe(204);
    const list = await imageStore.list(project.id);
    expect(list).toHaveLength(0);
  });

  it("returns 400 if source field missing in multipart", async () => {
    const { app, project } = await mkApp();
    const boundary = "----Bound" + Math.random().toString(36).slice(2);
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="x.png"',
      'Content-Type: image/png',
      '',
      'bytes',
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/overview/images`,
      payload: body,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(400);
  });
});
