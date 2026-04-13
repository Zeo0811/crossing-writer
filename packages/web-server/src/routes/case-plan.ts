import type { FastifyInstance } from "fastify";
import type { ProjectStore } from "../services/project-store.js";
import type { ExpertRegistry } from "../services/expert-registry.js";
import { computeCasePreselect } from "../services/case-expert-preselect.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCasePlan } from "../services/case-plan-orchestrator.js";
import { buildSelectedCasesMd } from "../services/selected-cases-writer.js";

export interface CasePlanDeps {
  store: ProjectStore;
  expertRegistry: ExpertRegistry;
  projectsDir?: string;
  orchestratorDeps?: {
    vaultPath: string;
    sqlitePath: string;
    agents: Record<string, unknown>;
    defaultCli: "claude" | "codex";
    fallbackCli: "claude" | "codex";
  };
}

export function registerCasePlanRoutes(app: FastifyInstance, deps: CasePlanDeps) {
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/experts/case",
    async (req, reply) => {
      const p = await deps.store.get(req.params.id);
      if (!p) return reply.code(404).send({ error: "not found" });
      const all = await deps.expertRegistry.listActive();
      const missionExperts = (p as any).mission?.experts_selected ?? [];
      const preselected = computeCasePreselect(all, missionExperts);
      return all.map((e) => ({
        name: e.name,
        specialty: e.specialty ?? "",
        creativity_score: e.creativity_score ?? null,
        preselected: preselected.includes(e.name),
      }));
    },
  );

  app.addContentTypeParser("text/markdown", { parseAs: "string" }, (_r, b, done) => done(null, b));

  app.post<{ Params: { id: string }; Body: { experts: string[] } }>(
    "/api/projects/:id/case-plan/start",
    async (req, reply) => {
      const p = await deps.store.get(req.params.id);
      if (!p) return reply.code(404).send({ error: "not found" });
      if (p.status !== "awaiting_case_expert_selection"
          && p.status !== "case_planning_failed") {
        return reply.code(409).send({ error: `cannot start from ${p.status}` });
      }
      const experts = req.body?.experts ?? [];
      if (experts.length === 0) {
        return reply.code(400).send({ error: "experts required" });
      }
      const all = await deps.expertRegistry.listActive();
      const expertKbs: Record<string, string> = {};
      const orchDeps = deps.orchestratorDeps!;
      for (const name of experts) {
        const rec = all.find((e) => e.name === name);
        if (rec) {
          try {
            expertKbs[name] = await readFile(
              join(orchDeps.vaultPath, "08_experts/topic-panel", rec.file),
              "utf-8",
            );
          } catch { expertKbs[name] = ""; }
        }
      }
      void runCasePlan({
        projectId: req.params.id,
        projectsDir: deps.projectsDir!,
        store: deps.store,
        experts, expertKbs,
        ...orchDeps,
      }).catch(() => {});
      return reply.code(202).send({ status: "planning" });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/case-plan/candidates",
    async (req, reply) => {
      const candPath = join(deps.projectsDir!, req.params.id, "mission/case-plan/candidates.md");
      try {
        const body = await readFile(candPath, "utf-8");
        reply.header("content-type", "text/markdown; charset=utf-8");
        return reply.send(body);
      } catch (e: any) {
        if (e.code === "ENOENT") return reply.code(404).send({ error: "not ready" });
        throw e;
      }
    },
  );

  app.post<{
    Params: { id: string };
    Body: { selectedIndices: number[] };
  }>("/api/projects/:id/case-plan/select", async (req, reply) => {
    const p = await deps.store.get(req.params.id);
    if (!p) return reply.code(404).send({ error: "not found" });
    if (p.status !== "awaiting_case_selection") {
      return reply.code(409).send({ error: `cannot select from ${p.status}` });
    }
    const indices = req.body?.selectedIndices ?? [];
    if (indices.length < 2 || indices.length > 4) {
      return reply.code(400).send({ error: "must select 2-4 cases" });
    }
    const candPath = join(deps.projectsDir!, req.params.id, "mission/case-plan/candidates.md");
    const candidatesMd = await readFile(candPath, "utf-8");
    const selected = buildSelectedCasesMd({
      candidatesMd, selectedIndices: indices,
      projectId: req.params.id,
      missionRef: "mission/selected.md",
      overviewRef: "context/product-overview.md",
    });
    const selPath = join(deps.projectsDir!, req.params.id, "mission/case-plan/selected-cases.md");
    await writeFile(selPath, selected, "utf-8");
    await deps.store.update(req.params.id, {
      status: "case_plan_approved",
      case_plan: {
        ...(p.case_plan ?? { experts_selected: [], candidates_path: "mission/case-plan/candidates.md" }),
        selected_path: "mission/case-plan/selected-cases.md",
        selected_indices: indices,
        selected_count: indices.length,
        approved_at: new Date().toISOString(),
      },
    });
    return reply.code(200).send({ ok: true });
  });

  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/case-plan/selected",
    async (req, reply) => {
      const selPath = join(deps.projectsDir!, req.params.id, "mission/case-plan/selected-cases.md");
      try {
        const body = await readFile(selPath, "utf-8");
        reply.header("content-type", "text/markdown; charset=utf-8");
        return reply.send(body);
      } catch (e: any) {
        if (e.code === "ENOENT") return reply.code(404).send({ error: "not selected" });
        throw e;
      }
    },
  );
}
