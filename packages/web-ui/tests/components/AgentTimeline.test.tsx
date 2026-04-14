import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentTimeline } from "../../src/components/status/AgentTimeline";

describe("AgentTimeline SP-03", () => {
  it("renders agent name with cli/model and status dot", () => {
    render(<AgentTimeline events={[
      { ts: "2026-04-13T14:32:15Z", type: "agent.started",
        agent: "brief_analyst", cli: "claude", model: "sonnet" },
    ]} />);
    expect(screen.getAllByText(/brief_analyst/).length).toBeGreaterThan(0);
    expect(screen.getByText(/claude\/sonnet/)).toBeInTheDocument();
    const dot = screen.getByTestId("status-dot-brief_analyst");
    expect(dot.className).toMatch(/bg-accent/);
  });

  it("shows gray dot after completed", () => {
    render(<AgentTimeline events={[
      { ts: "t1", type: "agent.started", agent: "x", cli: "codex", model: "gpt5" },
      { ts: "t2", type: "agent.completed", agent: "x", cli: "codex", model: "gpt5" },
    ]} />);
    const dot = screen.getByTestId("status-dot-x");
    expect(dot.className).toMatch(/bg-hair-strong/);
  });

  it("shows red dot on failed", () => {
    render(<AgentTimeline events={[
      { ts: "t1", type: "overview.started", agent: "product_overview", cli: "claude", model: "opus" },
      { ts: "t2", type: "overview.failed", agent: "product_overview", cli: "claude", model: "opus" },
    ]} />);
    const dot = screen.getByTestId("status-dot-product_overview");
    expect(dot.className).toMatch(/bg-red/);
  });

  it("aggregates multiple events from same agent into one row", () => {
    render(<AgentTimeline events={[
      { ts: "t1", type: "case_expert.round1_started", agent: "case_expert.A", cli: "c", model: "m" },
      { ts: "t2", type: "case_expert.tool_call", agent: "case_expert.A", command: "crossing-kb" },
      { ts: "t3", type: "case_expert.round2_completed", agent: "case_expert.A", cli: "c", model: "m" },
    ]} />);
    const rows = screen.getAllByTestId(/^agent-row-/);
    expect(rows).toHaveLength(1);
  });
});
