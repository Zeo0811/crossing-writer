import { describe, it, expect } from "vitest";
import {
  initialTopicConsultState,
  reduceTopicConsult,
} from "../../src/hooks/useProjectStream";

describe("reduceTopicConsult", () => {
  it("seeds pending entries on topic_consult.started", () => {
    const s = reduceTopicConsult(initialTopicConsultState(), {
      type: "topic_consult.started",
      data: { invokeType: "score", selected: ["A", "B"] },
    });
    expect(s.status).toBe("running");
    expect(s.invokeType).toBe("score");
    expect(s.experts["A"]!.status).toBe("pending");
    expect(s.experts["B"]!.status).toBe("pending");
  });

  it("expert_started → running", () => {
    let s = reduceTopicConsult(initialTopicConsultState(), {
      type: "topic_consult.started",
      data: { invokeType: "score", selected: ["A"] },
    });
    s = reduceTopicConsult(s, { type: "expert_started", data: { name: "A" } });
    expect(s.experts["A"]!.status).toBe("running");
  });

  it("expert_delta accumulates across multiple chunks", () => {
    let s = reduceTopicConsult(initialTopicConsultState(), {
      type: "topic_consult.started",
      data: { invokeType: "score", selected: ["A"] },
    });
    s = reduceTopicConsult(s, { type: "expert_delta", data: { name: "A", chunk: "Hel" } });
    s = reduceTopicConsult(s, { type: "expert_delta", data: { name: "A", chunk: "lo" } });
    expect(s.experts["A"]!.markdown).toBe("Hello");
  });

  it("expert_failed does not unset other experts", () => {
    let s = reduceTopicConsult(initialTopicConsultState(), {
      type: "topic_consult.started",
      data: { invokeType: "score", selected: ["A", "B"] },
    });
    s = reduceTopicConsult(s, { type: "expert_done", data: { name: "A", markdown: "MA" } });
    s = reduceTopicConsult(s, { type: "expert_failed", data: { name: "B", error: "err" } });
    expect(s.experts["A"]!.status).toBe("done");
    expect(s.experts["A"]!.markdown).toBe("MA");
    expect(s.experts["B"]!.status).toBe("failed");
    expect(s.experts["B"]!.error).toBe("err");
  });

  it("all_done transitions status to done", () => {
    let s = reduceTopicConsult(initialTopicConsultState(), {
      type: "topic_consult.started",
      data: { invokeType: "score", selected: ["A", "B"] },
    });
    s = reduceTopicConsult(s, {
      type: "all_done",
      data: { succeeded: ["A"], failed: ["B"] },
    });
    expect(s.status).toBe("done");
    expect(s.succeeded).toEqual(["A"]);
    expect(s.failed).toEqual(["B"]);
  });
});
