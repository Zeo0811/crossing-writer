import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentTimeline } from "../AgentTimeline";

const events = [
  {
    type: "writer.selection_rewritten",
    payload: {
      sectionKey: "opening",
      selected_text: "这是原文",
      new_text: "这是改写后的文字",
    },
    ts: "2026-04-14T12:00:00Z",
  },
];

describe("AgentTimeline writer.selection_rewritten", () => {
  it("renders the selection_rewritten event with sectionKey and preview", () => {
    render(<AgentTimeline events={events as any} />);
    expect(screen.getByText(/✂️ 改写选中片段/)).toBeInTheDocument();
    expect(screen.getByText(/opening/)).toBeInTheDocument();
    expect(screen.getByText(/这是原文/)).toBeInTheDocument();
    expect(screen.getByText(/这是改写后的文字/)).toBeInTheDocument();
  });
});
