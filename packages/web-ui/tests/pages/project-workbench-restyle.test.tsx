import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ProjectWorkbench } from "../../src/pages/ProjectWorkbench";
import { ToastProvider } from "../../src/components/ui/ToastProvider";

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

describe("ProjectWorkbench restyle", () => {
  it("renders TopNav + page-project-workbench testid + Card-based sidebar", async () => {
    const { getProject } = await import("../../src/api/client");
    vi.mocked(getProject).mockResolvedValue({
      id: "p1", name: "demo", status: "created", created_at: "", updated_at: "",
    } as any);
    render(<ToastProvider><ProjectWorkbench projectId="p1" /></ToastProvider>);
    await waitFor(() => expect(screen.getByTestId("page-project-workbench")).toBeInTheDocument());
    expect(screen.getByTestId("topnav")).toBeInTheDocument();
    expect(screen.getByTestId("pw-sidebar").className).toMatch(/bg-bg-0/);
  });
});
