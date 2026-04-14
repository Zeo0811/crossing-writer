import { describe, it, expect, beforeEach } from "vitest";
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

describe("useProjectStream writer.selection_rewritten event", () => {
  it("accepts writer.selection_rewritten and lands it in state.events", () => {
    const { result } = renderHook(() => useProjectStream("proj-1"));
    const es = MockEventSource.instances[0];
    act(() => {
      es.dispatch("writer.selection_rewritten", {
        sectionKey: "opening",
        selected_text: "原文片段",
        new_text: "改写后的文字",
        ts: 1,
      });
    });
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].type).toBe("writer.selection_rewritten");
    expect(result.current.events[0].payload).toMatchObject({
      sectionKey: "opening",
      selected_text: "原文片段",
      new_text: "改写后的文字",
    });
  });
});
