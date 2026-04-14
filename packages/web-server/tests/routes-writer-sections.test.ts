import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { ProjectStore } from "../src/services/project-store.js";
import { ArticleStore } from "../src/services/article-store.js";
import { registerWriterRoutes } from "../src/routes/writer.js";

async function setupWithArticle() {
  const vault = mkdtempSync(join(tmpdir(), "sp05-sec-"));
  const projectsDir = join(vault, "07_projects");
  const store = new ProjectStore(projectsDir);
  const p = await store.create({ name: "T" });
  await store.update(p.id, { status: "writing_ready" });
  const pDir = join(projectsDir, p.id);
  const as = new ArticleStore(pDir);
  await as.init();
  await as.writeSection("opening", { key: "opening", frontmatter: { section: "opening", last_agent: "writer.opening", last_updated_at: "2026-04-14T00:00:00Z" }, body: "# 开头\n" + "x".repeat(300) });
  await as.writeSection("closing", { key: "closing", frontmatter: { section: "closing", last_agent: "writer.closing", last_updated_at: "2026-04-14T00:00:00Z" }, body: "结尾" });
  const app = Fastify();
  registerWriterRoutes(app, { store, projectsDir, vaultPath: vault, sqlitePath: join(vault, "kb.sqlite"), configStore: { async get() { return undefined; } } as any });
  await app.ready();
  return { app, projectId: p.id, store, projectsDir };
}

describe("GET /writer/sections", () => {
  it("returns all sections with frontmatter + preview (200 chars)", async () => {
    const { app, projectId } = await setupWithArticle();
    const res = await app.inject({ method: "GET", url: `/api/projects/${projectId}/writer/sections` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sections.map((s: any) => s.key)).toEqual(["opening", "closing"]);
    expect(body.sections[0].preview.length).toBeLessThanOrEqual(200);
    expect(body.sections[0].frontmatter.last_agent).toBe("writer.opening");
  });

  it("transitions lazy state: evidence_ready → writing_configuring", async () => {
    const vault = mkdtempSync(join(tmpdir(), "sp05-lazy-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const p = await store.create({ name: "T" });
    await store.update(p.id, { status: "evidence_ready" });
    const app = Fastify();
    registerWriterRoutes(app, { store, projectsDir, vaultPath: vault, sqlitePath: join(vault, "kb.sqlite"), configStore: { async get() { return undefined; } } as any });
    await app.ready();
    const res = await app.inject({ method: "GET", url: `/api/projects/${p.id}/writer/sections` });
    expect(res.statusCode).toBe(200);
    expect((await store.get(p.id))?.status).toBe("writing_configuring");
  });
});

describe("GET /writer/sections/:key", () => {
  it("returns full section", async () => {
    const { app, projectId } = await setupWithArticle();
    const res = await app.inject({ method: "GET", url: `/api/projects/${projectId}/writer/sections/opening` });
    expect(res.statusCode).toBe(200);
    expect(res.json().body).toContain("开头");
  });

  it("404 on unknown section key", async () => {
    const { app, projectId } = await setupWithArticle();
    const res = await app.inject({ method: "GET", url: `/api/projects/${projectId}/writer/sections/practice.case-99` });
    expect(res.statusCode).toBe(404);
  });
});

describe("PUT /writer/sections/:key", () => {
  it("writes body + updates last_agent=human, returns 200", async () => {
    const { app, projectId } = await setupWithArticle();
    const res = await app.inject({
      method: "PUT", url: `/api/projects/${projectId}/writer/sections/opening`,
      payload: { body: "# 新开头\n正文" },
    });
    expect(res.statusCode).toBe(200);
    const res2 = await app.inject({ method: "GET", url: `/api/projects/${projectId}/writer/sections/opening` });
    const body = res2.json();
    expect(body.body).toContain("新开头");
    expect(body.frontmatter.last_agent).toBe("human");
  });

  it("400 on missing body", async () => {
    const { app, projectId } = await setupWithArticle();
    const res = await app.inject({
      method: "PUT", url: `/api/projects/${projectId}/writer/sections/opening`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
