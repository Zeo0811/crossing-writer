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
      write: vi.fn(async () => ({ text: "rewritten", meta: { cli: "claude", model: "opus", durationMs: 10 } })),
    })),
    runWriterOpening: vi.fn(async () => ({
      finalText: "rewritten", toolsUsed: [], rounds: 1,
      meta: { cli: "claude", model: "opus", durationMs: 10, total_duration_ms: 10 },
    })),
  };
});

import { ProjectStore } from "../src/services/project-store.js";
import { ArticleStore } from "../src/services/article-store.js";
import { registerWriterRoutes } from "../src/routes/writer.js";
import { pendingPinsStore } from "../src/state/pending-pins.js";

async function seed() {
  const vault = mkdtempSync(join(tmpdir(), "sp08-rwtool-"));
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
  await as.writeSection("opening", {
    key: "opening",
    frontmatter: { section: "opening", last_agent: "writer.opening", last_updated_at: "t" },
    body: "OLD",
  });
  const app = Fastify();
  registerWriterRoutes(app, {
    store,
    projectsDir,
    vaultPath: vault,
    sqlitePath: join(vault, "kb.sqlite"),
    configStore: { async get() { return { cli: "claude", model: "opus" }; } } as any,
  });
  await app.ready();
  return { app, store, projectId: p.id, projectsDir };
}

describe("POST /writer/sections/:key/rewrite with pinned skills", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("consumes pending pins, writes tools_used frontmatter, clears pins", async () => {
    const { app, projectId, projectsDir } = await seed();
    pendingPinsStore.push(projectId, "opening", {
      ok: true,
      tool: "search_wiki",
      query: "hello",
      args: { kind: "article" },
      hits: [],
      hits_count: 2,
      formatted: "pinned content here",
      pinned_by: "manual:user",
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/writer/sections/opening/rewrite`,
      payload: { user_hint: "tighter" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("writer.rewrite_completed");

    const as = new ArticleStore(join(projectsDir, projectId));
    const read = await as.readSection("opening");
    expect(read?.body).toBe("rewritten");
    const tu = (read?.frontmatter as any).tools_used;
    expect(Array.isArray(tu)).toBe(true);
    expect(tu).toHaveLength(1);
    expect(tu[0].tool).toBe("search_wiki");
    expect(tu[0].pinned_by).toBe("manual:user");
    expect(tu[0].hits_count).toBe(2);
    expect(pendingPinsStore.list(projectId, "opening")).toHaveLength(0);
  });

  it("include_pinned_skills:false does not clear pins or add tools_used", async () => {
    const { app, projectId, projectsDir } = await seed();
    pendingPinsStore.push(projectId, "opening", {
      ok: true,
      tool: "search_wiki",
      query: "hi",
      args: {},
      hits: [],
      hits_count: 1,
      formatted: "x",
      pinned_by: "manual:user",
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/writer/sections/opening/rewrite`,
      payload: { user_hint: "tighter", include_pinned_skills: false },
    });
    expect(res.statusCode).toBe(200);

    const as = new ArticleStore(join(projectsDir, projectId));
    const read = await as.readSection("opening");
    expect((read?.frontmatter as any).tools_used).toBeUndefined();
    expect(pendingPinsStore.list(projectId, "opening")).toHaveLength(1);
    pendingPinsStore.clear(projectId, "opening");
  });
});
