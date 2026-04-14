import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerConfigStylePanelsDistillRoutes } from "../src/routes/config-style-panels-distill.js";

describe("config-style-panels distill SSE route", () => {
  it("streams started -> slicer_progress -> snippets_done -> structure_done -> composer_done -> finished", async () => {
    const fakeRun = vi.fn(async (input: any, ctx: any) => {
      ctx.onEvent({ phase: "started", account: input.account, role: input.role, run_id: "rd-1" });
      ctx.onEvent({ phase: "slicer_progress", processed: 1, total: 2 });
      ctx.onEvent({ phase: "snippets_done", count: 4 });
      ctx.onEvent({ phase: "structure_done" });
      ctx.onEvent({ phase: "composer_done", panel_path: "/tmp/p.md" });
      return { panelPath: "/tmp/p.md", version: 3 };
    });
    const app = Fastify();
    registerConfigStylePanelsDistillRoutes(app, {
      vaultPath: "/tmp",
      sqlitePath: "/tmp/x.db",
      stylePanelStore: {} as any,
      runRoleDistill: fakeRun as any,
    });
    const r = await app.inject({
      method: "POST",
      url: "/api/config/style-panels/distill",
      payload: { account: "A", role: "opening" },
    });
    expect(r.body).toContain("event: distill.started");
    expect(r.body).toContain("event: distill.slicer_progress");
    expect(r.body).toContain("event: distill.snippets_done");
    expect(r.body).toContain("event: distill.structure_done");
    expect(r.body).toContain("event: distill.composer_done");
    expect(r.body).toContain("event: distill.finished");
    // finished carries panel_path + version
    expect(r.body).toContain('"version":3');
    // ordering check
    const idxStarted = r.body.indexOf("distill.started");
    const idxProg = r.body.indexOf("distill.slicer_progress");
    const idxFinished = r.body.indexOf("distill.finished");
    expect(idxStarted).toBeLessThan(idxProg);
    expect(idxProg).toBeLessThan(idxFinished);
    expect(fakeRun).toHaveBeenCalledOnce();
  });

  it("400 on bad role", async () => {
    const app = Fastify();
    registerConfigStylePanelsDistillRoutes(app, {
      vaultPath: "/tmp",
      sqlitePath: "/tmp/x.db",
      stylePanelStore: {} as any,
      runRoleDistill: vi.fn() as any,
    });
    const r = await app.inject({
      method: "POST",
      url: "/api/config/style-panels/distill",
      payload: { account: "A", role: "junk" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("400 on empty account", async () => {
    const app = Fastify();
    registerConfigStylePanelsDistillRoutes(app, {
      vaultPath: "/tmp",
      sqlitePath: "/tmp/x.db",
      stylePanelStore: {} as any,
      runRoleDistill: vi.fn() as any,
    });
    const r = await app.inject({
      method: "POST",
      url: "/api/config/style-panels/distill",
      payload: { account: "", role: "opening" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("emits distill.failed when orchestrator throws", async () => {
    const fakeRun = vi.fn(async (_input: any, ctx: any) => {
      ctx.onEvent({ phase: "started", account: "A", role: "opening", run_id: "rd-x" });
      throw new Error("boom");
    });
    const app = Fastify();
    registerConfigStylePanelsDistillRoutes(app, {
      vaultPath: "/tmp",
      sqlitePath: "/tmp/x.db",
      stylePanelStore: {} as any,
      runRoleDistill: fakeRun as any,
    });
    const r = await app.inject({
      method: "POST",
      url: "/api/config/style-panels/distill",
      payload: { account: "A", role: "opening" },
    });
    expect(r.body).toContain("event: distill.failed");
    expect(r.body).toContain("boom");
  });
});
