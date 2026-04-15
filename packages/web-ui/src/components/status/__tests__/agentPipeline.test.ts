import { describe, it, expect } from "vitest";
import { deriveAgentPipeline, eventLabel, formatElapsed } from "../agentPipeline";

describe("deriveAgentPipeline", () => {
  it("starts with all phases todo when no events", () => {
    const { phases, currentActivity } = deriveAgentPipeline([]);
    expect(phases.map((p) => p.status)).toEqual(["todo", "todo", "todo", "todo", "todo", "todo"]);
    expect(currentActivity).toBeNull();
  });

  it("marks brief done after agent.completed for brief_analyst", () => {
    const { phases } = deriveAgentPipeline([
      { type: "agent.started", agent: "brief_analyst" },
      { type: "agent.completed", agent: "brief_analyst" },
    ]);
    const brief = phases.find((p) => p.key === "brief")!;
    expect(brief.status).toBe("done");
  });

  it("marks brief done via state_changed brief_ready", () => {
    const { phases } = deriveAgentPipeline([
      { type: "state_changed", data: { from: "init", to: "brief_ready" } },
    ]);
    expect(phases.find((p) => p.key === "brief")!.status).toBe("done");
  });

  it("marks mission running on expert.round1_started", () => {
    const { phases } = deriveAgentPipeline([
      { type: "agent.completed", agent: "brief_analyst" },
      { type: "expert.round1_started", agent: "expert.A", data: { expert: "赛博禅心" } },
    ]);
    expect(phases.find((p) => p.key === "mission")!.status).toBe("running");
  });

  it("marks mission done via state_changed awaiting_mission_pick", () => {
    const { phases } = deriveAgentPipeline([
      { type: "state_changed", data: { to: "awaiting_mission_pick" } },
    ]);
    expect(phases.find((p) => p.key === "mission")!.status).toBe("done");
  });

  it("marks overview running/done", () => {
    const start = deriveAgentPipeline([{ type: "overview.started", agent: "po" }]);
    expect(start.phases.find((p) => p.key === "overview")!.status).toBe("running");
    const done = deriveAgentPipeline([
      { type: "overview.started", agent: "po" },
      { type: "overview.completed", agent: "po" },
    ]);
    expect(done.phases.find((p) => p.key === "overview")!.status).toBe("done");
  });

  it("marks case running on case_expert events and done on cases.selected", () => {
    const running = deriveAgentPipeline([
      { type: "case_expert.round1_started", agent: "case_expert.A" },
    ]);
    expect(running.phases.find((p) => p.key === "case")!.status).toBe("running");
    const done = deriveAgentPipeline([
      { type: "case_expert.round1_started", agent: "case_expert.A" },
      { type: "cases.selected", data: {} },
    ]);
    expect(done.phases.find((p) => p.key === "case")!.status).toBe("done");
  });

  it("marks evidence done on evidence.submitted", () => {
    const { phases } = deriveAgentPipeline([
      { type: "evidence.updated", data: {} },
      { type: "evidence.submitted", data: {} },
    ]);
    expect(phases.find((p) => p.key === "evidence")!.status).toBe("done");
  });

  it("marks writer running on writer.section_started", () => {
    const { phases } = deriveAgentPipeline([
      { type: "writer.section_started", agent: "writer", data: { sectionKey: "opening" } },
    ]);
    expect(phases.find((p) => p.key === "writer")!.status).toBe("running");
  });

  it("propagates 'done' backwards: when writer is running, prior phases auto-done", () => {
    const { phases } = deriveAgentPipeline([
      { type: "writer.section_started", agent: "writer", data: { sectionKey: "opening" } },
    ]);
    expect(phases.find((p) => p.key === "brief")!.status).toBe("done");
    expect(phases.find((p) => p.key === "mission")!.status).toBe("done");
  });

  it("marks overview failed", () => {
    const { phases } = deriveAgentPipeline([
      { type: "overview.started", agent: "po" },
      { type: "overview.failed", agent: "po" },
    ]);
    expect(phases.find((p) => p.key === "overview")!.status).toBe("failed");
  });

  it("populates currentActivity from the latest agent event", () => {
    const { currentActivity } = deriveAgentPipeline([
      { type: "agent.started", agent: "brief_analyst", cli: "claude", model: "sonnet", ts: "2026-04-14T12:00:00Z" },
      { type: "expert.round1_started", agent: "expert.A", data: { expert: "赛博禅心", round: 1 }, cli: "codex", model: "gpt5", ts: "2026-04-14T12:01:00Z" },
    ]);
    expect(currentActivity).not.toBeNull();
    expect(currentActivity!.agent).toBe("expert.A");
    expect(currentActivity!.cli).toBe("codex");
    expect(currentActivity!.round).toBe(1);
    expect(currentActivity!.description).toMatch(/赛博禅心/);
  });
});

describe("eventLabel", () => {
  it("translates coordinator.aggregating", () => {
    expect(eventLabel({ type: "coordinator.aggregating" })).toBe("协调员 正在汇总");
  });
  it("translates expert.round1_started with expert name", () => {
    expect(eventLabel({ type: "expert.round1_started", data: { expert: "赛博禅心" } }))
      .toBe("专家 赛博禅心 开始 Round 1");
  });
  it("falls back to raw type when unknown", () => {
    expect(eventLabel({ type: "weird.thing" })).toBe("weird.thing");
  });
});

describe("formatElapsed", () => {
  it("formats seconds", () => {
    const start = Date.parse("2026-04-14T12:00:00Z");
    expect(formatElapsed(start, start + 5_000)).toBe("5s");
  });
  it("formats minutes+seconds", () => {
    const start = Date.parse("2026-04-14T12:00:00Z");
    expect(formatElapsed(start, start + 65_000)).toBe("1m5s");
  });
  it("returns em-dash for missing", () => {
    expect(formatElapsed(undefined)).toBe("—");
  });
});
