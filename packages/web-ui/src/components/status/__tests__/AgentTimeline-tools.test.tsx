import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentTimeline } from "../AgentTimeline";

const events = [
  {
    type: "writer.tool_called",
    payload: { sectionKey: "opening", round: 1, toolName: "search_raw", args: { query: "x" } },
    ts: "2026-04-14T12:00:00Z",
  },
  {
    type: "writer.tool_returned",
    payload: { sectionKey: "opening", round: 1, toolName: "search_raw", ok: true },
    ts: "2026-04-14T12:00:01Z",
  },
  {
    type: "writer.tool_failed",
    payload: { sectionKey: "opening", round: 2, toolName: "search_raw", error: "boom" },
    ts: "2026-04-14T12:00:02Z",
  },
  {
    type: "writer.tool_round_completed",
    payload: { sectionKey: "opening", round: 2 },
    ts: "2026-04-14T12:00:03Z",
  },
];

describe("AgentTimeline tool events", () => {
  it("renders 4 tool event types with distinct labels", () => {
    render(<AgentTimeline events={events as any} />);
    expect(screen.getByText(/→ search_raw/)).toBeInTheDocument();
    expect(screen.getByText(/← search_raw ok/)).toBeInTheDocument();
    expect(screen.getByText(/✗ search_raw: boom/)).toBeInTheDocument();
    expect(screen.getByText(/round 2 完成/)).toBeInTheDocument();
  });
});
