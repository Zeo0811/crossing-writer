import type React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProjectWorkbench } from "../../src/pages/ProjectWorkbench";
import { ToastProvider } from "../../src/components/ui/ToastProvider";

function renderWith(ui: React.ReactElement) {
  return render(<MemoryRouter><ToastProvider>{ui}</ToastProvider></MemoryRouter>);
}

vi.mock("../../src/api/client", () => ({
  getProject: vi.fn(),
  getOverview: vi.fn(async () => null),
  getCaseCandidates: vi.fn(async () => null),
  getSelectedCases: vi.fn(async () => null),
  listOverviewImages: vi.fn(async () => []),
  listCaseExperts: vi.fn(async () => []),
}));

// Inject-able events hook
const streamState: { events: any[] } = { events: [] };
vi.mock("../../src/hooks/useProjectStream", () => ({
  useProjectStream: () => ({
    events: streamState.events,
    activeAgents: [],
    connectionState: "connected",
    lastEventTs: null,
  }),
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
  getAgentConfigs: vi.fn(async () => ({ agents: {} })),
  getProjectOverride: vi.fn(async () => ({ agents: {} })),
  listConfigStylePanels: vi.fn(async () => ({ panels: [] })),
}));

beforeEach(() => {
  streamState.events = [];
});

describe("ProjectWorkbench run.blocked UI", () => {
  it("renders block card with missingBindings when run.blocked event present", async () => {
    const { getProject } = await import("../../src/api/client");
    vi.mocked(getProject).mockResolvedValue({
      id: "p1", name: "T", status: "writing_configuring", created_at: "", updated_at: "",
    } as any);

    streamState.events = [
      {
        type: "run.blocked",
        data: { missingBindings: [{ agentKey: "writer.closing", reason: "style_not_bound" }] },
        missingBindings: [{ agentKey: "writer.closing", reason: "style_not_bound" }],
      },
    ];

    renderWith(<ProjectWorkbench projectId="p1" />);

    await waitFor(() => {
      expect(screen.getByText(/无法开始/)).toBeInTheDocument();
    });
    expect(screen.getAllByText(/writer\.closing/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /本项目专属配置/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /去配置工作台/ })).toBeInTheDocument();
  });

  it("header exposes 本项目专属配置 button regardless of run state", async () => {
    const { getProject } = await import("../../src/api/client");
    vi.mocked(getProject).mockResolvedValue({
      id: "p1", name: "T", status: "writing_ready", created_at: "", updated_at: "",
    } as any);
    renderWith(<ProjectWorkbench projectId="p1" />);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /本项目专属配置/ }).length).toBeGreaterThan(0);
    });
  });
});
