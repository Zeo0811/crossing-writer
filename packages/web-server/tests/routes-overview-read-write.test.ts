import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { registerOverviewRoutes } from "../src/routes/overview.js";
import { ProjectStore } from "../src/services/project-store.js";
import { ImageStore } from "../src/services/image-store.js";

async function mkApp() {
  const vault = mkdtempSync(join(tmpdir(), "ovrw-"));
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
  return { app, projectsDir, p };
}

describe("GET/PATCH /overview", () => {
  it("404 when not generated yet", async () => {
    const { app, p } = await mkApp();
    const res = await app.inject({
      method: "GET", url: `/api/projects/${p.id}/overview`,
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns markdown when present", async () => {
    const { app, p, projectsDir } = await mkApp();
    mkdirSync(join(projectsDir, p.id, "context"), { recursive: true });
    writeFileSync(
      join(projectsDir, p.id, "context/product-overview.md"),
      "---\ntype: product_overview\n---\n# Body",
      "utf-8",
    );
    const res = await app.inject({
      method: "GET", url: `/api/projects/${p.id}/overview`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("type: product_overview");
  });

  it("PATCH writes raw md + marks human_edited", async () => {
    const { app, p, projectsDir } = await mkApp();
    mkdirSync(join(projectsDir, p.id, "context"), { recursive: true });
    writeFileSync(
      join(projectsDir, p.id, "context/product-overview.md"),
      "---\ntype: product_overview\n---\n# Old",
      "utf-8",
    );
    const res = await app.inject({
      method: "PATCH",
      url: `/api/projects/${p.id}/overview`,
      payload: "---\ntype: product_overview\n---\n# New",
      headers: { "content-type": "text/markdown" },
    });
    expect(res.statusCode).toBe(200);
    const body = readFileSync(
      join(projectsDir, p.id, "context/product-overview.md"),
      "utf-8",
    );
    expect(body).toContain("# New");
  });
});
