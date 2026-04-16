import type { FastifyInstance } from "fastify";
import { readdir, readFile, writeFile } from "node:fs/promises";
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
        runMission({ projectId: id, experts, ...deps }).catch(async (err) => {
          app.log.error({ err, projectId: id }, "mission run failed");
          try {
            const { appendEvent } = await import("../services/event-log.js");
            const { join } = await import("node:path");
            const projectDir = join(deps.projectsDir, id);
            await appendEvent(projectDir, {
              type: "mission.failed",
              error: err instanceof Error ? err.message : String(err),
            });
            await deps.store.update(id, { status: "brief_ready" });
          } catch (e) {
            app.log.error({ e }, "failed to write mission.failed event");
          }
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

  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/mission/selected",
    async (req, reply) => {
      const project = await deps.store.get(req.params.id);
      if (!project?.mission?.selected_path) {
        return reply.code(404).send({ error: "no selection yet" });
      }
      const md = await readFile(
        join(deps.projectsDir, req.params.id, project.mission.selected_path),
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
      status: "mission_approved_preview",
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
      to: "mission_approved_preview",
    });
    await appendEvent(projectDir, {
      type: "mission.selected",
      candidate_index: candidateIndex,
      path: selectedPath,
    });
    return { ok: true };
  });

  app.post<{
    Params: { id: string };
    Body: { feedback?: string };
  }>("/api/projects/:id/mission/refine", async (req, reply) => {
    const { id } = req.params;
    const feedback = (req.body?.feedback ?? "").toString();
    const project = await deps.store.get(id);
    if (!project?.mission?.selected_path) {
      return reply.code(400).send({ error: "no selected mission to refine" });
    }
    if (project.status !== "mission_approved_preview" && project.status !== "mission_review") {
      return reply.code(400).send({ error: `refine not allowed in status ${project.status}` });
    }
    setImmediate(() => {
      import("../services/mission-refine-service.js").then(async (mod) => {
        try {
          await mod.runMissionRefine({
            projectId: id,
            feedback,
            store: deps.store,
            projectsDir: deps.projectsDir,
            agents: deps.agents,
            defaultCli: deps.defaultCli,
            fallbackCli: deps.fallbackCli,
          });
        } catch (err: any) {
          app.log.error({ err, projectId: id }, "refine failed");
          const { appendEvent } = await import("../services/event-log.js");
          const { join } = await import("node:path");
          await appendEvent(join(deps.projectsDir, id), {
            type: "mission.refine_failed",
            error: err instanceof Error ? err.message : String(err),
          });
          await deps.store.update(id, { status: "mission_approved_preview" });
        }
      });
    });
    return reply.code(202).send({ ok: true, status: "mission_refining" });
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/mission/confirm", async (req, reply) => {
    const { id } = req.params;
    const project = await deps.store.get(id);
    if (!project?.mission?.selected_path) {
      return reply.code(400).send({ error: "no selected mission" });
    }
    if (project.status !== "mission_approved_preview" && project.status !== "mission_review") {
      return reply.code(400).send({ error: `confirm not allowed in status ${project.status}` });
    }
    const projectDir = join(deps.projectsDir, id);
    const refinesDir = join(projectDir, "mission/refines");
    const existing = (await readdir(refinesDir).catch(() => [])).filter((f) => /^round-\d+\.md$/.test(f));
    if (existing.length > 0) {
      const lastFile = `round-${existing.length}.md`;
      const finalText = await readFile(join(refinesDir, lastFile), "utf-8");
      await writeFile(join(projectDir, project.mission.selected_path), finalText, "utf-8");
    }
    const fromStatus = project.status;
    await deps.store.update(id, { status: "mission_approved" });
    await appendEvent(projectDir, { type: "mission.confirmed", final_path: project.mission.selected_path });
    await appendEvent(projectDir, { type: "state_changed", from: fromStatus, to: "mission_approved" });
    return { ok: true, status: "mission_approved" };
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id/mission/refines", async (req, reply) => {
    const { id } = req.params;
    const project = await deps.store.get(id);
    if (!project) return reply.code(404).send({ error: "project not found" });
    const refinesDir = join(deps.projectsDir, id, "mission/refines");
    const entries = (await readdir(refinesDir).catch(() => [])).filter((f) => /^round-\d+\.md$/.test(f));
    const refines = [];
    for (const f of entries.sort()) {
      const m = f.match(/^round-(\d+)\.md$/);
      if (!m) continue;
      const index = Number(m[1]);
      const mdPath = join(refinesDir, f);
      const feedbackPath = join(refinesDir, `round-${index}.feedback.txt`);
      let feedback = "";
      try { feedback = await readFile(feedbackPath, "utf-8"); } catch { /* skip */ }
      let created_at = "";
      try {
        const { statSync } = await import("node:fs");
        created_at = statSync(mdPath).mtime.toISOString();
      } catch { /* skip */ }
      refines.push({ index, path: `mission/refines/${f}`, feedback, created_at });
    }
    return { refines };
  });

  app.get<{ Params: { id: string; index: string } }>(
    "/api/projects/:id/mission/refines/:index",
    async (req, reply) => {
      const { id, index } = req.params;
      const idx = Number(index);
      if (!Number.isInteger(idx) || idx < 1) return reply.code(400).send({ error: "invalid index" });
      const project = await deps.store.get(id);
      if (!project) return reply.code(404).send({ error: "project not found" });
      const filePath = join(deps.projectsDir, id, "mission/refines", `round-${idx}.md`);
      try {
        const content = await readFile(filePath, "utf-8");
        reply.header("content-type", "text/markdown; charset=utf-8");
        return content;
      } catch {
        return reply.code(404).send({ error: "not found" });
      }
    },
  );
}
