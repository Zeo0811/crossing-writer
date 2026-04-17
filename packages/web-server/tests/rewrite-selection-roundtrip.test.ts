import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";

vi.mock("@crossing/agents", async () => {
  const actual = await vi.importActual<any>("@crossing/agents");
  return {
    ...actual,
    invokeAgent: vi.fn(() => ({
      text: "",
      meta: { cli: "claude", model: "opus", durationMs: 1 },
    })),
    runWriterBookend: vi.fn(async () => ({
      finalText: "NEWTEXT",
      toolsUsed: [],
      rounds: 1,
    })),
    runWriterPractice: vi.fn(async () => ({
      finalText: "NEWTEXT",
      toolsUsed: [],
      rounds: 1,
    })),
  };
});
vi.mock("@crossing/kb", async () => {
  const actual = await vi.importActual<any>("@crossing/kb");
  return { ...actual, dispatchSkill: vi.fn() };
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
import { registerWriterRewriteSelectionRoutes } from "../src/routes/writer-rewrite-selection.js";

function makeBookendDeps(projectsDir: string, store: ProjectStore) {
  return {
    store,
    projectsDir,
    vaultPath: "/tmp/v",
    sqlitePath: "/tmp/kb.sqlite",
    configStore: {
      async get() {
        return { cli: "claude" };
      },
    } as any,
    agentConfigStore: {
      get: (_key: string) => ({
        agentKey: _key,
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
  };
}

async function seedWithBody(body: string, frontmatterExtra: any = {}) {
  const projectsDir = mkdtempSync(join(tmpdir(), "sp09-sel-rt-"));
  const store = new ProjectStore(projectsDir);
  const p = await store.create({ name: "T" });
  await store.update(p.id, { article_type: "实测" } as any);
  const pDir = join(projectsDir, p.id);
  const articles = new ArticleStore(pDir);
  await articles.init();
  await articles.writeSection("opening", {
    key: "opening",
    frontmatter: {
      section: "opening",
      last_agent: "writer.opening",
      last_updated_at: "x",
      ...frontmatterExtra,
    },
    body,
  });
  const app = Fastify();
  registerWriterRewriteSelectionRoutes(app, makeBookendDeps(projectsDir, store));
  await app.ready();
  return { app, projectId: p.id, articles };
}

describe("rewrite-selection round-trip: body replace + tools_used merge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("replaces only the selected substring inside a middle paragraph", async () => {
    const agents = (await import("@crossing/agents")) as any;
    agents.runWriterBookend.mockImplementationOnce(async () => ({
      finalText: "MIDDLE-NEW",
      toolsUsed: [],
      rounds: 1,
    }));
    const body =
      "First paragraph stays.\n\n" +
      "Middle paragraph contains MIDDLE-OLD token here.\n\n" +
      "Third paragraph stays.";
    const { app, projectId, articles } = await seedWithBody(body);
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/writer/sections/opening/rewrite-selection`,
      payload: { selected_text: "MIDDLE-OLD", user_prompt: "replace middle" },
    });
    expect(res.statusCode).toBe(200);
    const saved = await articles.readSection("opening");
    expect(saved!.body).toBe(
      "First paragraph stays.\n\n" +
        "Middle paragraph contains MIDDLE-NEW token here.\n\n" +
        "Third paragraph stays.",
    );
    // Only the middle paragraph's fragment changed.
    expect(saved!.body).toContain("First paragraph stays.");
    expect(saved!.body).toContain("Third paragraph stays.");
    expect(saved!.body).not.toContain("MIDDLE-OLD");
  });

  it("accumulates tools_used across two sequential rewrite calls (append, no dedupe)", async () => {
    const agents = (await import("@crossing/agents")) as any;
    agents.runWriterBookend
      .mockImplementationOnce(async () => ({
        finalText: "FIRST",
        toolsUsed: [
          {
            tool: "search_wiki",
            query: "AI",
            args: {},
            pinned_by: "auto",
            round: 1,
            hits_count: 2,
            hits_summary: [],
          },
        ],
        rounds: 1,
      }))
      .mockImplementationOnce(async () => ({
        finalText: "SECOND",
        toolsUsed: [
          {
            tool: "search_wiki",
            query: "ML",
            args: {},
            pinned_by: "auto",
            round: 1,
            hits_count: 3,
            hits_summary: [],
          },
          {
            tool: "read_page",
            query: "",
            args: { id: "p1" },
            pinned_by: "user",
            round: 2,
            hits_count: 1,
            hits_summary: [],
          },
        ],
        rounds: 2,
      }));
    const { app, projectId, articles } = await seedWithBody(
      "alpha OLD1 beta OLD2 gamma",
    );

    const r1 = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/writer/sections/opening/rewrite-selection`,
      payload: { selected_text: "OLD1", user_prompt: "first" },
    });
    expect(r1.statusCode).toBe(200);
    const afterFirst = await articles.readSection("opening");
    expect(afterFirst!.body).toBe("alpha FIRST beta OLD2 gamma");
    expect((afterFirst!.frontmatter as any).tools_used).toHaveLength(1);

    const r2 = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/writer/sections/opening/rewrite-selection`,
      payload: { selected_text: "OLD2", user_prompt: "second" },
    });
    expect(r2.statusCode).toBe(200);
    const afterSecond = await articles.readSection("opening");
    expect(afterSecond!.body).toBe("alpha FIRST beta SECOND gamma");
    const tools = (afterSecond!.frontmatter as any).tools_used as any[];
    // Append, not dedupe: prior (1) + new (2) = 3. Same tool name search_wiki
    // appears twice (once from first call, once from second).
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.tool)).toEqual([
      "search_wiki",
      "search_wiki",
      "read_page",
    ]);
    expect(tools[0].query).toBe("AI");
    expect(tools[1].query).toBe("ML");
  });
});
