import type { FastifyInstance } from "fastify";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectStore } from "../services/project-store.js";
import type { ExpertRegistry } from "../services/expert-registry.js";
import { runMission } from "../services/mission-orchestrator.js";
import { appendEvent } from "../services/event-log.js";
import type { AgentConfig } from "@crossing/agents";

export interface MissionDeps {
  store: ProjectStore;
  registry: ExpertRegistry;
  projectsDir: string;
  cli: "claude" | "codex";
  model?: string;
  agents: Record<string, AgentConfig>;
  defaultCli: "claude" | "codex";
  fallbackCli: "claude" | "codex";
  searchCtx: { sqlitePath: string; vaultPath: string };
}

export function registerMissionRoutes(app: FastifyInstance, deps: MissionDeps) {
  app.post<{ Params: { id: string }; Body: { experts: string[] } }>(
    "/api/projects/:id/mission/start",
    async (req, reply) => {
      const { id } = req.params;
      const { experts } = req.body ?? ({ experts: [] } as any);
      if (!Array.isArray(experts) || experts.length === 0) {
        return reply.code(400).send({ error: "experts required" });
      }
      setImmediate(() => {
        runMission({ projectId: id, experts, ...deps }).catch((err) => {
          app.log.error({ err, projectId: id }, "mission run failed");
        });
      });
      return reply.code(202).send({ ok: true, status: "started" });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/mission/candidates",
    async (req, reply) => {
      const project = await deps.store.get(req.params.id);
      if (!project?.mission?.candidates_path) {
        return reply.code(404).send({ error: "no candidates yet" });
      }
      const md = await readFile(
        join(deps.projectsDir, req.params.id, project.mission.candidates_path),
        "utf-8",
      );
      reply.header("content-type", "text/markdown; charset=utf-8");
      return md;
    },
  );

  app.post<{
    Params: { id: string };
    Body: { candidateIndex: number; edits?: string };
  }>("/api/projects/:id/mission/select", async (req, reply) => {
    const { id } = req.params;
    const { candidateIndex, edits } = req.body;
    if (typeof candidateIndex !== "number") {
      return reply.code(400).send({ error: "candidateIndex required" });
    }
    const project = await deps.store.get(id);
    if (!project?.mission?.candidates_path) {
      return reply.code(400).send({ error: "no candidates" });
    }
    const now = new Date().toISOString();
    const selectedPath = "mission/selected.md";
    const projectDir = join(deps.projectsDir, id);

    const candidatesMd = await readFile(
      join(projectDir, project.mission.candidates_path),
      "utf-8",
    );
    const selectedMd = `---\ntype: mission\nproject_id: ${id}\nselected_index: ${candidateIndex}\napproved_by: human\napproved_at: ${now}\nhuman_edits: ${edits ? "true" : "false"}\n---\n\n${edits ?? ""}\n\n<!-- source candidates.md: -->\n\n${candidatesMd}\n`;
    await writeFile(join(projectDir, selectedPath), selectedMd, "utf-8");

    await deps.store.update(id, {
      status: "mission_approved",
      mission: {
        ...project.mission,
        selected_index: candidateIndex,
        selected_path: selectedPath,
        selected_at: now,
        selected_by: "human",
      },
    });
    await appendEvent(projectDir, {
      type: "state_changed",
      from: project.status,
      to: "mission_approved",
    });
    return { ok: true };
  });
}
