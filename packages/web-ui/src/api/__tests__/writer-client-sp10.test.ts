import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getAgentConfigs,
  getAgentConfig,
  setAgentConfig,
  listConfigStylePanels,
  deleteStylePanel,
  distillStylePanel,
  getProjectOverride,
  setProjectOverride,
  clearProjectAgentOverride,
  type AgentConfigEntry,
  type ProjectOverride,
} from "../writer-client.js";

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(ctrl) {
      for (const c of chunks) ctrl.enqueue(enc.encode(c));
      ctrl.close();
    },
  });
}

function mkFrame(type: string, data: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function flush() {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function errRes(status: number, text = "fail") {
  return {
    ok: false,
    status,
    json: async () => ({ error: text }),
    text: async () => text,
  };
}

describe("SP-10 writer-client agent config APIs", () => {
  beforeEach(() => {
    (globalThis as any).fetch = vi.fn();
  });

  it("getAgentConfigs GETs /api/config/agents and returns agents map", async () => {
    const fetchMock = vi.fn(async () =>
      okJson({ agents: { "writer.opening": { agentKey: "writer.opening", model: { cli: "claude" } } } }),
    );
    (globalThis as any).fetch = fetchMock;
    const out = await getAgentConfigs();
    expect(fetchMock).toHaveBeenCalledWith("/api/config/agents", undefined);
    expect(out.agents["writer.opening"]!.model!.cli).toBe("claude");
  });

  it("getAgentConfigs throws on non-ok response", async () => {
    (globalThis as any).fetch = vi.fn(async () => errRes(500, "boom"));
    await expect(getAgentConfigs()).rejects.toThrow(/500/);
  });

  it("getAgentConfig GETs /api/config/agents/:agentKey (encoded)", async () => {
    const fetchMock = vi.fn(async () =>
      okJson({ agentKey: "writer.opening", model: { cli: "codex", model: "gpt-5.4" } } as AgentConfigEntry),
    );
    (globalThis as any).fetch = fetchMock;
    const out = await getAgentConfig("writer.opening");
    expect(fetchMock).toHaveBeenCalledWith("/api/config/agents/writer.opening", undefined);
    expect(out.model!.cli).toBe("codex");
  });

  it("setAgentConfig PUTs JSON body", async () => {
    const fetchMock = vi.fn(async () => okJson({ ok: true }));
    (globalThis as any).fetch = fetchMock;
    const cfg: AgentConfigEntry = {
      agentKey: "writer.opening",
      model: { cli: "claude" },
    };
    await setAgentConfig("writer.opening", cfg);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/config/agents/writer.opening",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      }),
    );
  });

  it("setAgentConfig throws on 400", async () => {
    (globalThis as any).fetch = vi.fn(async () => errRes(400, "bad"));
    await expect(
      setAgentConfig("writer.opening", { agentKey: "writer.opening", model: { cli: "claude" } }),
    ).rejects.toThrow(/400/);
  });
});

describe("SP-10 writer-client style panels APIs", () => {
  beforeEach(() => {
    (globalThis as any).fetch = vi.fn();
  });

  it("listConfigStylePanels without filters GETs base URL", async () => {
    const fetchMock = vi.fn(async () => okJson({ panels: [] }));
    (globalThis as any).fetch = fetchMock;
    const out = await listConfigStylePanels();
    expect(fetchMock).toHaveBeenCalledWith("/api/config/style-panels", undefined);
    expect(out.panels).toEqual([]);
  });

  it("listConfigStylePanels with filters appends querystring", async () => {
    const fetchMock = vi.fn(async () => okJson({ panels: [] }));
    (globalThis as any).fetch = fetchMock;
    await listConfigStylePanels({ account: "acc", role: "opening", include_deleted: true });
    const called = (fetchMock.mock.calls as any)[0][0] as string;
    expect(called).toMatch(/^\/api\/config\/style-panels\?/);
    expect(called).toContain("account=acc");
    expect(called).toContain("role=opening");
    expect(called).toContain("include_deleted=1");
  });

  it("deleteStylePanel soft delete DELETEs URL", async () => {
    const fetchMock = vi.fn(async () => okJson({ ok: true }));
    (globalThis as any).fetch = fetchMock;
    await deleteStylePanel("acc", "opening", 3);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/config/style-panels/acc/opening/3",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("deleteStylePanel hard delete appends ?hard=1", async () => {
    const fetchMock = vi.fn(async () => okJson({ ok: true }));
    (globalThis as any).fetch = fetchMock;
    await deleteStylePanel("acc", "opening", 3, true);
    expect((fetchMock.mock.calls as any)[0][0]).toBe("/api/config/style-panels/acc/opening/3?hard=1");
  });

  it("deleteStylePanel throws on 404", async () => {
    (globalThis as any).fetch = vi.fn(async () => errRes(404, "nope"));
    await expect(deleteStylePanel("acc", "opening", 9)).rejects.toThrow(/404/);
  });

  it("distillStylePanel streams SSE events", async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      body: sseBody([
        mkFrame("distill.started", { account: "acc", role: "opening", run_id: "r1" }),
        mkFrame("distill.slicer_progress", { processed: 1, total: 3 }),
        mkFrame("distill.composer_done", { panel_path: "/p" }),
        mkFrame("distill.finished", { panel_path: "/p", version: 2 }),
      ]),
    }));
    const events: Array<{ type: string; data?: any }> = [];
    const s = distillStylePanel("acc", "opening", 5);
    s.onEvent((e) => events.push(e));
    await flush();
    expect(events.map((e) => e.type)).toEqual([
      "distill.started",
      "distill.slicer_progress",
      "distill.composer_done",
      "distill.finished",
    ]);
    expect(events[3].data.version).toBe(2);
  });

  it("distillStylePanel emits distill.failed when HTTP error", async () => {
    (globalThis as any).fetch = vi.fn(async () => ({ ok: false, status: 500, body: null }));
    const events: Array<{ type: string; error?: string }> = [];
    const s = distillStylePanel("acc", "opening");
    s.onEvent((e) => events.push(e));
    await flush();
    expect(events[0].type).toBe("distill.failed");
    expect(events[0].error).toMatch(/500/);
  });

  it("distillStylePanel posts body with account/role/limit", async () => {
    let capturedInit: RequestInit | undefined;
    (globalThis as any).fetch = vi.fn(async (_u: string, init: RequestInit) => {
      capturedInit = init;
      return { ok: true, body: sseBody([mkFrame("distill.finished", { panel_path: "/p", version: 1 })]) };
    });
    const s = distillStylePanel("acc", "practice", 7);
    s.onEvent(() => {});
    await flush();
    expect(JSON.parse(capturedInit!.body as string)).toEqual({
      account: "acc",
      role: "practice",
      limit: 7,
    });
  });
});

