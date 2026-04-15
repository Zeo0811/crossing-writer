import type { FastifyInstance } from "fastify";
import { ProjectConflictError, ConfirmationMismatchError, type ProjectStore } from "../services/project-store.js";

export interface ProjectsDeps { store: ProjectStore; }

export function registerProjectsRoutes(app: FastifyInstance, deps: ProjectsDeps) {
  app.get<{ Querystring: { include_archived?: string; only_archived?: string } }>(
    "/api/projects",
    async (req) => {
      const q = req.query ?? {};
      if (q.only_archived === "1") {
        const [items, active] = await Promise.all([
          deps.store.listArchived(),
          deps.store.list(),
        ]);
        return { items, active_count: active.length };
      }
      if (q.include_archived === "1") {
        const [active, archived] = await Promise.all([
          deps.store.list(),
          deps.store.listArchived(),
        ]);
        const items = [
          ...active.map((p) => ({ ...p, archived: false })),
          ...archived.map((p) => ({ ...p, archived: true })),
        ];
        return { items };
      }
      const [items, archived] = await Promise.all([
        deps.store.list(),
        deps.store.listArchived(),
      ]);
      return { items, archived_count: archived.length };
    },
  );

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

  app.delete<{ Params: { id: string }; Body: { confirm?: string } }>(
    "/api/projects/:id",
    async (req, reply) => {
      const confirm = req.body?.confirm;
      if (typeof confirm !== "string" || confirm.length === 0) {
        return reply.code(400).send({ error: "confirmation_required" });
      }
      try {
        const { removedPath } = await deps.store.destroy(req.params.id, { confirmSlug: confirm });
        return reply.code(200).send({ ok: true, id: req.params.id, removed_path: removedPath });
      } catch (e: any) {
        if (e instanceof ConfirmationMismatchError) {
          return reply.code(400).send({ error: "confirmation_mismatch", expected: e.expected });
        }
        if (/project_not_found/.test(e?.message ?? "")) {
          return reply.code(404).send({ error: "project_not_found" });
        }
        throw e;
      }
    },
  );
}
