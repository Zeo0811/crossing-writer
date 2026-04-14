import type { FastifyInstance } from "fastify";
import type { ProjectOverride, ProjectOverrideStore } from "../services/project-override-store.js";
import type { ProjectStore } from "../services/project-store.js";

export interface ConfigProjectOverridesDeps {
  projectOverrideStore: ProjectOverrideStore;
  projectStore: Pick<ProjectStore, "get">;
}

const VALID_CLIS = ["claude", "codex"];
const VALID_ROLES = ["opening", "practice", "closing"];

function validateOverride(o: unknown): string | null {
  if (!o || typeof o !== "object") return "body must be an object";
  const override = o as ProjectOverride;
  if (override.agents === undefined || override.agents === null) {
    return "agents is required";
  }
  if (typeof override.agents !== "object" || Array.isArray(override.agents)) {
    return "agents must be an object";
  }
  for (const [key, entry] of Object.entries(override.agents)) {
    if (!entry || typeof entry !== "object") {
      return `agents[${key}] must be an object`;
    }
    const e = entry as Record<string, unknown>;
    if (e.model) {
      const model = e.model as Record<string, unknown>;
      if (model.cli !== undefined && !VALID_CLIS.includes(model.cli as string)) {
        return `agents[${key}].model.cli must be claude|codex`;
      }
    }
    if (e.styleBinding) {
      const sb = e.styleBinding as Record<string, unknown>;
      if (sb.role !== undefined && !VALID_ROLES.includes(sb.role as string)) {
        return `agents[${key}].styleBinding.role must be opening|practice|closing`;
      }
      if (sb.account !== undefined && (typeof sb.account !== "string" || sb.account.trim() === "")) {
        return `agents[${key}].styleBinding.account must be non-empty string`;
      }
    }
  }
  return null;
}

export function registerConfigProjectOverridesRoutes(
  app: FastifyInstance,
  deps: ConfigProjectOverridesDeps,
): void {
  async function requireProject(id: string): Promise<boolean> {
    const p = await deps.projectStore.get(id);
    return p !== null && p !== undefined;
  }

  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/override",
    async (req, reply) => {
      const { id } = req.params;
      if (!(await requireProject(id))) {
        return reply.code(404).send({ error: `project not found: ${id}` });
      }
      const override = deps.projectOverrideStore.get(id);
      if (!override) return reply.send({});
      return reply.send(override);
    },
  );

  app.put<{ Params: { id: string }; Body: ProjectOverride }>(
    "/api/projects/:id/override",
    async (req, reply) => {
      const { id } = req.params;
      if (!(await requireProject(id))) {
        return reply.code(404).send({ error: `project not found: ${id}` });
      }
      const err = validateOverride(req.body);
      if (err) {
        return reply.code(400).send({ error: err });
      }
      deps.projectOverrideStore.set(id, req.body as ProjectOverride);
      return reply.send({ ok: true });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/projects/:id/override",
    async (req, reply) => {
      const { id } = req.params;
      if (!(await requireProject(id))) {
        return reply.code(404).send({ error: `project not found: ${id}` });
      }
      deps.projectOverrideStore.delete(id);
      return reply.send({ ok: true });
    },
  );

  app.delete<{ Params: { id: string; agentKey: string } }>(
    "/api/projects/:id/override/:agentKey",
    async (req, reply) => {
      const { id } = req.params;
      const agentKey = decodeURIComponent(req.params.agentKey);
      if (!(await requireProject(id))) {
        return reply.code(404).send({ error: `project not found: ${id}` });
      }
      deps.projectOverrideStore.clear(id, agentKey);
      return reply.send({ ok: true });
    },
  );
}
