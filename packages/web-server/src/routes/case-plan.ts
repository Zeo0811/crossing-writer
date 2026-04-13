import type { FastifyInstance } from "fastify";
import type { ProjectStore } from "../services/project-store.js";
import type { ExpertRegistry } from "../services/expert-registry.js";
import { computeCasePreselect } from "../services/case-expert-preselect.js";

export interface CasePlanDeps {
  store: ProjectStore;
  expertRegistry: ExpertRegistry;
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
}
