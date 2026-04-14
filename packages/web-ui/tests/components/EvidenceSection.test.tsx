import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EvidenceSection } from "../../src/components/evidence/EvidenceSection";
import { ToastProvider } from "../../src/components/ui/ToastProvider";

vi.mock("../../src/api/evidence-client", () => ({
  getProjectEvidence: vi.fn(async () => ({
    cases: {
      "case-01": { has_screenshot: true, has_notes: true, has_generated: true, complete: true,
        counts: { screenshots: 2, recordings: 1, generated: 3 }, last_updated_at: "" },
      "case-02": { has_screenshot: true, has_notes: false, has_generated: false, complete: false,
        counts: { screenshots: 1, recordings: 0, generated: 0 }, last_updated_at: "" },
    },
    all_complete: false,
    submitted_at: null,
    index_path: "evidence/index.md",
  })),
  submitEvidence: vi.fn(async () => {}),
}));

vi.mock("../../src/hooks/useProjectStream", () => ({
  useProjectStream: () => ({ events: [], activeAgents: [] }),
}));

function wrap(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe("EvidenceSection", () => {
  it("renders per-case rows with badges", async () => {
    const onSelect = vi.fn();
    wrap(<EvidenceSection projectId="p1" selectedCaseId={null} onSelectCase={onSelect} />);
    await waitFor(() => screen.getByText(/case-01/));
    expect(screen.getByText(/case-02/)).toBeInTheDocument();
    expect(screen.getByText(/1\/2 完整/)).toBeInTheDocument();
  });

  it("submit button disabled when not all complete", async () => {
    wrap(<EvidenceSection projectId="p1" selectedCaseId={null} onSelectCase={() => {}} />);
    await waitFor(() => screen.getByText(/case-01/));
    expect(screen.getByRole("button", { name: /提交 Evidence/ })).toBeDisabled();
  });

  it("clicking case row triggers onSelectCase", async () => {
    const onSelect = vi.fn();
    wrap(<EvidenceSection projectId="p1" selectedCaseId={null} onSelectCase={onSelect} />);
    await waitFor(() => screen.getByText(/case-01/));
    fireEvent.click(screen.getByTestId("case-row-case-01"));
    expect(onSelect).toHaveBeenCalledWith("case-01");
  });
});
