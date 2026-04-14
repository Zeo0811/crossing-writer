import { describe, it, expect } from "vitest";
import { STATUSES, TRANSITIONS } from "../src/state/state-machine.js";

describe("state machine SP-04 extensions", () => {
  it("includes evidence_collecting and evidence_ready statuses", () => {
    expect(STATUSES).toContain("evidence_collecting");
    expect(STATUSES).toContain("evidence_ready");
  });

  it("case_plan_approved transitions to evidence_collecting", () => {
    expect(TRANSITIONS["case_plan_approved"]).toContain("evidence_collecting");
  });

  it("evidence_collecting transitions to evidence_ready", () => {
    expect(TRANSITIONS["evidence_collecting"]).toContain("evidence_ready");
  });

  it("evidence_ready can transition back to evidence_collecting", () => {
    expect(TRANSITIONS["evidence_ready"]).toContain("evidence_collecting");
  });
});
