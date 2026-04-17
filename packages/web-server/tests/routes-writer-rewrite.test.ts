import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";

vi.mock("@crossing/agents", async () => {
  const actual = await vi.importActual<any>("@crossing/agents");
  return {
    ...actual,
    runWriterBookend: vi.fn(async () => ({
      finalText: "REWRITTEN OPENING", toolsUsed: [], rounds: 1,
      meta: { cli: "claude", model: "opus", durationMs: 10, total_duration_ms: 10 },
    })),
    renderHardRulesBlock: vi.fn(() => "## 写作硬规则（绝对不允许违反）\n"),
  };
});
vi.mock("../src/services/style-binding-resolver.js", async () => {
  return {
    resolveStyleBindingV2: vi.fn(async () => ({
      panel: { frontmatter: { banned_vocabulary: [] } },
      typeSection: "STYLE-SECTION",
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
    article_type: "实测",
    writer_config: {
      cli_model_per_agent: { "writer.opening": { cli: "claude", model: "opus" } },
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
  registerWriterRoutes(app, {
    store,
    projectsDir,
    vaultPath: vault,
    sqlitePath: join(vault, "kb.sqlite"),
    configStore: { current: { agents: {}, defaultModel: { writer: { cli: 'claude', model: 'opus' }, other: { cli: 'claude', model: 'opus' } } } } as any,
    agentConfigStore: {
      get: (_key: string) => ({
        agentKey: _key,
        model: { cli: "claude" },
        styleBinding: { account: "test-account", role: "opening" },
      }),
    } as any,
    stylePanelStore: {} as any,
    hardRulesStore: {
      read: async () => ({
        version: 1 as const,
        updated_at: "2026-01-01T00:00:00Z",
        banned_phrases: [],
        banned_vocabulary: [],
        layout_rules: [],
      }),
    } as any,
  });
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
