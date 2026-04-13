import type { FastifyInstance } from "fastify";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { ProjectStore } from "../services/project-store.js";
import { EvidenceStore } from "../services/evidence-store.js";
import { computeCompleteness } from "../services/evidence-completeness.js";

export interface EvidenceDeps {
  store: ProjectStore;
  projectsDir: string;
}

interface ParsedCase {
  caseId: string;
  name: string;
}

function parseSelectedCases(projectDir: string): ParsedCase[] {
  const path = join(projectDir, "mission/case-plan/selected-cases.md");
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf-8");
  const re = /^# Case (\d+)\s*[—\-]?\s*(.+)$/gm;
  const out: ParsedCase[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const idx = parseInt(m[1]!, 10);
    const caseId = `case-${String(idx).padStart(2, "0")}`;
    out.push({ caseId, name: m[2]!.trim() });
  }
  return out;
}

async function buildProjectEvidence(deps: EvidenceDeps, projectId: string) {
  const projectDir = join(deps.projectsDir, projectId);
  const evStore = new EvidenceStore(projectDir);
  const cases = parseSelectedCases(projectDir);
  await evStore.ensureCaseDirs(cases.map((c) => c.caseId));
  const summary = await evStore.regenerateIndex(projectId, cases);
  const project = await deps.store.get(projectId);
  const submitted_at = project?.evidence?.submitted_at ?? null;
  const casesCache: Record<string, any> = {};
  for (const [k, v] of Object.entries(summary.cases)) {
    casesCache[k] = {
      has_screenshot: v.completeness.has_screenshot,
      has_notes: v.completeness.has_notes,
      has_generated: v.completeness.has_generated,
      complete: v.completeness.complete,
      counts: v.counts,
      last_updated_at: summary.updated_at,
    };
  }
  await deps.store.update(projectId, {
    evidence: {
      cases: casesCache,
      index_path: "evidence/index.md",
      all_complete: summary.all_complete,
      submitted_at,
    },
  });
  return { ...summary, submitted_at };
}

export function registerEvidenceRoutes(app: FastifyInstance, deps: EvidenceDeps) {
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/evidence",
    async (req, reply) => {
      const project = await deps.store.get(req.params.id);
      if (!project) return reply.code(404).send({ error: "project not found" });
      if (project.status === "case_plan_approved") {
        await deps.store.update(req.params.id, { status: "evidence_collecting" });
      }
      const summary = await buildProjectEvidence(deps, req.params.id);
      // serialize cases as OBJECT keyed by case_id (test asserts Object.keys(body.cases))
      const casesObj: Record<string, any> = {};
      for (const [k, v] of Object.entries(summary.cases)) {
        casesObj[k] = {
          ...v,
          last_updated_at: summary.updated_at,
        };
      }
      return reply.send({
        cases: casesObj,
        all_complete: summary.all_complete,
        submitted_at: summary.submitted_at,
        index_path: "evidence/index.md",
      });
    },
  );

  app.get<{ Params: { id: string; caseId: string } }>(
    "/api/projects/:id/evidence/:caseId",
    async (req, reply) => {
      const projectDir = join(deps.projectsDir, req.params.id);
      const cases = parseSelectedCases(projectDir);
      const c = cases.find((x) => x.caseId === req.params.caseId);
      if (!c) return reply.code(404).send({ error: "case not found" });
      const evStore = new EvidenceStore(projectDir);
      const screenshots = await evStore.listFiles(req.params.caseId, "screenshot");
      const recordings = await evStore.listFiles(req.params.caseId, "recording");
      const generated = await evStore.listFiles(req.params.caseId, "generated");
      const notes = await evStore.readNotes(req.params.caseId);
      const completeness = computeCompleteness(join(projectDir, "evidence", req.params.caseId));
      return reply.send({
        case_id: c.caseId,
        name: c.name,
        screenshots,
        recordings,
        generated,
        notes,
        completeness,
      });
    },
  );
}
