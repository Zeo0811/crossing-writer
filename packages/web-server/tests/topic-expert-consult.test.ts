import { describe, it, expect, vi } from "vitest";
import { runTopicExpertConsult, type ConsultEvent } from "../src/services/topic-expert-consult.js";

function makeStore(missing: string[] = []) {
  return {
    get: vi.fn(async (name: string) => {
      if (missing.includes(name)) return null;
      return {
        name,
        specialty: "zen",
        active: true,
        default_preselect: false,
        soft_deleted: false,
        kb_markdown: `kb of ${name}`,
        word_count: 10,
      };
    }),
  } as any;
}

function collect(): { emit: (e: ConsultEvent) => void; events: ConsultEvent[] } {
  const events: ConsultEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}

describe("runTopicExpertConsult", () => {
  it("3 experts all succeed: started + per-expert pairs + all_done", async () => {
    const invoke = vi.fn(async (a: any) => ({
      markdown: `md-${a.name}`, meta: { cli: "claude", durationMs: 1 },
    }));
    const { emit, events } = collect();
    const r = await runTopicExpertConsult(
      { projectId: "p1", selectedExperts: ["A", "B", "C"], invokeType: "score", brief: "b", productContext: "pc" },
      { store: makeStore(), invoke, emit },
    );
    expect(r.succeeded).toEqual(expect.arrayContaining(["A", "B", "C"]));
    expect(r.failed).toEqual([]);
    expect(events[0]!.type).toBe("topic_consult.started");
    expect(events.at(-1)!.type).toBe("all_done");
    expect(events.filter((e) => e.type === "expert_done")).toHaveLength(3);
  });

  it("missing KB emits expert_failed with kb not found", async () => {
    const invoke = vi.fn(async (a: any) => ({
      markdown: `md-${a.name}`, meta: { cli: "claude", durationMs: 1 },
    }));
    const { emit, events } = collect();
    const r = await runTopicExpertConsult(
      { projectId: "p1", selectedExperts: ["A", "B"], invokeType: "score", brief: "b", productContext: "pc" },
      { store: makeStore(["B"]), invoke, emit },
    );
    expect(r.failed).toEqual(["B"]);
    const fail = events.find((e) => e.type === "expert_failed")!;
    expect((fail.data as any).error).toMatch(/kb not found/);
  });

  it("concurrency=2 with 5 experts never exceeds 2 in-flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const invoke = vi.fn(async (a: any) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return { markdown: `md-${a.name}`, meta: { cli: "claude", durationMs: 10 } };
    });
    const { emit } = collect();
    await runTopicExpertConsult(
      { projectId: "p1", selectedExperts: ["A","B","C","D","E"], invokeType: "score", brief: "b", productContext: "pc" },
      { store: makeStore(), invoke, emit, concurrency: 2 },
    );
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("invoke throws for one name → expert_failed; others proceed", async () => {
    const invoke = vi.fn(async (a: any) => {
      if (a.name === "B") throw new Error("boom");
      return { markdown: `md-${a.name}`, meta: { cli: "claude", durationMs: 1 } };
    });
    const { emit, events } = collect();
    const r = await runTopicExpertConsult(
      { projectId: "p1", selectedExperts: ["A","B","C"], invokeType: "score", brief: "b", productContext: "pc" },
      { store: makeStore(), invoke, emit },
    );
    expect(r.failed).toEqual(["B"]);
    expect(r.succeeded).toEqual(expect.arrayContaining(["A", "C"]));
    const fail = events.find((e) => e.type === "expert_failed")!;
    expect((fail.data as any).error).toMatch(/boom/);
  });

  it("all_done contains every selected name exactly once", async () => {
    const invoke = vi.fn(async (a: any) => {
      if (a.name === "C") throw new Error("x");
      return { markdown: "m", meta: { cli: "claude", durationMs: 1 } };
    });
    const { emit, events } = collect();
    await runTopicExpertConsult(
      { projectId: "p1", selectedExperts: ["A","B","C","D"], invokeType: "score", brief: "b", productContext: "pc" },
      { store: makeStore(["B"]), invoke, emit },
    );
    const last = events.at(-1)!;
    expect(last.type).toBe("all_done");
    const d = last.data as { succeeded: string[]; failed: string[] };
    const all = [...d.succeeded, ...d.failed].sort();
    expect(all).toEqual(["A","B","C","D"]);
  });
});
