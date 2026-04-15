import type { FastifyInstance } from "fastify";
import {
  ContextBundleService,
  ProjectNotFoundError,
  trimToBudget,
} from "../services/context-bundle-service.js";

export interface ContextRoutesDeps {
  contextBundleService: ContextBundleService;
}

export function registerContextRoutes(
  app: FastifyInstance,
  deps: ContextRoutesDeps,
): void {
  app.get<{ Params: { id: string }; Querystring: { trim?: string; summary?: string } }>(
    "/api/projects/:id/context",
    async (req, reply) => {
      try {
        const bundle = await deps.contextBundleService.build(req.params.id);
        if (req.query?.trim === "1") trimToBudget(bundle);
        if (req.query?.summary === "1") {
          return reply.send({
            projectId: bundle.projectId,
            builtAt: bundle.builtAt,
            tokensEstimated: bundle._tokensEstimated,
            truncated: Boolean(bundle._truncated),
          });
        }
        return reply.send(bundle);
      } catch (err) {
        if (err instanceof ProjectNotFoundError) {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    },
  );
}
