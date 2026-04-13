import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useProjectStream } from "../../src/hooks/useProjectStream";

describe("useProjectStream agent aggregation", () => {
  it("tracks activeAgents set (started → completed removes)", () => {
    const { result } = renderHook(() => useProjectStream("p1"));
    act(() => {
      (result.current as any).__injectForTest?.({
        type: "case_expert.round1_started",
        agent: "case_expert.卡兹克", cli: "claude", model: "opus",
      });
    });
    expect(result.current.activeAgents).toEqual([
      { agent: "case_expert.卡兹克", cli: "claude", model: "opus", stage: "round1_started", status: "online" },
    ]);

    act(() => {
      (result.current as any).__injectForTest?.({
        type: "case_expert.round1_completed",
        agent: "case_expert.卡兹克", cli: "claude", model: "opus",
      });
    });
    expect(result.current.activeAgents).toEqual([]);
  });

  it("parses cli/model from all events", () => {
    const { result } = renderHook(() => useProjectStream("p1"));
    act(() => {
      (result.current as any).__injectForTest?.({
        type: "overview.started",
        agent: "product_overview", cli: "claude", model: "opus",
      });
    });
    expect(result.current.events[result.current.events.length - 1]).toMatchObject({
      agent: "product_overview", cli: "claude", model: "opus",
    });
  });
});
