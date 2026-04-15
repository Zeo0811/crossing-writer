import "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { ProjectStore } from "../services/project-store.js";
import { EvidenceStore, type EvidenceKind } from "../services/evidence-store.js";
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

  const KIND_LIMITS: Record<EvidenceKind, number> = {
    screenshot: 10 * 1024 * 1024,
    recording: 100 * 1024 * 1024,
    generated: 200 * 1024 * 1024,
  };
  const CASE_TOTAL_LIMIT = 1024 * 1024 * 1024;
  const VALID_KINDS = new Set<EvidenceKind>(["screenshot", "recording", "generated"]);

  app.post<{ Params: { id: string; caseId: string } }>(
    "/api/projects/:id/evidence/:caseId/files",
    async (req, reply) => {
      const projectDir = join(deps.projectsDir, req.params.id);
      const cases = parseSelectedCases(projectDir);
      if (!cases.find((c) => c.caseId === req.params.caseId)) {
        return reply.code(404).send({ error: "case not found" });
      }
      const evStore = new EvidenceStore(projectDir);
      let kind: EvidenceKind | undefined;
      let fileData: { filename: string; buffer: Buffer } | null = null;
      const parts = req.parts();
      for await (const part of parts) {
        if (part.type === "file") {
          const chunks: Buffer[] = [];
          for await (const c of part.file) chunks.push(c as Buffer);
          fileData = { filename: part.filename, buffer: Buffer.concat(chunks) };
        } else {
          if (part.fieldname === "kind") kind = String(part.value) as EvidenceKind;
        }
      }
      if (!fileData) return reply.code(400).send({ error: "no file" });
      if (!kind || !VALID_KINDS.has(kind)) {
        return reply.code(400).send({ error: `invalid kind: ${kind}` });
      }
      if (fileData.buffer.length > KIND_LIMITS[kind]) {
        return reply.code(413).send({ error: `${kind} exceeds limit ${KIND_LIMITS[kind]} bytes` });
      }
      const all = await Promise.all(
        (["screenshot", "recording", "generated"] as EvidenceKind[]).map((k) => evStore.listFiles(req.params.caseId, k)),
      );
      const currentTotal = all.flat().reduce((s, f) => s + f.size, 0);
      if (currentTotal + fileData.buffer.length > CASE_TOTAL_LIMIT) {
        return reply.code(409).send({ error: `case total exceeds ${CASE_TOTAL_LIMIT} bytes` });
      }
      const info = await evStore.saveFile(req.params.caseId, kind, fileData.filename, fileData.buffer);
      await buildProjectEvidence(deps, req.params.id);
      return reply.code(201).send({ ...info, kind });
    },
  );

  app.delete<{ Params: { id: string; caseId: string; kind: string; filename: string } }>(
    "/api/projects/:id/evidence/:caseId/files/:kind/:filename",
    async (req, reply) => {
      const kind = req.params.kind as EvidenceKind;
      if (!VALID_KINDS.has(kind)) return reply.code(400).send({ error: "invalid kind" });
      const projectDir = join(deps.projectsDir, req.params.id);
      const evStore = new EvidenceStore(projectDir);
      await evStore.deleteFile(req.params.caseId, kind, req.params.filename);
      await buildProjectEvidence(deps, req.params.id);
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { id: string; caseId: string; kind: string; filename: string } }>(
    "/api/projects/:id/evidence/:caseId/files/:kind/:filename",
    async (req, reply) => {
      const { id, caseId, kind, filename } = req.params;
      if (!VALID_KINDS.has(kind as EvidenceKind)) return reply.code(400).send({ error: "invalid kind" });
      if (filename.includes("/") || filename.includes("..") || filename.includes("\\")) {
        return reply.code(400).send({ error: "invalid filename" });
      }
      const { readFileSync, existsSync } = await import("node:fs");
      const { extname } = await import("node:path");
      const decoded = decodeURIComponent(filename);
      const abs = join(deps.projectsDir, id, "evidence", caseId, kind, decoded);
      if (!existsSync(abs)) return reply.code(404).send({ error: "not found" });
      const ext = extname(decoded).toLowerCase();
      const mime =
        ext === ".png" ? "image/png" :
        ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
        ext === ".gif" ? "image/gif" :
        ext === ".webp" ? "image/webp" :
        ext === ".mp4" ? "video/mp4" :
        ext === ".webm" ? "video/webm" :
        ext === ".mov" ? "video/quicktime" :
        "application/octet-stream";
      reply.header("content-type", mime);
      reply.header("cache-control", "private, max-age=3600");
      return reply.send(readFileSync(abs));
    },
  );

  const VALID_SEVERITY = new Set(["major", "minor", "positive"]);

  function validateNotesFrontmatter(fm: any, expectedCaseId: string): string | null {
    if (!fm || typeof fm !== "object") return "frontmatter required";
    if (fm.type !== "evidence_notes") return "type must be 'evidence_notes'";
    if (fm.case_id !== expectedCaseId) return `case_id must equal ${expectedCaseId}`;
    if (fm.ran_at != null && typeof fm.ran_at !== "string") return "ran_at must be string";
    if (fm.duration_min != null && (typeof fm.duration_min !== "number" || fm.duration_min < 0)) {
      return "duration_min must be non-negative number";
    }
    if (fm.quantitative != null) {
      if (typeof fm.quantitative !== "object") return "quantitative must be object";
      for (const [k, v] of Object.entries(fm.quantitative)) {
        if (k === "custom") {
          if (typeof v !== "object") return "quantitative.custom must be object";
        } else if (typeof v !== "number") {
          return `quantitative.${k} must be number`;
        }
      }
    }
    if (fm.observations != null) {
      if (!Array.isArray(fm.observations)) return "observations must be array";
      for (const [i, obs] of fm.observations.entries()) {
        if (!obs || typeof obs !== "object") return `observations[${i}] must be object`;
        if (typeof obs.point !== "string" || !obs.point) return `observations[${i}].point required`;
        if (!VALID_SEVERITY.has(obs.severity)) return `observations[${i}].severity invalid`;
        if (obs.screenshot_ref != null && typeof obs.screenshot_ref !== "string") {
          return `observations[${i}].screenshot_ref must be string`;
        }
        if (obs.generated_ref != null && typeof obs.generated_ref !== "string") {
          return `observations[${i}].generated_ref must be string`;
        }
      }
    }
    return null;
  }

  app.get<{ Params: { id: string; caseId: string } }>(
    "/api/projects/:id/evidence/:caseId/notes",
    async (req, reply) => {
      const projectDir = join(deps.projectsDir, req.params.id);
      const evStore = new EvidenceStore(projectDir);
      const notes = await evStore.readNotes(req.params.caseId);
      if (!notes) return reply.code(404).send({ error: "notes not found" });
      return reply.send(notes);
    },
  );

  app.put<{
    Params: { id: string; caseId: string };
    Body: { frontmatter: Record<string, any>; body: string };
  }>(
    "/api/projects/:id/evidence/:caseId/notes",
    async (req, reply) => {
      const body = req.body ?? ({} as any);
      const err = validateNotesFrontmatter(body.frontmatter, req.params.caseId);
      if (err) return reply.code(400).send({ error: err });
      if (typeof body.body !== "string") {
        return reply.code(400).send({ error: "body must be string" });
      }
      const projectDir = join(deps.projectsDir, req.params.id);
      const evStore = new EvidenceStore(projectDir);
      await evStore.writeNotes(req.params.caseId, {
        frontmatter: body.frontmatter,
        body: body.body,
      });
      await buildProjectEvidence(deps, req.params.id);
      return reply.send({ ok: true });
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

  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/evidence/submit",
    async (req, reply) => {
      const summary = await buildProjectEvidence(deps, req.params.id);
      const incomplete = Object.entries(summary.cases)
        .filter(([, v]) => !v.completeness.complete)
        .map(([k]) => k);
      if (incomplete.length > 0) {
        return reply.code(409).send({
          error: "not all cases complete",
          incomplete_cases: incomplete,
        });
      }
      const submitted_at = new Date().toISOString();
      await deps.store.update(req.params.id, {
        status: "evidence_ready",
        evidence: {
          cases: (await deps.store.get(req.params.id))?.evidence?.cases ?? {},
          index_path: "evidence/index.md",
          all_complete: true,
          submitted_at,
        },
      });
      return reply.send({ ok: true });
    },
  );
}
