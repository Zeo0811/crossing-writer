import type { FastifyInstance } from "fastify";
import type { ProjectStore } from "../services/project-store.js";

export interface ProjectsDeps { store: ProjectStore; }

export function registerProjectsRoutes(app: FastifyInstance, deps: ProjectsDeps) {
  app.get("/api/projects", async () => {
    return deps.store.list();
  });

  app.post<{ Body: { name?: string } }>("/api/projects", async (req, reply) => {
    const name = req.body?.name;
    if (!name || typeof name !== "string" || !name.trim()) {
      return reply.code(400).send({ error: "name required" });
    }
    const p = await deps.store.create({ name: name.trim() });
    return reply.code(201).send(p);
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id", async (req, reply) => {
    const p = await deps.store.get(req.params.id);
    if (!p) return reply.code(404).send({ error: "not found" });
    return p;
  });
}