describe("SP-10 writer-client project override APIs", () => {
  beforeEach(() => {
    (globalThis as any).fetch = vi.fn();
  });

  it("getProjectOverride GETs project override", async () => {
    const fetchMock = vi.fn(async () =>
      okJson({ agents: { "writer.opening": { model: { cli: "claude" } } } } as ProjectOverride),
    );
    (globalThis as any).fetch = fetchMock;
    const out = await getProjectOverride("p1");
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/override", undefined);
    expect(out.agents["writer.opening"]?.model?.cli).toBe("claude");
  });

  it("setProjectOverride PUTs body", async () => {
    const fetchMock = vi.fn(async () => okJson({ ok: true }));
    (globalThis as any).fetch = fetchMock;
    const ov: ProjectOverride = { agents: { "writer.opening": { model: { cli: "codex" } } } };
    await setProjectOverride("p1", ov);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/override",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify(ov),
      }),
    );
  });

  it("clearProjectAgentOverride DELETEs agent-specific override", async () => {
    const fetchMock = vi.fn(async () => okJson({ ok: true }));
    (globalThis as any).fetch = fetchMock;
    await clearProjectAgentOverride("p1", "writer.opening");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/p1/override/writer.opening",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("clearProjectAgentOverride throws on 500", async () => {
    (globalThis as any).fetch = vi.fn(async () => errRes(500, "x"));
    await expect(clearProjectAgentOverride("p1", "writer.opening")).rejects.toThrow(/500/);
  });
});
