import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { registerOverviewRoutes } from "../src/routes/overview.js";
import { registerCasePlanRoutes } from "../src/routes/case-plan.js";
import { ProjectStore } from "../src/services/project-store.js";
import { ImageStore } from "../src/services/image-store.js";
import { ExpertRegistry } from "../src/services/expert-registry.js";

vi.mock("../src/services/case-inspiration-pack-builder.js", () => ({
  buildInspirationPack: async () => "# Inspiration Pack\nmock content",
}));

vi.mock("@crossing/agents", () => ({
  ProductOverviewAgent: vi.fn().mockImplementation(() => ({
    analyze: async () => ({
      text: "---\ntype: product_overview\nproduct_name: Mock\n---\n# 产品概览\nbody",
      meta: { cli: "claude", model: "opus", durationMs: 100 },
    }),
  })),
  CasePlannerExpert: vi.fn().mockImplementation((opts: any) => ({
    name: opts.name,
    round1: async () => ({ text: `# Case 1 — ${opts.name}\nproposed_by: ${opts.name}\n\nbody`, meta: { cli: "c", model: "m", durationMs: 10 } }),
    round2: async () => ({ text: "", meta: { cli: "c", model: "m", durationMs: 10 } }),
  })),
  CaseCoordinator: vi.fn().mockImplementation(() => ({
    synthesize: async () => ({
      text: "---\ntype: case_plan_candidates\ntotal_cases: 2\n---\n# Case 1 — A\nbody A\n# Case 2 — B\nbody B",
      meta: { cli: "c", model: "m", durationMs: 10 },
    }),
  })),
  runCaseExpert: async (e: any) => ({
    final: await e.round1({}), roundsUsed: 1, toolCallsMade: [],
  }),
  resolveAgent: () => ({ cli: "claude", model: "opus" }),
}));

describe("SP-03 e2e: overview → case approval", () => {
  it("walks full pipeline", async () => {
    const vault = mkdtempSync(join(tmpdir(), "e2e-"));
    const projectsDir = join(vault, "07_projects");
    mkdirSync(join(vault, "08_experts/topic-panel"), { recursive: true });
    writeFileSync(join(vault, "08_experts/topic-panel/index.yaml"), `experts:
  - name: X
    file: experts/x.md
    active: true
    creativity_score: 9
`, "utf-8");
    mkdirSync(join(vault, "08_experts/topic-panel/experts"), { recursive: true });
    writeFileSync(join(vault, "08_experts/topic-panel/experts/x.md"), "kb", "utf-8");

    const store = new ProjectStore(projectsDir);
    const imageStore = new ImageStore(projectsDir);
    const expertRegistry = new ExpertRegistry(vault);
    const app = Fastify();
    await app.register(multipart);
    registerProjectsRoutes(app, { store });
    registerOverviewRoutes(app, {
      store, imageStore, projectsDir,
      analyzeOverviewDeps: { vaultPath: vault, sqlitePath: "", agents: {}, defaultCli: "claude", fallbackCli: "codex" },
    });
    registerCasePlanRoutes(app, {
      store, expertRegistry, projectsDir,
      orchestratorDeps: { vaultPath: vault, sqlitePath: "", agents: {}, defaultCli: "claude", fallbackCli: "codex" },
    });
    await app.ready();

    const p = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "E2E" } })).json();

    const pDir = join(projectsDir, p.id);
    mkdirSync(join(pDir, "mission"), { recursive: true });
    writeFileSync(join(pDir, "mission/selected.md"), "mission body", "utf-8");
    await store.update(p.id, { status: "awaiting_overview_input" });

    await imageStore.save({
      projectId: p.id, filename: "a.png",
      buffer: Buffer.from("x"), source: "brief",
    });

    const genRes = await app.inject({
      method: "POST", url: `/api/projects/${p.id}/overview/generate`,
      payload: { productUrls: [], userDescription: "" },
    });
    expect(genRes.statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 100));

    const p1 = await store.get(p.id);
    expect(p1?.status).toBe("overview_ready");
    expect(existsSync(join(pDir, "context/product-overview.md"))).toBe(true);

    const aprRes = await app.inject({
      method: "POST", url: `/api/projects/${p.id}/overview/approve`,
    });
    expect(aprRes.statusCode).toBe(200);

    const startRes = await app.inject({
      method: "POST", url: `/api/projects/${p.id}/case-plan/start`,
      payload: { experts: ["X"] },
    });
    expect(startRes.statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 500));

    const p2 = await store.get(p.id);
    expect(p2?.status).toBe("awaiting_case_selection");
    expect(existsSync(join(pDir, "mission/case-plan/candidates.md"))).toBe(true);

    const selRes = await app.inject({
      method: "POST", url: `/api/projects/${p.id}/case-plan/select`,
      payload: { selectedIndices: [1, 2] },
    });
    expect(selRes.statusCode).toBe(200);

    const p3 = await store.get(p.id);
    expect(p3?.status).toBe("case_plan_approved");
    expect(existsSync(join(pDir, "mission/case-plan/selected-cases.md"))).toBe(true);
  });
});
