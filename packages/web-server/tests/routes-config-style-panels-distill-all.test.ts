import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerConfigStylePanelsDistillRoutes } from "../src/routes/config-style-panels-distill.js";

describe("config-style-panels distill-all SSE route", () => {
  it("streams distill_all.started -> slicer_progress -> role_started x3 -> role_done x3 -> distill_all.finished", async () => {
    const fakeRunAll = vi.fn(async (input: any, ctx: any) => {
      ctx.onEvent({ phase: "all.started", account: input.account, run_id: "rdall-1" });
      ctx.onEvent({ phase: "slicer_progress", processed: 1, total: 2 });
      ctx.onEvent({ phase: "slicer_progress", processed: 2, total: 2 });
      ctx.onEvent({ phase: "role_started", role: "opening" });
      ctx.onEvent({ phase: "role_started", role: "practice" });
      ctx.onEvent({ phase: "role_started", role: "closing" });
      ctx.onEvent({
        phase: "role_done",
        role: "opening",
        panel_path: "/tmp/o.md",
        version: 1,
      });
      ctx.onEvent({
        phase: "role_done",
        role: "practice",
        panel_path: "/tmp/p.md",
        version: 1,
      });
      ctx.onEvent({
        phase: "role_done",
        role: "closing",
        panel_path: "/tmp/c.md",
        version: 1,
      });
      ctx.onEvent({
        phase: "all.finished",
        results: [
          { role: "opening", panel_path: "/tmp/o.md", version: 1 },
          { role: "practice", panel_path: "/tmp/p.md", version: 1 },
          { role: "closing", panel_path: "/tmp/c.md", version: 1 },
        ],
      });
      return {
        results: [
          { role: "opening", panelPath: "/tmp/o.md", version: 1 },
          { role: "practice", panelPath: "/tmp/p.md", version: 1 },
          { role: "closing", panelPath: "/tmp/c.md", version: 1 },
        ],
      };
    });
    const app = Fastify();
    registerConfigStylePanelsDistillRoutes(app, {
      vaultPath: "/tmp",
      sqlitePath: "/tmp/x.db",
      stylePanelStore: {} as any,
      runRoleDistillAll: fakeRunAll as any,
    });
    const r = await app.inject({
      method: "POST",
      url: "/api/config/style-panels/distill-all",
      payload: { account: "A" },
    });
    expect(r.body).toContain("event: distill_all.started");
    expect(r.body).toContain("event: slicer_progress");
    expect(r.body).toContain("event: role_started");
    expect(r.body).toContain("event: role_done");
    expect(r.body).toContain("event: distill_all.finished");
    const idxStart = r.body.indexOf("distill_all.started");
    const idxSlicer = r.body.indexOf("slicer_progress");
    const idxRoleStart = r.body.indexOf("role_started");
    const idxFinished = r.body.indexOf("distill_all.finished");
    expect(idxStart).toBeLessThan(idxSlicer);
    expect(idxSlicer).toBeLessThan(idxRoleStart);
    expect(idxRoleStart).toBeLessThan(idxFinished);
    expect(fakeRunAll).toHaveBeenCalledOnce();
  });

  it("400 on empty account", async () => {
    const app = Fastify();
    registerConfigStylePanelsDistillRoutes(app, {
      vaultPath: "/tmp",
      sqlitePath: "/tmp/x.db",
      stylePanelStore: {} as any,
      runRoleDistillAll: vi.fn() as any,
    });
    const r = await app.inject({
      method: "POST",
      url: "/api/config/style-panels/distill-all",
      payload: { account: "" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("emits distill_all.failed when orchestrator throws", async () => {
    const fakeRunAll = vi.fn(async (_input: any, ctx: any) => {
      ctx.onEvent({ phase: "all.started", account: "A", run_id: "rdall-x" });
      throw new Error("kaboom");
    });
    const app = Fastify();
    registerConfigStylePanelsDistillRoutes(app, {
      vaultPath: "/tmp",
      sqlitePath: "/tmp/x.db",
      stylePanelStore: {} as any,
      runRoleDistillAll: fakeRunAll as any,
    });
    const r = await app.inject({
      method: "POST",
      url: "/api/config/style-panels/distill-all",
      payload: { account: "A" },
    });
    expect(r.body).toContain("event: distill_all.failed");
    expect(r.body).toContain("kaboom");
  });

  it("role_failed event is forwarded", async () => {
    const fakeRunAll = vi.fn(async (_input: any, ctx: any) => {
      ctx.onEvent({ phase: "all.started", account: "A", run_id: "rdall-f" });
      ctx.onEvent({
        phase: "role_failed",
        role: "practice",
        error: "no slices matched role=practice",
      });
      ctx.onEvent({ phase: "all.finished", results: [] });
      return { results: [] };
    });
    const app = Fastify();
    registerConfigStylePanelsDistillRoutes(app, {
      vaultPath: "/tmp",
      sqlitePath: "/tmp/x.db",
      stylePanelStore: {} as any,
      runRoleDistillAll: fakeRunAll as any,
    });
    const r = await app.inject({
      method: "POST",
      url: "/api/config/style-panels/distill-all",
      payload: { account: "A" },
    });
    expect(r.body).toContain("event: role_failed");
    expect(r.body).toContain("no slices matched");
  });
});
