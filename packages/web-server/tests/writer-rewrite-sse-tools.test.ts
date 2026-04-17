import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";

vi.mock("@crossing/agents", async () => {
  const actual = await vi.importActual<any>("@crossing/agents");
  return {
    ...actual,
    runWriterBookend: vi.fn(async (opts: any) => {
      opts.onEvent?.({ type: "tool_called", section_key: opts.sectionKey, agent: "writer.opening", tool: "search_raw", args: { query: "x" }, round: 1 });
      opts.onEvent?.({ type: "tool_returned", section_key: opts.sectionKey, agent: "writer.opening", tool: "search_raw", round: 1, hits_count: 2, duration_ms: 3 });
      opts.onEvent?.({ type: "tool_failed", section_key: opts.sectionKey, agent: "writer.opening", tool: "fetch_url", round: 1, duration_ms: 1, error: "net" });
      opts.onEvent?.({ type: "tool_round_completed", section_key: opts.sectionKey, agent: "writer.opening", round: 1, total_tools_in_round: 2 });
      return {
        finalText: "rewritten",
        toolsUsed: [],
        rounds: 2,
        meta: { cli: "claude", model: "opus", durationMs: 10, total_duration_ms: 10 },
      };
    }),
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
  const vault = mkdtempSync(join(tmpdir(), "sp08-rwsse-"));
  const projectsDir = join(vault, "07_projects");
  const store = new ProjectStore(projectsDir);
  const p = await store.create({ name: "T" });
  await store.update(p.id, {
    status: "writing_ready",
    article_type: "实测",
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
  return { app, projectId: p.id };
}

describe("rewrite SSE forwards tool_* events", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("emits writer.tool_called/tool_returned/tool_failed/tool_round_completed during rewrite", async () => {
    const { app, projectId } = await seed();
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/writer/sections/opening/rewrite`,
      payload: { user_hint: "改短" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("event: writer.tool_called");
    expect(res.body).toContain("event: writer.tool_returned");
    expect(res.body).toContain("event: writer.tool_failed");
    expect(res.body).toContain("event: writer.tool_round_completed");
    expect(res.body).toContain("writer.rewrite_completed");
  });
});
