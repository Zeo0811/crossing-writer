import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

// Mock @crossing/agents BEFORE importing buildApp so both the distill
// orchestrator (runSectionSlicer + StyleDistiller* agents) and the
// writer-orchestrator (runWriterOpening/Practice/Closing/Stitcher) pick up
// canned responses. Keep real exports for everything else.
vi.mock("@crossing/agents", async () => {
  const actual = await vi.importActual<any>("@crossing/agents");
  return {
    ...actual,
    runSectionSlicer: vi.fn(async () => ({
      slices: [
        { start_char: 0, end_char: 10, role: "opening" },
        { start_char: 10, end_char: 20, role: "practice" },
        { start_char: 20, end_char: 30, role: "closing" },
      ],
      meta: { cli: "claude", model: null, durationMs: 1 },
    })),
    StyleDistillerSnippetsAgent: vi.fn().mockImplementation(() => ({
      harvest: vi.fn(async () => ({
        candidates: [
          { tag: "hook", from: "a1", excerpt: "hook excerpt", position_ratio: 0.1, length: 10 },
        ],
        meta: { cli: "claude", model: null, durationMs: 1 },
      })),
    })),
    StyleDistillerStructureAgent: vi.fn().mockImplementation(() => ({
      distill: vi.fn(async () => ({
        text: "# Structure\n\n- punchy openings\n",
        meta: { cli: "claude", model: null, durationMs: 1 },
      })),
    })),
    StyleDistillerComposerAgent: vi.fn().mockImplementation(() => ({
      compose: vi.fn(async () => ({
        kbMd: "# 十字路口 opening 风格 v1\n\n短句多，钩子强。",
        meta: { cli: "claude", model: null, durationMs: 1 },
      })),
    })),
    runWriterOpening: vi.fn(async (opts: any) => ({
      finalText: "OPENING_FINAL",
      toolsUsed: [],
      rounds: 1,
      meta: { cli: "claude", model: "opus", durationMs: 1, total_duration_ms: 1 },
      __captured: opts,
    })),
    runWriterPractice: vi.fn(async () => ({
      finalText: "PRACTICE_FINAL",
      toolsUsed: [],
      rounds: 1,
      meta: { cli: "claude", model: "opus", durationMs: 1, total_duration_ms: 1 },
    })),
    runWriterClosing: vi.fn(async () => ({
      finalText: "CLOSING_FINAL",
      toolsUsed: [],
      rounds: 1,
      meta: { cli: "claude", model: "opus", durationMs: 1, total_duration_ms: 1 },
    })),
    runStyleCritic: vi.fn(async () => ({
      finalText: "NO_CHANGES",
      toolsUsed: [],
      rounds: 1,
      meta: { cli: "claude", model: "opus", durationMs: 1, total_duration_ms: 1 },
    })),
    PracticeStitcherAgent: vi.fn().mockImplementation(() => ({
      stitch: vi.fn(async () => ({
        transitions: {},
        meta: { cli: "claude", durationMs: 1 },
      })),
    })),
  };
});

let tmpRoot: string;
let vaultPath: string;
let sqlitePath: string;
let configPath: string;
let projectsDir: string;
let prevConfigEnv: string | undefined;

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "sp10-e2e-"));
  vaultPath = join(tmpRoot, "vault");
  projectsDir = join(vaultPath, "07_projects");
  const stylePanelDir = join(vaultPath, "08_experts", "style-panel");
  mkdirSync(projectsDir, { recursive: true });
  mkdirSync(stylePanelDir, { recursive: true });

  // Seed sqlite with ref_articles for account 十字路口
  sqlitePath = join(tmpRoot, "refs.sqlite");
  const db = new Database(sqlitePath);
  db.exec(`CREATE TABLE ref_articles (
    id TEXT PRIMARY KEY,
    account TEXT,
    body_plain TEXT,
    published_at TEXT
  );`);
  const body = "opening..__practice__closing...\n";
  const ins = db.prepare(
    "INSERT INTO ref_articles (id, account, body_plain, published_at) VALUES (@id, @account, @body, @published_at)",
  );
  for (let i = 1; i <= 3; i++) {
    ins.run({
      id: `a${i}`,
      account: "十字路口",
      body,
      published_at: `2026-04-0${i}`,
    });
  }
  db.close();

  // Seed config.json with styleBinding for all three writer agents
  configPath = join(tmpRoot, "config.json");
  const configJson = {
    vaultPath,
    sqlitePath,
    modelAdapter: { defaultCli: "claude", fallbackCli: "claude" },
    agents: {
      "writer.opening": {
        agentKey: "writer.opening",
        model: { cli: "claude", model: "opus" },
        styleBinding: { account: "十字路口", role: "opening" },
      },
      "writer.practice": {
        agentKey: "writer.practice",
        model: { cli: "claude", model: "opus" },
        styleBinding: { account: "十字路口", role: "practice" },
      },
      "writer.closing": {
        agentKey: "writer.closing",
        model: { cli: "claude", model: "opus" },
        styleBinding: { account: "十字路口", role: "closing" },
      },
    },
  };
  writeFileSync(configPath, JSON.stringify(configJson, null, 2), "utf-8");

  // Pre-seed practice/closing panels so only opening needs distilling.
  // (Opening will be produced by the distill SSE in the test itself.)
  const stylePanelDir2 = join(stylePanelDir, "十字路口");
  mkdirSync(stylePanelDir2, { recursive: true });
  writeFileSync(
    join(stylePanelDir2, "practice-v1.md"),
    [
      "---",
      "account: 十字路口",
      "role: practice",
      "version: 1",
      "status: active",
      "created_at: 2026-04-01T00:00:00Z",
      "source_article_count: 3",
      "---",
      "# 十字路口 practice 风格 v1",
      "",
      "实测部分：亲测、具体操作。",
    ].join("\n"),
    "utf-8",
  );
  writeFileSync(
    join(stylePanelDir2, "closing-v1.md"),
    [
      "---",
      "account: 十字路口",
      "role: closing",
      "version: 1",
      "status: active",
      "created_at: 2026-04-01T00:00:00Z",
      "source_article_count: 3",
      "---",
      "# 十字路口 closing 风格 v1",
      "",
      "结尾：金句收束。",
    ].join("\n"),
    "utf-8",
  );

  prevConfigEnv = process.env.CROSSING_CONFIG;
  process.env.CROSSING_CONFIG = configPath;
});

