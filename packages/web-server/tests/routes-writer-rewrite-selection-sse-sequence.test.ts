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
    runWriterBookend: vi.fn(async ({ onEvent, sectionKey, role }: any) => {
      onEvent?.({
        type: "tool_called",
        section_key: sectionKey,
        agent: role === "opening" ? "writer.opening" : "writer.closing",
        tool: "search_kb",
        args: ["foo"],
      });
      onEvent?.({
        type: "tool_returned",
        section_key: sectionKey,
        agent: role === "opening" ? "writer.opening" : "writer.closing",
        tool: "search_kb",
        ok: true,
        duration_ms: 5,
      });
      onEvent?.({
        type: "tool_round_completed",
        section_key: sectionKey,
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
  };
}

async function seed() {
  const projectsDir = mkdtempSync(join(tmpdir(), "sp09-sel-seq-"));
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

describe("POST rewrite-selection — SSE full event sequence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits started → tool_called → tool_returned → tool_round_completed → selection_rewritten → completed in order", async () => {
    const { app, projectId } = await seed();
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/writer/sections/opening/rewrite-selection`,
      payload: {
        selected_text: "OLDTEXT",
        user_prompt: "rewrite it",
        references: [],
      },
    });
    expect(res.statusCode).toBe(200);

    const eventLines = res.body
      .split("\n")
      .filter((l) => l.startsWith("event:"))
      .map((l) => l.replace(/^event:\s*/, ""));

    expect(eventLines[0]).toBe("writer.started");
    expect(eventLines[eventLines.length - 1]).toBe("writer.completed");

    const expected = [
      "writer.started",
      "writer.tool_called",
      "writer.tool_returned",
      "writer.tool_round_completed",
      "writer.selection_rewritten",
      "writer.completed",
    ];
    const positions = expected.map((ev) => eventLines.indexOf(ev));
    for (const pos of positions) expect(pos).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it("started payload carries sectionKey + ts; selection_rewritten carries section_key + ts", async () => {
    const { app, projectId } = await seed();
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/writer/sections/opening/rewrite-selection`,
      payload: { selected_text: "OLDTEXT", user_prompt: "p" },
    });
    expect(res.statusCode).toBe(200);

    // Parse frames: each frame is `event: X\ndata: JSON\n\n`
    const frames = res.body.split("\n\n").filter((f) => f.trim().length > 0);
    const parsed = frames.map((f) => {
      const evLine = f.split("\n").find((l) => l.startsWith("event:"))!;
      const dataLine = f.split("\n").find((l) => l.startsWith("data:"))!;
      return {
        event: evLine.replace(/^event:\s*/, ""),
        data: JSON.parse(dataLine.replace(/^data:\s*/, "")),
      };
    });

    const started = parsed.find((p) => p.event === "writer.started")!;
    expect(started.data.sectionKey).toBe("opening");
    expect(typeof started.data.ts).toBe("number");

    const rewritten = parsed.find(
      (p) => p.event === "writer.selection_rewritten",
    )!;
    expect(rewritten.data.section_key).toBe("opening");
    expect(rewritten.data.new_text).toBe("NEWTEXT");
    expect(typeof rewritten.data.ts).toBe("number");

    const completed = parsed.find((p) => p.event === "writer.completed")!;
    expect(typeof completed.data.ts).toBe("number");

    const toolCalled = parsed.find((p) => p.event === "writer.tool_called")!;
    expect(toolCalled.data.section_key).toBe("opening");
    expect(typeof toolCalled.data.ts).toBe("number");
  });
});
