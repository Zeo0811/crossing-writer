import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { ProjectStore } from "../src/services/project-store.js";
import { ArticleStore } from "../src/services/article-store.js";
import { registerWriterRoutes } from "../src/routes/writer.js";

describe("GET /writer/final", () => {
  it("returns merged final.md text (includes top frontmatter + all sections)", async () => {
    const vault = mkdtempSync(join(tmpdir(), "sp05-final-"));
    const projectsDir = join(vault, "07_projects");
    const store = new ProjectStore(projectsDir);
    const p = await store.create({ name: "T" });
    await store.update(p.id, { status: "writing_ready" });
    const as = new ArticleStore(join(projectsDir, p.id));
    await as.init();
    await as.writeSection("opening", { key: "opening", frontmatter: { section: "opening", last_agent: "a", last_updated_at: "t", reference_accounts: ["X"] }, body: "O" });
    await as.writeSection("closing", { key: "closing", frontmatter: { section: "closing", last_agent: "a", last_updated_at: "t", reference_accounts: ["Y"] }, body: "C" });
    const app = Fastify();
    registerWriterRoutes(app, { store, projectsDir, vaultPath: vault, sqlitePath: join(vault, "kb.sqlite"), configStore: { async get() { return undefined; } } as any });
    await app.ready();
    const res = await app.inject({ method: "GET", url: `/api/projects/${p.id}/writer/final` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("type: article_draft");
    expect(res.body).toContain("reference_accounts_summary");
    expect(res.body).toContain("O");
    expect(res.body).toContain("C");
  });
});
