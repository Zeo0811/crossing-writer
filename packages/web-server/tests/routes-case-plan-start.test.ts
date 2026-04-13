import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { registerCasePlanRoutes } from "../src/routes/case-plan.js";
import { ProjectStore } from "../src/services/project-store.js";
import { ExpertRegistry } from "../src/services/expert-registry.js";
import { createConfigStore } from "../src/services/config-store.js";

vi.mock("../src/services/case-plan-orchestrator.js", () => ({
  runCasePlan: vi.fn(async () => "/abs/candidates.md"),
}));

describe("/case-plan routes", () => {
  it("POST /case-plan/start 202 when status is awaiting_case_expert_selection", async () => {
    const { runCasePlan } = await import("../src/services/case-plan-orchestrator.js");
    const vault = mkdtempSync(join(tmpdir(), "cps-"));
    const projectsDir = join(vault, "07_projects");
    mkdirSync(join(vault, "08_experts/topic-panel"), { recursive: true });
    writeFileSync(join(vault, "08_experts/topic-panel/index.yaml"),
      "experts: []\n", "utf-8");
    const store = new ProjectStore(projectsDir);
    const expertRegistry = new ExpertRegistry(vault);
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
      store, expertRegistry,
      projectsDir,
      orchestratorDeps: {
        vaultPath: vault, sqlitePath: "", configStore,
      },
    });
    await app.ready();
    const p = (await app.inject({
      method: "POST", url: "/api/projects", payload: { name: "T" },
    })).json();
    await store.update(p.id, { status: "awaiting_case_expert_selection" });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${p.id}/case-plan/start`,
      payload: { experts: ["卡兹克"] },
    });
    expect(res.statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 20));
    expect(runCasePlan).toHaveBeenCalled();
  });

  it("GET /case-plan/candidates returns md", async () => {
    const vault = mkdtempSync(join(tmpdir(), "cps-"));
    const projectsDir = join(vault, "07_projects");
    mkdirSync(join(vault, "08_experts/topic-panel"), { recursive: true });
    writeFileSync(join(vault, "08_experts/topic-panel/index.yaml"), "experts: []\n", "utf-8");
    const store = new ProjectStore(projectsDir);
    const expertRegistry = new ExpertRegistry(vault);
    const cfgPath2 = join(vault, "config.json");
    writeFileSync(cfgPath2, JSON.stringify({
      vaultPath: vault,
      sqlitePath: "",
      modelAdapter: { defaultCli: "claude", fallbackCli: "codex" },
      agents: {},
    }, null, 2), "utf-8");
    const configStore2 = createConfigStore(cfgPath2);
    const app = Fastify();
    registerProjectsRoutes(app, { store });
    registerCasePlanRoutes(app, {
      store, expertRegistry,
      projectsDir,
      orchestratorDeps: { vaultPath: vault, sqlitePath: "", configStore: configStore2 },
    });
    await app.ready();
    const p = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "T" } })).json();
    mkdirSync(join(projectsDir, p.id, "mission/case-plan"), { recursive: true });
    writeFileSync(join(projectsDir, p.id, "mission/case-plan/candidates.md"),
      "---\ntype: case_plan_candidates\n---\n# Case 01", "utf-8");

    const res = await app.inject({
      method: "GET", url: `/api/projects/${p.id}/case-plan/candidates`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("case_plan_candidates");
  });
});
