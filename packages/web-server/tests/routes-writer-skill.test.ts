import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";

const dispatchSkill = vi.fn();

vi.mock("@crossing/kb", async () => {
  const actual = await vi.importActual<any>("@crossing/kb");
  return {
    ...actual,
    dispatchSkill: (...args: any[]) => dispatchSkill(...args),
  };
});

import { ProjectStore } from "../src/services/project-store.js";
import { registerWriterRoutes } from "../src/routes/writer.js";
import { pendingPinsStore } from "../src/state/pending-pins.js";

async function seed() {
  const vault = mkdtempSync(join(tmpdir(), "sp08-skill-"));
  const projectsDir = join(vault, "07_projects");
  const store = new ProjectStore(projectsDir);
  const p = await store.create({ name: "T" });
  const app = Fastify();
  registerWriterRoutes(app, {
    store,
    projectsDir,
    vaultPath: vault,
    sqlitePath: join(vault, "kb.sqlite"),
    configStore: { async get() { return { cli: "claude" }; } } as any,
  });
  await app.ready();
  return { app, projectId: p.id };
}

describe("POST /writer/sections/:key/skill", () => {
  beforeEach(() => { vi.clearAllMocks(); dispatchSkill.mockReset(); });

  it("successful skill invocation pushes pin", async () => {
    const { app, projectId } = await seed();
    dispatchSkill.mockResolvedValue({
      ok: true,
      tool: "search_wiki",
      query: "hello",
      args: { kind: "article" },
      hits: [{ path: "a.md", title: "A" }],
      hits_count: 1,
      formatted: "1. A",
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/writer/sections/opening/skill`,
      payload: { tool: "search_wiki", args: { query: "hello", kind: "article" } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.hits_count).toBe(1);
    const pins = pendingPinsStore.list(projectId, "opening");
    expect(pins).toHaveLength(1);
    expect(pins[0]!.ok).toBe(true);
    expect((pins[0] as any).pinned_by).toBe("manual:user");
    pendingPinsStore.clear(projectId, "opening");

    const call = dispatchSkill.mock.calls[0]![0];
    expect(call.command).toBe("search_wiki");
    expect(call.args).toContain(`"hello"`);
    expect(call.args).toContain("--kind=article");
  });

  it("unknown tool returns ok:false and does not pin", async () => {
    const { app, projectId } = await seed();
    dispatchSkill.mockResolvedValue({
      ok: false,
      tool: "bogus",
      query: "x",
      args: {},
      error: "unknown tool: bogus",
    });
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectId}/writer/sections/opening/skill`,
      payload: { tool: "bogus", args: { query: "x" } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("unknown");
    expect(pendingPinsStore.list(projectId, "opening")).toHaveLength(0);
  });

  it("returns 404 when project does not exist", async () => {
    const { app } = await seed();
    const res = await app.inject({
      method: "POST",
      url: `/api/projects/nope/writer/sections/opening/skill`,
      payload: { tool: "search_wiki", args: {} },
    });
    expect(res.statusCode).toBe(404);
  });
});