afterAll(() => {
  if (prevConfigEnv === undefined) delete process.env.CROSSING_CONFIG;
  else process.env.CROSSING_CONFIG = prevConfigEnv;
});

function serverConfig() {
  return {
    vaultPath,
    sqlitePath,
    projectsDir,
    expertsDir: join(vaultPath, "08_experts"),
    defaultCli: "claude" as const,
    fallbackCli: "claude" as const,
    agents: {} as Record<string, unknown>,
    configPath,
  } as any;
}

async function waitForEvent(
  readEvents: () => Promise<any[]>,
  predicate: (ev: any) => boolean,
  timeoutMs = 5000,
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const evs = await readEvents();
    const hit = evs.find(predicate);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("event wait timeout");
}

describe("SP-10 e2e: distill SSE + writer-run with styleBinding", () => {
  it("happy path", async () => {
    const { buildApp } = await import("../src/server.js");
    const app = await buildApp(serverConfig());
    await app.ready();

    try {
      // 1. distill → SSE body contains expected events in order
      const distillRes = await app.inject({
        method: "POST",
        url: "/api/config/style-panels/distill",
        payload: { account: "十字路口", role: "opening" },
      });
      expect(distillRes.statusCode).toBe(200);
      const body = distillRes.body;
      expect(body).toContain("event: distill.started");
      expect(body).toContain("event: distill.slicer_progress");
      expect(body).toContain("event: distill.composer_done");
      expect(body).toContain("event: distill.finished");
      const iStarted = body.indexOf("distill.started");
      const iProg = body.indexOf("distill.slicer_progress");
      const iComposer = body.indexOf("distill.composer_done");
      const iFinished = body.indexOf("distill.finished");
      expect(iStarted).toBeLessThan(iProg);
      expect(iProg).toBeLessThan(iComposer);
      expect(iComposer).toBeLessThan(iFinished);

      // 2. list panels → new opening v1 for 十字路口 shows up as active
      const listRes = await app.inject({
        method: "GET",
        url: "/api/config/style-panels",
      });
      expect(listRes.statusCode).toBe(200);
      const { panels } = JSON.parse(listRes.body) as { panels: any[] };
      const opening = panels.find(
        (p) =>
          p.account === "十字路口" && p.role === "opening" && p.status === "active",
      );
      expect(opening).toBeTruthy();
      expect(opening.version).toBe(1);

      // 3. Create project + seed evidence_ready state so writer/start will run
      const projRes = await app.inject({
        method: "POST",
        url: "/api/projects",
        payload: { name: "sp10 e2e project" },
      });
      expect(projRes.statusCode).toBe(201);
      const project = JSON.parse(projRes.body) as any;
      const pDir = join(projectsDir, project.id);

      // Seed writer-run filesystem inputs
      mkdirSync(join(pDir, "mission/case-plan"), { recursive: true });
      mkdirSync(join(pDir, "context"), { recursive: true });
      mkdirSync(join(pDir, "evidence/case-01/screenshots"), { recursive: true });
      mkdirSync(join(pDir, "brief"), { recursive: true });
      writeFileSync(join(pDir, "brief/brief.md"), "brief body\n", "utf-8");
      writeFileSync(join(pDir, "mission/selected.md"), "mission body\n", "utf-8");
      writeFileSync(
        join(pDir, "context/product-overview.md"),
        "product overview\n",
        "utf-8",
      );
      writeFileSync(
        join(pDir, "mission/case-plan/selected-cases.md"),
        "---\n---\n\n# Case 1 — First\ndesc\n",
        "utf-8",
      );
      writeFileSync(
        join(pDir, "evidence/case-01/notes.md"),
        "---\ncase_id: case-01\n---\nnotes body\n",
        "utf-8",
      );

      // Force project into evidence_ready (writer route gate)
      await app.projectStore.update(project.id, { status: "evidence_ready" });

      // 4. Kick off writer-run
      const runRes = await app.inject({
        method: "POST",
        url: `/api/projects/${project.id}/writer/start`,
        payload: {},
      });
      expect(runRes.statusCode).toBe(200);

      // 5. Wait for runWriter to produce the opening section via event log
      const { readEvents } = await import("../src/services/event-log.js");
      await waitForEvent(
        () => readEvents(pDir),
        (ev) => ev.type === "writer.section_completed" && ev.data?.section_key === "opening",
        8000,
      );

      // 6. Assert runWriterOpening received a pinnedContext carrying the Style
      //    Reference header + body from the freshly-distilled opening panel.
      const agents = await import("@crossing/agents");
      const calls = (agents.runWriterOpening as any).mock.calls as any[];
      expect(calls.length).toBeGreaterThan(0);
      const first = calls[0][0];
      expect(first.pinnedContext).toBeTruthy();
      expect(first.pinnedContext).toContain(
        "# Style Reference — 十字路口/opening v1",
      );
      expect(first.pinnedContext).toContain("短句多");
    } finally {
      await app.close();
    }
  }, 30_000);
});
