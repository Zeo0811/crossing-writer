import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentTimeline } from "../AgentTimeline";

describe("AgentTimeline pipeline view", () => {
  it("renders the 6-phase pipeline strip", () => {
    render(<AgentTimeline events={[]} />);
    expect(screen.getByTestId("pipeline-strip")).toBeInTheDocument();
    for (const k of ["brief", "mission", "overview", "case", "evidence", "writer"]) {
      expect(screen.getByTestId(`phase-${k}`)).toBeInTheDocument();
    }
  });

  it("reflects phase statuses derived from events", () => {
    render(
      <AgentTimeline
        events={[
          { type: "agent.completed", agent: "brief_analyst" },
          { type: "expert.round1_started", agent: "expert.A", data: { expert: "赛博禅心", round: 1 } },
        ] as any}
      />,
    );
    expect(screen.getByTestId("phase-brief").getAttribute("data-status")).toBe("done");
    expect(screen.getByTestId("phase-mission").getAttribute("data-status")).toBe("running");
  });

  it("renders current activity card with friendly label for coordinator.aggregating", () => {
    render(
      <AgentTimeline
        events={[
          { type: "coordinator.aggregating", agent: "coordinator", cli: "claude", model: "sonnet" },
        ] as any}
      />,
    );
    expect(screen.getByTestId("current-activity")).toBeInTheDocument();
    expect(screen.getAllByText(/协调员 正在汇总/).length).toBeGreaterThan(0);
  });

  it("shows empty state when no agent activity yet", () => {
    render(<AgentTimeline events={[]} />);
    expect(screen.getByTestId("current-activity-empty")).toBeInTheDocument();
  });
});
