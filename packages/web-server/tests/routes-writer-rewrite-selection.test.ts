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
    runWriterBookend: vi.fn(async ({ onEvent, role }: any) => {
      onEvent?.({
        type: "tool_round_completed",
        agent: role === "opening" ? "writer.opening" : "writer.closing",
        round: 1,
      });
      return { finalText: "NEWTEXT", toolsUsed: [], rounds: 1 };
    }),
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

async function seed() {
  const projectsDir = mkdtempSync(join(tmpdir(), "sp09-sel-"));
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
    },
    body: "hello OLDTEXT world",
  });
  const app = Fastify();
  registerWriterRewriteSelectionRoutes(app, makeBookendDeps(projectsDir, store));
  await app.ready();
  return { app, projectId: p.id, projectsDir, articles };
}

describe("POST rewrite-selection — validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("400 when selected_text missing from body", async () => {
    const { app, projectId } = await seed();
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/writer/sections/opening/rewrite-selection`,
      payload: { selected_text: "NOPE", user_prompt: "x" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 on unsupported section key", async () => {
    const { app, projectId } = await seed();
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/writer/sections/brief/rewrite-selection`,
      payload: { selected_text: "x", user_prompt: "y" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404 when project missing", async () => {
    const { app } = await seed();
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/nope/writer/sections/opening/rewrite-selection`,
      payload: { selected_text: "x", user_prompt: "y" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("400 when selected_text/user_prompt missing", async () => {
    const { app, projectId } = await seed();
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/writer/sections/opening/rewrite-selection`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("happy path: rewrites first match, writes section, emits selection_rewritten", async () => {
    const { app, projectId, projectsDir } = await seed();
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/writer/sections/opening/rewrite-selection`,
      payload: { selected_text: "OLDTEXT", user_prompt: "make it snappier" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("writer.selection_rewritten");
    expect(res.body).toContain("NEWTEXT");
    const articles = new ArticleStore(join(projectsDir, projectId));
    const read = await articles.readSection("opening");
    expect(read?.body).toBe("hello NEWTEXT world");
  });

  it("multiple matches → picks first, emits match_index:0", async () => {
    const projectsDir = mkdtempSync(join(tmpdir(), "sp09-sel-multi-"));
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
      },
      body: "DUP start DUP end",
    });
    const app = Fastify();
    registerWriterRewriteSelectionRoutes(app, makeBookendDeps(projectsDir, store));
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${p.id}/writer/sections/opening/rewrite-selection`,
      payload: { selected_text: "DUP", user_prompt: "p" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"match_index":0');
    const read = await articles.readSection("opening");
    expect(read?.body).toBe("NEWTEXT start DUP end");
  });
});
