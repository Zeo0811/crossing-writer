import type { FastifyInstance } from "fastify";
import { readdir, stat, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename, normalize } from "node:path";
import { spawn } from "node:child_process";
import type { ProjectStore } from "../services/project-store.js";

export interface ProjectTreeDeps {
  store: ProjectStore;
  projectsDir: string;
}

interface TreeNode {
  name: string;
  type: "dir" | "file";
  path: string; // relative to project root
  children?: TreeNode[];
  size?: number;
  mtime?: string;
}

const IGNORED_NAMES = new Set([
  ".DS_Store",
  ".obsidian",
]);

const MAX_DEPTH = 4;

async function walk(abs: string, rel: string, depth: number): Promise<TreeNode> {
  const s = await stat(abs);
  if (!s.isDirectory()) {
    return {
      name: basename(abs),
      type: "file",
      path: rel,
      size: s.size,
      mtime: s.mtime.toISOString(),
    };
  }
  const node: TreeNode = {
    name: basename(abs) || "/",
    type: "dir",
    path: rel,
    children: [],
    mtime: s.mtime.toISOString(),
  };
  if (depth >= MAX_DEPTH) return node;
  const entries = await readdir(abs, { withFileTypes: true });
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".gitkeep") continue;
    if (IGNORED_NAMES.has(e.name)) continue;
    const childAbs = join(abs, e.name);
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    try {
      node.children!.push(await walk(childAbs, childRel, depth + 1));
    } catch { /* unreadable, skip */ }
  }
  return node;
}

export function registerProjectTreeRoutes(app: FastifyInstance, deps: ProjectTreeDeps) {
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/tree",
    async (req, reply) => {
      const project = await deps.store.get(req.params.id);
      if (!project) return reply.code(404).send({ error: "project not found" });
      const projectDir = join(deps.projectsDir, req.params.id);
      try {
        const root = await walk(projectDir, "", 0);
        return reply.send({ root });
      } catch (err: any) {
        return reply.code(500).send({ error: String(err?.message ?? err) });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/open-folder",
    async (req, reply) => {
      const project = await deps.store.get(req.params.id);
      if (!project) return reply.code(404).send({ error: "project not found" });
      const projectDir = join(deps.projectsDir, req.params.id);
      if (process.platform !== "darwin") {
        return reply.code(501).send({ error: "open-folder only supported on macOS" });
      }
      try {
        const proc = spawn("open", [projectDir], { detached: true, stdio: "ignore" });
        proc.unref();
        return reply.send({ ok: true, path: projectDir });
      } catch (err: any) {
        return reply.code(500).send({ error: String(err?.message ?? err) });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/agent/stop",
    async (req, reply) => {
      const project = await deps.store.get(req.params.id);
      if (!project) return reply.code(404).send({ error: "project not found" });
      // Best-effort: no central registry of running spawn PIDs per project yet.
      // Return 501 with a clear message so UI can show the button but indicate the capability isn't wired.
      return reply.code(501).send({
        error: "agent stop not yet implemented",
        detail: "No central spawn registry wired up; manually Ctrl+C the CLI process or kill it.",
      });
    },
  );

  // Serve agent run artifacts (prompt.txt / response.txt / stderr.txt / meta.json)
  // Path format: /api/projects/:id/runs/:runId/:file
  // runId is sanitized agent-key-timestamped (e.g. 2026-04-16T15-50-00Z-brief_analyst)
  const ALLOWED_FILES = new Set(["prompt.txt", "response.txt", "stderr.txt", "meta.json", "trace.ndjson"]);
  const RUN_ID_RE = /^[\w.-]+$/;
  app.get<{ Params: { id: string; runId: string; file: string } }>(
    "/api/projects/:id/runs/:runId/:file",
    async (req, reply) => {
      const { id, runId, file } = req.params;
      if (!RUN_ID_RE.test(runId)) return reply.code(400).send({ error: "invalid runId" });
      if (!ALLOWED_FILES.has(file)) return reply.code(400).send({ error: "invalid file" });
      const project = await deps.store.get(id);
      if (!project) return reply.code(404).send({ error: "project not found" });
      const projectDir = join(deps.projectsDir, id);
      const abs = normalize(join(projectDir, "runs", runId, file));
      // Ensure still under projectDir/runs
      if (!abs.startsWith(join(projectDir, "runs") + "/") && abs !== join(projectDir, "runs", runId, file)) {
        return reply.code(400).send({ error: "path escape" });
      }
      if (!existsSync(abs)) return reply.code(404).send({ error: "not found" });
      const content = await readFile(abs, "utf-8");
      if (file === "meta.json") {
        reply.header("content-type", "application/json; charset=utf-8");
      } else {
        reply.header("content-type", "text/plain; charset=utf-8");
      }
      return content;
    },
  );
}
