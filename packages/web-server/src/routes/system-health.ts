import type { FastifyInstance } from "fastify";
import type { CliHealthResponse } from "../services/cli-health.js";

export interface SystemHealthDeps {
  prober: { probe(): Promise<CliHealthResponse> };
}

export function registerSystemHealthRoutes(app: FastifyInstance, deps: SystemHealthDeps) {
  app.get("/api/system/cli-health", async (_req, reply) => {
    try {
      const data = await deps.prober.probe();
      return reply.send(data);
    } catch (err) {
      const message = (err as Error).message ?? "probe failed";
      return reply.code(500).send({ message });
    }
  });
}
