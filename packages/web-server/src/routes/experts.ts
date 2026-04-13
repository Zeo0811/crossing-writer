import type { FastifyInstance } from "fastify";
import type { ExpertRegistry } from "../services/expert-registry.js";

export function registerExpertsRoutes(
  app: FastifyInstance,
  deps: { registry: ExpertRegistry },
) {
  app.get("/api/experts", async () => {
    const topic = deps.registry.listActive("topic-panel");
    return { topic_panel: topic };
  });
}
