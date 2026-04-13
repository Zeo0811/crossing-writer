import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { registerCasePlanRoutes } from "../src/routes/case-plan.js";
import { ProjectStore } from "../src/services/project-store.js";
import { ExpertRegistry } from "../src/services/expert-registry.js";
import { createConfigStore } from "../src/services/config-store.js";

describe("GET /api/projects/:id/experts/case", () => {
  it("returns experts with preselect flags", async () => {
    const vault = mkdtempSync(join(tmpdir(), "ecr-"));
    const panelDir = join(vault, "08_experts/topic-panel");
    mkdirSync(panelDir, { recursive: true });
    writeFileSync(join(panelDir, "index.yaml"), `experts:
  - name: A
    file: experts/a.md
    active: true
    creativity_score: 9
  - name: B
    file: experts/b.md
    active: true
    creativity_score: 7
  - name: C
    file: experts/c.md
    active: true
    creativity_score: 5
`, "utf-8");
    mkdirSync(join(panelDir, "experts"), { recursive: true });
    for (const n of ["a.md", "b.md", "c.md"]) {
      writeFileSync(join(panelDir, "experts", n), "kb", "utf-8");
    }
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const registry = new ExpertRegistry(vault);
    const cfgPath = join(vault, "config.json");
    writeFileSync(cfgPath, JSON.stringify({
      vaultPath: vault,
      sqlitePath: "",
      modelAdapter: { defaultCli: "claude", fallbackCli: "codex" },
      agents: {},
    }, null, 2), "utf-8");
    const configStore = createConfigStore(cfgPath);
    const app = Fastify();
    registerProjectsRoutes(app, { store });
    registerCasePlanRoutes(app, {
      store, expertRegistry: registry,
      projectsDir,
      orchestratorDeps: {
        vaultPath: vault, sqlitePath: "", configStore,
      },
    });
    await app.ready();
    const p = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "T" } })).json();
    const res = await app.inject({ method: "GET", url: `/api/projects/${p.id}/experts/case` });
    expect(res.statusCode).toBe(200);
    const list = res.json();
    expect(list).toHaveLength(3);
    const A = list.find((e: any) => e.name === "A");
    expect(A.preselected).toBe(true);
    expect(A.creativity_score).toBe(9);
  });
});
