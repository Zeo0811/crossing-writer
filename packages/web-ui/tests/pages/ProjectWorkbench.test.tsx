import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ProjectWorkbench } from "../../src/pages/ProjectWorkbench";
import { ToastProvider } from "../../src/components/ui/ToastProvider";

// Helper: matches if at least one element in the document matches the pattern
function expectAny(pattern: RegExp) {
  const matches = screen.queryAllByText(pattern);
  expect(matches.length).toBeGreaterThan(0);
}

vi.mock("../../src/api/client", () => ({
  getProject: vi.fn(),
  getOverview: vi.fn(async () => null),
  getCaseCandidates: vi.fn(async () => null),
  getSelectedCases: vi.fn(async () => null),
  listOverviewImages: vi.fn(async () => []),
  listCaseExperts: vi.fn(async () => []),
  getProjectChecklist: vi.fn(async () => ({
    projectId: "p1",
    generatedAt: "2026-04-18T00:00:00Z",
    items: [],
  })),
}));

vi.mock("../../src/hooks/useProjectStream", () => ({
  useProjectStream: () => ({ events: [], activeAgents: [] }),
}));

vi.mock("../../src/api/evidence-client", () => ({
  getProjectEvidence: vi.fn(async () => ({ cases: {}, all_complete: true, submitted_at: null, index_path: "" })),
  getCaseEvidence: vi.fn(),
  uploadEvidenceFile: vi.fn(),
  deleteEvidenceFile: vi.fn(),
  putNotes: vi.fn(),
  submitEvidence: vi.fn(),
}));

vi.mock("../../src/api/writer-client", () => ({
  getSections: vi.fn(async () => ({ sections: [] })),
  getSection: vi.fn(),
  putSection: vi.fn(),
  startWriter: vi.fn(),
  retryFailed: vi.fn(),
  getFinal: vi.fn(async () => ""),
  listStylePanels: vi.fn(async () => []),
  rewriteSectionStream: vi.fn(),
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
    ["evidence_collecting", /左侧选一个 Case/],
    ["evidence_ready", /开始写作|配置/],
    ["writing_running", /运行中|等待/],
    ["writing_ready", /@agent 重写|导出 final/],
  ])("status=%s renders expected panel", async (status, pattern) => {
    const { getProject } = await import("../../src/api/client");
    vi.mocked(getProject).mockResolvedValue({
      id: "p1", name: "T", status, created_at: "", updated_at: "",
    } as any);
    render(<ToastProvider><ProjectWorkbench projectId="p1" /></ToastProvider>);
    await waitFor(() => {
      expectAny(pattern);
    });
  });
});
