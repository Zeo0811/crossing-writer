import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { registerCasePlanRoutes } from "../src/routes/case-plan.js";
import { ProjectStore } from "../src/services/project-store.js";
import { ExpertRegistry } from "../src/services/expert-registry.js";

describe("POST /case-plan/select", () => {
  it("writes selected-cases.md and transitions to case_plan_approved", async () => {
    const vault = mkdtempSync(join(tmpdir(), "sel-"));
    const projectsDir = join(vault, "07_projects");
    mkdirSync(join(vault, "08_experts/topic-panel"), { recursive: true });
    writeFileSync(join(vault, "08_experts/topic-panel/index.yaml"), "experts: []\n", "utf-8");
    const store = new ProjectStore(projectsDir);
    const expertRegistry = new ExpertRegistry(vault);
    const app = Fastify();
    registerProjectsRoutes(app, { store });
    registerCasePlanRoutes(app, {
      store, expertRegistry, projectsDir,
      orchestratorDeps: { vaultPath: vault, sqlitePath: "", agents: {}, defaultCli: "claude", fallbackCli: "codex" },
    });
    await app.ready();
    const p = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "T" } })).json();
    await store.update(p.id, { status: "awaiting_case_selection" });
    const cpDir = join(projectsDir, p.id, "mission/case-plan");
    mkdirSync(cpDir, { recursive: true });
    writeFileSync(join(cpDir, "candidates.md"), `---
type: case_plan_candidates
---
# Case 1 — A
body A
# Case 2 — B
body B
# Case 3 — C
body C
`, "utf-8");

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${p.id}/case-plan/select`,
      payload: { selectedIndices: [1, 3] },
    });
    expect(res.statusCode).toBe(200);
    const selPath = join(cpDir, "selected-cases.md");
    expect(existsSync(selPath)).toBe(true);
    const body = readFileSync(selPath, "utf-8");
    expect(body).toContain("selected_count: 2");
    const updated = await store.get(p.id);
    expect(updated?.status).toBe("case_plan_approved");
  });
});
