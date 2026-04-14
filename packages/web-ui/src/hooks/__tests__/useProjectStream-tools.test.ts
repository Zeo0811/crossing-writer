import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useProjectStream } from "../useProjectStream";

class MockEventSource {
  static instances: MockEventSource[] = [];
  listeners = new Map<string, ((ev: MessageEvent) => void)[]>();
  url: string;
  readyState = 1;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (ev: MessageEvent) => void) {
    const arr = this.listeners.get(type) ?? [];
    arr.push(cb);
    this.listeners.set(type, arr);
  }
  removeEventListener() {}
  close() {}
  dispatch(type: string, payload: unknown) {
    const arr = this.listeners.get(type) ?? [];
    for (const cb of arr) cb(new MessageEvent(type, { data: JSON.stringify(payload) }));
  }
}

beforeEach(() => {
  MockEventSource.instances = [];
  (globalThis as any).EventSource = MockEventSource;
});

describe("useProjectStream writer.tool_* events", () => {
  it("appends writer.tool_called / tool_returned / tool_failed / tool_round_completed in order", () => {
    const { result } = renderHook(() => useProjectStream("proj-1"));
    const es = MockEventSource.instances[0];
    act(() => {
      es.dispatch("writer.tool_called", { sectionKey: "opening", round: 1, toolName: "search_raw", args: { query: "x" }, ts: 1 });
      es.dispatch("writer.tool_returned", { sectionKey: "opening", round: 1, toolName: "search_raw", ok: true, ts: 2 });
      es.dispatch("writer.tool_failed", { sectionKey: "opening", round: 2, toolName: "search_raw", error: "boom", ts: 3 });
      es.dispatch("writer.tool_round_completed", { sectionKey: "opening", round: 2, ts: 4 });
    });
    const types = result.current.events.map((e) => e.type);
    expect(types).toEqual([
      "writer.tool_called",
      "writer.tool_returned",
      "writer.tool_failed",
      "writer.tool_round_completed",
    ]);
    expect(result.current.events[0].payload).toMatchObject({ toolName: "search_raw", round: 1 });
  });

  it("ignores unknown event types", () => {
    const { result } = renderHook(() => useProjectStream("proj-1"));
    const es = MockEventSource.instances[0];
    act(() => {
      es.dispatch("writer.tool_unknown", { foo: 1 });
    });
    expect(result.current.events).toHaveLength(0);
  });
});
