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

describe("useProjectStream SP-10 distill + run.blocked events", () => {
  const sp10Types = [
    "distill.started",
    "distill.slicer_progress",
    "distill.composer_done",
    "distill.finished",
    "distill.failed",
    "run.blocked",
  ];

  for (const type of sp10Types) {
    it(`accepts ${type} event and pushes it onto events`, () => {
      const { result } = renderHook(() => useProjectStream("proj-1"));
      const es = MockEventSource.instances[0];
      act(() => {
        es.dispatch(type, { foo: "bar", ts: 1 });
      });
      expect(result.current.events).toHaveLength(1);
      expect(result.current.events[0].type).toBe(type);
      expect(result.current.events[0].payload).toMatchObject({ foo: "bar" });
    });
  }

  it("distill.started marks slicer agent online", () => {
    const { result } = renderHook(() => useProjectStream("proj-1"));
    const es = MockEventSource.instances[0];
    act(() => {
      es.dispatch("distill.started", { agent: "style-distiller.composer", account: "acc", role: "opening" });
    });
    expect(result.current.activeAgents.map((a) => a.agent)).toContain("style-distiller.composer");
  });

  it("distill.failed marks the agent failed", () => {
    const { result } = renderHook(() => useProjectStream("proj-1"));
    const es = MockEventSource.instances[0];
    act(() => {
      es.dispatch("distill.started", { agent: "style-distiller.composer" });
      es.dispatch("distill.failed", { agent: "style-distiller.composer", error: "boom" });
    });
    const agent = result.current.activeAgents.find((a) => a.agent === "style-distiller.composer");
    expect(agent?.status).toBe("failed");
  });
});
