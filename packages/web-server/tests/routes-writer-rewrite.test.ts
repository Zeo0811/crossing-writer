import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";

vi.mock("@crossing/agents", async () => {
  const actual = await vi.importActual<any>("@crossing/agents");
  return {
    ...actual,
    WriterOpeningAgent: vi.fn().mockImplementation(() => ({
      write: vi.fn(async () => ({ text: "REWRITTEN OPENING", meta: { cli: "claude", model: "opus", durationMs: 10 } })),
    })),
  };
});

import { ProjectStore } from "../src/services/project-store.js";
import { ArticleStore } from "../src/services/article-store.js";
import { registerWriterRoutes } from "../src/routes/writer.js";

async function seed() {
  const vault = mkdtempSync(join(tmpdir(), "sp05-rw-"));
  const projectsDir = join(vault, "07_projects");
  const store = new ProjectStore(projectsDir);
  const p = await store.create({ name: "T" });
  await store.update(p.id, {
    status: "writing_ready",
    writer_config: {
      cli_model_per_agent: { "writer.opening": { cli: "claude", model: "opus" } },
      reference_accounts_per_agent: {},
    },
  });
  const pDir = join(projectsDir, p.id);
  mkdirSync(join(pDir, "mission"), { recursive: true });
  mkdirSync(join(pDir, "context"), { recursive: true });
  writeFileSync(join(pDir, "mission/selected.md"), "mission", "utf-8");
  writeFileSync(join(pDir, "context/product-overview.md"), "overview", "utf-8");
  const as = new ArticleStore(pDir);
  await as.init();
  await as.writeSection("opening", { key: "opening", frontmatter: { section: "opening", last_agent: "writer.opening", last_updated_at: "t" }, body: "OLD OPENING" });
  const app = Fastify();
  registerWriterRoutes(app, { store, projectsDir, vaultPath: vault, sqlitePath: join(vault, "kb.sqlite"), configStore: { async get() { return { cli: "claude", model: "opus" }; } } as any });
  await app.ready();
  return { app, store, projectId: p.id, projectsDir };
}

describe("POST /writer/sections/:key/rewrite SSE", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("streams chunk + completed events and writes file with last_agent=agent key", async () => {
    const { app, projectId, projectsDir } = await seed();
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/writer/sections/opening/rewrite`,
      payload: { user_hint: "更犀利一点" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(res.body).toContain("writer.rewrite_chunk");
    expect(res.body).toContain("writer.rewrite_completed");
    const as = new ArticleStore(join(projectsDir, projectId));
    const read = await as.readSection("opening");
    expect(read?.body).toBe("REWRITTEN OPENING");
    expect(read?.frontmatter.last_agent).toBe("writer.opening");
  });

  it("404 when section does not exist", async () => {
    const { app, projectId } = await seed();
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/writer/sections/practice.case-99/rewrite`,
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});
