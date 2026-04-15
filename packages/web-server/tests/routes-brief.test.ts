import { describe, it, expect, vi } from "vitest";

vi.mock("@crossing/agents", () => ({
  stripAgentPreamble: (s: string) => s,
  BriefAnalyst: class {
    analyze() { return { text: "---\ntype: brief_summary\n---\nok", meta: { cli: "codex", durationMs: 1 } }; }
  },
  resolveAgent: (_cfg: any, _key: string) => ({ cli: _cfg.modelAdapter.defaultCli }),
}));
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { registerProjectsRoutes } from "../src/routes/projects.js";
import { registerBriefRoutes } from "../src/routes/brief.js";
import { ProjectStore } from "../src/services/project-store.js";

async function mkApp() {
  const vault = mkdtempSync(join(tmpdir(), "vault-"));
  const projectsDir = join(vault, "07_projects");
  const store = new ProjectStore(projectsDir);
  const app = Fastify();
  await app.register(multipart);
  registerProjectsRoutes(app, { store });
  registerBriefRoutes(app, { store, projectsDir, cli: "codex", agents: {}, defaultCli: "codex", fallbackCli: "claude" });
  await app.ready();
  const created = (await app.inject({ method: "POST", url: "/api/projects", payload: { name: "T" } })).json();
  return { app, store, project: created, projectsDir };
}

describe("brief route", () => {
  it("accepts plain text brief and saves brief.md + updates project status", async () => {
    const { app, store, project, projectsDir } = await mkApp();
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/brief`,
      payload: {
        text: "# Brief\n\nHello world.",
        productName: "ACME",
        productUrl: null,
        notes: "urgent",
      },
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(200);
    const updated = await store.get(project.id);
    expect(updated!.status).toBe("brief_uploaded");
    expect(updated!.brief!.source_type).toBe("text");
    const mdPath = join(projectsDir, project.id, updated!.brief!.md_path);
    expect(existsSync(mdPath)).toBe(true);
    expect(readFileSync(mdPath, "utf-8")).toMatch(/Hello world/);
    expect(updated!.product_info!.name).toBe("ACME");
    expect(updated!.product_info!.notes).toBe("urgent");
  });

  it("rejects missing text and missing file", async () => {
    const { app, project } = await mkApp();
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/brief`,
      payload: {},
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for missing project", async () => {
    const { app } = await mkApp();
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/does-not-exist/brief`,
      payload: { text: "x" },
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("writes events.jsonl entry on upload", async () => {
    const { app, project, projectsDir } = await mkApp();
    await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/brief`,
      payload: { text: "brief text" },
      headers: { "content-type": "application/json" },
    });
    const eventsPath = join(projectsDir, project.id, "events.jsonl");
    expect(existsSync(eventsPath)).toBe(true);
    const content = readFileSync(eventsPath, "utf-8");
    expect(content).toMatch(/state_changed/);
    expect(content).toMatch(/brief_uploaded/);
  });
});
