import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProjectWorkbench } from "../../src/pages/ProjectWorkbench";
import { ToastProvider } from "../../src/components/ui/ToastProvider";

const CHECKLIST = {
  projectId: "p1",
  generatedAt: "2026-04-18T00:00:00Z",
  items: [
    { step: "brief", status: "done", link: "brief" },
    { step: "topic", status: "todo", link: "mission" },
    { step: "case", status: "partial", reason: "draft", link: "case" },
    { step: "evidence", status: "todo", link: "evidence" },
    { step: "styleBindings", status: "blocked", reason: "writer.practice 缺少 styleBinding", link: "config" },
    { step: "draft", status: "todo", link: "article" },
    { step: "review", status: "todo", link: "article" },
  ],
};

vi.mock("../../src/api/client", () => ({
  api: {
    getBriefSummary: vi.fn(async () => "summary"),
    listProjects: vi.fn(async () => ({ items: [], archived_count: 0 })),
    getProject: vi.fn(async () => ({ id: "p1", name: "demo", status: "case_plan_approved" })),
  },
  getProject: vi.fn(async () => ({ id: "p1", name: "demo", status: "case_plan_approved" })),
  getOverview: vi.fn(async () => null),
  getCaseCandidates: vi.fn(async () => null),
  getSelectedCases: vi.fn(async () => null),
  listOverviewImages: vi.fn(async () => []),
  listCaseExperts: vi.fn(async () => []),
  getProjectChecklist: vi.fn(async () => CHECKLIST),
}));

vi.mock("../../src/hooks/useProjectStream", () => ({
  useProjectStream: () => ({ events: [], activeAgents: [] }),
  initialTopicConsultState: () => ({ status: "idle", experts: {}, succeeded: [], failed: [] }),
  reduceTopicConsult: (s: unknown) => s,
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
  listTopicExperts: vi.fn(async () => []),
  consultTopicExperts: vi.fn(),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/projects/p1"]}>
          <Routes>
            <Route path="/projects/:id" element={<ProjectWorkbench />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("SP-18 project checklist — e2e smoke", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* noop */ }
  });

  it("renders all 7 chips with expected data-status and Chinese labels", async () => {
    renderPage();
    for (const it of CHECKLIST.items) {
      const chip = await screen.findByTestId(`checklist-chip-${it.step}`);
      expect(chip.getAttribute("data-status")).toBe(it.status);
    }
    expect(screen.getByText("选题简报")).toBeInTheDocument();
    expect(screen.getByText("风格绑定")).toBeInTheDocument();
  });

  it("blocked styleBindings chip opens settings drawer", async () => {
    renderPage();
    const chip = await screen.findByTestId("checklist-chip-styleBindings");
    fireEvent.click(chip);
    await waitFor(() => {
      expect(screen.getByTestId("settings-drawer")).toBeInTheDocument();
    });
  });

  it("clicking a section chip calls scrollIntoView on the matching data-section", async () => {
    const spy = vi.fn();
    (Element.prototype as any).scrollIntoView = spy;
    renderPage();
    const chip = await screen.findByTestId("checklist-chip-case");
    fireEvent.click(chip);
    // data-section="case" div is rendered because project.status !== "created"
    expect(spy).toHaveBeenCalled();
  });

  it("collapse persists across re-mount per project", async () => {
    const first = renderPage();
    const toggle = await screen.findByTestId("checklist-toggle");
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByTestId("checklist-summary")).toBeInTheDocument());
    expect(localStorage.getItem("checklist_collapsed_p1")).toBe("1");
    first.unmount();
    renderPage();
    await waitFor(() => expect(screen.getByTestId("checklist-summary")).toBeInTheDocument());
  });
});
