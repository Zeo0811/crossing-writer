import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { registerOverviewRoutes } from "../src/routes/overview.js";
import { ProjectStore } from "../src/services/project-store.js";
import { ImageStore } from "../src/services/image-store.js";
import { createConfigStore } from "../src/services/config-store.js";

describe("POST /overview/approve", () => {
  it("moves overview_ready -> awaiting_case_expert_selection", async () => {
    const vault = mkdtempSync(join(tmpdir(), "apr-"));
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
    const p = (await app.inject({
      method: "POST", url: "/api/projects", payload: { name: "T" },
    })).json();
    await store.update(p.id, { status: "overview_ready" });
    mkdirSync(join(projectsDir, p.id, "context"), { recursive: true });
    writeFileSync(join(projectsDir, p.id, "context/product-overview.md"), "md", "utf-8");

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${p.id}/overview/approve`,
    });
    expect(res.statusCode).toBe(200);
    const updated = await store.get(p.id);
    expect(updated?.status).toBe("awaiting_case_expert_selection");
  });

  it("409 if status is not overview_ready", async () => {
    const vault = mkdtempSync(join(tmpdir(), "apr-"));
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
    const p = (await app.inject({
      method: "POST", url: "/api/projects", payload: { name: "T" },
    })).json();
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${p.id}/overview/approve`,
    });
    expect(res.statusCode).toBe(409);
  });
});
