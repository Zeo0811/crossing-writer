import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent } from "../src/services/event-log.js";

describe("new SSE event types for SP-03", () => {
  it("accepts all new overview and case event types", async () => {
    const dir = mkdtempSync(join(tmpdir(), "evt-"));
    mkdirSync(dir, { recursive: true });
    for (const type of [
      "overview.started", "overview.completed", "overview.failed",
      "case_expert.round1_started", "case_expert.round1_completed",
      "case_expert.tool_call",
      "case_expert.round2_started", "case_expert.round2_completed",
      "case_coordinator.synthesizing", "case_coordinator.done",
      "cases.selected",
    ]) {
      await appendEvent(dir, { type, agent: "x", cli: "claude", model: "opus" });
    }
    const lines = readFileSync(join(dir, "events.jsonl"), "utf-8").split("\n").filter(Boolean);
    expect(lines.length).toBe(11);
    for (const l of lines) {
      const e = JSON.parse(l);
      expect(e.ts).toBeTruthy();
      expect(e.type).toMatch(/^(overview|case_expert|case_coordinator|cases)\./);
    }
  });
});
