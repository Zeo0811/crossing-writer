import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ProjectWorkbench } from "../../src/pages/ProjectWorkbench";

vi.mock("../../src/api/client", () => ({
  getProject: vi.fn(),
  getOverview: vi.fn(async () => null),
  getCaseCandidates: vi.fn(async () => null),
  getSelectedCases: vi.fn(async () => null),
  listOverviewImages: vi.fn(async () => []),
  listCaseExperts: vi.fn(async () => []),
}));

vi.mock("../../src/hooks/useProjectStream", () => ({
  useProjectStream: () => ({ events: [], activeAgents: [] }),
}));

describe("ProjectWorkbench SP-03 status routing", () => {
  it.each([
    ["awaiting_overview_input", /Brief 配图|拖拽/],
    ["overview_analyzing", /正在生成/],
    ["overview_ready", /批准进入 Case 规划/],
    ["awaiting_case_expert_selection", /选择 Case 专家/],
    ["case_planning_running", /规划中/],
    ["awaiting_case_selection", /左侧选 2-4/],
    ["case_plan_approved", /Case Plan 已批准/],
  ])("status=%s renders expected panel", async (status, pattern) => {
    const { getProject } = await import("../../src/api/client");
    vi.mocked(getProject).mockResolvedValue({
      id: "p1", name: "T", status, created_at: "", updated_at: "",
    } as any);
    render(<ProjectWorkbench projectId="p1" />);
    await waitFor(() => {
      expect(screen.getByText(pattern)).toBeInTheDocument();
    });
  });
});
