import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentStatusBar } from "../../src/components/status/AgentStatusBar";

describe("AgentStatusBar", () => {
  it("renders nothing when no active agents", () => {
    const { container } = render(<AgentStatusBar activeAgents={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders pill per active agent with pulsing dot", () => {
    render(<AgentStatusBar activeAgents={[
      { agent: "case_expert.A", cli: "claude", model: "opus", stage: "round1_started" },
      { agent: "case_expert.B", cli: "codex", model: "gpt5", stage: "round1_started" },
    ]} />);
    expect(screen.getByText(/case_expert\.A/)).toBeInTheDocument();
    expect(screen.getByText(/case_expert\.B/)).toBeInTheDocument();
    const pulsing = screen.getAllByTestId(/pulse-dot/);
    expect(pulsing).toHaveLength(2);
  });

  it("shows stage on hover title", () => {
    render(<AgentStatusBar activeAgents={[
      { agent: "X", cli: "claude", model: "opus", stage: "synthesizing" },
    ]} />);
    const pill = screen.getByText(/X/).closest('[data-testid="pill-X"]');
    expect(pill?.getAttribute("title")).toContain("synthesizing");
  });
});
