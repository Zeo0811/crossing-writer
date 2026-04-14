import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../src/api/writer-client", () => ({ retryFailed: vi.fn(async () => {}) }));

const eventsHolder: { evs: any[] } = { evs: [] };
vi.mock("../../../src/hooks/useProjectStream", () => ({
  useProjectStream: () => ({ events: eventsHolder.evs }),
}));

import { WriterProgressPanel } from "../../../src/components/writer/WriterProgressPanel";

describe("WriterProgressPanel", () => {
  it("renders running / completed / failed cards based on events", () => {
    eventsHolder.evs = [
      { type: "writer.section_started", section_key: "opening", agent: "writer.opening", cli: "claude", model: "opus" },
      { type: "writer.section_completed", section_key: "opening", agent: "writer.opening", duration_ms: 2300 },
      { type: "writer.section_started", section_key: "practice.case-01", agent: "writer.practice", cli: "claude", model: "sonnet" },
      { type: "writer.section_failed", section_key: "practice.case-02", agent: "writer.practice", error: "boom" },
    ];
    render(<WriterProgressPanel projectId="pid" sectionsPlanned={["opening", "practice.case-01", "practice.case-02", "closing"]} status="writing_failed" />);
    expect(screen.getByText(/opening/)).toBeTruthy();
    expect(screen.getByText(/已完成/)).toBeTruthy();
    expect(screen.getByText(/practice\.case-01/)).toBeTruthy();
    expect(screen.getByText(/运行中/)).toBeTruthy();
    expect(screen.getByText(/practice\.case-02/)).toBeTruthy();
    expect(screen.getByText(/失败/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /重跑失败段/ })).toBeTruthy();
  });

  it("hides retry button when status != writing_failed", () => {
    eventsHolder.evs = [];
    render(<WriterProgressPanel projectId="pid" sectionsPlanned={["opening"]} status="writing_running" />);
    expect(screen.queryByRole("button", { name: /重跑失败段/ })).toBeNull();
  });
});
