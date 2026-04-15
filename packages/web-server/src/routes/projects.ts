import type { FastifyInstance } from "fastify";
import { ProjectConflictError, ConfirmationMismatchError, type ProjectStore } from "../services/project-store.js";

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

  app.post<{ Params: { id: string } }>("/api/projects/:id/archive", async (req, reply) => {
    try {
      await deps.store.archive(req.params.id);
      return reply.code(200).send({
        ok: true,
        id: req.params.id,
        archived_path: `_archive/${req.params.id}`,
      });
    } catch (e: any) {
      if (e instanceof ProjectConflictError) {
        return reply.code(409).send({ error: "already_archived" });
      }
      if (/project_not_found/.test(e?.message ?? "")) {
        return reply.code(404).send({ error: "project_not_found" });
      }
      throw e;
    }
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/restore", async (req, reply) => {
    try {
      await deps.store.restore(req.params.id);
      return reply.code(200).send({ ok: true, id: req.params.id });
    } catch (e: any) {
      if (e instanceof ProjectConflictError) {
        return reply.code(409).send({ error: "name_conflict", detail: e.message });
      }
      if (/project_not_found/.test(e?.message ?? "")) {
        return reply.code(404).send({ error: "project_not_found" });
      }
      throw e;
    }
  });
}
