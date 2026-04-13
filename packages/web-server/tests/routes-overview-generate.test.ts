import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { registerOverviewRoutes } from "../src/routes/overview.js";
import { ProjectStore } from "../src/services/project-store.js";
import { ImageStore } from "../src/services/image-store.js";

vi.mock("../src/services/overview-analyzer-service.js", () => ({
  analyzeOverview: vi.fn(async () => "/abs/out.md"),
}));

describe("POST /overview/generate", () => {
  it("requires at least one image", async () => {
    const vault = mkdtempSync(join(tmpdir(), "og-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const imageStore = new ImageStore(projectsDir);
    const app = Fastify();
    await app.register(multipart);
    registerProjectsRoutes(app, { store });
    registerOverviewRoutes(app, {
      store, imageStore, projectsDir,
      analyzeOverviewDeps: {
        vaultPath: "", sqlitePath: "",
        agents: {}, defaultCli: "claude", fallbackCli: "codex",
      },
    });
    await app.ready();
    const p = (await app.inject({
      method: "POST", url: "/api/projects", payload: { name: "T" },
    })).json();

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${p.id}/overview/generate`,
      payload: { productUrls: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/image/i);
  });

  it("202 triggers analyzeOverview in background", async () => {
    const { analyzeOverview } = await import("../src/services/overview-analyzer-service.js");
    const vault = mkdtempSync(join(tmpdir(), "og-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const imageStore = new ImageStore(projectsDir);
    const app = Fastify();
    await app.register(multipart);
    registerProjectsRoutes(app, { store });
    registerOverviewRoutes(app, {
      store, imageStore, projectsDir,
      analyzeOverviewDeps: {
        vaultPath: "", sqlitePath: "",
        agents: {}, defaultCli: "claude", fallbackCli: "codex",
      },
    });
    await app.ready();
    const p = (await app.inject({
      method: "POST", url: "/api/projects", payload: { name: "T" },
    })).json();
    await imageStore.save({
      projectId: p.id, filename: "a.png",
      buffer: Buffer.from("x"), source: "brief",
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${p.id}/overview/generate`,
      payload: { productUrls: ["https://x.com"], userDescription: "d" },
    });
    expect(res.statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 20));
    expect(analyzeOverview).toHaveBeenCalled();
  });
});
