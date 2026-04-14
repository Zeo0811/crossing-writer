import { describe, it, expect } from "vitest";
import { STATUSES, TRANSITIONS, canTransition } from "../src/state/state-machine.js";

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

describe("state machine SP-05 writer extensions", () => {
  it("includes all writing_* statuses", () => {
    expect(STATUSES).toContain("writing_configuring");
    expect(STATUSES).toContain("writing_running");
    expect(STATUSES).toContain("writing_ready");
    expect(STATUSES).toContain("writing_editing");
    expect(STATUSES).toContain("writing_failed");
  });

  it("evidence_ready transitions to writing_configuring", () => {
    expect(TRANSITIONS["evidence_ready"]).toContain("writing_configuring");
  });

  it("writing_configuring → writing_running", () => {
    expect(canTransition("writing_configuring", "writing_running")).toBe(true);
  });

  it("writing_running → writing_ready / writing_failed", () => {
    expect(canTransition("writing_running", "writing_ready")).toBe(true);
    expect(canTransition("writing_running", "writing_failed")).toBe(true);
  });

  it("writing_failed → writing_running (retry)", () => {
    expect(canTransition("writing_failed", "writing_running")).toBe(true);
  });

  it("writing_ready ↔ writing_editing", () => {
    expect(canTransition("writing_ready", "writing_editing")).toBe(true);
    expect(canTransition("writing_editing", "writing_ready")).toBe(true);
  });

  it("writing_ready can return to evidence_collecting for re-record", () => {
    expect(canTransition("writing_ready", "evidence_collecting")).toBe(true);
  });
});
